"""Reporting: imported Allure reports (local checkout and GitHub artifacts)."""
import io
import zipfile

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import BACKEND_DIR
from app.core.db import get_db
from app.core.deps import get_current_user
from app.modules.projects.checkouts import (
    require_checkout,
)
from app.modules.projects.models import AllureReport
from app.modules.projects.service import (
    check_organization_member,
    get_project_or_404,
    github_get,
    github_repository_context,
    parse_github_datetime,
)
from app.modules.reporting.service import (
    _allure_report_response,
    _allure_results_from_json_entries,
    _save_allure_report,
)
from app.modules.testing.runs import _write_manual_allure_report

router = APIRouter(prefix="/api/projects", tags=["Reporting"])


@router.get("/{project_id}/allure/reports")
async def list_allure_reports(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List normalized Allure reports from local and GitHub Actions imports."""
    check_organization_member(current_user)
    get_project_or_404(db, project_id)
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
    get_project_or_404(db, project_id)
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
    get_project_or_404(db, project_id)
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
    project = get_project_or_404(db, project_id)
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    created = updated = 0
    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
            runs_response = await github_get(
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
                artifacts_response = await github_get(
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
                    archive_response = await github_get(client, archive_url, token)
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
                        occurred_at=parse_github_datetime(run.get("run_started_at"))
                        or parse_github_datetime(run.get("created_at")),
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
