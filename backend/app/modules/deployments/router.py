"""Deployments area: the signed CI/CD webhook, the timeline, one deployment, and the service map (phase 11)."""
import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from typing import Literal, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.crypto import SecretUnreadable, decrypt, encrypt
from app.core.db import get_db
from app.core.permissions import has_permission, permission_denied, require, visible_project_ids
from app.modules.audit.service import name_of, record
from app.modules.deployments import service as deployments
from app.modules.deployments.models import Deployment, DeploymentCheck, Service, ServiceMerge, ServiceProject
from app.modules.identity.models import User
from app.modules.notifications.models import Notification
from app.modules.notifications.service import notify, project_testers
from app.modules.projects.models import AnalyticsSuite, Project

router = APIRouter(prefix="/api/deployments", tags=["Deployments"])

SERVICE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$")


# ── Webhook ───────────────────────────────────────────────────────────────────


@router.post("/webhook", status_code=202)
async def deployment_webhook(request: Request, x_atm_timestamp: Optional[str] = Header(default=None),
                             x_atm_signature: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    """A deployment reported by CI/CD, signed with the service's secret (see deployments/service.py)."""
    body = await request.body()
    service, event = deployments.verify(db, body, x_atm_timestamp, x_atm_signature)
    deployment, created = deployments.record(db, service, event)
    record(db, "deployment.webhook", f"{service.name} {deployment.version} deployed to {deployment.environment}"
                                     + (" (repeated delivery)" if not created else ""),
           details={"service": service.name, "deployment_id": deployment.id, "source": event.source,
                    "duplicate": not created})
    if created:
        await deployments.announce(db, service, deployment)
        await deployments.start_checks(db, service, deployment)
    return {"id": deployment.id, "duplicate": not created}


def _https_url(value: Optional[str], label: str) -> Optional[str]:
    value = (value or "").strip()
    if not value:
        return None
    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{label} must be a valid HTTPS URL.") from exc
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise HTTPException(status_code=400, detail=f"{label} must be a valid HTTPS URL.")
    return value


def _repository_identity(value: Optional[str]) -> str:
    if not value:
        return ""
    parsed = urlsplit(value.strip())
    path = parsed.path.rstrip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return f"{(parsed.hostname or '').lower()}{path.lower()}"


def _clean_branch(value: str) -> str:
    branch = value.strip()
    if not branch or len(branch) > 255 or not re.fullmatch(r"[A-Za-z0-9._/-]+", branch) \
            or branch.startswith("/") or branch.endswith("/") or ".." in branch.split("/"):
        raise HTTPException(status_code=400, detail="Enter a valid monitored branch name.")
    return branch


@router.post("/services/{service_id}/github-webhook", status_code=202)
async def github_merge_webhook(service_id: int, request: Request,
                               x_github_event: Optional[str] = Header(default=None),
                               x_github_delivery: Optional[str] = Header(default=None),
                               x_hub_signature_256: Optional[str] = Header(default=None),
                               db: Session = Depends(get_db)):
    """Accept signed GitHub pull-request webhooks and notify project testers of merges to the monitored branch."""
    body = await request.body()
    if len(body) > 1_000_000:
        raise HTTPException(status_code=413, detail="The GitHub event is too large.")
    if x_github_event != "pull_request":
        return {"ignored": True}
    if not x_github_delivery or len(x_github_delivery) > 100:
        raise HTTPException(status_code=400, detail="A valid X-GitHub-Delivery header is required.")

    service = _service_or_404(db, service_id)
    rejected = HTTPException(status_code=401, detail="Unknown service or invalid GitHub signature.")
    if not service.repository_url or not x_hub_signature_256:
        raise rejected
    try:
        secret = decrypt(service.webhook_secret)
    except SecretUnreadable:
        raise rejected
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, x_hub_signature_256.strip()):
        raise rejected

    try:
        payload = json.loads(body)
        pull_request = payload["pull_request"]
        repository_url = payload["repository"]["html_url"]
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=400, detail="Not a GitHub pull request event.")
    if _repository_identity(repository_url) != _repository_identity(service.repository_url):
        raise rejected
    if payload.get("action") != "closed" or not pull_request.get("merged") \
            or pull_request.get("base", {}).get("ref") != service.main_branch:
        return {"ignored": True}

    existing = db.query(ServiceMerge).filter(ServiceMerge.service_id == service.id,
                                              ServiceMerge.delivery_id == x_github_delivery).first()
    if existing:
        return {"ignored": False, "duplicate": True}

    try:
        merged_at = datetime.fromisoformat(str(pull_request["merged_at"]).replace("Z", "+00:00"))
        if merged_at.tzinfo is not None:
            merged_at = merged_at.astimezone(timezone.utc).replace(tzinfo=None)
        pull_url = _https_url(pull_request.get("html_url"), "Pull request URL")
        if not pull_url:
            raise ValueError("missing pull request URL")
        merge = ServiceMerge(
            service_id=service.id,
            delivery_id=x_github_delivery,
            pull_request_number=int(pull_request["number"]),
            title=str(pull_request.get("title") or "Merged pull request")[:255],
            url=pull_url,
            commit_sha=pull_request.get("merge_commit_sha"),
            merged_at=merged_at,
        )
        db.add(merge)
        db.flush()
    except (KeyError, TypeError, ValueError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="The merged pull request is missing required details.") from exc
    except IntegrityError:
        db.rollback()
        return {"ignored": False, "duplicate": True}

    branch = service.main_branch
    title = f"{service.name} merged into {branch}: #{merge.pull_request_number} {merge.title}"
    author = (pull_request.get("user") or {}).get("login")
    body_text = f"Merged by {author}." if author else f"Merged into {branch}."
    for _, project in deployments.mappings(db, service.id):
        notify(db, project_testers(db, project.id), "repository_merge", title, body_text,
               merge.url, project_id=project.id)
    db.commit()
    return {"ignored": False, "duplicate": False}


# ── Timeline and one deployment ───────────────────────────────────────────────


def _visible_service_ids(db: Session, user: User) -> Optional[set[int]]:
    """Services mapped to a project the user sees, or None for every service (users who see every project)."""
    visible = visible_project_ids(db, user)
    if visible is None:
        return None
    return {sid for (sid,) in db.query(ServiceProject.service_id).filter(ServiceProject.project_id.in_(visible))}


def _checks(db: Session, deployment_id: int, visible: Optional[set[int]]) -> list[dict]:
    rows = (db.query(DeploymentCheck, Project, AnalyticsSuite)
            .join(Project, Project.id == DeploymentCheck.project_id)
            .outerjoin(AnalyticsSuite, AnalyticsSuite.id == DeploymentCheck.suite_id)
            .filter(DeploymentCheck.deployment_id == deployment_id).order_by(Project.name).all())
    return [{"id": check.id, "project_id": project.id, "project": project.name,
             "suite": suite.name if suite else None, "status": check.status, "detail": check.detail,
             "run_id": f"manual-{check.run_id}" if check.run_id else None}
            for check, project, suite in rows if visible is None or project.id in visible]


def _deployment_response(db: Session, deployment: Deployment, service: Service,
                         visible: Optional[set[int]]) -> dict:
    checks = _checks(db, deployment.id, visible)
    statuses = {c["status"] for c in checks}
    check_status = next((s for s in ("running", "failed", "error", "passed", "skipped") if s in statuses), None)
    return {
        "id": deployment.id,
        "service": {"id": service.id, "name": service.name, "kind": service.kind},
        "version": deployment.version,
        "environment": deployment.environment,
        "source": deployment.source,
        "commit": deployment.commit_sha,
        "url": deployment.url,
        "notes": deployment.notes,
        "deployed_at": deployment.deployed_at.isoformat(),
        "checks": checks,
        "check_status": check_status,
    }


@router.get("")
async def list_deployments(environment: Optional[str] = None, service_id: Optional[int] = None,
                           limit: int = Query(100, ge=1, le=500),
                           current_user: User = Depends(require("deployment.view")), db: Session = Depends(get_db)):
    """The timeline, newest first: deployments of the services the user's projects test."""
    services = _visible_service_ids(db, current_user)
    query = db.query(Deployment, Service).join(Service, Service.id == Deployment.service_id)
    if services is not None:
        query = query.filter(Deployment.service_id.in_(services))
    environments = sorted({env for (env,) in query.with_entities(Deployment.environment).distinct()})
    if environment:
        query = query.filter(Deployment.environment == environment)
    if service_id is not None:
        query = query.filter(Deployment.service_id == service_id)
    rows = query.order_by(Deployment.deployed_at.desc(), Deployment.id.desc()).limit(limit).all()
    visible = visible_project_ids(db, current_user)
    return {"items": [_deployment_response(db, d, s, visible) for d, s in rows], "environments": environments}


# ── Service map ───────────────────────────────────────────────────────────────


class ServicePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["backend", "frontend"] = "backend"
    description: Optional[str] = Field(default=None, max_length=500)
    repository_url: Optional[str] = Field(default=None, max_length=1024)
    main_branch: str = Field(default="main", min_length=1, max_length=255)
    check_portal_url: Optional[str] = Field(default=None, max_length=1024)


class ServiceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    kind: Optional[Literal["backend", "frontend"]] = None
    description: Optional[str] = Field(default=None, max_length=500)
    repository_url: Optional[str] = Field(default=None, max_length=1024)
    main_branch: Optional[str] = Field(default=None, min_length=1, max_length=255)
    check_portal_url: Optional[str] = Field(default=None, max_length=1024)


class MappingPayload(BaseModel):
    smoke_suite_id: Optional[int] = None
    check_user_id: Optional[int] = None


def _service_or_404(db: Session, service_id: int) -> Service:
    service = db.query(Service).filter(Service.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found.")
    return service


def _ensure_controls(db: Session, user: User, service: Service) -> None:
    """A lead changes a service only when every project testing it is theirs (or nobody's yet and they made it)."""
    visible = visible_project_ids(db, user)
    if visible is None:
        return
    mapped = {pid for (pid,) in db.query(ServiceProject.project_id).filter(ServiceProject.service_id == service.id)}
    if (mapped and not mapped <= visible) or (not mapped and service.created_by_id != user.id):
        raise permission_denied("Another lead's project tests this service.")


def _clean_name(db: Session, name: str, service_id: Optional[int] = None) -> str:
    name = name.strip()
    if not SERVICE_NAME.match(name):
        raise HTTPException(status_code=400, detail="A service name uses letters, digits, spaces, '.', '_' and '-'.")
    clash = db.query(Service).filter(Service.name == name, Service.id != (service_id or 0)).first()
    if clash:
        raise HTTPException(status_code=400, detail=f"A service named {name} already exists.")
    return name


def _service_response(db: Session, service: Service, user: User) -> dict:
    visible = visible_project_ids(db, user)
    projects = []
    for mapping, project in deployments.mappings(db, service.id):
        if visible is not None and project.id not in visible:
            continue
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == mapping.smoke_suite_id).first() \
            if mapping.smoke_suite_id else None
        runner = db.query(User).filter(User.id == mapping.check_user_id).first() if mapping.check_user_id else None
        projects.append({"project_id": project.id, "project": project.name,
                         "smoke_suite": {"id": suite.id, "name": suite.name} if suite else None,
                         "check_user": {"id": runner.id, "name": runner.full_name or runner.username}
                         if runner else None})
    last = (db.query(Deployment).filter(Deployment.service_id == service.id)
            .order_by(Deployment.deployed_at.desc(), Deployment.id.desc()).first())
    return {"id": service.id, "name": service.name, "kind": service.kind, "description": service.description,
            "repository_url": service.repository_url, "main_branch": service.main_branch,
            "check_portal_url": service.check_portal_url,
            "projects": projects,
            "last_deployment": {"id": last.id, "version": last.version, "environment": last.environment,
                                "deployed_at": last.deployed_at.isoformat()} if last else None}


@router.get("/services")
async def list_services(current_user: User = Depends(require("deployment.view")), db: Session = Depends(get_db)):
    """Every service for those who configure deployments; for everyone else the services their projects test."""
    services = None if has_permission(current_user, "deployment.configure") else _visible_service_ids(db, current_user)
    query = db.query(Service)
    if services is not None:
        query = query.filter(Service.id.in_(services))
    return [_service_response(db, s, current_user) for s in query.order_by(Service.name).all()]


@router.post("/services", status_code=201)
async def create_service(payload: ServicePayload, current_user: User = Depends(require("deployment.configure")),
                         db: Session = Depends(get_db)):
    """A new service. Its webhook secret is shown once, in this answer."""
    secret = deployments.new_secret()
    service = Service(name=_clean_name(db, payload.name), kind=payload.kind,
                      description=(payload.description or "").strip() or None,
                      repository_url=_https_url(payload.repository_url, "Repository URL"),
                      main_branch=_clean_branch(payload.main_branch),
                      check_portal_url=_https_url(payload.check_portal_url, "Check portal URL"),
                      webhook_secret=encrypt(secret),
                      created_by_id=current_user.id)
    db.add(service)
    db.commit()
    db.refresh(service)
    return {**_service_response(db, service, current_user), "secret": secret}


@router.patch("/services/{service_id}")
async def update_service(service_id: int, payload: ServiceUpdate,
                         current_user: User = Depends(require("deployment.configure")), db: Session = Depends(get_db)):
    service = _service_or_404(db, service_id)
    _ensure_controls(db, current_user, service)
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        service.name = _clean_name(db, payload.name, service.id)
    if "kind" in fields and payload.kind is not None:
        service.kind = payload.kind
    if "description" in fields:
        service.description = (payload.description or "").strip() or None
    if "repository_url" in fields:
        service.repository_url = _https_url(payload.repository_url, "Repository URL")
    if "main_branch" in fields and payload.main_branch is not None:
        service.main_branch = _clean_branch(payload.main_branch)
    if "check_portal_url" in fields:
        service.check_portal_url = _https_url(payload.check_portal_url, "Check portal URL")
    db.commit()
    return _service_response(db, service, current_user)


@router.delete("/services/{service_id}")
async def delete_service(service_id: int, current_user: User = Depends(require("deployment.configure")),
                         db: Session = Depends(get_db)):
    """Delete a service with its deployments and their checks."""
    service = _service_or_404(db, service_id)
    _ensure_controls(db, current_user, service)
    name = service.name
    db.delete(service)
    db.commit()
    record(db, "service.delete", f"{name_of(current_user)} deleted the service {name}", actor_id=current_user.id,
           details={"service": name, "service_id": service_id})
    return {"deleted": service_id}


@router.post("/services/{service_id}/secret")
async def regenerate_secret(service_id: int, current_user: User = Depends(require("deployment.configure")),
                            db: Session = Depends(get_db)):
    """A new webhook secret (shown once); the old one stops working at once."""
    service = _service_or_404(db, service_id)
    _ensure_controls(db, current_user, service)
    secret = deployments.new_secret()
    service.webhook_secret = encrypt(secret)
    db.commit()
    return {"secret": secret}


@router.get("/projects/{project_id}/check-options")
async def check_options(project_id: int, current_user: User = Depends(require("deployment.configure",
                                                                              project_from="project_id")),
                        db: Session = Depends(get_db)):
    """What a check can run (the project's suites) and as whom (the project's testers who may run tests)."""
    suites = (db.query(AnalyticsSuite).filter(AnalyticsSuite.project_id == project_id,
                                              AnalyticsSuite.active.is_(True)).order_by(AnalyticsSuite.name).all())
    testers = db.query(User).filter(User.id.in_(project_testers(db, project_id))).all()
    return {
        "suites": [{"id": s.id, "name": s.name, "test_type": s.test_type} for s in suites],
        "users": sorted(({"id": u.id, "name": u.full_name or u.username} for u in testers
                         if has_permission(u, "run.execute")), key=lambda u: u["name"]),
    }


@router.put("/services/{service_id}/projects/{project_id}")
async def map_project(service_id: int, project_id: int, payload: MappingPayload,
                      current_user: User = Depends(require("deployment.configure", project_from="project_id")),
                      db: Session = Depends(get_db)):
    """The project tests the service; optionally its smoke suite runs after each deployment, as the chosen tester."""
    service = _service_or_404(db, service_id)
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="Project not found.")
    if payload.smoke_suite_id is not None:
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == payload.smoke_suite_id).first()
        if not suite or suite.project_id != project_id:
            raise HTTPException(status_code=400, detail="That suite is not one of this project's.")
        if payload.check_user_id is None:
            raise HTTPException(status_code=400, detail="Choose who the check runs as (it uses their checkout).")
        runner = db.query(User).filter(User.id == payload.check_user_id).first()
        if not runner or runner.id not in project_testers(db, project_id) or not has_permission(runner, "run.execute"):
            raise HTTPException(status_code=400, detail="The check runs as a tester of this project who may run tests.")
    mapping = db.query(ServiceProject).filter(ServiceProject.service_id == service.id,
                                              ServiceProject.project_id == project_id).first()
    if not mapping:
        mapping = ServiceProject(service_id=service.id, project_id=project_id)
        db.add(mapping)
    mapping.smoke_suite_id = payload.smoke_suite_id
    mapping.check_user_id = payload.check_user_id if payload.smoke_suite_id is not None else None
    db.commit()
    return _service_response(db, service, current_user)


@router.delete("/services/{service_id}/projects/{project_id}")
async def unmap_project(service_id: int, project_id: int,
                        current_user: User = Depends(require("deployment.configure", project_from="project_id")),
                        db: Session = Depends(get_db)):
    service = _service_or_404(db, service_id)
    db.query(ServiceProject).filter(ServiceProject.service_id == service.id,
                                    ServiceProject.project_id == project_id).delete()
    db.commit()
    return _service_response(db, service, current_user)


# Registered last: /{deployment_id} would otherwise catch /services.
@router.get("/{deployment_id}")
async def get_deployment(deployment_id: int, current_user: User = Depends(require("deployment.view")),
                         db: Session = Depends(get_db)):
    """One deployment: its details, the checks, and who was notified (in the projects the user sees)."""
    row = (db.query(Deployment, Service).join(Service, Service.id == Deployment.service_id)
           .filter(Deployment.id == deployment_id).first())
    services = _visible_service_ids(db, current_user)
    if not row or (services is not None and row[1].id not in services):
        raise HTTPException(status_code=404, detail="Deployment not found.")
    deployment, service = row
    visible = visible_project_ids(db, current_user)
    notified = (db.query(Notification, User).join(User, User.id == Notification.user_id)
                .filter(Notification.deployment_id == deployment.id, Notification.kind == "deployment")
                .order_by(User.full_name, User.username).all())
    projects = {p.id: p.name for p in db.query(Project).filter(
        Project.id.in_({n.project_id for n, _ in notified if n.project_id}))}
    return {
        **_deployment_response(db, deployment, service, visible),
        "received_at": deployment.received_at.isoformat(),
        "delivery_id": deployment.delivery_id,
        "service_description": service.description,
        "notified": [{"name": user.full_name or user.username, "project": projects.get(n.project_id or 0),
                      "read": n.read_at is not None}
                     for n, user in notified if visible is None or n.project_id in visible],
    }
