"""Testing: suites and runs, GitHub Actions runs, and the runnable content of the local checkout."""
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import SessionLocal, get_db
from app.core.permissions import can_see_project, ensure, has_permission, require
from app.core.security import decode_token, token_user_id
from app.modules.identity.models import User
from app.modules.projects.checkouts import (
    checkout_path,
    require_checkout,
    service_project,
)
from app.modules.projects.models import AllureReport, AnalyticsRun, AnalyticsSuite
from app.modules.projects.service import (
    get_project_or_404,
    github_get,
    github_headers,
    github_repository_context,
    parse_github_datetime,
    save_script_config,
    script_configs,
)
from app.modules.reporting.service import _allure_run_response
from app.modules.testing.runs import (
    _FRAMEWORK_DETECTION_TTL_SECONDS,
    AnalyticsRunExecuteRequest,
    _analytics_run_response,
    _append_manual_run_log,
    _broadcast_manual_run_message,
    _clean_run_name,
    _execute_manual_run_background,
    _framework_detection_cache,
    _manual_run_artifact_dir,
    _start_appium_run,
    _start_framework_run,
    _write_manual_allure_report,
    _write_manual_run_metadata,
    cancelled_manual_runs,
    manual_run_processes,
    manual_run_sockets,
)

router = APIRouter(prefix="/api/projects", tags=["Testing"])
runs_router = APIRouter(prefix="/api", tags=["Testing"])


class GitHubRunsSyncRequest(BaseModel):
    workflow_id: Optional[str] = None
    collection: Optional[str] = None
    branch: Optional[str] = None
    limit: int = 100


class AnalyticsSuiteCreate(BaseModel):
    name: str
    tags: list[str] = []
    active: bool = True


class AnalyticsRunCreate(BaseModel):
    suite_id: str
    branch: Optional[str] = None
    commit_sha: Optional[str] = None
    triggered_by: Optional[str] = None
    collection: Optional[str] = None
    name: Optional[str] = None


class AnalyticsRunRename(BaseModel):
    name: Optional[str] = None


@runs_router.get("/suites/projects/{project_id}")
async def list_analytics_suites(
    project_id: int,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Expose imported Allure results as a virtual suite to the Analytics client."""
    get_project_or_404(db, project_id)
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


@runs_router.post("/suites/projects/{project_id}/suites")
async def create_analytics_suite(
    project_id: int,
    payload: AnalyticsSuiteCreate,
    current_user=Depends(require("suite.manage", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Create legacy suite metadata for a project."""
    get_project_or_404(db, project_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Suite name is required.")
    suite = AnalyticsSuite(
        project_id=project_id,
        name=name,
        tags=[tag.strip() for tag in payload.tags if tag.strip()],
        active=payload.active,
        created_by_user_id=current_user.id,
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


@runs_router.get("/runs/projects/{project_id}")
async def list_analytics_runs(
    project_id: int,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Return imported local and GitHub Allure reports in the standard run list contract."""
    get_project_or_404(db, project_id)
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


@runs_router.post("/runs")
async def create_analytics_run(
    payload: AnalyticsRunCreate,
    current_user=Depends(require("run.execute")),
    db: Session = Depends(get_db),
):
    """Create a local pending run from a legacy project suite."""
    try:
        suite_id = int(payload.suite_id)
    except ValueError:
        if not payload.suite_id.startswith("allure-suite-"):
            raise HTTPException(status_code=400, detail="A valid project suite is required for local runs.")
        try:
            project_id = int(payload.suite_id.removeprefix("allure-suite-"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Allure suite reference.")
        get_project_or_404(db, project_id)
        ensure(db, current_user, "run.execute", project_id)
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
    get_project_or_404(db, suite.project_id)
    ensure(db, current_user, "run.execute", suite.project_id)
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


@runs_router.patch("/runs/{run_id}")
async def rename_analytics_run(
    run_id: str,
    payload: AnalyticsRunRename,
    current_user=Depends(require("run.execute", project_from="run_id")),
    db: Session = Depends(get_db),
):
    """Set or clear the display name of a local run."""
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
    get_project_or_404(db, suite.project_id)
    run.name = _clean_run_name(payload.name)
    db.commit()
    db.refresh(run)
    return _analytics_run_response(run)


@runs_router.get("/runs/{run_id}")
async def get_analytics_run_details(
    run_id: str,
    current_user=Depends(require("run.view", project_from="run_id")),
    db: Session = Depends(get_db),
):
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
        get_project_or_404(db, suite.project_id)
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


@runs_router.get("/runs/{run_id}/reports/{file_name}")
async def get_run_report_file(
    run_id: str,
    file_name: str,
    current_user=Depends(require("run.view", project_from="run_id")),
    db: Session = Depends(get_db),
):
    """Serve a report document captured for this run (copied into the run's artifacts)."""
    import mimetypes

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
    get_project_or_404(db, suite.project_id)
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


@runs_router.get("/runs/{run_id}/allure-report")
async def get_manual_allure_report(
    run_id: str,
    current_user=Depends(require("run.view", project_from="run_id")),
    db: Session = Depends(get_db),
):
    """Serve the generated Allure-style HTML report for one local execution."""
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


@runs_router.post("/runs/{run_id}/execute")
async def execute_analytics_run(
    run_id: str,
    payload: AnalyticsRunExecuteRequest = AnalyticsRunExecuteRequest(),
    current_user=Depends(require("run.execute", project_from="run_id")),
    db: Session = Depends(get_db),
):
    """Start a Bruno collection in the user's linked local checkout and stream live logs."""
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
    get_project_or_404(db, suite.project_id)

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


@runs_router.post("/runs/{run_id}/cancel")
async def cancel_analytics_run(
    run_id: str,
    current_user=Depends(require("run.execute", project_from="run_id")),
    db: Session = Depends(get_db),
):
    """Cancel a manually-created local run."""
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


@runs_router.delete("/runs/{run_id}")
async def delete_analytics_run(
    run_id: str,
    current_user=Depends(require("run.execute", project_from="run_id")),
    db: Session = Depends(get_db),
):
    """Delete a manually-created run or an imported Allure report."""
    if run_id.startswith("allure-"):
        try:
            report_id = int(run_id.removeprefix("allure-"))
        except ValueError:
            raise HTTPException(status_code=404, detail="Run not found")
        report = db.query(AllureReport).filter(AllureReport.id == report_id).first()
        if not report:
            raise HTTPException(status_code=404, detail="Run not found")
        get_project_or_404(db, report.project_id)
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


def _may_watch_run(token: Optional[str], run_id: str) -> bool:
    """Whether the token's user may read this run's logs (run.view on the run's project)."""
    payload = decode_token(token) if token else None
    user_id = token_user_id(payload) if payload else None
    if user_id is None:
        return False
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active or not has_permission(user, "run.view"):
            return False
        if not run_id.startswith("manual-"):
            return True
        try:
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == int(run_id.removeprefix("manual-"))).first()
        except ValueError:
            return False
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first() if run else None
        return bool(suite) and can_see_project(db, user, suite.project_id)
    finally:
        db.close()


WS_TOKEN_PROTOCOL = "atm-token"


@runs_router.websocket("/ws/runs/{run_id}")
async def stream_manual_run_logs(websocket: WebSocket, run_id: str):
    """Stream the status and log messages of a run.

    Browsers cannot send an Authorization header on a WebSocket. The client offers the subprotocols
    ["atm-token", <access token>] (headers are not written to the access log, unlike the URL); the access_token
    cookie works too.
    """
    offered = list(websocket.scope.get("subprotocols") or [])
    token = None
    if WS_TOKEN_PROTOCOL in offered and offered.index(WS_TOKEN_PROTOCOL) + 1 < len(offered):
        token = offered[offered.index(WS_TOKEN_PROTOCOL) + 1]
    token = token or websocket.cookies.get("access_token")
    if not _may_watch_run(token, run_id):
        await websocket.close(code=1008)  # policy violation: not signed in or not allowed
        return
    await websocket.accept(subprotocol=WS_TOKEN_PROTOCOL if WS_TOKEN_PROTOCOL in offered else None)
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


@router.post("/{project_id}/github/runs/sync")
async def sync_project_github_runs(
    project_id: int,
    payload: GitHubRunsSyncRequest,
    current_user=Depends(require("run.execute", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Import GitHub Actions history into the legacy Dashboard and Analytics runs."""
    project = get_project_or_404(db, project_id)
    workflow_id = (payload.workflow_id or "").strip()
    if workflow_id and "/" in workflow_id:
        raise HTTPException(status_code=400, detail="Invalid workflow id.")
    limit = max(1, min(int(payload.limit or 100), 300))
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    endpoint = (
        f"{api_base}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
        if workflow_id else f"{api_base}/repos/{owner}/{repo}/actions/runs"
    )
    params = {"per_page": min(limit, 100)}
    if payload.branch:
        params["branch"] = payload.branch.strip()
    async with httpx.AsyncClient(timeout=30) as client:
        response = await github_get(client, endpoint, token, params=params)
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
        run.started_at = parse_github_datetime(item.get("run_started_at")) or parse_github_datetime(
            item.get("created_at")
        )
        run.finished_at = parse_github_datetime(item.get("updated_at")) if item.get("status") == "completed" else None
        run.logs_json = [metadata]
        run.created_at = parse_github_datetime(item.get("created_at")) or datetime.utcnow()
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
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Return live GitHub Actions run history for the selected workflow."""
    project = get_project_or_404(db, project_id)
    workflow_id = workflow_id.strip()
    if workflow_id and "/" in workflow_id:
        raise HTTPException(status_code=400, detail="Invalid workflow id.")
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    endpoint = (
        f"{api_base}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
        if workflow_id else f"{api_base}/repos/{owner}/{repo}/actions/runs"
    )
    params = {"per_page": max(1, min(int(limit or 30), 100))}
    if branch.strip():
        params["branch"] = branch.strip()
    async with httpx.AsyncClient(timeout=30) as client:
        response = await github_get(client, endpoint, token, params=params)
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


@router.get("/{project_id}/local/libraries")
async def get_project_local_libraries(
    project_id: int,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Detect dependency manifests in the linked local checkout."""
    project = get_project_or_404(db, project_id)
    repo_path = checkout_path(current_user, project_id)
    from app.services.local_library_service import LocalLibraryError, LocalLibraryService

    try:
        return LocalLibraryService.detect(service_project(project.id, repo_path))
    except LocalLibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{project_id}/local/setup-plan")
async def get_project_local_setup_plan(
    project_id: int,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Build the allowed dependency setup plan for the linked local checkout."""
    project = get_project_or_404(db, project_id)
    repo_path = checkout_path(current_user, project_id)
    from app.services.workflow_recipe_service import WorkflowRecipeError, WorkflowRecipeService

    try:
        return WorkflowRecipeService.build_plan(service_project(project.id, repo_path))
    except WorkflowRecipeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{project_id}/local/collections")
async def get_project_local_bruno_collections(
    project_id: int,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Discover executable Bruno collections and environments in the linked checkout."""
    get_project_or_404(db, project_id)
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


@router.get("/{project_id}/local/frameworks")
async def detect_project_local_frameworks(
    project_id: int,
    refresh: bool = False,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Runnable test frameworks (and their targets) found in the linked checkout."""
    import time as time_module

    from app.services import framework_run_service

    get_project_or_404(db, project_id)
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
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Detect Appium runners/suites/device profiles in the linked checkout and
    report which settings or station tools need changing before a run."""
    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    from app.services.appium_project_service import analyze_project

    return await analyze_project(repo_path, refresh=refresh)


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
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """List .properties files in the user's linked checkout."""
    from app.services import properties_service

    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return {"files": await asyncio.to_thread(properties_service.list_files, repo_path)}


@router.get("/{project_id}/local/properties/file")
async def read_project_properties_file(
    project_id: int,
    path: str,
    reveal: bool = False,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Read one .properties file; credential-like values are masked unless ``reveal``."""
    from app.services import properties_service

    get_project_or_404(db, project_id)
    if reveal:  # unmasked credential values need edit rights
        ensure(db, current_user, "code.edit", project_id)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_properties_call, properties_service.read_file, repo_path, path, reveal)


@router.put("/{project_id}/local/properties/file")
async def update_project_properties_file(
    project_id: int,
    payload: PropertiesUpdateRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Change existing values / add new keys, preserving the rest of the file."""
    from app.services import properties_service

    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(
        _properties_call, properties_service.update_file,
        repo_path, payload.path, payload.etag, payload.changes, payload.additions,
    )


@router.post("/{project_id}/local/properties/revert")
async def revert_project_properties_file(
    project_id: int,
    payload: PropertiesRevertRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Discard local changes to a committed .properties file (git checkout)."""
    from app.services import properties_service

    get_project_or_404(db, project_id)
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
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """List the environment .bru files a collection's runs can use."""
    from app.services import bruno_env_service

    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return {"files": await asyncio.to_thread(_properties_call, bruno_env_service.list_files, repo_path, collection)}


@router.get("/{project_id}/local/bruno-env/file")
async def read_project_bruno_env_file(
    project_id: int,
    path: str,
    reveal: bool = False,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Read one environment file; credential-like values are masked unless ``reveal``."""
    from app.services import bruno_env_service

    get_project_or_404(db, project_id)
    if reveal:  # unmasked credential values need edit rights
        ensure(db, current_user, "code.edit", project_id)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_properties_call, bruno_env_service.read_file, repo_path, path, reveal)


@router.put("/{project_id}/local/bruno-env/file")
async def update_project_bruno_env_file(
    project_id: int,
    payload: BrunoEnvUpdateRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Change values, enable/disable or add variables, preserving the rest of the file."""
    from app.services import bruno_env_service

    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(
        _properties_call, bruno_env_service.update_file,
        repo_path, payload.path, payload.etag, payload.changes, payload.additions, payload.enabled,
    )


@router.post("/{project_id}/local/bruno-env/revert")
async def revert_project_bruno_env_file(
    project_id: int,
    payload: PropertiesRevertRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Discard local changes to a committed environment file (git checkout)."""
    from app.services import bruno_env_service

    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_properties_call, bruno_env_service.revert_file, repo_path, payload.path)


@router.get("/{project_id}/local/scripts")
async def list_project_local_scripts(
    project_id: int,
    current_user=Depends(require("run.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Detect allow-listed runnable scripts in the user's linked checkout."""
    project = get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    configs = script_configs(current_user, project_id)
    return [_script_item(script, configs) for script in _detect_scripts(project.id, repo_path)]




# ── Scripts, dependencies and GitHub Actions dispatch ────────────────────────


class LocalScriptRunRequest(BaseModel):
    script_id: str
    timeout: Optional[int] = None


class LocalScriptConfigRequest(BaseModel):
    script_id: str
    values: dict[str, str | bool] = {}


class LibraryInstallRequest(BaseModel):
    manifest_id: str
    timeout: Optional[int] = None


class SetupInstallRequest(BaseModel):
    timeout: Optional[int] = None


class WorkflowDispatchRequest(BaseModel):
    workflow_id: str
    ref: Optional[str] = None
    inputs: dict[str, str | bool] = {}
    collection: Optional[str] = None


def _detect_scripts(project_id: int, repo_path: Path) -> list[dict]:
    from app.services.local_script_service import LocalScriptError, LocalScriptService

    try:
        return LocalScriptService.detect(service_project(project_id, repo_path))
    except LocalScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _script_item(script: dict, configs: dict) -> dict:
    values = configs.get(script["id"])
    return {
        **{key: value for key, value in script.items() if not key.startswith("_")},
        "usage": script.get("usage"),
        "example": script.get("example"),
        "params": script.get("params", []),
        "configured": values is not None,
        "config_values": values or {},
    }


@router.put("/{project_id}/local/scripts/config")
async def save_project_local_script_config(
    project_id: int,
    payload: LocalScriptConfigRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Save the input values for a detected script's "Usage:" parameters (kept per user)."""
    project = get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    script = next((s for s in _detect_scripts(project.id, repo_path) if s["id"] == payload.script_id), None)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found. Rescan and try again.")
    save_script_config(db, current_user, project_id, payload.script_id, payload.values)
    return _script_item(script, {payload.script_id: payload.values})


@router.post("/{project_id}/local/scripts/run")
async def run_project_local_script(
    project_id: int,
    payload: LocalScriptRunRequest,
    current_user=Depends(require("run.execute", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Run a detected script in the checkout and return its output."""
    from app.services.local_script_service import LocalScriptError, LocalScriptService

    project = get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    values = script_configs(current_user, project_id).get(payload.script_id, {})
    try:
        return await LocalScriptService.run(
            service_project(project.id, repo_path), payload.script_id, payload.timeout or 300, config_values=values
        )
    except LocalScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{project_id}/local/libraries/install")
async def install_project_local_libraries(
    project_id: int,
    payload: LibraryInstallRequest,
    current_user=Depends(require("run.execute", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Install a detected manifest's dependencies in the checkout and return the output."""
    from app.services.local_library_service import LocalLibraryError, LocalLibraryService

    project = get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    try:
        return await LocalLibraryService.install(
            service_project(project.id, repo_path), payload.manifest_id, payload.timeout or 600
        )
    except LocalLibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{project_id}/local/setup-plan/install")
async def install_project_local_setup_plan(
    project_id: int,
    payload: Optional[SetupInstallRequest] = None,
    current_user=Depends(require("run.execute", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Run every step of the setup plan in order, stopping at the first failure."""
    from app.services.workflow_recipe_service import WorkflowRecipeError, WorkflowRecipeService

    project = get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    try:
        return await WorkflowRecipeService.install(
            service_project(project.id, repo_path), (payload.timeout if payload else None) or 900
        )
    except WorkflowRecipeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{project_id}/github/workflows/dispatch")
async def dispatch_project_github_workflow(
    project_id: int,
    payload: WorkflowDispatchRequest,
    current_user=Depends(require("run.execute.ci", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Start a GitHub Actions ``workflow_dispatch`` run. The run itself is recorded by the runs sync."""
    project = get_project_or_404(db, project_id)
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    ref = (payload.ref or "main").strip()
    workflow_id = payload.workflow_id.strip()
    if not workflow_id or "/" in workflow_id:
        raise HTTPException(status_code=400, detail="Invalid workflow id.")

    # GitHub only accepts string input values for workflow_dispatch.
    inputs = {k: (str(v).lower() if isinstance(v, bool) else str(v)) for k, v in payload.inputs.items()}
    body: dict = {"ref": ref, **({"inputs": inputs} if inputs else {})}
    url = f"{api_base}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(url, headers=github_headers(token), json=body)
            if resp.status_code == 401:
                resp = await client.post(url, headers=github_headers(token, "token"), json=body)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {exc}")

    if resp.status_code == 204:
        web_base = api_base.replace("://api.github.com", "://github.com").removesuffix("/api/v3")
        return {"dispatched": True, "workflow_id": workflow_id, "ref": ref,
                "actions_url": f"{web_base}/{owner}/{repo}/actions/workflows/{workflow_id}", "run_id": None}
    if resp.status_code in (401, 403):
        raise HTTPException(
            status_code=400, detail="GitHub token lacks 'workflow'/'actions' permission, or is invalid for this repo."
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Workflow not found, or it does not declare 'workflow_dispatch'.")
    if resp.status_code == 422:
        raise HTTPException(status_code=422, detail=f"GitHub rejected the dispatch: {resp.text[:300]}")
    raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
