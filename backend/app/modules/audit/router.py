"""Admin › Audit: the audit log. Super admins see everything; a lead sees what they did, what was done to their
people, and what happened in the projects they see."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import SA, require, visible_project_ids
from app.modules.audit.models import AuditEntry
from app.modules.identity.models import User
from app.modules.projects.models import Project

router = APIRouter(prefix="/api/audit", tags=["Admin"])


@router.get("")
async def list_audit(action: Optional[str] = None, limit: int = Query(200, ge=1, le=1000),
                     current_user: User = Depends(require("audit.view")), db: Session = Depends(get_db)):
    query = db.query(AuditEntry)
    if current_user.role != SA:
        people = [uid for (uid,) in db.query(User.id).filter(User.assigned_lead_id == current_user.id)]
        visible = visible_project_ids(db, current_user) or set()
        query = query.filter(or_(AuditEntry.actor_id == current_user.id, AuditEntry.subject_user_id.in_(people),
                                 AuditEntry.project_id.in_(visible)))
    actions = sorted({a for (a,) in query.with_entities(AuditEntry.action).distinct()})
    if action:
        query = query.filter(AuditEntry.action == action)
    entries = query.order_by(AuditEntry.created_at.desc(), AuditEntry.id.desc()).limit(limit).all()
    user_ids = {i for e in entries for i in (e.actor_id, e.subject_user_id) if i}
    users = {u.id: u.full_name or u.username for u in db.query(User).filter(User.id.in_(user_ids))} if user_ids else {}
    project_ids = {e.project_id for e in entries if e.project_id}
    projects = {p.id: p.name for p in db.query(Project).filter(Project.id.in_(project_ids))} if project_ids else {}
    return {
        "actions": actions,
        "items": [{"id": e.id, "action": e.action, "summary": e.summary, "details": e.details,
                   "actor": users.get(e.actor_id or 0) if e.actor_id else None,
                   "subject": users.get(e.subject_user_id or 0) if e.subject_user_id else None,
                   "project": projects.get(e.project_id or 0) if e.project_id else None,
                   "created_at": e.created_at.isoformat()} for e in entries],
    }
