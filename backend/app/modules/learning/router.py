"""Learning area (phase 13): my progress and profile, practice tasks and their review, the mentor view, the hint
library and the AI tutor."""
import re
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import ensure, has_permission, require
from app.modules.identity.models import User
from app.modules.learning import service
from app.modules.learning.progress_models import (
    Hint,
    LearningProfile,
    LearningProgress,
    PracticeSubmission,
    PracticeTask,
)
from app.modules.notifications.service import notify
from app.modules.projects.models import Project

router = APIRouter(prefix="/api/learning", tags=["Learning"])

ITEM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")
HINT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def _item(item_id: str) -> str:
    if not ITEM_ID.match(item_id):
        raise HTTPException(status_code=400, detail="Unknown lesson or quiz.")
    return item_id


def _person(user: Optional[User]) -> Optional[str]:
    return (user.full_name or user.username) if user else None


# ── My progress and profile ───────────────────────────────────────────────────


def _submission_response(db: Session, submission: PracticeSubmission) -> dict:
    reviewer = db.query(User).filter(User.id == submission.reviewer_id).first() if submission.reviewer_id else None
    return {"id": submission.id, "task_id": submission.task_id, "branch": submission.branch, "link": submission.link,
            "note": submission.note, "status": submission.status, "feedback": submission.feedback,
            "reviewer": _person(reviewer), "submitted_at": submission.submitted_at.isoformat(),
            "reviewed_at": submission.reviewed_at.isoformat() if submission.reviewed_at else None}


def _me(db: Session, user: User) -> dict:
    saved = service.profile(db, user.id)
    return {
        "profile": {"path_id": saved.path_id if saved else None, "tutor_mode": service.tutor_mode(db, user)},
        "progress": service.progress_of(db, [user.id])[user.id],
    }


@router.get("/me")
async def my_learning(current_user: User = Depends(require("learning.use")), db: Session = Depends(get_db)):
    return _me(db, current_user)


class ProfileUpdate(BaseModel):
    path_id: Optional[str] = Field(default=None, max_length=100)
    tutor_mode: Optional[bool] = None


@router.put("/me/profile")
async def update_profile(payload: ProfileUpdate, current_user: User = Depends(require("learning.use")),
                         db: Session = Depends(get_db)):
    saved = service.profile(db, current_user.id)
    if not saved:
        saved = LearningProfile(user_id=current_user.id)
        db.add(saved)
    fields = payload.model_fields_set
    if "path_id" in fields:
        saved.path_id = _item(payload.path_id) if payload.path_id else None
    if "tutor_mode" in fields:
        saved.tutor_mode = payload.tutor_mode
    db.commit()
    return _me(db, current_user)


def _progress_row(db: Session, user_id: int, kind: str, item_id: str) -> LearningProgress:
    row = db.query(LearningProgress).filter(LearningProgress.user_id == user_id, LearningProgress.kind == kind,
                                            LearningProgress.item_id == item_id).first()
    if not row:
        row = LearningProgress(user_id=user_id, kind=kind, item_id=item_id, attempts=0, passed=False)
        db.add(row)
    return row


@router.put("/me/lessons/{lesson_id}")
async def complete_lesson(lesson_id: str, current_user: User = Depends(require("learning.use")),
                          db: Session = Depends(get_db)):
    row = _progress_row(db, current_user.id, "lesson", _item(lesson_id))
    if not row.passed:
        row.passed = True
        row.completed_at = datetime.utcnow()
    row.attempts += 1
    db.commit()
    return _me(db, current_user)


@router.delete("/me/lessons/{lesson_id}")
async def reopen_lesson(lesson_id: str, current_user: User = Depends(require("learning.use")),
                        db: Session = Depends(get_db)):
    db.query(LearningProgress).filter(LearningProgress.user_id == current_user.id, LearningProgress.kind == "lesson",
                                      LearningProgress.item_id == _item(lesson_id)).delete()
    db.commit()
    return _me(db, current_user)


class QuizResult(BaseModel):
    score: int = Field(ge=0, le=100)
    total: int = Field(ge=1, le=100)


@router.post("/me/quizzes/{module_id}")
async def record_quiz(module_id: str, payload: QuizResult, current_user: User = Depends(require("learning.use")),
                      db: Session = Depends(get_db)):
    """A quiz attempt (graded in the browser): keeps the best score; passed from the pass mark on."""
    if payload.score > payload.total:
        raise HTTPException(status_code=400, detail="The score cannot be higher than the number of questions.")
    row = _progress_row(db, current_user.id, "quiz", _item(module_id))
    row.attempts += 1
    if row.best_score is None or payload.score > row.best_score:
        row.best_score, row.total = payload.score, payload.total
    if service.quiz_passed(payload.score, payload.total) and not row.passed:
        row.passed = True
        row.completed_at = datetime.utcnow()
    db.commit()
    return {**_me(db, current_user), "passed": service.quiz_passed(payload.score, payload.total)}


# ── Practice tasks ────────────────────────────────────────────────────────────


class TaskPayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=20_000)
    path_id: Optional[str] = Field(default=None, max_length=100)
    project_id: Optional[int] = None
    active: bool = True


def _task_response(db: Session, task: PracticeTask, mine: Optional[PracticeSubmission]) -> dict:
    project = db.query(Project).filter(Project.id == task.project_id).first() if task.project_id else None
    return {"id": task.id, "title": task.title, "description": task.description, "path_id": task.path_id,
            "project": {"id": project.id, "name": project.name} if project else None, "active": task.active,
            "created_at": task.created_at.isoformat(),
            "my_submission": _submission_response(db, mine) if mine else None}


@router.get("/practice")
async def list_practice(current_user: User = Depends(require("learning.use")), db: Session = Depends(get_db)):
    """Practice tasks (inactive ones only for those who manage them), each with my submission."""
    query = db.query(PracticeTask)
    if not has_permission(current_user, "learning.manage"):
        query = query.filter(PracticeTask.active.is_(True))
    mine = {s.task_id: s for s in db.query(PracticeSubmission).filter(PracticeSubmission.user_id == current_user.id)}
    return [_task_response(db, task, mine.get(task.id))
            for task in query.order_by(PracticeTask.active.desc(), PracticeTask.created_at.desc()).all()]


def _clean_task(db: Session, payload: TaskPayload) -> dict:
    if payload.project_id is not None and not db.query(Project).filter(Project.id == payload.project_id).first():
        raise HTTPException(status_code=400, detail="That project does not exist.")
    return {"title": payload.title.strip(), "description": payload.description.strip(),
            "path_id": _item(payload.path_id) if payload.path_id else None, "project_id": payload.project_id,
            "active": payload.active}


@router.post("/practice", status_code=201)
async def create_practice(payload: TaskPayload, current_user: User = Depends(require("learning.manage")),
                          db: Session = Depends(get_db)):
    task = PracticeTask(**_clean_task(db, payload), created_by_id=current_user.id)
    db.add(task)
    db.commit()
    return _task_response(db, task, None)


@router.put("/practice/{task_id}")
async def update_practice(task_id: int, payload: TaskPayload, current_user: User = Depends(require("learning.manage")),
                          db: Session = Depends(get_db)):
    task = db.query(PracticeTask).filter(PracticeTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Practice task not found.")
    for field, value in _clean_task(db, payload).items():
        setattr(task, field, value)
    db.commit()
    return _task_response(db, task, None)


class SubmissionPayload(BaseModel):
    branch: Optional[str] = Field(default=None, max_length=255)
    link: Optional[str] = Field(default=None, max_length=1024)
    note: Optional[str] = Field(default=None, max_length=2000)


@router.post("/practice/{task_id}/submit")
async def submit_practice(task_id: int, payload: SubmissionPayload,
                          current_user: User = Depends(require("learning.use")), db: Session = Depends(get_db)):
    """Hand in (or hand in again) my work on a practice task: the branch or pull request, and a note."""
    ensure(db, current_user, "code.edit")  # viewers read the lessons but do not practise
    task = db.query(PracticeTask).filter(PracticeTask.id == task_id, PracticeTask.active.is_(True)).first()
    if not task:
        raise HTTPException(status_code=404, detail="Practice task not found.")
    branch, link = (payload.branch or "").strip() or None, (payload.link or "").strip() or None
    if not branch and not link:
        raise HTTPException(status_code=400, detail="Say where your work is: a branch or a link to the pull request.")
    if link and not link.startswith(("https://", "http://")):
        raise HTTPException(status_code=400, detail="The link must start with http:// or https://.")
    submission = db.query(PracticeSubmission).filter(PracticeSubmission.task_id == task.id,
                                                     PracticeSubmission.user_id == current_user.id).first()
    if submission and submission.status == "approved":
        raise HTTPException(status_code=400, detail="This practice task is already approved.")
    if not submission:
        submission = PracticeSubmission(task_id=task.id, user_id=current_user.id)
        db.add(submission)
    submission.branch, submission.link = branch, link
    submission.note = (payload.note or "").strip() or None
    submission.status = "submitted"
    submission.submitted_at = datetime.utcnow()
    db.commit()
    if current_user.assigned_lead_id:
        notify(db, [current_user.assigned_lead_id], "review_request",
               f"{_person(current_user)} handed in practice: {task.title}", submission.note or "", "/learning/mentor")
    return _task_response(db, task, submission)


class PracticeReview(BaseModel):
    decision: Literal["approved", "changes_requested"]
    feedback: str = Field(default="", max_length=4000)


@router.post("/practice/submissions/{submission_id}/review")
async def review_practice(submission_id: int, payload: PracticeReview,
                          current_user: User = Depends(require("learning.mentor")), db: Session = Depends(get_db)):
    """A mentor approves the work or asks for changes (with feedback); the learner is notified."""
    submission = db.query(PracticeSubmission).filter(PracticeSubmission.id == submission_id).first()
    if not submission or not service.is_mentee(db, current_user, submission.user_id):
        raise HTTPException(status_code=404, detail="Submission not found among the people you mentor.")
    if payload.decision == "changes_requested" and not payload.feedback.strip():
        raise HTTPException(status_code=400, detail="Say what to change.")
    submission.status = payload.decision
    submission.feedback = payload.feedback.strip() or None
    submission.reviewer_id = current_user.id
    submission.reviewed_at = datetime.utcnow()
    db.commit()
    task = db.query(PracticeTask).filter(PracticeTask.id == submission.task_id).one()
    verdict = "approved" if payload.decision == "approved" else "asked for changes to"
    notify(db, [submission.user_id], "practice", f"{_person(current_user)} {verdict} your practice: {task.title}",
           submission.feedback or "", "/learning/practice")
    return _submission_response(db, submission)


# ── Mentor view ───────────────────────────────────────────────────────────────


@router.get("/mentor")
async def mentor_view(current_user: User = Depends(require("learning.mentor")), db: Session = Depends(get_db)):
    """The people I mentor with their progress, and the practice waiting for review."""
    people = service.mentees(db, current_user)
    ids = [p.id for p in people]
    progress = service.progress_of(db, ids)
    profiles = {p.user_id: p for p in db.query(LearningProfile).filter(LearningProfile.user_id.in_(ids))} if ids else {}
    submissions = (db.query(PracticeSubmission).filter(PracticeSubmission.user_id.in_(ids))
                   .order_by(PracticeSubmission.submitted_at).all() if ids else [])
    tasks = {t.id: t for t in db.query(PracticeTask).filter(PracticeTask.id.in_({s.task_id for s in submissions}))}
    names = {p.id: _person(p) for p in people}
    return {
        "people": [{
            "id": p.id, "name": names[p.id], "role": p.role.value,
            "path_id": profiles[p.id].path_id if p.id in profiles else None,
            **progress[p.id],
            "practice": {status: sum(1 for s in submissions if s.user_id == p.id and s.status == status)
                         for status in ("submitted", "approved", "changes_requested")},
        } for p in people],
        "waiting": [{**_submission_response(db, s), "learner": names[s.user_id], "learner_id": s.user_id,
                     "task": tasks[s.task_id].title, "task_description": tasks[s.task_id].description}
                    for s in submissions if s.status == "submitted"],
    }


# ── Hint library ──────────────────────────────────────────────────────────────


class HintPayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=500)
    details: str = Field(default="", max_length=20_000)
    topics: list[str] = Field(default_factory=list, max_length=30)


def _hint_response(hint: Hint) -> dict:
    return {"id": hint.id, "title": hint.title, "text": hint.text, "details": hint.details, "topics": hint.topics,
            "updated_at": hint.updated_at.isoformat()}


@router.get("/hints")
async def list_hints(current_user: User = Depends(require("learning.use")), db: Session = Depends(get_db)):
    """Every hint: lessons show those of their topic, the workspace editor those its rules detect."""
    return [_hint_response(h) for h in db.query(Hint).order_by(Hint.title).all()]


@router.put("/hints/{hint_id}")
async def save_hint(hint_id: str, payload: HintPayload, current_user: User = Depends(require("learning.manage")),
                    db: Session = Depends(get_db)):
    if not HINT_ID.match(hint_id):
        raise HTTPException(status_code=400, detail="A hint id uses lower-case letters, digits and '-'.")
    hint = db.query(Hint).filter(Hint.id == hint_id).first()
    if not hint:
        hint = Hint(id=hint_id)
        db.add(hint)
    hint.title, hint.text, hint.details = payload.title.strip(), payload.text.strip(), payload.details.strip()
    hint.topics = sorted({_item(t) for t in payload.topics})
    hint.updated_by_id = current_user.id
    db.commit()
    return _hint_response(hint)


@router.delete("/hints/{hint_id}")
async def delete_hint(hint_id: str, current_user: User = Depends(require("learning.manage")),
                      db: Session = Depends(get_db)):
    db.query(Hint).filter(Hint.id == hint_id).delete()
    db.commit()
    return {"deleted": hint_id}


# ── AI tutor ──────────────────────────────────────────────────────────────────


class TutorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class TutorQuestion(BaseModel):
    lesson: str = Field(min_length=1, max_length=300)
    context: str = Field(default="", max_length=12_000)  # the lesson's summary and the step the learner is on
    question: str = Field(min_length=1, max_length=4000)
    history: list[TutorMessage] = Field(default_factory=list, max_length=12)


TUTOR_SYSTEM = (
    "You are the AI tutor in ATM's Learning area. The learner is a manual tester becoming a test automation engineer "
    "and is reading the lesson below. Answer their question about it: explain in plain words, give a small example, "
    "and connect it to testing practice. Guide them to the answer with hints and one question back when they are "
    "working on a practice task; do not do the practice for them. Keep answers short (under 200 words) unless they "
    "ask for more."
)


@router.post("/tutor")
async def ask_tutor(payload: TutorQuestion, current_user: User = Depends(require("learning.use")),
                    db: Session = Depends(get_db)):
    from app.modules.workspace.assistant_router import _active_config
    from app.services import ai_provider_service as providers

    ensure(db, current_user, "ai.use")
    config = await _active_config(current_user, db)
    system = f"{TUTOR_SYSTEM}\n\n# Lesson: {payload.lesson}\n{payload.context}"
    messages = [m.model_dump() for m in payload.history] + [{"role": "user", "content": payload.question}]
    parts = []
    try:
        async for chunk in providers.stream_chat(config, system, messages):
            parts.append(chunk)
    except providers.AIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return {"answer": "".join(parts).strip()}
