"""One in-process scheduler for the station: starts suites whose schedule (cron) is due.

Every ATM_SCHEDULER_INTERVAL_SECONDS it looks at the active suites with a schedule. A suite is due when its cron
expression matches the current minute and it has not started in that minute yet. It runs as the person who set the
schedule, in their checkout, if they may still run tests in the project. It can move to a separate worker later.
"""
import asyncio
import logging
from datetime import datetime

from fastapi import HTTPException

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.permissions import can_see_project, has_permission
from app.modules.identity.models import User
from app.modules.projects.models import AnalyticsSuite
from app.modules.testing import cron

logger = logging.getLogger("atm.scheduler")


async def run_due_suites(now: datetime | None = None) -> list[int]:
    """Start every suite due at ``now`` (local time); returns the ids of the suites started."""
    now = (now or datetime.now()).replace(second=0, microsecond=0)
    started: list[int] = []
    db = SessionLocal()
    try:
        suites = db.query(AnalyticsSuite).filter(AnalyticsSuite.active.is_(True),
                                                 AnalyticsSuite.cron_expression.isnot(None)).all()
        for suite in suites:
            try:
                if not cron.parse(suite.cron_expression or "").matches(now):
                    continue
            except cron.CronError:
                continue
            if suite.last_scheduled_at and suite.last_scheduled_at >= now:
                continue  # already started in this minute
            suite.last_scheduled_at = now
            db.commit()
            user = db.query(User).filter(User.id == suite.schedule_user_id).first() if suite.schedule_user_id else None
            if not user or not user.is_active or not has_permission(user, "run.execute") \
                    or not can_see_project(db, user, suite.project_id):
                logger.warning("Schedule of suite %s skipped: its owner may no longer run tests there", suite.id)
                continue
            from app.modules.testing.suites_router import start_suite_run

            try:
                await start_suite_run(db, user, suite, suite.environment_id, trigger="schedule")
                started.append(suite.id)
                logger.info("Scheduled run of suite %s started", suite.id)
            except HTTPException as exc:
                logger.warning("Scheduled run of suite %s did not start: %s", suite.id, exc.detail)
    finally:
        db.close()
    return started


async def scheduler_loop() -> None:
    interval = max(1, settings.ATM_SCHEDULER_INTERVAL_SECONDS)
    while True:
        try:
            await run_due_suites()
        except Exception:  # keep scheduling after an unexpected error
            logger.exception("Scheduler tick failed")
        await asyncio.sleep(interval)
