"""Publishing a run's report to Confluence (open topic T1, decided as the default in decisions-to-review.md).

One page per suite, "<project> · <suite> · Test report", under the project's parent page in its Confluence space.
Each publication updates the page (latest run, failed tests, the suite's recent runs, a link back to ATM) and attaches
the Allure report as a zip. Every publication, also a failed one, is recorded in ``report_publications``.
"""
import asyncio
import html
import io
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.modules.audit.service import record
from app.modules.identity.models import User
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ReportPublication, TestEnvironment
from app.modules.reporting import allure
from app.modules.work.integrations import (
    ConfluenceClient,
    Connection,
    IntegrationError,
    confluence_connection,
    confluence_space_key,
)

RECENT_RUNS = 10
FAILED_TESTS_SHOWN = 50
STATUS_COLOURS = {"passed": "Green", "failed": "Red", "error": "Red", "cancelled": "Yellow"}


def page_title(project: Project, suite: AnalyticsSuite) -> str:
    return f"{project.name} · {suite.name} · Test report"


def _e(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def _status_macro(status: str) -> str:
    colour = STATUS_COLOURS.get(status, "Grey")
    return (f'<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">{colour}</ac:parameter>'
            f'<ac:parameter ac:name="title">{_e(status.upper())}</ac:parameter></ac:structured-macro>')


def _pass_rate(run: AnalyticsRun) -> str:
    return f"{100 * run.passed_tests / run.total_tests:.1f} %" if run.total_tests else "—"


def _duration(run: AnalyticsRun) -> str:
    if not (run.started_at and run.finished_at):
        return "—"
    seconds = (run.finished_at - run.started_at).total_seconds()
    return f"{seconds:.0f} s" if seconds < 60 else f"{int(seconds // 60)} min {int(seconds % 60)} s"


def page_body(project: Project, suite: AnalyticsSuite, run: AnalyticsRun, recent: list[AnalyticsRun],
              environment: Optional[str], report_link: str, attachment: str, publisher: str) -> str:
    """The page in Confluence storage format (XHTML); every value is escaped."""
    failed = [r for r in run.results_json or [] if str(r.get("status") or "").lower() in ("failed", "error")]
    rows = [
        ("Run", _e(run.name or run.collection or f"Run #{run.id}")),
        ("Result", _status_macro(run.status)),
        ("Pass rate", _e(_pass_rate(run))),
        ("Tests", _e(f"{run.passed_tests} passed, {run.failed_tests} failed, {run.skipped_tests} skipped")),
        ("Duration", _e(_duration(run))),
        ("Test type", _e(suite.test_type)),
        ("Environment", _e(environment or "—")),
        ("Branch", _e(run.branch or "—")),
        ("Finished", _e(run.finished_at.strftime("%Y-%m-%d %H:%M UTC") if run.finished_at else "—")),
        ("Published by", _e(publisher)),
    ]
    parts = [
        f"<p>Test report of <strong>{_e(suite.name)}</strong> in <strong>{_e(project.name)}</strong>, "
        f"published from ATM. The latest run is shown first; the Allure report is attached as "
        f"<code>{_e(attachment)}</code>.</p>",
        "<h2>Latest run</h2>",
        "<table><tbody>" + "".join(f"<tr><th>{label}</th><td>{value}</td></tr>" for label, value in rows)
        + "</tbody></table>",
        f'<p><a href="{_e(report_link)}">Open the Allure report in ATM</a></p>',
    ]
    if failed:
        parts.append(f"<h2>Failed tests ({len(failed)})</h2><ul>" + "".join(
            f"<li><strong>{_e(r.get('class_name') or '')} {_e(r.get('test_name'))}</strong>"
            + (f": {_e(str(r.get('error_message'))[:300])}" if r.get("error_message") else "") + "</li>"
            for r in failed[:FAILED_TESTS_SHOWN]) + "</ul>")
    parts.append("<h2>Recent runs</h2><table><tbody><tr><th>Finished</th><th>Result</th><th>Pass rate</th>"
                 "<th>Duration</th><th>Branch</th></tr>" + "".join(
                     f"<tr><td>{_e(r.finished_at.strftime('%Y-%m-%d %H:%M') if r.finished_at else '—')}</td>"
                     f"<td>{_status_macro(r.status)}</td><td>{_e(_pass_rate(r))}</td><td>{_e(_duration(r))}</td>"
                     f"<td>{_e(r.branch or '—')}</td></tr>" for r in recent) + "</tbody></table>")
    return "".join(parts)


def zip_report(report_dir: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(report_dir.rglob("*")):
            if path.is_file():
                archive.write(path, Path("allure-report") / path.relative_to(report_dir))
    return buffer.getvalue()


def _page_url(connection: Connection, page: dict) -> str:
    webui = (page.get("_links") or {}).get("webui") or ""
    base = connection.base_url
    if webui and not base.endswith("/wiki") and "atlassian.net" in base:
        base = f"{base}/wiki"
    return f"{base}{webui}" if webui else base


async def _upsert_page(client: ConfluenceClient, space: str, parent_id: str, title: str, body: str) -> dict:
    found = await client.request("GET", "/content", params={"spaceKey": space, "title": title, "type": "page",
                                                             "expand": "version"})
    existing = ((found or {}).get("results") or [None])[0]
    storage = {"storage": {"value": body, "representation": "storage"}}
    if existing:
        version = int(((existing.get("version") or {}).get("number")) or 1) + 1
        return await client.request("PUT", f"/content/{existing['id']}", json={
            "id": existing["id"], "type": "page", "title": title, "space": {"key": space},
            "version": {"number": version, "message": "Published from ATM"}, "body": storage})
    return await client.request("POST", "/content", json={
        "type": "page", "title": title, "space": {"key": space}, "ancestors": [{"id": parent_id}], "body": storage})


async def publish_run(db: Session, user: User, run: AnalyticsRun, atm_base_url: str) -> ReportPublication:
    """Publish (create or update the suite's page, attach the report). Failures are recorded and re-raised."""
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).one()
    project = db.query(Project).filter(Project.id == suite.project_id).one()
    publication = ReportPublication(run_id=run.id, project_id=suite.project_id, status="failed",
                                    published_by_id=user.id, published_at=datetime.utcnow())
    try:
        report_dir = allure.run_report_dir(suite.project_id, suite.id, run.id) / "allure-report"
        if not (report_dir / "index.html").is_file():
            raise IntegrationError(409, "This run has no Allure report to publish yet.")
        parent_id = (project.confluence_parent_page_id or "").strip()
        if not parent_id:
            raise IntegrationError(400, "Choose the project's Confluence parent page in Admin › Projects first.")
        connection = confluence_connection(db, user)
        space = confluence_space_key(project, connection)
        environment = db.query(TestEnvironment).filter(TestEnvironment.id == run.environment_id).first() \
            if run.environment_id else None
        recent = (db.query(AnalyticsRun).filter(AnalyticsRun.suite_id == suite.id,
                                                AnalyticsRun.status.notin_(("pending", "running")))
                  .order_by(AnalyticsRun.created_at.desc(), AnalyticsRun.id.desc()).limit(RECENT_RUNS).all())
        attachment = f"allure-report-run-{run.id}.zip"
        body = page_body(project, suite, run, recent, environment.name if environment else None,
                         f"{atm_base_url.rstrip('/')}/reports/runs/manual-{run.id}", attachment,
                         user.full_name or user.username)
        client = ConfluenceClient(connection)
        page = await _upsert_page(client, space, parent_id, page_title(project, suite), body)
        archive = await asyncio.to_thread(zip_report, report_dir)
        await client.request("POST", f"/content/{page['id']}/child/attachment",
                             files={"file": (attachment, archive, "application/zip")},
                             headers={"X-Atlassian-Token": "no-check"})
        publication.status = "published"
        publication.page_id = str(page["id"])
        publication.page_url = _page_url(connection, page)
        publication.page_version = int(((page.get("version") or {}).get("number")) or 1)
        publication.attachment = attachment
    except IntegrationError as exc:
        publication.error = exc.detail[:1000]
        db.add(publication)
        db.commit()
        raise
    db.add(publication)
    db.commit()
    db.refresh(publication)
    record(db, "report.publish", f"{user.full_name or user.username} published {page_title(project, suite)} "
                                 f"(version {publication.page_version})", actor_id=user.id, project_id=project.id,
           details={"run_id": run.id, "page_url": publication.page_url, "version": publication.page_version})
    return publication


def publication_response(publication: ReportPublication, publisher: Optional[str] = None) -> dict:
    return {
        "id": publication.id,
        "run_id": f"manual-{publication.run_id}",
        "status": publication.status,
        "page_url": publication.page_url,
        "page_version": publication.page_version,
        "attachment": publication.attachment,
        "error": publication.error,
        "published_by": publisher,
        "published_at": publication.published_at.isoformat() if publication.published_at else None,
    }

