"""Deployments: the signed webhook, telling the testers, and the environment check (open topics T2 and T3, defaults).

A CI/CD pipeline posts ``{"service", "version", "environment", ...}`` signed with the service's secret:
``X-ATM-Timestamp: <unix seconds>`` and ``X-ATM-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">``.
ATM records the deployment, notifies the testers of every project that tests the service (in ATM, and in the
project's Teams channel when one is set), and runs each project's smoke suite on the environment of the same name.
"""
import hashlib
import hmac
import json
import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import SecretUnreadable, decrypt
from app.core.db import SessionLocal
from app.core.permissions import can_see_project, has_permission
from app.modules.deployments.models import Deployment, DeploymentCheck, Service, ServiceProject
from app.modules.identity.models import User
from app.modules.notifications import teams
from app.modules.notifications.service import notify, project_testers
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, TestEnvironment

logger = logging.getLogger("atm.deployments")

MAX_BODY_BYTES = 64 * 1024
MAX_CLOCK_SKEW_SECONDS = 300
FINISHED = ("passed", "failed", "error", "cancelled")


class DeploymentEvent(BaseModel):
    service: str = Field(min_length=1, max_length=100)
    version: str = Field(min_length=1, max_length=100)
    environment: str = Field(min_length=1, max_length=100)
    source: Optional[str] = Field(default=None, max_length=255)
    commit: Optional[str] = Field(default=None, max_length=64)
    url: Optional[str] = Field(default=None, max_length=1024)
    notes: Optional[str] = Field(default=None, max_length=2000)
    deployed_at: Optional[datetime] = None
    delivery_id: Optional[str] = Field(default=None, max_length=100)


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def signature(secret: str, timestamp: str, body: bytes) -> str:
    digest = hmac.new(secret.encode("utf-8"), timestamp.encode("ascii") + b"." + body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify(db: Session, body: bytes, timestamp: Optional[str], signed: Optional[str],
           now: Optional[float] = None) -> tuple[Service, DeploymentEvent]:
    """The service and the event, or 401 (an unknown service answers like a bad signature) / 400 / 413."""
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="The deployment event is too large.")
    rejected = HTTPException(status_code=401, detail="Unknown service or invalid signature.")
    if not timestamp or not signed or not timestamp.isdigit():
        raise HTTPException(status_code=401, detail="Sign the request: X-ATM-Timestamp and X-ATM-Signature.")
    if abs((now or time.time()) - int(timestamp)) > MAX_CLOCK_SKEW_SECONDS:
        raise HTTPException(status_code=401, detail="The signature has expired: X-ATM-Timestamp is too old.")
    try:
        raw: Any = json.loads(body)
        event = DeploymentEvent.model_validate(raw)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail=f"Not a deployment event: {str(exc)[:300]}")
    service = db.query(Service).filter(Service.name == event.service.strip()).first()
    if not service:
        logger.warning("Deployment webhook for unknown service %r", event.service)
        raise rejected
    try:
        secret = decrypt(service.webhook_secret)
    except SecretUnreadable:
        logger.warning("The webhook secret of %s cannot be decrypted; generate a new one", service.name)
        raise rejected
    if not hmac.compare_digest(signature(secret, timestamp, body), signed.strip()):
        logger.warning("Deployment webhook for %s with an invalid signature", service.name)
        raise rejected
    return service, event


def record(db: Session, service: Service, event: DeploymentEvent) -> tuple[Deployment, bool]:
    """Store the deployment; a repeated delivery (same delivery_id) returns the first one and False."""
    delivery_id = (event.delivery_id or "").strip() or None
    if delivery_id:
        existing = db.query(Deployment).filter(Deployment.service_id == service.id,
                                               Deployment.delivery_id == delivery_id).first()
        if existing:
            return existing, False
    deployed_at = event.deployed_at or datetime.utcnow()
    if deployed_at.tzinfo is not None:
        deployed_at = deployed_at.astimezone(timezone.utc).replace(tzinfo=None)
    deployment = Deployment(service_id=service.id, version=event.version.strip(),
                            environment=event.environment.strip(), source=event.source, commit_sha=event.commit,
                            url=event.url, notes=event.notes, delivery_id=delivery_id, deployed_at=deployed_at)
    db.add(deployment)
    db.commit()
    db.refresh(deployment)
    return deployment, True


def deployment_title(service: Service, deployment: Deployment) -> str:
    return f"{service.name} {deployment.version} deployed to {deployment.environment}"


def _absolute(path: str) -> Optional[str]:
    base = settings.ATM_PUBLIC_URL.rstrip("/")
    return f"{base}{path}" if base else None


def mappings(db: Session, service_id: int) -> list[tuple[ServiceProject, Project]]:
    rows = (db.query(ServiceProject, Project).join(Project, Project.id == ServiceProject.project_id)
            .filter(ServiceProject.service_id == service_id).order_by(Project.name))
    return [(mapping, project) for mapping, project in rows]


async def announce(db: Session, service: Service, deployment: Deployment) -> None:
    """Notify the testers of every project that tests the service, once each, and post to the projects' Teams."""
    title = deployment_title(service, deployment)
    link = f"/deployments/{deployment.id}"
    notified: set[int] = set()
    posts: list[tuple[Optional[str], str]] = []
    for _, project in mappings(db, service.id):
        body = f"{project.name} tests this {service.kind}."
        if deployment.source:
            body += f" From {deployment.source}."
        recipients = [uid for uid in project_testers(db, project.id) if uid not in notified]
        notify(db, recipients, "deployment", title, body, link, project_id=project.id, deployment_id=deployment.id)
        notified.update(recipients)
        posts.append((project.teams_webhook, body))
    for webhook, body in posts:
        await teams.post(webhook, title, body, _absolute(link))


def _check_user(db: Session, mapping: ServiceProject) -> Optional[User]:
    user = db.query(User).filter(User.id == mapping.check_user_id).first() if mapping.check_user_id else None
    if not user or not user.is_active or not has_permission(user, "run.execute") \
            or not can_see_project(db, user, mapping.project_id):
        return None
    return user


async def start_checks(db: Session, service: Service, deployment: Deployment) -> list[DeploymentCheck]:
    """Run the smoke suite of each project that has one, on the project's environment named like the deployment's."""
    from app.modules.testing.suites_router import start_suite_run

    checks = []
    for mapping, project in mappings(db, service.id):
        if not mapping.smoke_suite_id:
            continue
        check = DeploymentCheck(deployment_id=deployment.id, project_id=project.id, suite_id=mapping.smoke_suite_id,
                                status="skipped")
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == mapping.smoke_suite_id).first()
        environments = db.query(TestEnvironment).filter(TestEnvironment.project_id == project.id).all()
        match = next((e for e in environments if e.name.lower() == deployment.environment.lower()), None)
        user = _check_user(db, mapping)
        if not suite:
            check.detail = "The smoke suite no longer exists."
        elif not match:
            check.detail = (f"{project.name} has no environment named {deployment.environment}. "
                            "Add it in Tests › Environments.")
        elif not user:
            check.detail = "The person the check runs as may no longer run tests in this project."
        else:
            try:
                run = await start_suite_run(db, user, suite, match.id, trigger="deployment")
                check.run_id = run.id
                check.status = "running"
            except HTTPException as exc:
                check.status = "error"
                check.detail = str(exc.detail)[:500]
        db.add(check)
        db.commit()
        checks.append(check)
        if check.status != "running":
            logger.info("Check of %s for %s: %s (%s)", deployment.id, project.name, check.status, check.detail)
    return checks


def _finish_check(run_id: int, status: str) -> list[tuple[Optional[str], str, str, str]]:
    """Record a check's result and notify the project's testers; returns the Teams posts to make."""
    posts = []
    db = SessionLocal()
    try:
        for check in db.query(DeploymentCheck).filter(DeploymentCheck.run_id == run_id,
                                                      DeploymentCheck.status == "running").all():
            check.status = status if status in ("passed", "failed") else "error"
            db.commit()
            deployment = db.query(Deployment).filter(Deployment.id == check.deployment_id).one()
            service = db.query(Service).filter(Service.id == deployment.service_id).one()
            project = db.query(Project).filter(Project.id == check.project_id).one()
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == run_id).first()
            result = {"passed": "passed", "failed": "failed"}.get(check.status, "could not run")
            title = f"Smoke check {result}: {service.name} {deployment.version} on {deployment.environment}"
            body = f"{project.name}" + (f": {run.passed_tests} passed, {run.failed_tests} failed." if run else ".")
            link = f"/deployments/{deployment.id}"
            notify(db, project_testers(db, project.id), "deployment_check", title, body, link,
                   project_id=project.id, deployment_id=deployment.id)
            posts.append((project.teams_webhook, title, body, link))
    finally:
        db.close()
    return posts


def _notify_starter(run_id: int, status: str) -> None:
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == run_id).first()
        if not run or not run.started_by_id or run.trigger == "deployment":  # a check is announced as a check
            return
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first()
        project = db.query(Project).filter(Project.id == suite.project_id).first() if suite else None
        name = run.name or (suite.name if suite else f"Run #{run.id}")
        title = f"Run {status}: {name}"
        body = f"{run.passed_tests} passed, {run.failed_tests} failed" + (f" · {project.name}" if project else "")
        if run.trigger == "schedule":
            body += " · scheduled"
        notify(db, [run.started_by_id], "run_finished", title, body, f"/reports/runs/manual-{run.id}",
               project_id=project.id if project else None)
    finally:
        db.close()


async def on_run_finished(run_id: int, status: str) -> None:
    """Called when a local run ends: tell who started it, and finish a deployment check it belongs to."""
    import asyncio

    if status not in FINISHED:
        return
    try:
        await asyncio.to_thread(_notify_starter, run_id, status)
        posts = await asyncio.to_thread(_finish_check, run_id, status)
        for webhook, title, body, link in posts:
            await teams.post(webhook, title, body, _absolute(link))
    except Exception:  # notifications must never break a run
        logger.exception("Notifications for run %s failed", run_id)
