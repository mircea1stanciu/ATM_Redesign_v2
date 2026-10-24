"""Readiness and promotion (phase 14, open topic T4 suggested default): the evidence a lead sees before deciding,
readiness requests, and the decision with a note. Nothing is automatic: ATM shows the evidence, the lead decides."""
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import ROLE_RANK, TAGGED_ROLES, PermissionDenied, check_role_change, has_permission, require
from app.modules.audit.service import record
from app.modules.identity.models import User, UserRole
from app.modules.identity.users_router import ROLE_NAMES
from app.modules.learning import service
from app.modules.learning.progress_models import PracticeSubmission, ReadinessRequest
from app.modules.notifications.service import notify
from app.modules.projects.models import AnalyticsRun
from app.modules.reviews.models import PullRequest, PullRequestReview
from app.modules.work.models import WorkItem

router = APIRouter(prefix="/api/readiness", tags=["Learning"])

# The ladder a promotion climbs (docs/redesign/04-roles-and-permissions.md, section 4.4).
RANK = ROLE_RANK


def _name(user: Optional[User]) -> Optional[str]:
    return (user.full_name or user.username) if user else None


def _person(db: Session, viewer: User, user_id: int) -> User:
    """The person whose readiness is shown: oneself, or someone the viewer mentors (404 otherwise)."""
    person = db.query(User).filter(User.id == user_id).first()
    if not person or (person.id != viewer.id and not service.is_mentee(db, viewer, person.id)):
        raise HTTPException(status_code=404, detail="Not found among the people you mentor.")
    return person


def evidence(db: Session, person: User) -> dict:
    """The numbers the lead looks at (T4 default): learning, practice, work items, pull requests, runs."""
    progress = service.progress_of(db, [person.id])[person.id]
    profile = service.profile(db, person.id)
    practice = dict(db.query(PracticeSubmission.status, func.count()).filter(PracticeSubmission.user_id == person.id)
                    .group_by(PracticeSubmission.status).all())
    work = dict(db.query(WorkItem.status, func.count()).filter(WorkItem.assignee_id == person.id)
                .group_by(WorkItem.status).all())
    opened = db.query(PullRequest).filter(PullRequest.author_id == person.id).all()
    approved = {(r.project_id, r.number) for r in db.query(PullRequestReview).filter(
        PullRequestReview.event == "APPROVE", PullRequestReview.reviewer_id != person.id,
        PullRequestReview.project_id.in_({pr.project_id for pr in opened}))} if opened else set()
    runs = db.query(AnalyticsRun).filter(AnalyticsRun.started_by_id == person.id)
    last = runs.order_by(AnalyticsRun.created_at.desc()).first()
    return {
        "path_id": profile.path_id if profile else None,
        "lessons": progress["lessons"],
        "quizzes": progress["quizzes"],
        "last_activity": progress["last_activity"],
        "practice": {status: int(practice.get(status, 0)) for status in ("approved", "submitted", "changes_requested")},
        "work_items": {status: int(work.get(status, 0)) for status in ("done", "in_review", "in_progress", "todo")},
        "pull_requests": {"opened": len(opened),
                          "approved": sum(1 for pr in opened if (pr.project_id, pr.number) in approved)},
        "runs": {"total": runs.count(), "passed": runs.filter(AnalyticsRun.status == "passed").count(),
                 "failed": runs.filter(AnalyticsRun.status.in_(("failed", "error"))).count(),
                 "last_at": last.created_at.isoformat() if last and last.created_at else None},
    }


def _request_response(db: Session, item: ReadinessRequest) -> dict:
    people = {u.id: u for u in db.query(User).filter(User.id.in_(
        {i for i in (item.user_id, item.requested_by_id, item.decided_by_id) if i}))}
    return {"id": item.id, "user_id": item.user_id, "user": _name(people.get(item.user_id)),
            "requested_by": _name(people.get(item.requested_by_id or 0)), "note": item.note, "status": item.status,
            "decision": item.decision, "from_role": item.from_role, "to_role": item.to_role,
            "decision_note": item.decision_note, "decided_by": _name(people.get(item.decided_by_id or 0)),
            "requested_at": item.requested_at.isoformat(),
            "decided_at": item.decided_at.isoformat() if item.decided_at else None}


def _open_request(db: Session, user_id: int) -> Optional[ReadinessRequest]:
    return db.query(ReadinessRequest).filter(ReadinessRequest.user_id == user_id,
                                             ReadinessRequest.status == "open").first()


def _next_roles(viewer: User, person: User) -> list[str]:
    """The roles the viewer may promote the person to: higher on the ladder and allowed by footnote 3."""
    if not has_permission(viewer, "readiness.decide"):
        return []
    allowed = []
    for role, rank in RANK.items():
        if rank <= RANK[person.role]:
            continue
        try:
            check_role_change(viewer, person, role)
        except PermissionDenied:
            continue
        allowed.append(role.value)
    return allowed


@router.get("/people/{user_id}")
async def readiness_of(user_id: int, current_user: User = Depends(require("learning.use")),
                       db: Session = Depends(get_db)):
    """A person's evidence, their open request, the decisions so far, and what the viewer may decide."""
    person = _person(db, current_user, user_id)
    history = (db.query(ReadinessRequest).filter(ReadinessRequest.user_id == person.id)
               .order_by(ReadinessRequest.requested_at.desc()).all())
    return {
        "user": {"id": person.id, "name": _name(person), "role": person.role.value},
        "evidence": evidence(db, person),
        "open_request": next((_request_response(db, r) for r in history if r.status == "open"), None),
        "history": [_request_response(db, r) for r in history if r.status != "open"],
        "can_request": person.role in service.LEARNER_ROLES and _open_request(db, person.id) is None,
        "promote_to": _next_roles(current_user, person),
    }


@router.get("/requests")
async def open_requests(current_user: User = Depends(require("learning.mentor")), db: Session = Depends(get_db)):
    """Open readiness requests of the people I mentor, oldest first."""
    ids = [p.id for p in service.mentees(db, current_user)]
    rows = (db.query(ReadinessRequest).filter(ReadinessRequest.user_id.in_(ids), ReadinessRequest.status == "open")
            .order_by(ReadinessRequest.requested_at).all() if ids else [])
    return [_request_response(db, r) for r in rows]


class RequestPayload(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.post("/people/{user_id}/request", status_code=201)
async def request_review(user_id: int, payload: RequestPayload, current_user: User = Depends(require("learning.use")),
                         db: Session = Depends(get_db)):
    """Ask for a readiness review: the learner for themselves, or a mentor for them. The lead is notified."""
    person = _person(db, current_user, user_id)
    if person.role not in service.LEARNER_ROLES:
        raise HTTPException(status_code=400, detail="Readiness reviews are for Trainees and Users.")
    if _open_request(db, person.id):
        raise HTTPException(status_code=400, detail="A readiness review is already requested.")
    item = ReadinessRequest(user_id=person.id, requested_by_id=current_user.id, note=payload.note.strip() or None,
                            status="open", from_role=person.role.value)
    db.add(item)
    db.commit()
    if person.assigned_lead_id and person.assigned_lead_id != current_user.id:
        by = "" if person.id == current_user.id else f" ({_name(current_user)} asked)"
        notify(db, [person.assigned_lead_id], "readiness", f"{_name(person)} asks for a readiness review{by}",
               item.note or "", f"/learning/readiness/{person.id}")
    return _request_response(db, item)


class DecisionPayload(BaseModel):
    decision: Literal["promote", "not_yet"]
    role: Optional[str] = None
    note: str = Field(min_length=1, max_length=2000)


@router.post("/people/{user_id}/decision")
async def decide(user_id: int, payload: DecisionPayload, current_user: User = Depends(require("readiness.decide")),
                 db: Session = Depends(get_db)):
    """The lead's decision with a note: promote (the role changes at once) or not yet. Logged and notified."""
    person = _person(db, current_user, user_id)
    note = payload.note.strip()
    if not note:
        raise HTTPException(status_code=400, detail="Write a short note about the decision.")
    item = _open_request(db, person.id) or ReadinessRequest(user_id=person.id, requested_by_id=current_user.id,
                                                            status="open", from_role=person.role.value)
    if item.id is None:
        db.add(item)
    from_role = person.role
    to_role: Optional[UserRole] = None
    if payload.decision == "promote":
        try:
            to_role = UserRole(payload.role or "")
        except ValueError:
            raise HTTPException(status_code=400, detail="Choose the new role.")
        if RANK[to_role] <= RANK[from_role]:
            raise HTTPException(status_code=400, detail="A promotion moves someone up: choose a higher role.")
        check_role_change(current_user, person, to_role)
        person.role = to_role
        person.scope_tag = (person.scope_tag or "project_base") if to_role in TAGGED_ROLES else None
    item.status, item.decision = "decided", "promoted" if to_role else "not_yet"
    item.from_role, item.to_role = from_role.value, to_role.value if to_role else None
    item.decision_note, item.decided_by_id, item.decided_at = note, current_user.id, datetime.utcnow()
    db.commit()
    lead = _name(current_user)
    if to_role:
        before, after = ROLE_NAMES[from_role], ROLE_NAMES[to_role]
        record(db, "promotion", f"{lead} promoted {_name(person)} from {before} to {after}", actor_id=current_user.id,
               subject_user_id=person.id, details={"from": from_role.value, "to": to_role.value, "note": note,
                                                   "request_id": item.id})
        notify(db, [person.id], "promotion", f"You are now {after}", f"{lead}: {note}",
               f"/learning/readiness/{person.id}")
    else:
        record(db, "readiness.not_yet", f"{lead} decided {_name(person)} is not ready yet", actor_id=current_user.id,
               subject_user_id=person.id, details={"role": from_role.value, "note": note, "request_id": item.id})
        notify(db, [person.id], "readiness", "Your readiness review: not yet", f"{lead}: {note}",
               f"/learning/readiness/{person.id}")
    return _request_response(db, item)
