"""The Reports area: report list, trends, and viewing a run's Allure report through a short-lived signed link."""
import base64
import hashlib
import hmac
import json
import mimetypes
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.permissions import require
from app.modules.identity.models import User
from app.modules.projects.models import (
    AllureReport,
    AnalyticsRun,
    AnalyticsSuite,
    ReportPublication,
    TestEnvironment,
)
from app.modules.projects.service import get_project_or_404
from app.modules.reporting import allure
from app.modules.reporting.confluence_publisher import publication_response, publish_run
from app.modules.work.integrations import IntegrationError

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
    target = (root / (path or "index.html")).resolve()
    if root.resolve() not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found.")
    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type, headers=REPORT_HEADERS)


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
