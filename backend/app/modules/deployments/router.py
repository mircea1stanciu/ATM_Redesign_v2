"""Deployments area: the signed CI/CD webhook, the timeline, one deployment, and the service map (phase 11)."""
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.crypto import encrypt
from app.core.db import get_db
from app.core.permissions import has_permission, permission_denied, require, visible_project_ids
from app.modules.audit.service import record
from app.modules.deployments import service as deployments
from app.modules.deployments.models import Deployment, DeploymentCheck, Service, ServiceProject
from app.modules.identity.models import User
from app.modules.notifications.models import Notification
from app.modules.notifications.service import project_testers
from app.modules.projects.models import AnalyticsSuite, Project

router = APIRouter(prefix="/api/deployments", tags=["Deployments"])

SERVICE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


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


class ServiceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    kind: Optional[Literal["backend", "frontend"]] = None
    description: Optional[str] = Field(default=None, max_length=500)


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
        raise HTTPException(status_code=400, detail="A service name uses letters, digits, '.', '_' and '-', as the "
                                                    "pipeline sends it (for example payment-service).")
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
                      description=(payload.description or "").strip() or None, webhook_secret=encrypt(secret),
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
    db.commit()
    return _service_response(db, service, current_user)


@router.delete("/services/{service_id}")
async def delete_service(service_id: int, current_user: User = Depends(require("deployment.configure")),
                         db: Session = Depends(get_db)):
    """Delete a service with its deployments and their checks."""
    service = _service_or_404(db, service_id)
    _ensure_controls(db, current_user, service)
    db.delete(service)
    db.commit()
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
