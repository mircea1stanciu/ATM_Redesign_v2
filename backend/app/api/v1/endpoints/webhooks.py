"""
Webhook endpoints pentru GitHub și GitLab.
Permite declanșarea automată a unui test run la push sau pull_request/merge_request.

Configurare per-proiect (câmpul config_json):
  {
    "webhook_secret": "<secret>",   # GitHub HMAC secret sau GitLab token
    ...
  }
"""
import hashlib
import hmac
import logging
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.models import Project, TestSuite
from app.schemas.test_runs import TestRunCreate
from app.services.test_run_service import TestRunService
from app.workers.tasks import execute_test_run_task

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_project_or_404(db: AsyncSession, project_id: str) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _get_first_active_suite(db: AsyncSession, project_id: str) -> TestSuite:
    result = await db.execute(
        select(TestSuite)
        .where(TestSuite.project_id == project_id, TestSuite.active.is_(True))
        .order_by(TestSuite.created_at)
        .limit(1)
    )
    suite = result.scalar_one_or_none()
    if not suite:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No active test suite found for this project",
        )
    return suite


async def _create_and_dispatch(
    db: AsyncSession,
    suite_id: str,
    project_id: str,
    branch: str,
    commit_sha: str,
    triggered_by: str,
) -> dict[str, Any]:
    run_data = TestRunCreate(
        suite_id=suite_id,
        branch=branch,
        commit_sha=commit_sha,
        triggered_by=triggered_by,
    )
    run = await TestRunService.create_run(db, run_data)
    execute_test_run_task.delay(str(run.id), suite_id, project_id)
    return {"run_id": str(run.id), "status": "queued"}


# ---------------------------------------------------------------------------
# GitHub webhook  POST /api/v1/webhooks/github/{project_id}
# ---------------------------------------------------------------------------

@router.post(
    "/github/{project_id}",
    summary="GitHub push / pull_request webhook",
    tags=["webhooks"],
)
async def github_webhook(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_hub_signature_256: str = Header(default=""),
    x_github_event: str = Header(default=""),
):
    """
    Primeşte evenimentele GitHub **push** şi **pull_request**.

    Secretul webhook (HMAC-SHA256) trebuie configurat în `config_json.webhook_secret`
    al proiectului. Dacă secretul nu este configurat, verificarea semnăturii este omisă
    (nerecomandat în producţie).
    """
    project = await _get_project_or_404(db, project_id)
    body = await request.body()

    # Verificare semnătură HMAC-SHA256
    secret: str = (project.config_json or {}).get("webhook_secret", "")
    if secret:
        expected = "sha256=" + hmac.new(
            secret.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, x_hub_signature_256):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid webhook signature",
            )

    # Acceptăm doar push şi pull_request
    if x_github_event not in ("push", "pull_request"):
        return {"ignored": True, "event": x_github_event}

    payload: dict[str, Any] = await request.json()

    # Extrage branch şi commit
    if x_github_event == "push":
        ref: str = payload.get("ref", "refs/heads/main")
        branch = ref.removeprefix("refs/heads/")
        commit_sha = (payload.get("head_commit") or {}).get("id", "")
    else:  # pull_request
        pr = payload.get("pull_request", {})
        branch = pr.get("head", {}).get("ref", "")
        commit_sha = pr.get("head", {}).get("sha", "")
        action = payload.get("action", "")
        # Declanşăm doar la deschidere/sincronizare
        if action not in ("opened", "synchronize", "reopened"):
            return {"ignored": True, "action": action}

    suite = await _get_first_active_suite(db, project_id)
    return await _create_and_dispatch(
        db,
        suite_id=str(suite.id),
        project_id=project_id,
        branch=branch,
        commit_sha=commit_sha,
        triggered_by="github-webhook",
    )


# ---------------------------------------------------------------------------
# GitLab webhook  POST /api/v1/webhooks/gitlab/{project_id}
# ---------------------------------------------------------------------------

@router.post(
    "/gitlab/{project_id}",
    summary="GitLab push / merge_request webhook",
    tags=["webhooks"],
)
async def gitlab_webhook(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_gitlab_token: str = Header(default=""),
    x_gitlab_event: str = Header(default=""),
):
    """
    Primeşte evenimentele GitLab **Push Hook** şi **Merge Request Hook**.

    Secretul webhook trebuie configurat în `config_json.webhook_secret` al proiectului.
    """
    project = await _get_project_or_404(db, project_id)

    # Verificare token simplu GitLab
    secret: str = (project.config_json or {}).get("webhook_secret", "")
    if secret and x_gitlab_token != secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook token",
        )

    payload: dict[str, Any] = await request.json()
    event_type = x_gitlab_event or payload.get("object_kind", "")

    if event_type == "push":
        ref: str = payload.get("ref", "refs/heads/main")
        branch = ref.removeprefix("refs/heads/")
        commit_sha = payload.get("checkout_sha", "")
    elif event_type in ("merge_request", "Merge Request Hook"):
        attrs = payload.get("object_attributes", {})
        branch = attrs.get("source_branch", "")
        commit_sha = attrs.get("last_commit", {}).get("id", "")
        action = attrs.get("action", "")
        if action not in ("open", "update", "reopen"):
            return {"ignored": True, "action": action}
    else:
        return {"ignored": True, "event": event_type}

    suite = await _get_first_active_suite(db, project_id)
    return await _create_and_dispatch(
        db,
        suite_id=str(suite.id),
        project_id=project_id,
        branch=branch,
        commit_sha=commit_sha,
        triggered_by="gitlab-webhook",
    )
