"""The project's ATM service account (phase 18): set it up, sync its checkout, remove it. Leads and super admins."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.crypto import encrypt
from app.core.db import get_db
from app.core.permissions import require
from app.modules.audit.service import record
from app.modules.identity.models import User
from app.modules.projects.models import Project
from app.modules.projects.service import get_project_or_404
from app.modules.testing import service_account

router = APIRouter(prefix="/api/projects/{project_id}/service-account", tags=["Testing"])
MANAGE = require("project.service_account", project_from="project_id")


def _status(db: Session, project: Project) -> dict:
    by = db.query(User).filter(User.id == project.service_configured_by_id).first() \
        if project.service_configured_by_id else None
    return {
        "configured": service_account.configured(project),
        "checkout_ready": (service_account.checkout_dir(project.id) / ".git").exists(),
        "synced_at": project.service_synced_at.isoformat() if project.service_synced_at else None,
        "error": project.service_error,
        "configured_by": (by.full_name or by.username) if by else None,
    }


@router.get("")
async def get_service_account(project_id: int, current_user: User = Depends(MANAGE), db: Session = Depends(get_db)):
    return _status(db, get_project_or_404(db, project_id))


class ServiceAccountPayload(BaseModel):
    github_token: str = Field(min_length=1, max_length=500)


@router.put("")
async def set_service_account(project_id: int, payload: ServiceAccountPayload, current_user: User = Depends(MANAGE),
                              db: Session = Depends(get_db)):
    """Check the token by cloning the repository into the service checkout; only a working token is saved."""
    project = get_project_or_404(db, project_id)
    token = payload.github_token.strip()
    try:
        await service_account.sync(project, token=token)
    except service_account.ServiceAccountError as exc:
        raise HTTPException(status_code=400, detail=f"The token could not clone the repository: {exc}")
    project.service_github_token = encrypt(token)
    project.service_configured_by_id = current_user.id
    service_account.mark(project, None)
    db.commit()
    record(db, "service_account.set", f"{current_user.full_name or current_user.username} set the service account of "
                                      f"{project.name}", actor_id=current_user.id, project_id=project.id)
    return _status(db, project)


@router.post("/sync")
async def sync_service_account(project_id: int, current_user: User = Depends(MANAGE), db: Session = Depends(get_db)):
    project = get_project_or_404(db, project_id)
    if not service_account.configured(project):
        raise HTTPException(status_code=400, detail="Set up the service account first.")
    try:
        await service_account.sync(project)
        service_account.mark(project, None)
    except service_account.ServiceAccountError as exc:
        service_account.mark(project, str(exc))
    db.commit()
    return _status(db, project)


@router.delete("")
async def remove_service_account(project_id: int, current_user: User = Depends(MANAGE),
                                 db: Session = Depends(get_db)):
    """Schedules go back to running as the people who set them; the service checkout is deleted."""
    project = get_project_or_404(db, project_id)
    project.service_github_token = None
    project.service_configured_by_id = None
    project.service_synced_at = None
    project.service_error = None
    db.commit()
    service_account.remove_checkout(project.id)
    record(db, "service_account.remove", f"{current_user.full_name or current_user.username} removed the service "
                                         f"account of {project.name}", actor_id=current_user.id, project_id=project.id)
    return _status(db, project)
