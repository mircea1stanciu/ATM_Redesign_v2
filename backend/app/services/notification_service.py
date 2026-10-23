import asyncio
import logging
import smtplib
from email.message import EmailMessage
from typing import Any

import httpx

from app.core.config import settings
from app.models.models import Project, RunStatus, TestRun, TestSuite

logger = logging.getLogger(__name__)


class NotificationService:
    """Send failure notifications through email and Slack webhook."""

    @staticmethod
    def _notifications_config(project: Project) -> dict[str, Any]:
        config = project.config_json if isinstance(project.config_json, dict) else {}
        notifications = config.get("notifications", {})
        if not isinstance(notifications, dict):
            return {}
        return notifications

    @staticmethod
    def _parse_email_recipients(raw_value: Any) -> list[str]:
        if isinstance(raw_value, list):
            return [str(item).strip() for item in raw_value if str(item).strip()]
        if isinstance(raw_value, str):
            return [value.strip() for value in raw_value.split(",") if value.strip()]
        return []

    @staticmethod
    def _supports_status(notifications: dict[str, Any], run_status: RunStatus) -> bool:
        if run_status == RunStatus.failed:
            return bool(notifications.get("notify_on_failed", True))
        if run_status == RunStatus.error:
            return bool(notifications.get("notify_on_error", True))
        return False

    @staticmethod
    async def send_failure_notifications(run: TestRun, suite: TestSuite, project: Project) -> None:
        notifications = NotificationService._notifications_config(project)
        if not notifications:
            return
        if not NotificationService._supports_status(notifications, run.status):
            return

        if bool(notifications.get("email_enabled", False)):
            recipients = NotificationService._parse_email_recipients(notifications.get("email_recipients", []))
            if recipients:
                try:
                    await NotificationService._send_email(run, suite, project, recipients)
                except Exception as exc:
                    logger.warning("Email notification failed for run %s: %s", run.id, exc)

        if bool(notifications.get("slack_enabled", False)):
            webhook_url = str(notifications.get("slack_webhook_url", "")).strip()
            if webhook_url:
                try:
                    await NotificationService._send_slack(run, suite, project, webhook_url)
                except Exception as exc:
                    logger.warning("Slack notification failed for run %s: %s", run.id, exc)

    @staticmethod
    async def _send_email(
        run: TestRun,
        suite: TestSuite,
        project: Project,
        recipients: list[str],
    ) -> None:
        if not settings.SMTP_HOST:
            logger.info("SMTP_HOST not configured; skipping email notification")
            return

        status_text = str(run.status.value).upper()
        subject = f"[TestManager] Run {status_text} - {project.name}/{suite.name}"
        body = (
            "Run execution finished with failure status.\n\n"
            f"Project: {project.name}\n"
            f"Suite: {suite.name}\n"
            f"Run ID: {run.id}\n"
            f"Status: {run.status.value}\n"
            f"Branch: {run.branch or 'main'}\n"
            f"Total: {run.total_tests}\n"
            f"Passed: {run.passed_tests}\n"
            f"Failed: {run.failed_tests}\n"
            f"Skipped: {run.skipped_tests}\n"
        )

        sender = settings.NOTIFICATION_EMAIL_SENDER or settings.SMTP_USERNAME or "noreply@testmanager.local"

        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = sender
        message["To"] = ", ".join(recipients)
        message.set_content(body)

        def _send_sync() -> None:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                if settings.SMTP_USE_STARTTLS:
                    smtp.starttls()
                if settings.SMTP_USERNAME:
                    smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                smtp.send_message(message)

        await asyncio.to_thread(_send_sync)

    @staticmethod
    async def _send_slack(
        run: TestRun,
        suite: TestSuite,
        project: Project,
        webhook_url: str,
    ) -> None:
        payload = {
            "text": (
                f"TestManager alert: run failed\n"
                f"Project: {project.name}\n"
                f"Suite: {suite.name}\n"
                f"Run ID: {run.id}\n"
                f"Status: {run.status.value}\n"
                f"Branch: {run.branch or 'main'}\n"
                f"Passed/Failed/Skipped: {run.passed_tests}/{run.failed_tests}/{run.skipped_tests}"
            )
        }

        async with httpx.AsyncClient(timeout=settings.SLACK_WEBHOOK_TIMEOUT_SECONDS) as client:
            response = await client.post(webhook_url, json=payload)
            response.raise_for_status()
