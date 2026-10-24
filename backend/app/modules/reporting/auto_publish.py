"""Automatic Confluence publishing (phase 19): when a run of a suite with "Publish automatically" finishes with a
report, it is published with the Confluence token of the person who switched it on."""
import logging

from app.core.db import SessionLocal
from app.core.permissions import can_see_project, has_permission
from app.modules.identity.models import User
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite
from app.modules.reporting import allure
from app.modules.reporting.confluence_publisher import publish_run
from app.modules.work.integrations import IntegrationError

logger = logging.getLogger("atm.reports")


async def after_run(run_id: int, status: str) -> None:
    """Publish the finished run if its suite asks for it; a failure is recorded as a failed publication."""
    if status not in ("passed", "failed"):
        return
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == run_id).first()
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first() if run else None
        if not run or not suite or not suite.auto_publish_by_id:
            return
        user = db.query(User).filter(User.id == suite.auto_publish_by_id).first()
        if not user or not user.is_active or not has_permission(user, "report.publish") \
                or not can_see_project(db, user, suite.project_id):
            logger.warning("Automatic publishing of suite %s skipped: who switched it on may no longer publish",
                           suite.id)
            return
        if not (allure.run_report_dir(suite.project_id, suite.id, run.id) / "allure-report" / "index.html").is_file():
            return
        try:
            await publish_run(db, user, run, suite.auto_publish_origin or "")
        except IntegrationError as exc:
            logger.warning("Automatic publishing of run %s failed: %s", run.id, exc.detail)
    except Exception:  # publishing must never break a run
        logger.exception("Automatic publishing of run %s failed", run_id)
    finally:
        db.close()
