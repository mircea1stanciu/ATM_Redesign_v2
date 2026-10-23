"""
Project Management API Routes - Jira-like functionality
"""
import asyncio
import io
import json
import os
import shutil
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.allure_report_template import render_report_html
from app.core.config import BACKEND_DIR
from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
from app.modules.identity.models import UserRole
from app.modules.projects.checkouts import (
    checkout_path,
    read_linked_path,
    require_checkout,
    save_linked_path,
    service_project,
)
from app.modules.projects.models import AllureReport, AnalyticsRun, AnalyticsSuite, Project

router = APIRouter(prefix="/api/projects", tags=["Projects"])
analytics_router = APIRouter(prefix="/api", tags=["Analytics"])
manual_run_sockets: dict[str, set[WebSocket]] = {}
# Running Appium (Maven) processes, so they can be cancelled.
manual_run_processes: dict[str, int] = {}
cancelled_manual_runs: set[str] = set()
# Strong references so fire-and-forget run tasks are not garbage-collected.
_run_tasks: set[asyncio.Task] = set()


def _spawn_run_task(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _run_tasks.add(task)
    task.add_done_callback(_run_tasks.discard)
    return task


# Helper functions for access control
def check_product_manager_access(current_user):
    """Check if user has Product Manager access for create/update/delete operations
    
    Requirements:
    - Must have "product" in assigned_communities (any role), OR
    - Super Admin or Org Admin
    """
    # Super admins and org admins have full access
    if current_user.role in [UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN]:
        return True
    
    # Check if user has "product" in their assigned communities (works for both community_lead and user roles)
    if current_user.assigned_communities:
        try:
            communities = json.loads(current_user.assigned_communities)
            if "product" in communities:
                return True
        except Exception:
            pass
    
    raise HTTPException(
        status_code=403, 
        detail=(
            "Access denied. Only users assigned to Product Management "
            "community can create, edit, or delete projects."
        )
    )


def check_organization_member(current_user):
    """Check if user belongs to an organization (for read operations)"""
    if not current_user.organization_id:
        raise HTTPException(
            status_code=403, 
            detail="Access denied. User must belong to an organization."
        )
    return True


# Pydantic Schemas
class ProjectCreate(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    community_id: str
    icon: str = "📋"
    color: str = "blue"


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    lead_user_id: Optional[int] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


# Project Endpoints
@router.get("/")
async def list_projects(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return projects in the test-automation client contract."""
    if not current_user.organization_id:
        return []

    projects = db.query(Project).filter(
        Project.organization_id == current_user.organization_id,
        Project.is_archived.is_(False)
    ).all()

    return [
        {
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "git_repo_url": project.github_repo_url or "",
            "git_provider": "github",
            "default_branch": "main",
            "framework": None,
            "config_json": None,
            "created_at": project.created_at.isoformat() if project.created_at else None,
        }
        for project in projects
    ]


@router.post("/")
async def create_project(
    project_data: ProjectCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new project - Only Product Managers"""
    # Check access
    check_product_manager_access(current_user)
    
    # Check if project key already exists
    existing = db.query(Project).filter(Project.key == project_data.key.upper()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Project key already exists")
    
    project = Project(
        key=project_data.key.upper(),
        name=project_data.name,
        description=project_data.description,
        community_id=project_data.community_id,
        organization_id=current_user.organization_id,
        icon=project_data.icon,
        color=project_data.color,
        created_by_user_id=current_user.id,
        lead_user_id=current_user.id
    )
    
    db.add(project)
    db.commit()
    db.refresh(project)
    
    return {"message": "Project created successfully", "project": project}


@router.get("/{project_id}")
async def get_project(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get project details - All organization members can view"""
    # Check user belongs to organization
    check_organization_member(current_user)
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {"project": project}


@router.patch("/{project_id}")
async def update_project(
    project_id: int,
    project_data: ProjectUpdate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update project - Only Product Managers"""
    # Check access
    check_product_manager_access(current_user)
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Update fields
    for field, value in project_data.dict(exclude_unset=True).items():
        setattr(project, field, value)
    
    db.commit()
    db.refresh(project)
    
    return {"message": "Project updated successfully", "project": project}


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete project - Only Product Managers"""
    # Check access
    check_product_manager_access(current_user)
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Delete the project (cascade will delete related issues, sprints, etc.)
    db.delete(project)
    db.commit()
    
    return {"message": "Project deleted successfully"}


# ── Per-project GitHub settings ───────────────────────────────────────────────
class ProjectGitHubConfig(BaseModel):
    github_token: Optional[str] = None
    github_repo_url: Optional[str] = None


class ProjectGitHubResponse(BaseModel):
    github_token_set: bool
    github_token_preview: str
    github_repo_url: str


class ProjectGitHubTestResponse(BaseModel):
    ok: bool
    login: Optional[str] = None
    name: Optional[str] = None
    error: Optional[str] = None


class LocalRepoLinkExistingRequest(BaseModel):
    path: str
    branch: Optional[str] = None


class LocalRepoImportRequest(BaseModel):
    path: str
    branch: Optional[str] = None


class GitHubRunsSyncRequest(BaseModel):
    workflow_id: Optional[str] = None
    collection: Optional[str] = None
    branch: Optional[str] = None
    limit: int = 100


class AnalyticsSuiteCreate(BaseModel):
    name: str
    tags: list[str] = []
    active: bool = True


RUN_NAME_MAX_LENGTH = 120


def _clean_run_name(name: Optional[str]) -> Optional[str]:
    cleaned = " ".join((name or "").split())
    if len(cleaned) > RUN_NAME_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Run name must be at most {RUN_NAME_MAX_LENGTH} characters.")
    return cleaned or None


class AnalyticsRunCreate(BaseModel):
    suite_id: str
    branch: Optional[str] = None
    commit_sha: Optional[str] = None
    triggered_by: Optional[str] = None
    collection: Optional[str] = None
    name: Optional[str] = None


class AnalyticsRunRename(BaseModel):
    name: Optional[str] = None


class AnalyticsRunExecuteRequest(BaseModel):
    run_project: Optional[str] = None
    run_collection: Optional[str] = None
    run_environment: Optional[str] = None
    # Appium (Maven) runs: run_type="appium", appium_target="runner:<Class>" or
    # "suite:<folder>/<file.xml>".
    run_type: Optional[str] = None
    appium_target: Optional[str] = None
    app_env: Optional[str] = None
    device_run_option: Optional[str] = None
    # Any other framework: run_type="framework", framework_target=<id from /local/frameworks>.
    framework_target: Optional[str] = None
    extra_args: Optional[str] = None
    # Bruno: run only these requests/folders (relative to the collection), e.g. the changed ones.
    run_requests: Optional[list[str]] = None


def _user_settings(user) -> dict:
    return dict(getattr(user, "settings_json", None) or {})


def _read_user_project_github_token(user, project_id) -> str:
    data = _user_settings(user)
    token_map = data.get("project_github_tokens")
    if not isinstance(token_map, dict):
        return ""
    return str(token_map.get(str(project_id)) or "")


def _set_user_project_github_token(db: Session, user, project_id, token: str) -> None:
    data = _user_settings(user)
    # Copy the nested dict rather than mutating in place; SQLAlchemy only
    # detects a change (and flushes JSON) when the column is reassigned.
    token_map = dict(data.get("project_github_tokens") or {})
    if token:
        token_map[str(project_id)] = token
    else:
        token_map.pop(str(project_id), None)
    data["project_github_tokens"] = token_map
    user.settings_json = data
    db.commit()
    db.refresh(user)


def _token_preview(token: str) -> str:
    return ("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else "")


def _build_github_user_endpoint(base_url: str) -> str:
    """Build /user endpoint for GitHub.com or GitHub Enterprise hosts."""
    if not base_url:
        return "https://api.github.com/user"

    parsed = urlparse(base_url)
    if not parsed.scheme or not parsed.netloc:
        return "https://api.github.com/user"

    host = parsed.netloc.lower()
    path = (parsed.path or "").strip("/")

    if host == "github.com" or host.endswith(".github.com"):
        return "https://api.github.com/user"

    if path.startswith("api/v3"):
        return f"{parsed.scheme}://{parsed.netloc}/{path}/user"
    return f"{parsed.scheme}://{parsed.netloc}/api/v3/user"


def _github_repository_context(project, current_user, project_id: int):
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")

    repo_url = (project.github_repo_url or "").strip()
    owner, repo, parsed = _github_repository_identity(repo_url)
    host = parsed.netloc.lower()
    if host == "github.com" or host.endswith(".github.com"):
        api_base = "https://api.github.com"
    else:
        api_base = f"{parsed.scheme}://{parsed.netloc}/api/v3"
    return owner, repo, api_base, token


def _github_repository_identity(repo_url: str):
    normalized_url = repo_url
    if repo_url.startswith("git@") and ":" in repo_url:
        host, path = repo_url[4:].split(":", 1)
        normalized_url = f"https://{host}/{path}"
    parsed = urlparse(normalized_url)
    path_parts = parsed.path.strip("/").removesuffix(".git").split("/")
    if len(path_parts) < 2 or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Could not parse GitHub repo URL.")
    return path_parts[-2].lower(), path_parts[-1].lower(), parsed


def _github_headers(token: str, scheme: str = "Bearer") -> dict:
    return {
        "Authorization": f"{scheme} {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def _github_get(
    client: httpx.AsyncClient, url: str, token: str, accept: str = "application/vnd.github+json", **kwargs
):
    headers = _github_headers(token)
    headers["Accept"] = accept
    response = await client.get(url, headers=headers, **kwargs)
    if response.status_code == 401:
        headers = _github_headers(token, "token")
        headers["Accept"] = accept
        response = await client.get(url, headers=headers, **kwargs)
    return response


async def _list_legacy_github_folder(
    client, api_base: str, owner: str, repo: str, folder: str, ref: str, token: str
) -> list[dict]:
    response = await _github_get(
        client,
        f"{api_base}/repos/{owner}/{repo}/contents/{folder}",
        token,
        params={"ref": ref},
    )
    if response.status_code == 404:
        return []
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code == 401 else response.status_code, detail=response.text[:200]
        )
    data = response.json()
    return data if isinstance(data, list) else []


def _legacy_project_or_404(db: Session, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _parse_github_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse a GitHub API ISO8601 timestamp (e.g. 2024-01-01T00:00:00Z) to naive UTC."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _allure_results_from_json_entries(entries) -> list[dict]:
    results = []
    for entry in entries:
        try:
            data = json.loads(entry)
        except (TypeError, ValueError):
            continue
        if not isinstance(data, dict) or not data.get("status") or not (data.get("name") or data.get("fullName")):
            continue
        status = str(data.get("status") or "unknown").lower()
        duration = data.get("duration")
        if not isinstance(duration, (int, float)):
            start, stop = data.get("start"), data.get("stop")
            duration = stop - start if isinstance(start, (int, float)) and isinstance(stop, (int, float)) else 0
        details = data.get("statusDetails") if isinstance(data.get("statusDetails"), dict) else {}
        results.append({
            "name": str(data.get("fullName") or data.get("name")),
            "class_name": str(data.get("historyId") or "") or None,
            "status": status,
            "duration_ms": max(0, int(duration or 0)),
            "message": str(details.get("message") or "") or None,
        })
    return results


def _save_allure_report(
    db: Session,
    project_id: int,
    source: str,
    external_id: str,
    name: str,
    results: list[dict],
    branch: Optional[str] = None,
    workflow_name: Optional[str] = None,
    report_url: Optional[str] = None,
    occurred_at: Optional[datetime] = None,
) -> bool:
    report = db.query(AllureReport).filter(
        AllureReport.project_id == project_id,
        AllureReport.source == source,
        AllureReport.external_id == external_id,
    ).first()
    created = report is None
    if report is None:
        report = AllureReport(project_id=project_id, source=source, external_id=external_id, name=name)
        db.add(report)
    # Reflect the real run date (not just import time) so date filtering,
    # sorting and "execution time" stay accurate for GitHub Actions imports.
    if occurred_at is not None:
        report.created_at = occurred_at

    status_counts = {status: 0 for status in ("passed", "failed", "broken", "skipped")}
    for result in results:
        status = result["status"]
        if status in status_counts:
            status_counts[status] += 1
    report.name = name
    report.branch = branch
    report.workflow_name = workflow_name
    report.report_url = report_url
    report.total_tests = len(results)
    report.passed_tests = status_counts["passed"]
    report.failed_tests = status_counts["failed"]
    report.broken_tests = status_counts["broken"]
    report.skipped_tests = status_counts["skipped"]
    report.duration_ms = sum(result["duration_ms"] for result in results)
    report.results_json = results
    return created


def _allure_report_response(report: AllureReport) -> dict:
    return {
        "id": report.id,
        "source": report.source,
        "name": report.name,
        "branch": report.branch,
        "workflow_name": report.workflow_name,
        "report_url": report.report_url,
        "total_tests": report.total_tests,
        "passed_tests": report.passed_tests,
        "failed_tests": report.failed_tests,
        "broken_tests": report.broken_tests,
        "skipped_tests": report.skipped_tests,
        "duration_ms": report.duration_ms,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "results": report.results_json or [],
    }


def _allure_run_status(report: AllureReport) -> str:
    if report.failed_tests or report.broken_tests:
        return "failed"
    if report.passed_tests:
        return "passed"
    return "skipped"


def _allure_run_response(report: AllureReport) -> dict:
    return {
        "id": f"allure-{report.id}",
        "suite_id": f"allure-suite-{report.project_id}",
        "status": _allure_run_status(report),
        "branch": report.branch,
        "commit_sha": None,
        "triggered_by": report.workflow_name or "Allure import",
        "source": report.source,
        "collection": report.name,
        "started_at": report.created_at.isoformat() if report.created_at else None,
        "finished_at": report.imported_at.isoformat() if report.imported_at else None,
        "total_tests": report.total_tests,
        "passed_tests": report.passed_tests,
        "failed_tests": report.failed_tests + report.broken_tests,
        "skipped_tests": report.skipped_tests,
        "created_at": report.created_at.isoformat() if report.created_at else datetime.utcnow().isoformat(),
    }


def _run_app_version_label(details: Optional[dict]) -> Optional[str]:
    app = (details or {}).get("app") or {}
    if not app.get("version") and not app.get("build"):
        return None
    build = f" ({app['build']})" if app.get("build") and app.get("build") != app.get("version") else ""
    return f"{app.get('name') or 'App'} {app.get('version') or ''}{build}".strip()


def _analytics_run_response(run: AnalyticsRun) -> dict:
    metadata = next(
        (item for item in (run.logs_json or []) if isinstance(item, dict) and item.get("type") == "github_actions"),
        {},
    )
    return {
        "id": f"manual-{run.id}",
        "name": run.name,
        "app_version": _run_app_version_label(run.details_json),
        "report_count": len((run.details_json or {}).get("reports") or []),
        "suite_id": str(run.suite_id),
        "status": run.status,
        "branch": run.branch,
        "commit_sha": run.commit_sha,
        "triggered_by": run.triggered_by,
        "source": "github_actions" if metadata else "local",
        "collection": run.collection,
        "environment": run.environment,
        "execution_time": run.started_at.isoformat()
        if run.started_at
        else run.created_at.isoformat()
        if run.created_at
        else None,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "total_tests": run.total_tests,
        "passed_tests": run.passed_tests,
        "failed_tests": run.failed_tests,
        "skipped_tests": run.skipped_tests,
        "created_at": run.created_at.isoformat() if run.created_at else datetime.utcnow().isoformat(),
    }


async def _broadcast_manual_run_message(run_id: str, payload: dict) -> None:
    sockets = manual_run_sockets.get(run_id, set()).copy()
    for socket in sockets:
        try:
            await socket.send_json(payload)
        except Exception:
            manual_run_sockets.get(run_id, set()).discard(socket)


def _append_manual_run_log(manual_run_id: int, payload: dict) -> None:
    _append_manual_run_logs(manual_run_id, [payload])


def _append_manual_run_logs(manual_run_id: int, payloads: list[dict]) -> None:
    """Persist log entries in one write (only the last 1000 are kept)."""
    if not payloads:
        return
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        if not run:
            return
        logs = list(run.logs_json or [])
        now = datetime.utcnow().isoformat()
        logs.extend({**payload, "timestamp": payload.get("timestamp") or now} for payload in payloads)
        run.logs_json = logs[-1000:]
        db.commit()
    finally:
        db.close()


async def _set_manual_run_status(run_id: str, manual_run_id: int, artifact_dir: Path, status: str) -> None:
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        if run:
            run.status = status
            if status not in ("running", "pending"):
                run.finished_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()
    payload = {"type": "status", "status": status, "timestamp": datetime.utcnow().isoformat()}
    _append_manual_run_log(manual_run_id, payload)
    _append_manual_run_artifact_log(artifact_dir, payload)
    metadata_path = artifact_dir / "metadata.json"
    if metadata_path.is_file():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["status"] = status
        metadata["finished_at"] = datetime.utcnow().isoformat() if status not in ("pending", "running") else None
        _write_manual_run_metadata(artifact_dir, metadata)
    await _broadcast_manual_run_message(run_id, payload)


def _manual_run_artifact_dir(repo_path: Path, run_id: str) -> Path:
    return repo_path / ".automationtestmanager" / "runs" / run_id


def _write_manual_run_metadata(artifact_dir: Path, metadata: dict) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def _append_manual_run_artifact_log(artifact_dir: Path, payload: dict) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    timestamp = payload.get("timestamp") or datetime.utcnow().isoformat()
    message = payload.get("data") or f"$ status: {payload.get('status') or ''}".rstrip()
    with (artifact_dir / "live.log").open("a", encoding="utf-8") as log_file:
        log_file.write(f"[{timestamp}] {message}\n")


def _write_manual_allure_report(artifact_dir: Path, run_id: str, run_name: str, results: list[dict]) -> None:
    allure_results_dir = artifact_dir / "allure-results"
    allure_results_dir.mkdir(parents=True, exist_ok=True)
    for index, result in enumerate(results):
        status = str(result.get("status") or "error").lower()
        allure_status = (
            "passed"
            if status == "passed"
            else "skipped"
            if status == "skipped"
            else "failed"
            if status == "failed"
            else "broken"
        )
        payload = {
            "uuid": f"{run_id}-{index}",
            "name": result.get("test_name") or "Unnamed test",
            "fullName": result.get("class_name") or result.get("test_name") or "Unnamed test",
            "status": allure_status,
            "statusDetails": {"message": result.get("error_message") or ""},
            "start": 0,
            "stop": int(result.get("duration_ms") or 0),
        }
        (allure_results_dir / f"{run_id}-{index}-result.json").write_text(
            json.dumps(payload, indent=2), encoding="utf-8"
        )

    raw_reporter_results: list[dict] = []
    reporter_path = artifact_dir / "results.json"
    if reporter_path.is_file():
        try:
            raw_payload = json.loads(reporter_path.read_text(encoding="utf-8"))
            for batch in raw_payload if isinstance(raw_payload, list) else []:
                raw_reporter_results.extend(batch.get("results", []) if isinstance(batch, dict) else [])
        except (OSError, ValueError):
            pass

    embedded_results = json.dumps(raw_reporter_results, ensure_ascii=False).replace("</", "<\\/")
    report_dir = artifact_dir / "allure-report"
    report_dir.mkdir(parents=True, exist_ok=True)
    fallback_results = json.dumps(results, ensure_ascii=False).replace("</", "<\\/")
    report_html = render_report_html(embedded_results, fallback_results, run_name)
    (report_dir / "index.html").write_text(report_html, encoding="utf-8")


@analytics_router.get("/suites/projects/{project_id}")
async def list_analytics_suites(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Expose imported Allure results as a virtual suite to the Analytics client."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    suites = (
        db.query(AnalyticsSuite)
        .filter(AnalyticsSuite.project_id == project_id)
        .order_by(AnalyticsSuite.created_at.desc())
        .all()
    )
    response = [{
        "id": str(suite.id),
        "project_id": str(project_id),
        "name": suite.name,
        "tags": suite.tags or [],
        "cron_expression": suite.cron_expression,
        "active": suite.active,
        "created_at": suite.created_at.isoformat() if suite.created_at else None,
    } for suite in suites]
    if db.query(AllureReport.id).filter(AllureReport.project_id == project_id).first():
        response.insert(0, {
            "id": f"allure-suite-{project_id}",
            "project_id": str(project_id),
            "name": "Allure Reports",
            "tags": ["allure"],
            "cron_expression": None,
            "active": True,
            "created_at": datetime.utcnow().isoformat(),
        })
    return response


@analytics_router.post("/suites/projects/{project_id}/suites")
async def create_analytics_suite(
    project_id: int,
    payload: AnalyticsSuiteCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create legacy suite metadata for a project."""
    check_organization_member(current_user)
    check_product_manager_access(current_user)
    _legacy_project_or_404(db, project_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Suite name is required.")
    suite = AnalyticsSuite(
        project_id=project_id,
        name=name,
        tags=[tag.strip() for tag in payload.tags if tag.strip()],
        active=payload.active,
    )
    db.add(suite)
    db.commit()
    db.refresh(suite)
    return {
        "id": str(suite.id),
        "project_id": str(project_id),
        "name": suite.name,
        "tags": suite.tags or [],
        "cron_expression": suite.cron_expression,
        "active": suite.active,
        "created_at": suite.created_at.isoformat() if suite.created_at else None,
    }


@analytics_router.get("/runs/projects/{project_id}")
async def list_analytics_runs(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return imported local and GitHub Allure reports in the standard run list contract."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    reports = (
        db.query(AllureReport)
        .filter(AllureReport.project_id == project_id)
        .order_by(AllureReport.created_at.desc())
        .all()
    )
    suite_ids = [suite.id for suite in db.query(AnalyticsSuite).filter(AnalyticsSuite.project_id == project_id).all()]
    manual_runs = (
        db.query(AnalyticsRun)
        .filter(AnalyticsRun.suite_id.in_(suite_ids))
        .order_by(AnalyticsRun.created_at.desc())
        .all()
        if suite_ids
        else []
    )
    combined = [_allure_run_response(report) for report in reports] + [
        _analytics_run_response(run) for run in manual_runs
    ]
    return sorted(combined, key=lambda run: run["created_at"], reverse=True)


@analytics_router.post("/runs")
async def create_analytics_run(
    payload: AnalyticsRunCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a local pending run from a legacy project suite."""
    check_organization_member(current_user)
    try:
        suite_id = int(payload.suite_id)
    except ValueError:
        if not payload.suite_id.startswith("allure-suite-"):
            raise HTTPException(status_code=400, detail="A valid project suite is required for local runs.")
        try:
            project_id = int(payload.suite_id.removeprefix("allure-suite-"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Allure suite reference.")
        _legacy_project_or_404(db, project_id)
        suite = db.query(AnalyticsSuite).filter(
            AnalyticsSuite.project_id == project_id,
            AnalyticsSuite.name == "Default Suite",
        ).first()
        if not suite:
            suite = AnalyticsSuite(project_id=project_id, name="Default Suite", tags=[], active=True)
            db.add(suite)
            db.commit()
            db.refresh(suite)
        suite_id = suite.id
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    _legacy_project_or_404(db, suite.project_id)
    run = AnalyticsRun(
        suite_id=suite.id,
        branch=payload.branch,
        commit_sha=payload.commit_sha,
        triggered_by=payload.triggered_by,
        name=_clean_run_name(payload.name),
        collection=payload.collection,
        collection_path=payload.collection,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return _analytics_run_response(run)


@analytics_router.patch("/runs/{run_id}")
async def rename_analytics_run(
    run_id: str,
    payload: AnalyticsRunRename,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set or clear the display name of a local run."""
    check_organization_member(current_user)
    if not run_id.startswith("manual-"):
        raise HTTPException(status_code=400, detail="Only local runs can be renamed.")
    try:
        manual_run_id = int(run_id.removeprefix("manual-"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Run not found")
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    _legacy_project_or_404(db, suite.project_id)
    run.name = _clean_run_name(payload.name)
    db.commit()
    db.refresh(run)
    return _analytics_run_response(run)


@analytics_router.get("/runs/{run_id}")
async def get_analytics_run_details(
    run_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    check_organization_member(current_user)
    if run_id.startswith("manual-"):
        try:
            manual_run_id = int(run_id.removeprefix("manual-"))
        except ValueError:
            raise HTTPException(status_code=404, detail="Run not found")
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first()
        if not suite:
            raise HTTPException(status_code=404, detail="Suite not found")
        _legacy_project_or_404(db, suite.project_id)
        results = [
            {
                "id": f"manual-result-{run.id}-{index}",
                "run_id": run_id,
                "test_name": result.get("test_name") or "Unnamed test",
                "class_name": result.get("class_name"),
                "status": result.get("status") or "error",
                "duration_ms": result.get("duration_ms"),
                "error_message": result.get("error_message"),
                "stack_trace": result.get("stack_trace"),
            }
            for index, result in enumerate(run.results_json or [])
        ]
        details = dict(run.details_json or {})
        details.pop("artifact_dir", None)
        return {**_analytics_run_response(run), "results": results, "details": details or None}

    if not run_id.startswith("allure-"):
        raise HTTPException(status_code=404, detail="Run not found")
    try:
        report_id = int(run_id.removeprefix("allure-"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Run not found")
    report = db.query(AllureReport).filter(AllureReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Run not found")
    results = []
    for index, result in enumerate(report.results_json or []):
        allure_status = str(result.get("status") or "unknown").lower()
        status = (
            "passed"
            if allure_status == "passed"
            else "skipped"
            if allure_status == "skipped"
            else "failed"
            if allure_status == "failed"
            else "error"
        )
        results.append({
            "id": f"allure-result-{report.id}-{index}",
            "run_id": run_id,
            "test_name": result.get("name") or "Unnamed test",
            "class_name": result.get("class_name"),
            "status": status,
            "duration_ms": result.get("duration_ms"),
            "error_message": result.get("message"),
            "stack_trace": None,
        })
    return {**_allure_run_response(report), "results": results}


@analytics_router.get("/runs/{run_id}/reports/{file_name}")
async def get_run_report_file(
    run_id: str,
    file_name: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve a report document captured for this run (copied into the run's artifacts)."""
    import mimetypes

    check_organization_member(current_user)
    if not run_id.startswith("manual-"):
        raise HTTPException(status_code=404, detail="Report not found")
    try:
        manual_run_id = int(run_id.removeprefix("manual-"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Report not found")
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    _legacy_project_or_404(db, suite.project_id)
    details = run.details_json or {}
    if file_name not in {report.get("file") for report in details.get("reports") or []}:
        raise HTTPException(status_code=404, detail="Report not found")
    reports_dir = (Path(details.get("artifact_dir") or "") / "reports").resolve()
    path = (reports_dir / file_name).resolve()
    if reports_dir not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Report file is no longer available.")
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name.split("-", 1)[-1],
                        content_disposition_type="inline")


@analytics_router.get("/runs/{run_id}/allure-report")
async def get_manual_allure_report(
    run_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve the generated Allure-style HTML report for one local execution."""
    check_organization_member(current_user)
    if not run_id.startswith("manual-"):
        raise HTTPException(status_code=404, detail="Allure report not found")
    try:
        manual_run_id = int(run_id.removeprefix("manual-"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Allure report not found")
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    repo_path = checkout_path(current_user, suite.project_id)
    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    _write_manual_allure_report(artifact_dir, run_id, run.collection or run_id, list(run.results_json or []))
    report_path = artifact_dir / "allure-report" / "index.html"
    if not report_path.is_file():
        raise HTTPException(status_code=404, detail="Allure report is not available until this run completes.")
    return FileResponse(report_path, media_type="text/html")


def _bruno_run_details(argv: list, collection: str, environment: str, started: datetime, exit_code,
                       artifact_dir: Path, report_files) -> dict:
    from app.services.appium_project_service import store_reports

    reports = [Path(p) for p in report_files if Path(p).is_file()]
    try:
        stored = store_reports(artifact_dir, reports, artifact_dir / "reports") if reports else []
    except OSError:
        stored = []
    return {
        "type": "bruno",
        "command": list(argv),
        "target": {"kind": "collection", "name": collection},
        "app_env": environment,
        "duration_seconds": round((datetime.utcnow() - started).total_seconds(), 1),
        "exit_code": exit_code,
        "technology": {"test_runner": "Bruno CLI"},
        "reports": stored,
        "artifact_dir": str(artifact_dir),
    }


async def _execute_manual_run_background(
    run_id: str,
    manual_run_id: int,
    repo_path: Path,
    run_collection: str,
    run_environment: str,
    run_requests: Optional[list[str]] = None,
) -> None:
    """Run a Bruno collection in the linked checkout and stream output via WebSocket."""
    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)

    async def log(text: str, level: str = "stdout") -> None:
        payload = {"type": level, "data": text, "timestamp": datetime.utcnow().isoformat()}
        _append_manual_run_log(manual_run_id, payload)
        _append_manual_run_artifact_log(artifact_dir, payload)
        await _broadcast_manual_run_message(run_id, payload)

    async def set_status(status: str) -> None:
        await _set_manual_run_status(run_id, manual_run_id, artifact_dir, status)

    try:
        collection_dir = (repo_path / run_collection.strip("/")).resolve()
        if repo_path not in [collection_dir, *collection_dir.parents]:
            await log(f"$ Error: '{run_collection}' is outside the checkout.", "stderr")
            await set_status("failed")
            return
        if not collection_dir.is_dir():
            await log(f"$ Error: collection directory '{run_collection}' not found.", "stderr")
            await set_status("failed")
            return

        env_file = collection_dir / "environments" / f"{run_environment}.bru"
        if not env_file.is_file():
            # Try one level up (collection lives at project/collection, envs at project/environments)
            env_file = collection_dir.parent / "environments" / f"{run_environment}.bru"
        env_path = (
            str(env_file.relative_to(collection_dir)) if env_file.is_file() else f"environments/{run_environment}.bru"
        )

        bru_bin = shutil.which("bru")
        paths = [p for p in (run_requests or []) if p and p != "."]
        if bru_bin:
            argv = [bru_bin, "run", *paths, "-r", "--sandbox", "developer", "--env-file", env_path]
        else:
            await log("$ `bru` not in PATH – trying npx @usebruno/cli ...")
            argv = ["npx", "--yes", "@usebruno/cli", "run", *paths, "-r", "--sandbox", "developer",
                    "--env-file", env_path]
        if paths:
            await log(f"$ Running only {len(paths)} changed request(s)/folder(s) of the collection.")

        junit_path = artifact_dir / "results.xml"
        json_path = artifact_dir / "results.json"
        argv.extend(["--reporter-junit", str(junit_path), "--reporter-json", str(json_path)])

        bruno_started = datetime.utcnow()
        await log(f"$ Working dir: {collection_dir}")
        await log(f"$ Command:     {' '.join(argv)}")
        await log("─" * 60)

        run_env = {**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"}
        from app.services.appium_project_service import process_group_kwargs

        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(collection_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=run_env,
            **process_group_kwargs(),
        )
        manual_run_processes[run_id] = proc.pid

        output_lines: dict[str, list[str]] = {"stdout": [], "stderr": []}

        async def stream(pipe, level: str) -> None:
            while True:
                line = await pipe.readline()
                if not line:
                    break
                text_line = line.decode("utf-8", errors="replace").rstrip()
                output_lines[level].append(text_line)
                await log(text_line, level)

        stdout_task = asyncio.create_task(stream(proc.stdout, "stdout"))
        stderr_task = asyncio.create_task(stream(proc.stderr, "stderr"))
        try:
            exit_code = await asyncio.wait_for(proc.wait(), timeout=600)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise
        finally:
            manual_run_processes.pop(run_id, None)
        await asyncio.gather(stdout_task, stderr_task)

        if run_id in cancelled_manual_runs:
            cancelled_manual_runs.discard(run_id)
            await log("$ Execution stopped by user.", "stderr")
            return

        await log("─" * 60)
        await log(f"$ Exit code: {exit_code}")
        from app.services.junit_parser import TestResultBuilder
        try:
            if junit_path.is_file():
                parsed_results = TestResultBuilder.from_junit_output(
                    junit_path.read_text(encoding="utf-8", errors="replace"),
                    "\n".join(output_lines["stdout"]),
                    "\n".join(output_lines["stderr"]),
                )
            else:
                parsed_results = TestResultBuilder.from_raw_output(
                    "\n".join(output_lines["stdout"]),
                    "\n".join(output_lines["stderr"]),
                    "bruno",
                )
        except Exception:
            parsed_results = {
                "test_results": [],
                "total_tests": 0,
                "passed_tests": 0,
                "failed_tests": 0,
                "skipped_tests": 0,
            }

        if not parsed_results["test_results"]:
            parsed_results["test_results"] = [{
                "test_name": run_collection,
                "class_name": "Bruno collection",
                "status": "passed" if exit_code == 0 else "failed",
                "duration_ms": None,
                "error_message": None if exit_code == 0 else "Bruno returned a non-zero exit code.",
                "stack_trace": None,
            }]
            parsed_results["total_tests"] = 1
            parsed_results["passed_tests"] = int(exit_code == 0)
            parsed_results["failed_tests"] = int(exit_code != 0)

        db = SessionLocal()
        try:
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
            if run:
                run.results_json = parsed_results["test_results"]
                run.total_tests = parsed_results["total_tests"]
                run.passed_tests = parsed_results["passed_tests"]
                run.failed_tests = parsed_results["failed_tests"]
                run.skipped_tests = parsed_results["skipped_tests"]
                run.details_json = _bruno_run_details(argv, run_collection, run_environment, bruno_started,
                                                      exit_code, artifact_dir, (junit_path, json_path))
                db.commit()
                _write_manual_allure_report(
                    artifact_dir, run_id, run.collection or run_collection, parsed_results["test_results"]
                )
        finally:
            db.close()
        for source_dir in (collection_dir / "allure-results", repo_path / "allure-results"):
            if source_dir.is_dir():
                target_dir = artifact_dir / "allure-results"
                if target_dir.exists():
                    shutil.rmtree(target_dir)
                shutil.copytree(source_dir, target_dir)
                await log(f"$ Saved Allure results: {target_dir}")
                break
        if exit_code == 0:
            await log("$ ✓ Tests PASSED")
            await set_status("passed")
        else:
            await log("$ ✗ Tests FAILED", "stderr")
            await set_status("failed")

    except asyncio.TimeoutError:
        await log("$ Timed out waiting for process to finish.", "stderr")
        await set_status("error")
    except Exception as exc:
        await log(f"$ Execution error: {exc}", "stderr")
        await set_status("error")


APPIUM_RUN_TIMEOUT_SECONDS = 4 * 60 * 60
_APPIUM_LOG_FLUSH_LINES = 100
_APPIUM_LOG_FLUSH_SECONDS = 1.0
_APPIUM_POLL_SECONDS = 0.5


# Appium runs can take hours, so their process id and output position are kept
# on disk; after a backend restart the run is re-attached (live log, Stop, results).
def _run_registry_path() -> Path:
    from app.core.config import settings as app_settings

    directory = Path(app_settings.ARTIFACTS_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "manual-run-processes.json"


def _load_run_registry() -> dict:
    try:
        return json.loads(_run_registry_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_run_registry(registry: dict) -> None:
    path = _run_registry_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(registry, indent=2), encoding="utf-8")
    tmp.replace(path)


def _update_run_registry(run_id: str, entry: Optional[dict]) -> None:
    registry = _load_run_registry()
    if entry is None:
        registry.pop(run_id, None)
    else:
        registry[run_id] = {**registry.get(run_id, {}), **entry}
    _save_run_registry(registry)


class _ManualRunLogger:
    """Streams log lines to WebSocket clients and live.log; batches DB writes."""

    def __init__(self, run_id: str, manual_run_id: int, artifact_dir: Path):
        import time as time_module

        self._clock = time_module.monotonic
        self.run_id = run_id
        self.manual_run_id = manual_run_id
        self.artifact_dir = artifact_dir
        self.pending: list[dict] = []
        self.last_flush = self._clock()

    def flush(self) -> None:
        _append_manual_run_logs(self.manual_run_id, self.pending)
        self.pending.clear()
        self.last_flush = self._clock()

    async def log(self, text: str, level: str = "stdout") -> None:
        payload = {"type": level, "data": text, "timestamp": datetime.utcnow().isoformat()}
        self.pending.append(payload)
        _append_manual_run_artifact_log(self.artifact_dir, payload)
        await _broadcast_manual_run_message(self.run_id, payload)
        if len(self.pending) >= _APPIUM_LOG_FLUSH_LINES or self._clock() - self.last_flush >= _APPIUM_LOG_FLUSH_SECONDS:
            self.flush()

    async def finish(self, status: str) -> None:
        self.flush()
        await _set_manual_run_status(self.run_id, self.manual_run_id, self.artifact_dir, status)


async def _execute_appium_run_background(run_id: str, manual_run_id: int, repo_path: Path, plan) -> None:
    """Start an Appium Cucumber runner / TestNG suite with Maven and follow it."""
    import time as time_module

    from app.services import appium_project_service as appium

    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    logger = _ManualRunLogger(run_id, manual_run_id, artifact_dir)
    started = time_module.time()
    try:
        await logger.log(f"$ Working dir: {plan.cwd}")
        await logger.log(f"$ Command:     {' '.join(plan.argv)}")
        if plan.java_home:
            await logger.log(f"$ JAVA_HOME:   {plan.java_home}")
        for warning in plan.warnings:
            await logger.log(f"$ Warning: {warning}", "stderr")
        await logger.log("─" * 60)

        # Read the installed app version before the tests run (they may reinstall/remove it).
        app_before = await appium.detect_app_version(plan.meta)
        if app_before:
            await logger.log(f"$ App under test: {app_before.get('name')} {app_before.get('version') or ''}"
                             f" ({app_before.get('build') or '?'})")

        artifact_dir.mkdir(parents=True, exist_ok=True)
        # Output goes to a file (not a pipe) so the run survives a backend restart.
        with open(artifact_dir / "process.log", "wb") as output:
            proc = await asyncio.create_subprocess_exec(
                *plan.argv,
                cwd=plan.cwd,
                env=plan.env,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=output,
                stderr=asyncio.subprocess.STDOUT,
                **appium.process_group_kwargs(),
            )
    except Exception as exc:
        await logger.log(f"$ Execution error: {exc}", "stderr")
        await logger.finish("error")
        return

    manual_run_processes[run_id] = proc.pid
    seed = {"meta": plan.meta, "command": plan.argv, "java_home": plan.java_home, "app_before": app_before}
    _update_run_registry(run_id, {
        "manual_run_id": manual_run_id,
        "pid": proc.pid,
        "repo_path": str(repo_path),
        "artifact_dir": str(artifact_dir),
        "started": started,
        "label": plan.label,
        "offset": 0,
        "seed": seed,
    })
    await _follow_appium_run(run_id, manual_run_id, repo_path, artifact_dir, started, plan.label,
                             proc.pid, proc.wait, logger, offset=0, seed=seed)


async def _follow_appium_run(
    run_id: str,
    manual_run_id: int,
    repo_path: Path,
    artifact_dir: Path,
    started: float,
    label: str,
    pid: int,
    wait,
    logger: _ManualRunLogger,
    offset: int,
    seed: Optional[dict] = None,
) -> None:
    """Tail the run's output file until the process exits, then record results.

    ``wait`` is the child's ``wait`` coroutine function, or ``None`` when the
    process was re-attached after a backend restart (exit code unknown).
    """
    import time as time_module

    from app.services import appium_project_service as appium

    output_path = artifact_dir / "process.log"
    pending_bytes = b""
    exit_code = None
    timed_out = False

    async def pump() -> None:
        nonlocal offset, pending_bytes
        if not output_path.is_file():
            return
        with open(output_path, "rb") as handle:
            handle.seek(offset)
            chunk = handle.read()
        if not chunk:
            return
        offset += len(chunk)
        pending_bytes += chunk
        *complete, pending_bytes = pending_bytes.split(b"\n")
        for raw in complete:
            text_line = raw.decode("utf-8", errors="replace").rstrip("\r")
            await logger.log(text_line, "stderr" if "[ERROR]" in text_line else "stdout")
        _update_run_registry(run_id, {"offset": offset})

    wait_task = asyncio.create_task(wait()) if wait else None
    try:
        while True:
            await pump()
            if wait_task is not None:
                if wait_task.done():
                    exit_code = wait_task.result()
                    break
            elif not appium.pid_alive(pid):
                break
            if time_module.time() - started > APPIUM_RUN_TIMEOUT_SECONDS:
                timed_out = True
                appium.terminate_process_tree(pid)
                break
            await asyncio.sleep(_APPIUM_POLL_SECONDS)
        await pump()
        if pending_bytes:
            await logger.log(pending_bytes.decode("utf-8", errors="replace").rstrip(), "stdout")
    except Exception as exc:
        await logger.log(f"$ Execution error: {exc}", "stderr")
        await logger.finish("error")
        return
    finally:
        manual_run_processes.pop(run_id, None)
        _update_run_registry(run_id, None)

    if run_id in cancelled_manual_runs:
        cancelled_manual_runs.discard(run_id)
        await logger.log("$ Execution stopped by user.", "stderr")
        logger.flush()
        return
    if timed_out:
        await logger.log("$ Timed out waiting for the run to finish; the execution was stopped.", "stderr")
        await logger.finish("error")
        return
    if (seed or {}).get("kind") == "framework":
        await _finish_framework_run(repo_path, manual_run_id, artifact_dir, started, exit_code, seed or {}, logger)
        return

    await logger.log("─" * 60)
    exit_text = exit_code if exit_code is not None else "unknown (backend restarted during the run)"
    await logger.log(f"$ Exit code: {exit_text}")
    try:
        parsed = appium.collect_surefire_results(repo_path, started)
        if not parsed:
            ok = exit_code == 0
            parsed = {
                "test_results": [{
                    "test_name": label,
                    "class_name": "Appium run",
                    "status": "passed" if ok else "failed" if exit_code is not None else "error",
                    "duration_ms": None,
                    "error_message": None if ok else (
                        "Maven returned a non-zero exit code (see logs)." if exit_code is not None
                        else "No test reports were found and the exit code is unknown."
                    ),
                    "stack_trace": None,
                }],
                "total_tests": 1,
                "passed_tests": int(ok),
                "failed_tests": int(not ok),
                "skipped_tests": 0,
            }
        db = SessionLocal()
        try:
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
            if run:
                run.results_json = parsed["test_results"]
                run.total_tests = parsed["total_tests"]
                run.passed_tests = parsed["passed_tests"]
                run.failed_tests = parsed["failed_tests"]
                run.skipped_tests = parsed["skipped_tests"]
                db.commit()
                _write_manual_allure_report(artifact_dir, run_id, run.collection or label, parsed["test_results"])
        finally:
            db.close()
        copied = appium.copy_new_allure_results(repo_path, started, artifact_dir / "allure-results")
        if copied:
            await logger.log(f"$ Saved {copied} Allure result files: {artifact_dir / 'allure-results'}")
        await _record_appium_run_details(run_id, manual_run_id, repo_path, artifact_dir, started, exit_code,
                                         seed or {}, logger)
    except Exception as exc:
        await logger.log(f"$ Could not collect results: {exc}", "stderr")
        await logger.finish("error")
        return

    passed = parsed["failed_tests"] == 0 and (exit_code == 0 or (exit_code is None and parsed["passed_tests"] > 0))
    if passed:
        await logger.log("$ ✓ Tests PASSED")
        await logger.finish("passed")
    else:
        await logger.log("$ ✗ Tests FAILED", "stderr")
        await logger.finish("failed")


async def _finish_framework_run(repo_path: Path, manual_run_id: int, artifact_dir: Path, started: float, exit_code,
                                seed: dict, logger: _ManualRunLogger) -> None:
    from app.services import framework_run_service

    # Setup steps (npm install, .venv, ...) change what detection reports.
    _forget_framework_detection(repo_path)
    await logger.log("─" * 60)
    exit_text = exit_code if exit_code is not None else "unknown (backend restarted during the run)"
    await logger.log(f"$ Exit code: {exit_text}")
    try:
        parsed, details = await asyncio.to_thread(
            framework_run_service.collect_results, seed, artifact_dir, started, exit_code,
        )
        await logger.log(f"$ Results from {parsed['source']}: {parsed['passed_tests']} passed, "
                         f"{parsed['failed_tests']} failed, {parsed['skipped_tests']} skipped")
        for report in details.get("reports", []):
            await logger.log(f"$ Report saved: {report['name']}")
        db = SessionLocal()
        try:
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
            if run:
                run.results_json = parsed["test_results"]
                run.total_tests = parsed["total_tests"]
                run.passed_tests = parsed["passed_tests"]
                run.failed_tests = parsed["failed_tests"]
                run.skipped_tests = parsed["skipped_tests"]
                run.details_json = details
                db.commit()
                _write_manual_allure_report(artifact_dir, f"manual-{manual_run_id}", run.collection or "Run",
                                            parsed["test_results"])
        finally:
            db.close()
    except Exception as exc:
        await logger.log(f"$ Could not collect results: {exc}", "stderr")
        await logger.finish("error")
        return

    passed = parsed["failed_tests"] == 0 and (exit_code == 0 or (exit_code is None and parsed["passed_tests"] > 0))
    if passed:
        await logger.log("$ ✓ Run PASSED")
        await logger.finish("passed")
    else:
        await logger.log("$ ✗ Run FAILED", "stderr")
        await logger.finish("failed")


async def _execute_framework_run_background(run_id: str, manual_run_id: int, repo_path: Path, plan) -> None:
    """Start any detected framework command and follow it like an Appium run (restart-safe)."""
    import time as time_module

    from app.services import appium_project_service as appium

    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    logger = _ManualRunLogger(run_id, manual_run_id, artifact_dir)
    started = time_module.time()
    try:
        await logger.log(f"$ Framework:   {plan.seed.get('framework')}")
        await logger.log(f"$ Working dir: {plan.cwd}")
        await logger.log(f"$ Command:     {' '.join(plan.argv)}")
        for warning in plan.warnings:
            await logger.log(f"$ Warning: {warning}", "stderr")
        await logger.log("─" * 60)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        with open(artifact_dir / "process.log", "wb") as output:
            proc = await asyncio.create_subprocess_exec(
                *plan.argv,
                cwd=plan.cwd,
                env=plan.env,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=output,
                stderr=asyncio.subprocess.STDOUT,
                **appium.process_group_kwargs(),
            )
    except Exception as exc:
        await logger.log(f"$ Execution error: {exc}", "stderr")
        await logger.finish("error")
        return

    manual_run_processes[run_id] = proc.pid
    _update_run_registry(run_id, {
        "manual_run_id": manual_run_id,
        "pid": proc.pid,
        "repo_path": str(repo_path),
        "artifact_dir": str(artifact_dir),
        "started": started,
        "label": plan.label,
        "offset": 0,
        "seed": plan.seed,
    })
    await _follow_appium_run(run_id, manual_run_id, repo_path, artifact_dir, started, plan.label,
                             proc.pid, proc.wait, logger, offset=0, seed=plan.seed)


async def _start_framework_run(
    run: AnalyticsRun,
    run_id: str,
    repo_path: Path,
    payload: AnalyticsRunExecuteRequest,
    current_user,
    db: Session,
) -> dict:
    from app.services import framework_run_service

    target = (payload.framework_target or (run.collection_path or "").removeprefix(
        framework_run_service.FRAMEWORK_TARGET_PREFIX)).strip()
    if not target:
        raise HTTPException(status_code=400, detail="Select what to run.")
    if (payload.extra_args or "").strip():
        _require_editor(current_user)
    if run_id in manual_run_processes:
        raise HTTPException(status_code=409, detail="This run is already executing.")
    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    if artifact_dir.exists():
        shutil.rmtree(artifact_dir, ignore_errors=True)
    try:
        plan = await asyncio.to_thread(framework_run_service.build_plan, repo_path, target, artifact_dir,
                                       payload.extra_args)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _forget_framework_detection(repo_path)

    run.status = "running"
    run.started_at = datetime.utcnow()
    run.finished_at = None
    run.collection_path = f"{framework_run_service.FRAMEWORK_TARGET_PREFIX}{plan.target}"
    run.environment = plan.seed.get("framework")
    run.collection = f"{plan.label} - {run.started_at.strftime('%Y-%m-%d %H:%M:%S')}"
    run.logs_json = []
    run.results_json = []
    run.details_json = None
    db.commit()

    _write_manual_run_metadata(artifact_dir, {
        "run_id": run_id,
        "name": run.collection,
        "collection_path": run.collection_path,
        "environment": run.environment,
        "branch": run.branch or "main",
        "status": "running",
        "started_at": run.started_at.isoformat(),
        "command": plan.argv,
        "extra_args": payload.extra_args or "",
    })
    _spawn_run_task(_execute_framework_run_background(run_id, run.id, repo_path, plan))
    return {"status": "scheduled", "run_id": run_id, "task_id": f"local-{run.id}",
            "message": f"Run started: {plan.label}"}


def _manual_run_is_active(manual_run_id: int) -> bool:
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        return bool(run and run.status in ("running", "pending"))
    finally:
        db.close()


async def _record_appium_run_details(run_id: str, manual_run_id: int, repo_path: Path, artifact_dir: Path,
                                     started: float, exit_code, seed: dict, logger: _ManualRunLogger) -> None:
    """Store app version, device, technology and generated reports for the Run details tab."""
    import time as time_module

    from app.services import appium_project_service as appium

    try:
        details = await appium.build_run_details(
            repo_path, artifact_dir, seed.get("meta") or {}, started, time_module.time(), exit_code,
            seed.get("app_before"), seed.get("java_home"), seed.get("command") or [],
        )
    except Exception as exc:
        await logger.log(f"$ Could not collect run details: {exc}", "stderr")
        return
    details["artifact_dir"] = str(artifact_dir)
    app = details.get("app") or {}
    if app:
        await logger.log(f"$ App version: {app.get('name')} {app.get('version') or ''} ({app.get('build') or '?'})")
    for report in details.get("reports", []):
        await logger.log(f"$ Report generated: {report['source']}")
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        if run:
            run.details_json = details
            db.commit()
    finally:
        db.close()


async def resume_orphaned_manual_runs() -> None:
    """Re-attach Appium executions that were running when the backend restarted."""
    import time as time_module

    from app.services import appium_project_service as appium

    for run_id, entry in _load_run_registry().items():
        try:
            manual_run_id = int(entry["manual_run_id"])
            pid = int(entry["pid"])
            repo_path = Path(entry["repo_path"])
            artifact_dir = Path(entry["artifact_dir"])
        except (KeyError, TypeError, ValueError):
            _update_run_registry(run_id, None)
            continue
        if not _manual_run_is_active(manual_run_id):
            _update_run_registry(run_id, None)
            continue
        logger = _ManualRunLogger(run_id, manual_run_id, artifact_dir)
        alive = appium.pid_alive(pid) and appium.owns_process_group(pid)
        if alive:
            manual_run_processes[run_id] = pid
            await logger.log(f"$ Backend restarted — re-attached to the running execution (pid {pid}).")
        else:
            await logger.log("$ Backend restarted — the execution already finished; collecting results.")
        _spawn_run_task(_follow_appium_run(
            run_id, manual_run_id, repo_path, artifact_dir,
            float(entry.get("started") or time_module.time()), str(entry.get("label") or run_id),
            pid if alive else -1, None, logger, int(entry.get("offset") or 0), entry.get("seed"),
        ))


async def _start_appium_run(
    run: AnalyticsRun,
    run_id: str,
    repo_path: Path,
    payload: AnalyticsRunExecuteRequest,
    db: Session,
) -> dict:
    from app.services import appium_project_service as appium

    stored_target = (run.collection_path or "").removeprefix(appium.APPIUM_TARGET_PREFIX)
    stored_env, _, stored_device = (run.environment or "").partition(" / ")
    try:
        plan = await appium.build_run_plan(
            repo_path,
            (payload.appium_target or stored_target).strip(),
            (payload.app_env or stored_env).strip(),
            (payload.device_run_option or stored_device).strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if run_id in manual_run_processes:
        raise HTTPException(status_code=409, detail="This run is already executing.")

    run.status = "running"
    run.started_at = datetime.utcnow()
    run.finished_at = None
    run.collection_path = f"{appium.APPIUM_TARGET_PREFIX}{plan.target}"
    run.environment = f"{plan.app_env} / {plan.device_run_option}"
    run.collection = f"{plan.label} - {run.environment} - {run.started_at.strftime('%Y-%m-%d %H:%M:%S')}"
    run.logs_json = []
    db.commit()

    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    _write_manual_run_metadata(artifact_dir, {
        "run_id": run_id,
        "name": run.collection,
        "collection_path": run.collection_path,
        "environment": run.environment,
        "branch": run.branch or "main",
        "status": "running",
        "started_at": run.started_at.isoformat(),
        "command": plan.argv,
        "allure_results_dir": str(artifact_dir / "allure-results"),
    })
    _spawn_run_task(_execute_appium_run_background(run_id, run.id, repo_path, plan))
    return {"status": "scheduled", "run_id": run_id, "task_id": f"local-{run.id}",
            "message": f"Appium run started: {plan.label}"}


@analytics_router.post("/runs/{run_id}/execute")
async def execute_analytics_run(
    run_id: str,
    payload: AnalyticsRunExecuteRequest = AnalyticsRunExecuteRequest(),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start a Bruno collection in the user's linked local checkout and stream live logs."""
    check_organization_member(current_user)
    if not run_id.startswith("manual-"):
        raise HTTPException(status_code=400, detail="Only manually created local runs can be executed here.")
    try:
        manual_run_id = int(run_id.removeprefix("manual-"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Run not found")
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    _legacy_project_or_404(db, suite.project_id)

    repo_path = checkout_path(current_user, suite.project_id)
    if not (repo_path / ".git").exists():
        raise HTTPException(
            status_code=400, detail="No local checkout linked. Go to Projects → Local & GIT → link a folder first."
        )

    is_appium_run = payload.run_type == "appium" or (
        not payload.run_collection and (run.collection_path or "").startswith("appium:")
    )
    if is_appium_run:
        return await _start_appium_run(run, run_id, repo_path, payload, db)
    is_framework_run = payload.run_type == "framework" or (
        not payload.run_type and not payload.run_collection and (run.collection_path or "").startswith("framework:")
    )
    if is_framework_run:
        return await _start_framework_run(run, run_id, repo_path, payload, current_user, db)

    run_collection = (payload.run_collection or run.collection_path or run.collection or "").strip()
    run_environment = (payload.run_environment or "").strip()
    if not run_collection:
        raise HTTPException(status_code=400, detail="Select a Bruno collection before running.")
    if not run_environment:
        raise HTTPException(status_code=400, detail="Select an environment before running.")

    collection_dir = (repo_path / run_collection.strip("/")).resolve()
    if repo_path not in [collection_dir, *collection_dir.parents] or not (collection_dir / "bruno.json").is_file():
        raise HTTPException(
            status_code=400,
            detail="The selected collection is not present in the linked local checkout. "
            "Refresh the project data and choose a local Bruno collection.",
        )
    if not (collection_dir / "environments" / f"{run_environment}.bru").is_file():
        raise HTTPException(
            status_code=400, detail="The selected Bruno environment is not present in the local collection."
        )

    run_requests = None
    if payload.run_requests:
        run_requests = []
        for rel in payload.run_requests[:500]:
            rel = (rel or "").strip().replace("\\", "/")
            target = (collection_dir / rel).resolve()
            if (rel.startswith("-") or ".." in rel.split("/") or collection_dir not in [target, *target.parents]
                    or not target.exists()):
                raise HTTPException(status_code=400, detail=f"'{rel}' is not a request or folder of the collection.")
            run_requests.append(rel)

    run.status = "running"
    run.started_at = run.started_at or datetime.utcnow()
    run.collection_path = run_collection
    run.environment = run_environment
    run.collection = f"{run_collection} - {run_environment} - {run.started_at.strftime('%Y-%m-%d %H:%M:%S')}"
    run.logs_json = []
    db.commit()

    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    _write_manual_run_metadata(artifact_dir, {
        "run_id": run_id,
        "name": run.collection,
        "collection_path": run_collection,
        "environment": run_environment,
        "branch": run.branch or "main",
        "status": "running",
        "started_at": run.started_at.isoformat(),
        "allure_results_dir": str(artifact_dir / "allure-results"),
    })

    asyncio.create_task(
        _execute_manual_run_background(run_id, manual_run_id, repo_path, run_collection, run_environment,
                                       run_requests)
    )
    return {
        "status": "scheduled",
        "run_id": run_id,
        "task_id": f"local-{run.id}",
        "message": f"Bruno run started in {repo_path.name}/{run_collection}",
    }


@analytics_router.post("/runs/{run_id}/cancel")
async def cancel_analytics_run(
    run_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel a manually-created local run."""
    check_organization_member(current_user)
    if not run_id.startswith("manual-"):
        raise HTTPException(status_code=400, detail="Only manually created local runs can be cancelled here.")
    try:
        manual_run_id = int(run_id.removeprefix("manual-"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Run not found")
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    pid = manual_run_processes.get(run_id)
    if not pid and run.status not in ("running", "pending", "queued"):
        # Already finished: keep its real outcome instead of overwriting it with "cancelled".
        return {"status": run.status, "run_id": run_id}
    if pid:
        from app.services.appium_project_service import terminate_process_tree

        cancelled_manual_runs.add(run_id)
        terminate_process_tree(pid)
    run.status = "cancelled"
    run.finished_at = datetime.utcnow()
    db.commit()
    payload = {"type": "status", "status": "cancelled"}
    _append_manual_run_log(manual_run_id, payload)
    await _broadcast_manual_run_message(run_id, payload)
    return {"status": "cancelled", "run_id": run_id}


@analytics_router.delete("/runs/{run_id}")
async def delete_analytics_run(
    run_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a manually-created run or an imported Allure report."""
    check_organization_member(current_user)
    if run_id.startswith("allure-"):
        try:
            report_id = int(run_id.removeprefix("allure-"))
        except ValueError:
            raise HTTPException(status_code=404, detail="Run not found")
        report = db.query(AllureReport).filter(AllureReport.id == report_id).first()
        if not report:
            raise HTTPException(status_code=404, detail="Run not found")
        _legacy_project_or_404(db, report.project_id)
        db.delete(report)
        db.commit()
        return {"status": "deleted", "run_id": run_id}
    if not run_id.startswith("manual-"):
        raise HTTPException(status_code=400, detail="Unsupported run type.")
    try:
        manual_run_id = int(run_id.removeprefix("manual-"))
    except ValueError:
        raise HTTPException(status_code=404, detail="Run not found")
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    db.delete(run)
    db.commit()
    await _broadcast_manual_run_message(run_id, {"type": "status", "status": "deleted"})
    return {"status": "deleted", "run_id": run_id}


@analytics_router.websocket("/v1/runs/ws/{run_id}")
async def stream_manual_run_logs(websocket: WebSocket, run_id: str):
    """Stream status/log messages for legacy manual runs at the frontend's v1 URL."""
    await websocket.accept()
    sockets = manual_run_sockets.setdefault(run_id, set())
    sockets.add(websocket)
    try:
        if run_id.startswith("manual-"):
            try:
                manual_run_id = int(run_id.removeprefix("manual-"))
                db = SessionLocal()
                try:
                    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
                    saved_logs = list(run.logs_json or []) if run else []
                finally:
                    db.close()
                for payload in saved_logs:
                    await websocket.send_json(payload)
            except ValueError:
                pass
        await websocket.send_json({"type": "stdout", "data": f"$ Connected to run {run_id}."})
        while True:
            if await websocket.receive_text() == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        sockets.discard(websocket)
        if not sockets:
            manual_run_sockets.pop(run_id, None)


@router.get("/{project_id}/allure/reports")
async def list_allure_reports(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List normalized Allure reports from local and GitHub Actions imports."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    reports = (
        db.query(AllureReport)
        .filter(AllureReport.project_id == project_id)
        .order_by(AllureReport.created_at.desc())
        .all()
    )
    return [_allure_report_response(report) for report in reports]


@router.get("/{project_id}/allure/reports/{report_id}/html")
async def get_imported_allure_report_html(
    project_id: int,
    report_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate the interactive Allure-style HTML view for an imported report."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    report = db.query(AllureReport).filter(
        AllureReport.id == report_id,
        AllureReport.project_id == project_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Allure report not found")

    artifact_dir = (
        BACKEND_DIR / "uploads" / "allure-reports" / str(project_id) / str(report_id)
    )
    results = [
        {
            "test_name": item.get("name") or "Unnamed test",
            "class_name": item.get("class_name"),
            "status": item.get("status") or "error",
            "duration_ms": item.get("duration_ms") or 0,
            "error_message": item.get("message"),
        }
        for item in (report.results_json or [])
        if isinstance(item, dict)
    ]
    _write_manual_allure_report(artifact_dir, f"allure-{report.id}", report.name, results)
    return FileResponse(artifact_dir / "allure-report" / "index.html", media_type="text/html")


@router.post("/{project_id}/allure/import/local")
async def import_local_allure_reports(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import standard allure-results bundles from the linked local checkout."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    result_dirs = [
        path for path in repo_path.rglob("allure-results")
        if path.is_dir() and ".git" not in path.parts and "node_modules" not in path.parts
    ][:30]
    created = updated = 0
    for result_dir in result_dirs:
        entries = []
        for result_file in result_dir.glob("*-result.json"):
            try:
                entries.append(result_file.read_text(encoding="utf-8"))
            except OSError:
                continue
        results = _allure_results_from_json_entries(entries)
        if not results:
            continue
        relative_path = result_dir.relative_to(repo_path).as_posix()
        was_created = _save_allure_report(
            db,
            project_id,
            "local",
            relative_path,
            f"Local Allure · {relative_path}",
            results,
            branch="local",
        )
        created += int(was_created)
        updated += int(not was_created)
    db.commit()
    return {"imported": created + updated, "created": created, "updated": updated}


@router.post("/{project_id}/allure/sync/github")
async def sync_github_allure_reports(
    project_id: int,
    limit: int = 20,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download and import Allure result artifacts from recent GitHub Actions runs."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    created = updated = 0
    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
            runs_response = await _github_get(
                client,
                f"{api_base}/repos/{owner}/{repo}/actions/runs",
                token,
                params={"per_page": max(1, min(limit, 50))},
            )
            if runs_response.status_code != 200:
                raise HTTPException(
                    status_code=400 if runs_response.status_code == 401 else runs_response.status_code,
                    detail=runs_response.text[:200],
                )
            for run in runs_response.json().get("workflow_runs", []):
                run_id = run.get("id")
                if not run_id:
                    continue
                artifacts_response = await _github_get(
                    client, f"{api_base}/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts", token
                )
                if artifacts_response.status_code != 200:
                    continue
                for artifact in artifacts_response.json().get("artifacts", []):
                    artifact_name = str(artifact.get("name") or "")
                    artifact_id = artifact.get("id")
                    archive_url = artifact.get("archive_download_url")
                    if not artifact_id or not archive_url or "allure" not in artifact_name.lower():
                        continue
                    archive_response = await _github_get(client, archive_url, token)
                    if archive_response.status_code != 200:
                        continue
                    try:
                        with zipfile.ZipFile(io.BytesIO(archive_response.content)) as archive:
                            entries = [
                                archive.read(name).decode("utf-8", errors="replace")
                                for name in archive.namelist()
                                if name.endswith("-result.json") and "allure-results" in name
                            ]
                    except zipfile.BadZipFile:
                        continue
                    results = _allure_results_from_json_entries(entries)
                    if not results:
                        continue
                    was_created = _save_allure_report(
                        db,
                        project_id,
                        "github_actions",
                        f"{run_id}:{artifact_id}",
                        f"{run.get('name') or 'GitHub Actions'} · {artifact_name}",
                        results,
                        branch=run.get("head_branch"),
                        workflow_name=run.get("name"),
                        report_url=run.get("html_url"),
                        occurred_at=_parse_github_datetime(run.get("run_started_at"))
                        or _parse_github_datetime(run.get("created_at")),
                    )
                    created += int(was_created)
                    updated += int(not was_created)
    except HTTPException:
        db.rollback()
        raise
    except httpx.HTTPError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=f"GitHub artifact sync failed: {exc}")
    db.commit()
    return {"imported": created + updated, "created": created, "updated": updated}


_GITHUB_OVERVIEW_TTL_SECONDS = 300
_github_overview_cache: dict[tuple[int, int], tuple[float, dict]] = {}


def _count_label(items, page_size: int):
    if not isinstance(items, list):
        return None
    return f"{len(items)}+" if len(items) >= page_size else len(items)


def _forget_github_overview(project_id: int) -> None:
    for key in [k for k in _github_overview_cache if k[0] == project_id]:
        _github_overview_cache.pop(key, None)


@router.get("/{project_id}/github/overview")
async def get_project_github_overview(
    project_id: int,
    refresh: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Repository metadata, recent activity and detected test setup for the Overview page."""
    import time as time_module

    from app.services import github_overview_service as overview

    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    if not (project.github_repo_url or "").strip():
        raise HTTPException(status_code=400, detail="No GitHub repository is configured for this project.")
    cache_key = (project_id, current_user.id)
    cached = _github_overview_cache.get(cache_key)
    if cached and not refresh and time_module.monotonic() - cached[0] < _GITHUB_OVERVIEW_TTL_SECONDS:
        return cached[1]

    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    base = f"{api_base}/repos/{owner}/{repo}"

    async def get_json(client, url, **params):
        try:
            response = await _github_get(client, url, token, params=params or None)
        except httpx.HTTPError:
            return None
        return response.json() if response.status_code == 200 else None

    async def get_raw(client, path, ref):
        try:
            response = await _github_get(client, f"{base}/contents/{path}", token,
                                         accept="application/vnd.github.raw+json", params={"ref": ref})
        except httpx.HTTPError:
            return None
        return response.text if response.status_code == 200 else None

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            meta_response = await _github_get(client, base, token)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {exc}")
        if meta_response.status_code in (401, 403):
            raise HTTPException(status_code=400, detail="GitHub rejected the token for this repository.")
        if meta_response.status_code == 404:
            raise HTTPException(status_code=404,
                                detail=f"Repository {owner}/{repo} was not found or is not accessible.")
        if meta_response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"GitHub returned {meta_response.status_code}.")
        meta = meta_response.json()
        branch = meta.get("default_branch") or "main"

        tree, commit, languages, branches, contributors, runs = await asyncio.gather(
            get_json(client, f"{base}/git/trees/{branch}", recursive="1"),
            get_json(client, f"{base}/commits/{branch}"),
            get_json(client, f"{base}/languages"),
            get_json(client, f"{base}/branches", per_page="100"),
            get_json(client, f"{base}/contributors", per_page="5"),
            get_json(client, f"{base}/actions/runs", per_page="1"),
        )
        paths = [item.get("path", "") for item in (tree or {}).get("tree", []) if item.get("type") == "blob"]
        pom_text, package_text = await asyncio.gather(
            get_raw(client, "pom.xml", branch) if "pom.xml" in paths else asyncio.sleep(0, None),
            get_raw(client, "package.json", branch) if "package.json" in paths else asyncio.sleep(0, None),
        )

    commit_info = (commit or {}).get("commit") or {}
    latest_run = ((runs or {}).get("workflow_runs") or [None])[0]
    license_info = meta.get("license") or {}
    result = {
        "branch": branch,
        "analyzed_at": datetime.utcnow().isoformat(),
        "repository": {
            "full_name": meta.get("full_name"),
            "html_url": meta.get("html_url"),
            "description": meta.get("description"),
            "visibility": meta.get("visibility") or ("private" if meta.get("private") else "public"),
            "archived": bool(meta.get("archived")),
            "default_branch": branch,
            "language": meta.get("language"),
            "topics": meta.get("topics") or [],
            "stars": meta.get("stargazers_count"),
            "forks": meta.get("forks_count"),
            "open_issues": meta.get("open_issues_count"),
            "size_kb": meta.get("size"),
            "license": license_info.get("spdx_id") or license_info.get("name"),
            "created_at": meta.get("created_at"),
            "pushed_at": meta.get("pushed_at"),
            "branches_count": _count_label(branches, 100),
            "languages": overview.language_shares(languages or {}),
            "contributors": [
                {"login": c.get("login"), "contributions": c.get("contributions"), "html_url": c.get("html_url")}
                for c in (contributors if isinstance(contributors, list) else [])
            ],
            "latest_commit": {
                "sha": (commit or {}).get("sha"),
                "message": (commit_info.get("message") or "").split("\n", 1)[0],
                "author": (commit_info.get("author") or {}).get("name"),
                "date": (commit_info.get("author") or {}).get("date"),
                "html_url": (commit or {}).get("html_url"),
            } if commit else None,
            "latest_workflow_run": {
                "name": latest_run.get("name"),
                "status": latest_run.get("status"),
                "conclusion": latest_run.get("conclusion"),
                "branch": latest_run.get("head_branch"),
                "created_at": latest_run.get("created_at"),
                "html_url": latest_run.get("html_url"),
            } if latest_run else None,
        },
        "detection": {
            **overview.analyze_tree(paths, pom_text, package_text),
            "tree_truncated": bool((tree or {}).get("truncated")),
            "tree_available": tree is not None,
        },
    }
    try:
        result["local"] = await get_project_local_status(project_id, current_user, db)
    except HTTPException:
        result["local"] = None
    _github_overview_cache[cache_key] = (time_module.monotonic(), result)
    return result


@router.get("/{project_id}/github/analyze")
async def analyze_project_repository(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect test frameworks and collections from the GitHub repository tree."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await _github_get(
            client,
            f"{api_base}/repos/{owner}/{repo}/git/trees/main",
            token,
            params={"recursive": "1"},
        )
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code == 401 else response.status_code, detail=response.text[:200]
        )

    from app.services.framework_detector import FrameworkDetector

    files = [item.get("path", "") for item in response.json().get("tree", []) if item.get("type") == "blob"]
    return {
        "frameworks": FrameworkDetector.detect_frameworks(files),
        "projects": FrameworkDetector.detect_projects(files),
        "files_count": len(files),
    }


@router.get("/{project_id}/github/templates")
async def get_project_github_templates(
    project_id: int,
    ref: str = "",
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List dispatchable workflows and structured issue templates from GitHub."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    branch = ref or "main"

    from app.services.github_workflow_service import parse_issue_template, parse_workflow_dispatch

    workflows = []
    issue_templates = []
    async with httpx.AsyncClient(timeout=20) as client:
        workflow_files = await _list_legacy_github_folder(
            client, api_base, owner, repo, ".github/workflows", branch, token
        )
        for entry in workflow_files:
            name = str(entry.get("name") or "")
            if entry.get("type") != "file" or not name.endswith((".yml", ".yaml")):
                continue
            raw = await _github_get(
                client,
                f"{api_base}/repos/{owner}/{repo}/contents/{entry.get('path')}",
                token,
                accept="application/vnd.github.raw+json",
                params={"ref": branch},
            )
            if raw.status_code != 200:
                continue
            parsed = parse_workflow_dispatch(raw.text)
            if parsed:
                workflows.append({
                    "id": name,
                    "path": entry.get("path") or "",
                    "name": parsed["name"] or name,
                    "inputs": parsed["inputs"],
                })

        template_files = await _list_legacy_github_folder(
            client, api_base, owner, repo, ".github/ISSUE_TEMPLATE", branch, token
        )
        for entry in template_files:
            name = str(entry.get("name") or "")
            if entry.get("type") != "file" or not name.endswith((".yml", ".yaml")):
                continue
            raw = await _github_get(
                client,
                f"{api_base}/repos/{owner}/{repo}/contents/{entry.get('path')}",
                token,
                accept="application/vnd.github.raw+json",
                params={"ref": branch},
            )
            if raw.status_code != 200:
                continue
            parsed = parse_issue_template(raw.text)
            if parsed:
                issue_templates.append({
                    "id": name,
                    "path": entry.get("path") or "",
                    "name": parsed["name"] or name,
                    "description": parsed["description"],
                    "fields": parsed["fields"],
                })

    return {"ref": branch, "workflows": workflows, "issue_templates": issue_templates}


@router.post("/{project_id}/github/runs/sync")
async def sync_project_github_runs(
    project_id: int,
    payload: GitHubRunsSyncRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import GitHub Actions history into the legacy Dashboard and Analytics runs."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    workflow_id = (payload.workflow_id or "").strip()
    if workflow_id and "/" in workflow_id:
        raise HTTPException(status_code=400, detail="Invalid workflow id.")
    limit = max(1, min(int(payload.limit or 100), 300))
    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    endpoint = (
        f"{api_base}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
        if workflow_id else f"{api_base}/repos/{owner}/{repo}/actions/runs"
    )
    params = {"per_page": min(limit, 100)}
    if payload.branch:
        params["branch"] = payload.branch.strip()
    async with httpx.AsyncClient(timeout=30) as client:
        response = await _github_get(client, endpoint, token, params=params)
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code in (401, 403) else response.status_code, detail=response.text[:300]
        )

    data = response.json()
    raw_runs = (data.get("workflow_runs") or [])[:limit]
    suite = db.query(AnalyticsSuite).filter(
        AnalyticsSuite.project_id == project_id,
        AnalyticsSuite.name == "GitHub Actions",
    ).first()
    if not suite:
        suite = AnalyticsSuite(project_id=project_id, name="GitHub Actions", tags=["github-actions"], active=True)
        db.add(suite)
        db.flush()

    created = updated = 0
    for item in raw_runs:
        external_id = str(item.get("id") or "")
        if not external_id:
            continue
        marker = f"github-actions:{external_id}"
        run = db.query(AnalyticsRun).filter(
            AnalyticsRun.suite_id == suite.id,
            AnalyticsRun.collection_path == marker,
        ).first()
        status = (
            "passed"
            if item.get("conclusion") == "success"
            else "failed"
            if item.get("conclusion") in ("failure", "timed_out", "action_required")
            else "cancelled"
            if item.get("conclusion") == "cancelled"
            else "running"
            if item.get("status") in ("queued", "in_progress")
            else "pending"
        )
        metadata = {"type": "github_actions", "external_id": external_id, "html_url": item.get("html_url") or ""}
        if not run:
            run = AnalyticsRun(suite_id=suite.id, collection_path=marker)
            db.add(run)
            created += 1
        else:
            updated += 1
        run.status = status
        run.collection = (
            payload.collection or item.get("name") or item.get("display_title") or "GitHub Actions"
        ).strip()
        run.branch = item.get("head_branch")
        run.commit_sha = (item.get("head_sha") or "")[:40] or None
        run.triggered_by = (item.get("actor") or {}).get("login")
        run.started_at = _parse_github_datetime(item.get("run_started_at")) or _parse_github_datetime(
            item.get("created_at")
        )
        run.finished_at = _parse_github_datetime(item.get("updated_at")) if item.get("status") == "completed" else None
        run.logs_json = [metadata]
        run.created_at = _parse_github_datetime(item.get("created_at")) or datetime.utcnow()
    db.commit()
    return {
        "synced": len(raw_runs),
        "created": created,
        "updated": updated,
        "total_available": int(data.get("total_count") or len(raw_runs)),
    }


@router.get("/{project_id}/github/runs")
async def list_project_github_runs(
    project_id: int,
    workflow_id: str = "",
    branch: str = "",
    limit: int = 30,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return live GitHub Actions run history for the selected workflow."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    workflow_id = workflow_id.strip()
    if workflow_id and "/" in workflow_id:
        raise HTTPException(status_code=400, detail="Invalid workflow id.")
    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    endpoint = (
        f"{api_base}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
        if workflow_id else f"{api_base}/repos/{owner}/{repo}/actions/runs"
    )
    params = {"per_page": max(1, min(int(limit or 30), 100))}
    if branch.strip():
        params["branch"] = branch.strip()
    async with httpx.AsyncClient(timeout=30) as client:
        response = await _github_get(client, endpoint, token, params=params)
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code in (401, 403) else response.status_code, detail=response.text[:300]
        )
    return [
        {
            "id": str(run.get("id") or ""),
            "run_number": run.get("run_number"),
            "name": run.get("name") or run.get("display_title") or "",
            "status": run.get("status") or "",
            "conclusion": run.get("conclusion"),
            "branch": run.get("head_branch"),
            "event": run.get("event"),
            "actor": (run.get("actor") or {}).get("login"),
            "created_at": run.get("created_at"),
            "run_started_at": run.get("run_started_at"),
            "updated_at": run.get("updated_at"),
            "html_url": run.get("html_url") or "",
        }
        for run in (response.json().get("workflow_runs") or [])
        if run.get("id") is not None
    ]


_MAX_BRANCH_PAGES = 20


@router.get("/{project_id}/branches")
async def get_project_branches(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return GitHub branches using the legacy project's saved repository URL."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    branches: list[dict] = []
    async with httpx.AsyncClient(timeout=15) as client:
        meta = await _github_get(client, f"{api_base}/repos/{owner}/{repo}", token)
        default_branch = (meta.json() or {}).get("default_branch") if meta.status_code == 200 else None
        # GitHub pages branch listings; follow pages so large repos are complete.
        for page in range(1, _MAX_BRANCH_PAGES + 1):
            response = await _github_get(client, f"{api_base}/repos/{owner}/{repo}/branches", token,
                                         params={"per_page": 100, "page": page})
            if response.status_code != 200:
                if page > 1:
                    break
                raise HTTPException(status_code=400 if response.status_code == 401 else response.status_code,
                                    detail=response.text[:200])
            batch = response.json() or []
            branches.extend(batch)
            if len(batch) < 100:
                break
    default_branch = default_branch or "main"
    return [
        {
            "name": branch.get("name", ""),
            "commit_sha": (branch.get("commit") or {}).get("sha", ""),
            "is_default": branch.get("name") == default_branch,
        }
        for branch in branches
    ]


@router.get("/{project_id}/github/tree")
async def get_project_repo_tree(
    project_id: int,
    path: str = "",
    ref: str = "",
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a repository folder in the frontend's file-tree contract."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    branch = ref or "main"
    contents_path = f"/contents/{path.strip('/')}".rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await _github_get(
            client,
            f"{api_base}/repos/{owner}/{repo}{contents_path}",
            token,
            params={"ref": branch},
        )
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code == 401 else response.status_code, detail=response.text[:200]
        )
    contents = response.json()
    if not isinstance(contents, list):
        contents = [contents]
    return [
        {
            "name": item.get("name", ""),
            "path": item.get("path", ""),
            "type": "dir" if item.get("type") == "dir" else "file",
            "size": item.get("size"),
            "sha": item.get("sha", ""),
            "download_url": item.get("download_url"),
        }
        for item in contents
    ]


@router.get("/{project_id}/github/commit")
async def get_project_github_commit(
    project_id: int,
    ref: str = "",
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the commit metadata at the requested GitHub branch or ref."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    owner, repo, api_base, token = _github_repository_context(project, current_user, project_id)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await _github_get(client, f"{api_base}/repos/{owner}/{repo}/commits/{ref or 'main'}", token)
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code == 401 else response.status_code, detail=response.text[:200]
        )
    data = response.json()
    commit = data.get("commit") or {}
    author = commit.get("author") or {}
    return {
        "sha": data.get("sha", ""),
        "author": author.get("name", ""),
        "date": author.get("date", ""),
        "message": (commit.get("message") or "").split("\n", 1)[0],
    }


def _local_status(repo_path: Path) -> dict:
    git_path = repo_path / ".git"
    response = {
        "path": str(repo_path),
        "exists": repo_path.exists(),
        "is_git_repo": git_path.exists(),
        "current_branch": None,
        "branches": [],
        "last_commit": None,
        "dirty": False,
        "has_upstream": False,
        "ahead": 0,
        "behind": 0,
    }
    if not git_path.exists():
        return response

    def git(*args: str) -> str:
        completed = subprocess.run(["git", *args], cwd=repo_path, text=True, capture_output=True, check=False)
        return completed.stdout.strip() if completed.returncode == 0 else ""

    response["current_branch"] = git("rev-parse", "--abbrev-ref", "HEAD") or None
    response["branches"] = [branch for branch in git("branch", "--format=%(refname:short)").splitlines() if branch]
    response["dirty"] = bool(git("status", "--porcelain"))
    upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if upstream:
        response["has_upstream"] = True
        counts = git("rev-list", "--left-right", "--count", f"HEAD...{upstream}").split()
        if len(counts) == 2:
            response["ahead"], response["behind"] = int(counts[0]), int(counts[1])
    commit_lines = git("log", "-1", "--pretty=%H%n%an%n%ad%n%s", "--date=iso").splitlines()
    if commit_lines:
        response["last_commit"] = {
            "sha": commit_lines[0],
            "author": commit_lines[1] if len(commit_lines) > 1 else "",
            "date": commit_lines[2] if len(commit_lines) > 2 else "",
            "message": commit_lines[3] if len(commit_lines) > 3 else "",
        }
    return response


@router.get("/{project_id}/local/status")
async def get_project_local_status(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report whether the legacy managed local checkout exists for a project."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = checkout_path(current_user, project_id)
    return await asyncio.to_thread(_local_status, repo_path)


@router.get("/{project_id}/local/branches")
async def list_project_local_branches(
    project_id: int,
    fetch: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Local and GitHub (origin) branches of the linked checkout; ``fetch`` refreshes the GitHub ones first."""
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    repo_url = project.github_repo_url or ""
    fetch_error = None
    if fetch and repo_url:
        token = _read_user_project_github_token(current_user, project_id)
        try:
            await LocalRepoService.fetch_remote(service_project(project.id, repo_path), repo_url,
                                                token or None)
        except LocalRepoError as exc:
            fetch_error = str(exc)
    status = await asyncio.to_thread(_local_status, repo_path)
    _, out, _ = await LocalRepoService._run_git(
        ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], cwd=repo_path)
    remote = sorted({ref.split("/", 1)[1] for ref in out.splitlines() if "/" in ref and ref != "origin/HEAD"})
    return {**status, "remote_branches": remote, "github_connected": bool(repo_url), "fetch_error": fetch_error}


class LocalCheckoutRequest(BaseModel):
    branch: str


@router.post("/{project_id}/local/checkout")
async def checkout_project_local_branch(
    project_id: int,
    payload: LocalCheckoutRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Switch the linked checkout to a local branch, or create a tracking branch from ``origin/<branch>``."""
    from app.services.local_import_service import _check_branch_name, _git
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    _require_editor(current_user)
    repo_path = require_checkout(current_user, project_id)
    branch = payload.branch.strip()
    try:
        _check_branch_name(branch)
        status = await asyncio.to_thread(_local_status, repo_path)
        if branch == status["current_branch"]:
            return status
        if status["dirty"]:
            raise LocalRepoError("The project has uncommitted changes. Commit or discard them before switching "
                                 "branch (Projects › Local and GIT project Management).")

        async def has_ref(ref: str) -> bool:
            return (await LocalRepoService._run_git(["rev-parse", "--verify", "--quiet", ref], cwd=repo_path))[0] == 0

        if await has_ref(f"refs/heads/{branch}"):
            await _git(["checkout", branch], cwd=repo_path)
        elif await has_ref(f"refs/remotes/origin/{branch}"):
            await _git(["checkout", "-b", branch, "--track", f"origin/{branch}"], cwd=repo_path)
        else:
            raise LocalRepoError(f"Branch '{branch}' was not found locally or on GitHub. Refresh the branches.")
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return await asyncio.to_thread(_local_status, repo_path)


@router.get("/{project_id}/local/changes")
async def get_project_local_changes(
    project_id: int,
    base: str = "",
    committed: bool = True,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """New/modified files of the linked checkout (uncommitted, plus commits not on ``base``) for focused runs."""
    from app.services import changed_tests_service

    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    try:
        return await asyncio.to_thread(changed_tests_service.changed_files, repo_path, base or None,
                                       getattr(project, "default_branch", None) or "main", committed)
    except changed_tests_service.ChangedTestsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


_MAX_EDITOR_FILE_BYTES = 2_000_000


class LocalFileWriteRequest(BaseModel):
    path: str
    content: str


def _ai_project_service():
    from app.services import ai_project_service

    return ai_project_service


def _editor_target(repo_path: Path, rel_path: str) -> tuple[Path, str]:
    try:
        target, rel = _ai_project_service().resolve_project_path(repo_path, rel_path)
    except _ai_project_service().ProjectAIError as exc:
        raise HTTPException(status_code=400, detail=exc.message)
    if target.exists() and not target.is_file():
        raise HTTPException(status_code=400, detail=f"'{rel}' is not a file.")
    return target, rel


def _read_editor_file(repo_path: Path, rel_path: str) -> dict:
    target, rel = _editor_target(repo_path, rel_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"'{rel}' does not exist in the linked checkout.")
    size = target.stat().st_size
    if size > _MAX_EDITOR_FILE_BYTES:
        return {"path": rel, "content": None, "size": size, "binary": True, "too_large": True}
    data = target.read_bytes()
    try:
        if b"\x00" in data[:8192]:
            raise UnicodeDecodeError("utf-8", data, 0, 1, "binary")
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        return {"path": rel, "content": None, "size": size, "binary": True, "too_large": False}
    return {"path": rel, "content": content, "size": size, "binary": False, "too_large": False}


def _write_editor_file(repo_path: Path, rel_path: str, content: str) -> dict:
    if len(content.encode("utf-8")) > _MAX_EDITOR_FILE_BYTES:
        raise HTTPException(status_code=400, detail="The file is too large to save through the editor.")
    target, rel = _editor_target(repo_path, rel_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Keep the file's line endings: browsers edit with \n only.
    if target.is_file() and b"\r\n" in target.read_bytes()[:65536]:
        content = content.replace("\r\n", "\n").replace("\n", "\r\n")
    with open(target, "w", encoding="utf-8", newline="") as handle:
        handle.write(content)
    return _read_editor_file(repo_path, rel)


@router.get("/{project_id}/local/file")
async def read_project_local_file(
    project_id: int,
    path: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read a text file of the linked checkout (for the editors)."""
    from app.services import ai_project_service  # noqa: F401 - imported in the event loop, not the worker thread

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_read_editor_file, repo_path, path)


@router.put("/{project_id}/local/file")
async def write_project_local_file(
    project_id: int,
    payload: LocalFileWriteRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a text file in the linked checkout (not for viewers)."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    from app.services import ai_project_service  # noqa: F401 - imported in the event loop, not the worker thread

    _require_editor(current_user)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_write_editor_file, repo_path, payload.path, payload.content)


@router.get("/{project_id}/local/libraries")
async def get_project_local_libraries(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect dependency manifests in the linked local checkout."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    repo_path = checkout_path(current_user, project_id)
    from app.services.local_library_service import LocalLibraryError, LocalLibraryService

    try:
        return LocalLibraryService.detect(service_project(project.id, repo_path))
    except LocalLibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{project_id}/local/setup-plan")
async def get_project_local_setup_plan(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Build the allowed dependency setup plan for the linked local checkout."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    repo_path = checkout_path(current_user, project_id)
    from app.services.workflow_recipe_service import WorkflowRecipeError, WorkflowRecipeService

    try:
        return WorkflowRecipeService.build_plan(service_project(project.id, repo_path))
    except WorkflowRecipeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{project_id}/local/tree")
async def get_project_local_tree(
    project_id: int,
    path: str = "",
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List an immediate directory in the user's linked local checkout."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    target_path = (repo_path / path).resolve()
    if target_path != repo_path and repo_path not in target_path.parents:
        raise HTTPException(status_code=400, detail="Invalid local repository path.")
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="The requested local repository path is not a directory.")

    entries = []
    for entry in sorted(target_path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        if entry.name == ".git":
            continue
        relative_path = entry.relative_to(repo_path).as_posix()
        entries.append(
            {
                "name": entry.name,
                "path": relative_path,
                "type": "dir" if entry.is_dir() else "file",
                "size": None if entry.is_dir() else entry.stat().st_size,
                "sha": "",
                "download_url": None,
            }
        )
    return entries


@router.get("/{project_id}/local/collections")
async def get_project_local_bruno_collections(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Discover executable Bruno collections and environments in the linked checkout."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    collections = []
    for manifest in repo_path.rglob("bruno.json"):
        collection_dir = manifest.parent
        if ".git" in collection_dir.parts or "node_modules" in collection_dir.parts:
            continue
        environments_dir = collection_dir / "environments"
        environments = (
            sorted(environment.stem for environment in environments_dir.glob("*.bru"))
            if environments_dir.is_dir()
            else []
        )
        collections.append({"path": collection_dir.relative_to(repo_path).as_posix(), "environments": environments})
    return {
        "frameworks": ["bruno"] if collections else [],
        "projects": sorted(collections, key=lambda item: item["path"]),
        "files_count": len(collections),
    }


_FRAMEWORK_DETECTION_TTL_SECONDS = 60
_framework_detection_cache: dict[str, tuple[float, dict]] = {}


def _forget_framework_detection(repo_path: Path) -> None:
    _framework_detection_cache.pop(str(repo_path), None)


@router.get("/{project_id}/local/frameworks")
async def detect_project_local_frameworks(
    project_id: int,
    refresh: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Runnable test frameworks (and their targets) found in the linked checkout."""
    import time as time_module

    from app.services import framework_run_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    cached = _framework_detection_cache.get(str(repo_path))
    if cached and not refresh and time_module.time() - cached[0] < _FRAMEWORK_DETECTION_TTL_SECONDS:
        return cached[1]
    result = await asyncio.to_thread(framework_run_service.detect_public, repo_path)
    _framework_detection_cache[str(repo_path)] = (time_module.time(), result)
    return result


@router.get("/{project_id}/local/appium")
async def analyze_project_local_appium(
    project_id: int,
    refresh: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect Appium runners/suites/device profiles in the linked checkout and
    report which settings or station tools need changing before a run."""
    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    from app.services.appium_project_service import analyze_project

    return await analyze_project(repo_path, refresh=refresh)


def _require_editor(current_user) -> None:
    role = getattr(current_user.role, "value", str(current_user.role))
    if str(role).lower() == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot edit project files.")


class PropertiesUpdateRequest(BaseModel):
    path: str
    etag: str
    changes: dict[str, str] = {}
    additions: dict[str, str] = {}


class PropertiesRevertRequest(BaseModel):
    path: str


def _properties_call(func, *args):
    from app.services.properties_service import PropertiesError

    try:
        return func(*args)
    except PropertiesError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/{project_id}/local/properties")
async def list_project_properties_files(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List .properties files in the user's linked checkout."""
    from app.services import properties_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return {"files": await asyncio.to_thread(properties_service.list_files, repo_path)}


@router.get("/{project_id}/local/properties/file")
async def read_project_properties_file(
    project_id: int,
    path: str,
    reveal: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read one .properties file; credential-like values are masked unless ``reveal``."""
    from app.services import properties_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    if reveal:
        _require_editor(current_user)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_properties_call, properties_service.read_file, repo_path, path, reveal)


@router.put("/{project_id}/local/properties/file")
async def update_project_properties_file(
    project_id: int,
    payload: PropertiesUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change existing values / add new keys, preserving the rest of the file."""
    from app.services import properties_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    _require_editor(current_user)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(
        _properties_call, properties_service.update_file,
        repo_path, payload.path, payload.etag, payload.changes, payload.additions,
    )


@router.post("/{project_id}/local/properties/revert")
async def revert_project_properties_file(
    project_id: int,
    payload: PropertiesRevertRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Discard local changes to a committed .properties file (git checkout)."""
    from app.services import properties_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    _require_editor(current_user)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_properties_call, properties_service.revert_file, repo_path, payload.path)


class BrunoEnvUpdateRequest(BaseModel):
    path: str
    etag: str
    changes: dict[str, str] = {}
    additions: dict[str, str] = {}
    enabled: dict[str, bool] = {}


@router.get("/{project_id}/local/bruno-env")
async def list_project_bruno_env_files(
    project_id: int,
    collection: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the environment .bru files a collection's runs can use."""
    from app.services import bruno_env_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return {"files": await asyncio.to_thread(_properties_call, bruno_env_service.list_files, repo_path, collection)}


@router.get("/{project_id}/local/bruno-env/file")
async def read_project_bruno_env_file(
    project_id: int,
    path: str,
    reveal: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read one environment file; credential-like values are masked unless ``reveal``."""
    from app.services import bruno_env_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    if reveal:
        _require_editor(current_user)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_properties_call, bruno_env_service.read_file, repo_path, path, reveal)


@router.put("/{project_id}/local/bruno-env/file")
async def update_project_bruno_env_file(
    project_id: int,
    payload: BrunoEnvUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change values, enable/disable or add variables, preserving the rest of the file."""
    from app.services import bruno_env_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    _require_editor(current_user)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(
        _properties_call, bruno_env_service.update_file,
        repo_path, payload.path, payload.etag, payload.changes, payload.additions, payload.enabled,
    )


@router.post("/{project_id}/local/bruno-env/revert")
async def revert_project_bruno_env_file(
    project_id: int,
    payload: PropertiesRevertRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Discard local changes to a committed environment file (git checkout)."""
    from app.services import bruno_env_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    _require_editor(current_user)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_properties_call, bruno_env_service.revert_file, repo_path, payload.path)


@router.get("/{project_id}/local/compare")
async def compare_project_local_repository(
    project_id: int,
    base: str = "main",
    head: str = "local",
    fetch: bool = True,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compare the linked local checkout with the project's GitHub refs."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    legacy_project = service_project(project.id, repo_path)
    try:
        return await LocalRepoService.compare(
            legacy_project,
            base_spec=base,
            head_spec=head,
            repo_url=project.github_repo_url or None,
            token=_read_user_project_github_token(current_user, project_id) or None,
            do_fetch=fetch,
        )
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{project_id}/local/scripts")
async def list_project_local_scripts(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect allow-listed runnable scripts in the user's linked checkout."""
    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    from app.services.local_script_service import LocalScriptError, LocalScriptService

    legacy_project = service_project(project.id, repo_path)
    try:
        scripts = LocalScriptService.detect(legacy_project)
    except LocalScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return [
        {
            **{key: value for key, value in script.items() if not key.startswith("_")},
            "usage": script.get("usage"),
            "example": script.get("example"),
            "params": script.get("params", []),
            "configured": False,
            "config_values": {},
        }
        for script in scripts
    ]


@router.post("/{project_id}/local/link-existing")
async def link_existing_local_repo(
    project_id: int,
    payload: LocalRepoLinkExistingRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Link an existing checkout (optionally switching to one of its local branches)."""
    from app.services import local_import_service
    from app.services.local_repo_service import LocalRepoError

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    project = _legacy_project_or_404(db, project_id)
    repo_url = (project.github_repo_url or "").strip()
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")
    try:
        repo_path = local_import_service.normalize_user_path(payload.path).resolve()
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    info = local_import_service.describe_checkout(repo_path, repo_url)
    if info["error"]:
        raise HTTPException(status_code=400, detail=info["error"])

    branch = (payload.branch or "").strip()
    if branch and branch != info["current_branch"]:
        try:
            await local_import_service.checkout_local_branch(repo_path, branch)
        except LocalRepoError as exc:
            raise HTTPException(status_code=400, detail=f"Could not switch to '{branch}': {exc}") from exc

    save_linked_path(db, current_user, project_id, str(repo_path))
    return await get_project_local_status(project_id, current_user, db)


@router.get("/{project_id}/local/inspect")
async def inspect_local_folder(
    project_id: int,
    path: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Check a folder before linking it: git status, origin match and local branches."""
    from app.services import local_import_service
    from app.services.local_repo_service import LocalRepoError

    check_organization_member(current_user)
    project = _legacy_project_or_404(db, project_id)
    try:
        repo_path = local_import_service.normalize_user_path(path).resolve()
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return local_import_service.describe_checkout(repo_path, (project.github_repo_url or "").strip())


@router.post("/{project_id}/local/import")
async def import_local_repo(
    project_id: int,
    payload: LocalRepoImportRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clone the chosen branch into a folder (created if missing) and remember it for this project."""
    from app.services import local_import_service
    from app.services.local_repo_service import LocalRepoError

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    project = _legacy_project_or_404(db, project_id)
    try:
        repo_path = local_import_service.normalize_user_path(payload.path)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    repo_url = (project.github_repo_url or "").strip()
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")

    try:
        target, cloned = await local_import_service.import_branch(repo_path.resolve(), repo_url, token, payload.branch)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not use '{repo_path}': {exc.strerror or exc}") from exc

    previously_managed = (_user_settings(current_user).get("project_local_repo_managed") or {}).get(str(project_id))
    save_linked_path(db, current_user, project_id, str(target),
                                 managed=cloned or previously_managed == str(target))
    return await get_project_local_status(project_id, current_user, db)


@router.delete("/{project_id}/local")
async def remove_local_repo(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Forget the local checkout; folders ATM cloned itself are deleted from disk too."""
    check_organization_member(current_user)
    check_product_manager_access(current_user)
    _legacy_project_or_404(db, project_id)
    saved_path = read_linked_path(current_user, project_id)
    managed_path = (_user_settings(current_user).get("project_local_repo_managed") or {}).get(str(project_id))
    deleted = False
    if saved_path and managed_path == saved_path:
        folder = Path(saved_path)
        if (folder / ".git").exists():
            dirty = subprocess.run(["git", "status", "--porcelain"], cwd=folder,
                                   text=True, capture_output=True, check=False).stdout.strip()
            if dirty:
                raise HTTPException(status_code=400,
                                    detail="The local copy has uncommitted changes. Commit or discard them first.")
            shutil.rmtree(folder)
            deleted = True
    save_linked_path(db, current_user, project_id, "")
    return {"removed": True, "deleted_from_disk": deleted}


class ScaffoldCreateRequest(BaseModel):
    framework: str
    language: str
    path: str


def _project_scaffold_info(user, project_id: int) -> Optional[dict]:
    info = (_user_settings(user).get("project_scaffolds") or {}).get(str(project_id))
    return info if isinstance(info, dict) else None


def _set_project_scaffold_info(db: Session, user, project_id: int, info: Optional[dict]) -> None:
    data = _user_settings(user)
    scaffolds = dict(data.get("project_scaffolds") or {})
    if info:
        scaffolds[str(project_id)] = info
    else:
        scaffolds.pop(str(project_id), None)
    data["project_scaffolds"] = scaffolds
    user.settings_json = data
    db.commit()
    db.refresh(user)


@router.get("/{project_id}/scaffold/catalog")
async def get_scaffold_catalog(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Starter templates (framework x language) and which tools this station has."""
    from app.services import scaffold_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    return await asyncio.to_thread(scaffold_service.catalog)


@router.get("/{project_id}/scaffold")
async def get_project_scaffold(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The starter project generated for this project (if any) and its latest install & run check."""
    from app.services import scaffold_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    info = _project_scaffold_info(current_user, project_id)
    if info and info.get("path") != read_linked_path(current_user, project_id):
        info = None  # The local copy was removed or replaced since the starter was created.
    job = scaffold_service.latest_job(project_id)
    if info:
        info = {**info, "remotes": await asyncio.to_thread(scaffold_service.git_remotes, Path(info["path"]))}
    return {"scaffold": info, "verify": job.to_dict() if job and info and job.path == info["path"] else None}


@router.delete("/{project_id}/scaffold")
async def delete_project_scaffold(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete the generated starter folder (only if it was never connected to a remote) and unlink it."""
    from app.services import scaffold_service

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    _legacy_project_or_404(db, project_id)
    info = _project_scaffold_info(current_user, project_id)
    if not info or info.get("path") != read_linked_path(current_user, project_id):
        raise HTTPException(status_code=404, detail="This project has no generated starter project.")
    try:
        await asyncio.to_thread(scaffold_service.delete_project, Path(info["path"]))
    except scaffold_service.ScaffoldError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete '{info['path']}': {exc}") from exc
    save_linked_path(db, current_user, project_id, "")
    _set_project_scaffold_info(db, current_user, project_id, None)
    return {"deleted": True, "path": info["path"]}


@router.post("/{project_id}/scaffold")
async def create_project_scaffold(
    project_id: int,
    payload: ScaffoldCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a working starter project in a local folder and link it as the project's local copy."""
    from app.services import local_import_service, scaffold_service
    from app.services.local_repo_service import LocalRepoError

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    project = _legacy_project_or_404(db, project_id)
    try:
        path = local_import_service.normalize_user_path(payload.path).resolve()
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        target = await asyncio.to_thread(
            scaffold_service.create_project, path, payload.framework, payload.language, project.name,
            current_user.full_name or current_user.username, current_user.email,
        )
    except scaffold_service.ScaffoldError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not write to '{path}': {exc.strerror or exc}") from exc

    save_linked_path(db, current_user, project_id, str(target), managed=True)
    info = {"framework": payload.framework, "language": payload.language, "path": str(target),
            "created_at": datetime.utcnow().isoformat()}
    _set_project_scaffold_info(db, current_user, project_id, info)
    return {"scaffold": info, "local": await get_project_local_status(project_id, current_user, db)}


@router.post("/{project_id}/scaffold/verify")
async def start_project_scaffold_verify(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Install dependencies and run the starter's sample tests in the background."""
    from app.services import scaffold_service

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    _legacy_project_or_404(db, project_id)
    info = _project_scaffold_info(current_user, project_id)
    if not info:
        raise HTTPException(status_code=404, detail="This project has no generated starter project.")
    try:
        job = scaffold_service.start_verify(project_id, Path(info["path"]), info["framework"], info["language"])
    except scaffold_service.ScaffoldError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return job.to_dict()


@router.get("/{project_id}/scaffold/verify/{job_id}")
async def get_project_scaffold_verify(
    project_id: int,
    job_id: str,
    since: int = 0,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services import scaffold_service

    check_organization_member(current_user)
    _legacy_project_or_404(db, project_id)
    job = scaffold_service.get_job(job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Check not found.")
    return job.to_dict(max(0, since))


@router.post("/{project_id}/scaffold/verify/{job_id}/cancel")
async def cancel_project_scaffold_verify(
    project_id: int,
    job_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services import scaffold_service

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    _legacy_project_or_404(db, project_id)
    job = scaffold_service.get_job(job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Check not found.")
    return scaffold_service.cancel_job(job_id).to_dict()


@router.get("/{project_id}/github", response_model=ProjectGitHubResponse)
async def get_project_github(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get project GitHub URL and current user's token state for the project."""
    check_organization_member(current_user)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    token = _read_user_project_github_token(current_user, project_id)
    return ProjectGitHubResponse(
        github_token_set=bool(token),
        github_token_preview=_token_preview(token),
        github_repo_url=project.github_repo_url or "",
    )


@router.patch("/{project_id}/github", response_model=ProjectGitHubResponse)
async def update_project_github(
    project_id: int,
    payload: ProjectGitHubConfig,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save current user's GitHub token; repo URL requires manage access."""
    check_organization_member(current_user)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if payload.github_repo_url is not None:
        check_product_manager_access(current_user)
        project.github_repo_url = payload.github_repo_url
        db.commit()
        db.refresh(project)

    if payload.github_token is not None:
        _set_user_project_github_token(db, current_user, project_id, payload.github_token)
    _forget_github_overview(project_id)

    token = _read_user_project_github_token(current_user, project_id)
    return ProjectGitHubResponse(
        github_token_set=bool(token),
        github_token_preview=_token_preview(token),
        github_repo_url=project.github_repo_url or "",
    )


@router.delete("/{project_id}/github", status_code=204)
async def disconnect_project_github(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove current user's GitHub token for this project."""
    check_organization_member(current_user)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _set_user_project_github_token(db, current_user, project_id, "")
    _forget_github_overview(project_id)
    return None


@router.post("/{project_id}/github/test", response_model=ProjectGitHubTestResponse)
async def test_project_github(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test current user's GitHub token for the selected project repository."""
    check_organization_member(current_user)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(
            status_code=400,
            detail="No GitHub token configured for your account on this project.",
        )

    user_endpoint = _build_github_user_endpoint(project.github_repo_url or "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                user_endpoint,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
        # Some enterprise setups expect the `token` auth scheme.
        if resp.status_code == 401:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    user_endpoint,
                    headers={
                        "Authorization": f"token {token}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
        if resp.status_code == 200:
            data = resp.json()
            return ProjectGitHubTestResponse(ok=True, login=data.get("login"), name=data.get("name"))
        return ProjectGitHubTestResponse(
            ok=False, error=f"GitHub returned {resp.status_code}: {resp.text[:120]}"
        )
    except Exception as exc:
        return ProjectGitHubTestResponse(ok=False, error=str(exc))
