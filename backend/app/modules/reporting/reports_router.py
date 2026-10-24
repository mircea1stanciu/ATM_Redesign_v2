"""The Reports area: report list, trends, and viewing a run's Allure report through a short-lived signed link."""
import asyncio
import base64
import hashlib
import hmac
import json
import mimetypes
import secrets
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.permissions import require
from app.modules.audit.service import record
from app.modules.identity.models import User
from app.modules.projects.models import (
    AllureReport,
    AnalyticsRun,
    AnalyticsSuite,
    ReportPublication,
    ReportShareLink,
    TestEnvironment,
)
from app.modules.projects.service import get_project_or_404
from app.modules.reporting import allure
from app.modules.reporting.confluence_publisher import publication_response, publish_run, zip_report
from app.modules.work.integrations import IntegrationError
from app.services import station_tools_service

router = APIRouter(prefix="/api", tags=["Reports"])

LINK_TTL_SECONDS = 3600
# Test results can carry HTML (Allure renders descriptionHtml as is). The report runs sandboxed in an opaque origin,
# so its scripts can never reach ATM's window or the signed-in user's token. Its own requests (data/*.json, fonts) are
# then cross-origin, hence the open CORS header: the signed token in the path is the only credential, no cookies.
REPORT_HEADERS = {
    "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads; "
                               "frame-ancestors 'self'",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=600",
}
TREND_POINTS = 30


# ── Signed links ──────────────────────────────────────────────────────────────
# The Allure report is a small web app (index.html, app.js, data/*.json) loaded in an iframe; the iframe cannot send
# the Authorization header, so the report is served under a path that carries a signed, expiring token.


def _sign(payload: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]


def make_token(kind: str, ident: int, user_id: int) -> str:
    body = base64.urlsafe_b64encode(json.dumps(
        {"k": kind, "i": ident, "u": user_id, "e": int(time.time()) + LINK_TTL_SECONDS}).encode()).decode().rstrip("=")
    return f"{body}.{_sign(body)}"


def read_token(token: str) -> dict:
    body, _, signature = token.partition(".")
    if not body or not hmac.compare_digest(signature, _sign(body)):
        raise HTTPException(status_code=404, detail="Report not found.")
    data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    if data.get("e", 0) < time.time():
        raise HTTPException(status_code=410, detail="This report link has expired. Open the report again.")
    return data


def _run_and_suite(db: Session, run_id: str) -> tuple[AnalyticsRun, AnalyticsSuite]:
    if not run_id.startswith("manual-") or not run_id.removeprefix("manual-").isdigit():
        raise HTTPException(status_code=404, detail="Report not found.")
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == int(run_id.removeprefix("manual-"))).first()
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first() if run else None
    if not run or not suite:
        raise HTTPException(status_code=404, detail="Report not found.")
    return run, suite


@router.post("/runs/{run_id}/report-link")
async def create_report_link(run_id: str, current_user: User = Depends(require("report.view", project_from="run_id")),
                             db: Session = Depends(get_db)):
    """A link to the run's Allure report, valid for an hour. Imported reports are generated on first view."""
    if run_id.startswith("allure-") and run_id.removeprefix("allure-").isdigit():
        report = db.query(AllureReport).filter(AllureReport.id == int(run_id.removeprefix("allure-"))).first()
        if not report:
            raise HTTPException(status_code=404, detail="Report not found.")
        ok, message, _ = await allure.build_imported_report(report)
        if not ok:
            raise HTTPException(status_code=409, detail=message)
        return {"url": f"/api/reports/view/{make_token('imported', report.id, current_user.id)}/index.html"}
    run, suite = _run_and_suite(db, run_id)
    report_dir = allure.run_report_dir(suite.project_id, suite.id, run.id) / "allure-report"
    if not (report_dir / "index.html").is_file():
        status = (run.details_json or {}).get("report") or {}
        detail = status.get("message") or ("The report is ready when the run finishes."
                                           if run.status in ("pending", "running") else "This run has no report.")
        raise HTTPException(status_code=409, detail=detail)
    return {"url": f"/api/reports/view/{make_token('run', run.id, current_user.id)}/index.html"}


@router.get("/reports/view/{token}/{path:path}", include_in_schema=False)
async def view_report_file(token: str, path: str, db: Session = Depends(get_db)):
    """A file of an Allure report; the token proves the viewer may see it (checked when the link was made)."""
    data = read_token(token)
    if data["k"] == "run":
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == data["i"]).first()
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first() if run else None
        if not run or not suite:
            raise HTTPException(status_code=404, detail="Report not found.")
        root = allure.run_report_dir(suite.project_id, suite.id, run.id) / "allure-report"
    else:
        report = db.query(AllureReport).filter(AllureReport.id == data["i"]).first()
        if not report:
            raise HTTPException(status_code=404, detail="Report not found.")
        root = allure.imported_report_dir(report.project_id, report.id) / "allure-report"
    return _report_file(root, path)


def _report_file(root: Path, path: str) -> FileResponse:
    target = (root / (path or "index.html")).resolve()
    if root.resolve() not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found.")
    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type, headers=REPORT_HEADERS)


def _report_dir(run: AnalyticsRun, suite: AnalyticsSuite) -> Path:
    return allure.run_report_dir(suite.project_id, suite.id, run.id) / "allure-report"


# ── Share links (phase 19): links that do not expire, revoked by leads and super admins ────────────────────────


def _share_response(db: Session, link: ReportShareLink) -> dict:
    by = db.query(User).filter(User.id == link.created_by_id).first() if link.created_by_id else None
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == link.run_id).first()
    return {"id": link.id, "url": f"/api/reports/shared/{link.token}/index.html", "run_id": f"manual-{link.run_id}",
            "run": (run.name or f"Run #{run.id}") if run else None,
            "created_by": (by.full_name or by.username) if by else None,
            "created_at": link.created_at.isoformat(), "views": link.views,
            "last_viewed_at": link.last_viewed_at.isoformat() if link.last_viewed_at else None}


@router.post("/runs/{run_id}/share-links", status_code=201)
async def create_share_link(run_id: str, current_user: User = Depends(require("report.publish", project_from="run_id")),
                            db: Session = Depends(get_db)):
    """A link to the run's report for people outside ATM; it works until a lead revokes it."""
    run, suite = _run_and_suite(db, run_id)
    if not (_report_dir(run, suite) / "index.html").is_file():
        raise HTTPException(status_code=409, detail="This run has no report to share.")
    link = ReportShareLink(token=secrets.token_urlsafe(32), run_id=run.id, project_id=suite.project_id,
                           created_by_id=current_user.id)
    db.add(link)
    db.commit()
    record(db, "report.share", f"{current_user.full_name or current_user.username} shared the report of "
                               f"{run.name or f'run {run.id}'}", actor_id=current_user.id, project_id=suite.project_id,
           details={"run_id": run.id, "link_id": link.id})
    return _share_response(db, link)


@router.get("/runs/{run_id}/share-links")
async def list_run_share_links(run_id: str, current_user: User = Depends(require("report.view", project_from="run_id")),
                               db: Session = Depends(get_db)):
    run, _ = _run_and_suite(db, run_id)
    links = db.query(ReportShareLink).filter(ReportShareLink.run_id == run.id).order_by(ReportShareLink.id.desc())
    return [_share_response(db, link) for link in links]


@router.get("/reports/projects/{project_id}/share-links")
async def list_share_links(project_id: int,
                           current_user: User = Depends(require("report.manage", project_from="project_id")),
                           db: Session = Depends(get_db)):
    """Every share link of the project, for the leads who revoke them."""
    links = (db.query(ReportShareLink).filter(ReportShareLink.project_id == project_id)
             .order_by(ReportShareLink.id.desc()))
    return [_share_response(db, link) for link in links]


@router.delete("/reports/projects/{project_id}/share-links/{link_id}")
async def revoke_share_link(project_id: int, link_id: int,
                            current_user: User = Depends(require("report.manage", project_from="project_id")),
                            db: Session = Depends(get_db)):
    link = db.query(ReportShareLink).filter(ReportShareLink.id == link_id,
                                            ReportShareLink.project_id == project_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found.")
    db.delete(link)
    db.commit()
    record(db, "report.share.revoke", f"{current_user.full_name or current_user.username} revoked a share link",
           actor_id=current_user.id, project_id=project_id, details={"run_id": link.run_id, "link_id": link_id})
    return {"revoked": link_id}


@router.get("/reports/shared/{token}/{path:path}", include_in_schema=False)
async def view_shared_report(token: str, path: str, db: Session = Depends(get_db)):
    """A file of a shared report: the random token is the only credential (sandboxed like signed links)."""
    link = db.query(ReportShareLink).filter(ReportShareLink.token == token).first()
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == link.run_id).first() if link else None
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first() if run else None
    if not link or not run or not suite:
        raise HTTPException(status_code=404, detail="This link was revoked or never existed.")
    if path in ("", "index.html"):
        link.views += 1
        link.last_viewed_at = datetime.utcnow()
        db.commit()
    return _report_file(_report_dir(run, suite), path)


# ── Deleting a report, downloading it (phase 19) ──────────────────────────────


@router.delete("/runs/{run_id}/report")
async def delete_report(run_id: str, current_user: User = Depends(require("report.manage", project_from="run_id")),
                        db: Session = Depends(get_db)):
    """Delete the run's Allure report and its files for good (the run and its results stay). Share links go too."""
    run, suite = _run_and_suite(db, run_id)
    shutil.rmtree(allure.run_report_dir(suite.project_id, suite.id, run.id), ignore_errors=True)
    db.query(ReportShareLink).filter(ReportShareLink.run_id == run.id).delete()
    deleted = {"status": "deleted", "message": "The report was deleted."}
    run.details_json = {**(run.details_json or {}), "report": deleted}
    db.commit()
    record(db, "report.delete", f"{current_user.full_name or current_user.username} deleted the report of "
                                f"{run.name or f'run {run.id}'}", actor_id=current_user.id, project_id=suite.project_id,
           details={"run_id": run.id})
    return {"deleted": run_id}


@router.get("/runs/{run_id}/report.zip")
async def download_report(run_id: str, current_user: User = Depends(require("report.view", project_from="run_id")),
                          db: Session = Depends(get_db)):
    """The report as a zip: the same archive that is attached to the Confluence page."""
    run, suite = _run_and_suite(db, run_id)
    report_dir = _report_dir(run, suite)
    if not (report_dir / "index.html").is_file():
        raise HTTPException(status_code=409, detail="This run has no report to download.")
    archive = await asyncio.to_thread(zip_report, report_dir)
    return Response(archive, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="allure-report-run-{run.id}.zip"'})


# ── Allure on the station (phase 19) ──────────────────────────────────────────


@router.get("/reports/allure")
async def allure_status(current_user: User = Depends(require("report.view"))):
    binary = allure.allure_binary()
    return {"installed": bool(binary), "path": binary, "managed": bool(station_tools_service.managed_path("allure")),
            "java": station_tools_service.java_available()}


@router.post("/reports/allure/install")
async def install_allure(current_user: User = Depends(require("report.manage"))):
    """Download the Allure command line from Maven Central into ATM's tools folder."""
    lines: list[str] = []
    try:
        path = await station_tools_service.install("allure", lines.append)
    except station_tools_service.ToolInstallError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"path": path, "log": lines, "java": station_tools_service.java_available()}


# ── List and trends ───────────────────────────────────────────────────────────


def _duration(run: AnalyticsRun) -> Optional[float]:
    if run.started_at and run.finished_at:
        return round((run.finished_at - run.started_at).total_seconds(), 1)
    return None


def _pass_rate(run: AnalyticsRun) -> Optional[float]:
    total = run.total_tests or 0
    return round(100 * run.passed_tests / total, 1) if total else None


@router.get("/reports/projects/{project_id}/runs")
async def list_reports(project_id: int, suite_id: Optional[int] = None, limit: int = Query(100, ge=1, le=500),
                       current_user: User = Depends(require("report.view", project_from="project_id")),
                       db: Session = Depends(get_db)):
    """Finished runs of the project with their report: date, pass rate, duration, environment, branch."""
    get_project_or_404(db, project_id)
    suites = {s.id: s for s in db.query(AnalyticsSuite).filter(AnalyticsSuite.project_id == project_id)}
    environments = {e.id: e.name for e in db.query(TestEnvironment).filter(TestEnvironment.project_id == project_id)}
    query = db.query(AnalyticsRun).filter(AnalyticsRun.suite_id.in_(list(suites)),
                                          AnalyticsRun.status.notin_(("pending", "running")))
    if suite_id is not None:
        query = query.filter(AnalyticsRun.suite_id == suite_id)
    runs = query.order_by(AnalyticsRun.created_at.desc(), AnalyticsRun.id.desc()).limit(limit).all()
    # The latest publication of each run: "published" or "failed".
    published: dict[int, str] = {}
    for publication in (db.query(ReportPublication).filter(ReportPublication.run_id.in_([r.id for r in runs]))
                        .order_by(ReportPublication.published_at)):
        published[publication.run_id] = publication.status
    return [{
        "run_id": f"manual-{run.id}",
        "name": run.name or run.collection or f"Run #{run.id}",
        "suite_id": str(run.suite_id),
        "suite": suites[run.suite_id].name,
        "test_type": suites[run.suite_id].test_type,
        "status": run.status,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "pass_rate": _pass_rate(run),
        "total": run.total_tests,
        "failed": run.failed_tests,
        "duration_seconds": _duration(run),
        "environment": environments.get(run.environment_id) if run.environment_id else None,
        "branch": run.branch,
        "trigger": run.trigger,
        "report": ((run.details_json or {}).get("report") or {}).get("status") or "none",
        "confluence": published.get(run.id),
    } for run in runs]


@router.get("/reports/projects/{project_id}/trends")
async def suite_trends(project_id: int, suite_id: int,
                       current_user: User = Depends(require("report.view", project_from="project_id")),
                       db: Session = Depends(get_db)):
    """The suite's last runs: pass rate, duration and (performance suites) p95; plus the tests whose outcome flips."""
    get_project_or_404(db, project_id)
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == suite_id,
                                            AnalyticsSuite.project_id == project_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found.")
    runs = (db.query(AnalyticsRun).filter(AnalyticsRun.suite_id == suite.id,
                                          AnalyticsRun.status.notin_(("pending", "running")))
            .order_by(AnalyticsRun.created_at.desc(), AnalyticsRun.id.desc()).limit(TREND_POINTS).all())[::-1]
    points = [{
        "run_id": f"manual-{run.id}",
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "pass_rate": _pass_rate(run),
        "duration_seconds": _duration(run),
        "total": run.total_tests,
        "failed": run.failed_tests,
        "p95_ms": ((run.details_json or {}).get("performance") or {}).get("p95_ms"),
    } for run in runs]
    # A flaky test passed in some of these runs and failed in others.
    outcomes: dict[str, set[str]] = {}
    for run in runs:
        for result in run.results_json or []:
            name = f"{result.get('class_name') or ''} {result.get('test_name') or ''}".strip()
            status = str(result.get("status") or "").lower()
            if status in ("passed", "failed", "error"):
                outcomes.setdefault(name, set()).add("passed" if status == "passed" else "failed")
    flaky = sorted(name for name, seen in outcomes.items() if seen == {"passed", "failed"})
    return {"suite_id": str(suite.id), "suite": suite.name, "test_type": suite.test_type, "points": points,
            "flaky_tests": flaky}



# ── Confluence ────────────────────────────────────────────────────────────────


class AutoPublishPayload(BaseModel):
    enabled: bool


@router.put("/suites/{suite_id}/auto-publish")
async def set_auto_publish(suite_id: int, payload: AutoPublishPayload, request: Request,
                           current_user: User = Depends(require("report.publish", project_from="suite_id")),
                           db: Session = Depends(get_db)):
    """Publish every finished run of the suite to Confluence (phase 19), with the token of whoever switches it on."""
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found.")
    suite.auto_publish_by_id = current_user.id if payload.enabled else None
    suite.auto_publish_origin = (settings.ATM_PUBLIC_URL or request.headers.get("origin") or str(request.base_url)) \
        if payload.enabled else None
    db.commit()
    return {"suite_id": str(suite.id), "auto_publish": payload.enabled,
            "auto_publish_by": (current_user.full_name or current_user.username) if payload.enabled else None}


@router.post("/runs/{run_id}/publish")
async def publish_report(run_id: str, request: Request,
                         current_user: User = Depends(require("report.publish", project_from="run_id")),
                         db: Session = Depends(get_db)):
    """Publish the run's report to Confluence: the suite's page (created or updated) and the report as a zip."""
    run, _ = _run_and_suite(db, run_id)
    # Links on the page point back to ATM as the publisher sees it.
    atm_url = settings.ATM_PUBLIC_URL or request.headers.get("origin") or str(request.base_url)
    try:
        publication = await publish_run(db, current_user, run, atm_url)
    except IntegrationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return publication_response(publication, current_user.full_name or current_user.username)


@router.get("/runs/{run_id}/publications")
async def list_publications(run_id: str, current_user: User = Depends(require("report.view", project_from="run_id")),
                            db: Session = Depends(get_db)):
    """The run's publications to Confluence, newest first (failed ones too, with the reason)."""
    run, _ = _run_and_suite(db, run_id)
    publications = (db.query(ReportPublication).filter(ReportPublication.run_id == run.id)
                    .order_by(ReportPublication.published_at.desc(), ReportPublication.id.desc()).all())
    names = {u.id: u.full_name or u.username for u in db.query(User).filter(
        User.id.in_([p.published_by_id for p in publications if p.published_by_id]))}
    return [publication_response(p, names.get(p.published_by_id) if p.published_by_id else None)
            for p in publications]
