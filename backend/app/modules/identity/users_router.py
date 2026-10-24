"""The signed-in user (/api/me) and user management (/api/users): role, scope tag, lead and projects."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.permissions import (
    LEAD_ASSIGNABLE_ROLES,
    LEAD_ROLES,
    SCOPE_TAGS,
    TAGGED_ROLES,
    can_see_user,
    check_role_change,
    ensure,
    permission_denied,
    permissions_for,
    require,
    visible_project_ids,
)
from app.modules.audit.service import record
from app.modules.identity.models import Organization, User, UserRole
from app.modules.identity.service import get_default_organization
from app.modules.notifications.service import notify
from app.modules.projects.models import Project, ProjectMember

logger = logging.getLogger("atm.users")
router = APIRouter(prefix="/api", tags=["Users"])
# As the frontend names them (ROLE_LABELS in src/types/domain.ts).
ROLE_NAMES = {
    UserRole.SUPER_ADMIN: "Super Admin", UserRole.AUTOMATION_LEAD: "Automation Lead",
    UserRole.AUTOMATION_SENIOR: "Automation Senior", UserRole.AUTOMATION_USER: "Automation User",
    UserRole.AUTOMATION_TRAINEE: "Automation Trainee", UserRole.VIEWER: "Viewer",
}


def me_payload(db: Session, user: User) -> dict:
    """Who the user is and what they may do; the frontend shows or hides actions from this."""
    org = db.query(Organization).filter(Organization.id == user.organization_id).first()
    visible = visible_project_ids(db, user)
    all_ids: list[int] = list(db.scalars(select(Project.id))) if visible is None else []
    project_ids = sorted(all_ids if visible is None else visible)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
        "scope_tag": user.scope_tag,
        "assigned_lead_id": user.assigned_lead_id,
        "two_fa_enabled": user.two_fa_enabled,
        "permissions": permissions_for(user),
        "all_projects": visible is None,
        "project_ids": [str(pid) for pid in project_ids],
        "organization": {"id": org.id, "name": org.name, "slug": org.slug} if org else None,
    }


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return me_payload(db, current_user)


def _user_response(db: Session, user: User) -> dict:
    project_ids = [str(pid) for (pid,) in db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user.id)]
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
        "scope_tag": user.scope_tag,
        "assigned_lead_id": str(user.assigned_lead_id) if user.assigned_lead_id else None,
        "project_ids": project_ids,
        "is_active": user.is_active,
        "two_fa_enabled": user.two_fa_enabled,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login": user.last_login.isoformat() if user.last_login else None,
    }


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    username: Optional[str] = None
    role: str = UserRole.AUTOMATION_TRAINEE.value
    scope_tag: Optional[str] = None
    assigned_lead_id: Optional[int] = None
    project_ids: Optional[list[int]] = None


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    scope_tag: Optional[str] = None
    assigned_lead_id: Optional[int] = None
    project_ids: Optional[list[int]] = None
    is_active: Optional[bool] = None


def _parse_role(value: str) -> UserRole:
    try:
        return UserRole(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown role '{value}'.")


def _resolve_tag(role: UserRole, requested: Optional[str], current: Optional[str]) -> Optional[str]:
    """Seniors, users and trainees have exactly one tag (default project_base); other roles have none."""
    if role not in TAGGED_ROLES:
        if requested:
            raise HTTPException(status_code=400, detail=f"The {role.value} role has no scope tag.")
        return None
    tag = requested or current or "project_base"
    if tag not in SCOPE_TAGS:
        raise HTTPException(status_code=400, detail=f"Scope tag must be one of: {', '.join(SCOPE_TAGS)}.")
    return tag


def _check_password(password: str) -> None:
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password cannot exceed 72 bytes when encoded as UTF-8.")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")


def _set_lead(db: Session, actor: User, user: User, lead_id: Optional[int]) -> None:
    if lead_id is None:
        user.assigned_lead_id = None
        return
    if actor.role != UserRole.SUPER_ADMIN and lead_id != actor.id:
        raise permission_denied("Leads assign people only to themselves.")
    lead = db.query(User).filter(User.id == lead_id).first()
    if not lead or lead.role not in LEAD_ROLES:
        raise HTTPException(status_code=400, detail="The lead must be an Automation Lead or Super Admin.")
    user.assigned_lead_id = lead_id


def _set_projects(db: Session, actor: User, user: User, project_ids: list[int]) -> None:
    ensure(db, actor, "project.members.manage")
    visible = visible_project_ids(db, actor)
    wanted = set(project_ids)
    if db.query(Project.id).filter(Project.id.in_(wanted)).count() != len(wanted):
        raise HTTPException(status_code=400, detail="Unknown project.")
    current = {m.project_id: m for m in db.query(ProjectMember).filter(ProjectMember.user_id == user.id)}
    for pid in (wanted ^ set(current)):
        if visible is not None and pid not in visible:
            raise permission_denied("You can assign only projects in your scope.")
    for pid, member in current.items():
        if pid not in wanted:
            db.delete(member)
    for pid in wanted - set(current):
        db.add(ProjectMember(project_id=pid, user_id=user.id, added_by_user_id=actor.id))


@router.get("/users")
async def list_users(current_user: User = Depends(require("user.view")), db: Session = Depends(get_db)):
    """The people below oneself in the hierarchy (and oneself); a super admin sees everyone."""
    users = db.query(User).order_by(User.full_name, User.username).all()
    return [_user_response(db, user) for user in users if can_see_user(current_user, user)]


@router.post("/users/{user_id}/claim")
async def claim_user(user_id: int, current_user: User = Depends(require("user.manage")),
                     db: Session = Depends(get_db)):
    """A lead takes on someone who has no lead yet (phase 15)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not can_see_user(current_user, user):
        raise HTTPException(status_code=404, detail="User not found.")
    if current_user.role != UserRole.AUTOMATION_LEAD:
        raise HTTPException(status_code=400, detail="Only leads take people on; a super admin assigns a lead.")
    if user.assigned_lead_id is not None:
        raise HTTPException(status_code=400, detail="This person already has a lead.")
    if user.role not in LEAD_ASSIGNABLE_ROLES:
        raise permission_denied("Leads take on Seniors, Users, Trainees and Viewers.")
    user.assigned_lead_id = current_user.id
    db.commit()
    db.refresh(user)
    actor = current_user.full_name or current_user.username
    record(db, "user.claim", f"{actor} took on {user.full_name or user.username}", actor_id=current_user.id,
           subject_user_id=user.id)
    return _user_response(db, user)


@router.post("/users", status_code=201)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(require("user.manage")),
    db: Session = Depends(get_db),
):
    role = _parse_role(payload.role)
    check_role_change(current_user, None, role)
    _check_password(payload.password)
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered.")
    username = (payload.username or payload.email).strip()
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Username already taken.")

    user = User(
        username=username,
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=User.hash_password(payload.password),
        role=role,
        scope_tag=_resolve_tag(role, payload.scope_tag, None),
        organization_id=get_default_organization(db).id,
        is_active=True,
    )
    db.add(user)
    db.flush()
    # A lead's new people are assigned to that lead.
    _set_lead(db, current_user, user, payload.assigned_lead_id if current_user.role == UserRole.SUPER_ADMIN
              else current_user.id)
    if payload.project_ids:
        _set_projects(db, current_user, user, payload.project_ids)
    db.commit()
    db.refresh(user)
    logger.info("%s created user %s with role %s", current_user.username, user.username, role.value)
    return _user_response(db, user)


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require("user.manage")),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    new_role = _parse_role(payload.role) if payload.role is not None else None
    check_role_change(current_user, user, new_role)
    if user.id == current_user.id and new_role is not None and new_role != user.role:
        raise HTTPException(status_code=400, detail="You cannot change your own role.")

    fields = payload.model_fields_set
    role_change: Optional[tuple[UserRole, UserRole]] = None
    if "email" in fields and payload.email and payload.email != user.email:
        if db.query(User).filter(User.email == payload.email, User.id != user.id).first():
            raise HTTPException(status_code=400, detail="Email already registered.")
        user.email = payload.email
    if "full_name" in fields and payload.full_name is not None:
        user.full_name = payload.full_name
    if "password" in fields and payload.password:
        _check_password(payload.password)
        user.hashed_password = User.hash_password(payload.password)
    if "is_active" in fields and payload.is_active is not None:
        if user.id == current_user.id and not payload.is_active:
            raise HTTPException(status_code=400, detail="You cannot deactivate yourself.")
        user.is_active = payload.is_active
    if new_role is not None or "scope_tag" in fields:
        role = new_role or user.role
        old = (user.role, user.scope_tag)
        user.role = role
        user.scope_tag = _resolve_tag(role, payload.scope_tag, user.scope_tag)
        if old[0] != user.role:
            role_change = (old[0], user.role)
        if old != (user.role, user.scope_tag):
            logger.info("%s changed %s from %s/%s to %s/%s", current_user.username, user.username,
                        old[0].value, old[1], user.role.value, user.scope_tag)
    if "assigned_lead_id" in fields:
        _set_lead(db, current_user, user, payload.assigned_lead_id)
    if payload.project_ids is not None:
        _set_projects(db, current_user, user, payload.project_ids)
    db.commit()
    db.refresh(user)
    if role_change:
        before, after = (ROLE_NAMES.get(r, r.value) for r in role_change)
        actor = current_user.full_name or current_user.username
        record(db, "role.change", f"{actor} changed {user.full_name or user.username} from {before} to {after}",
               actor_id=current_user.id, subject_user_id=user.id,
               details={"from": role_change[0].value, "to": role_change[1].value})
        notify(db, [user.id], "promotion", f"Your role is now {after}",
               f"{actor} changed your role from {before} to {after}.", "/")
    return _user_response(db, user)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(require("user.manage")),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete yourself.")
    check_role_change(current_user, user, None)
    db.delete(user)
    db.commit()
    logger.info("%s deleted user %s", current_user.username, user.username)
    return {"message": "User deleted", "username": user.username}


@router.post("/users/{user_id}/2fa/disable")
async def disable_user_2fa(
    user_id: int,
    current_user: User = Depends(require("user.manage")),
    db: Session = Depends(get_db),
):
    """Reset another user's two-factor authentication (for a lost device)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Use the regular 2FA disable for your own account.")
    check_role_change(current_user, user, None)
    user.two_fa_enabled = False
    user.two_fa_secret = None
    db.commit()
    logger.info("%s disabled 2FA for %s", current_user.username, user.username)
    return {"message": f"2FA disabled for {user.username}", "enabled": False, "user_id": user.id}
