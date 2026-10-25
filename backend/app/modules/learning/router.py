"""Learning area (phase 13): my progress and profile, practice tasks and their review, the mentor view, the hint
library and the AI tutor. Phase 21: the paths leads build, and the mentors they assign."""
import re
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import SENIOR, ensure, has_permission, require
from app.modules.audit.service import name_of, record
from app.modules.identity.models import User
from app.modules.learning import service
from app.modules.learning.progress_models import (
    Hint,
    LearningPath,
    LearningProfile,
    LearningProgress,
    PracticeSubmission,
    PracticeTask,
)
from app.modules.notifications.service import notify
from app.modules.projects.models import Project

router = APIRouter(prefix="/api/learning", tags=["Learning"])

ITEM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")
MAX_PATHS = 100
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
    mentor = service.mentor_of(db, user.id)
    return {
        "profile": {"path_id": saved.path_id if saved else None, "tutor_mode": service.tutor_mode(db, user),
                    "mentor": _person(mentor)},
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
        if payload.path_id and not db.query(LearningPath).filter(LearningPath.id == payload.path_id).first():
            raise HTTPException(status_code=400, detail="That learning path does not exist.")
        saved.path_id = payload.path_id or None
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
    if payload.path_id and not db.query(LearningPath).filter(LearningPath.id == payload.path_id).first():
        raise HTTPException(status_code=400, detail="That learning path does not exist.")
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
    mentor = service.mentor_of(db, current_user.id)
    reviewers = [uid for uid in (current_user.assigned_lead_id, mentor.id if mentor else None) if uid]
    notify(db, reviewers, "review_request", f"{_person(current_user)} handed in practice: {task.title}",
           submission.note or "", "/learning/mentor")
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
    mentor_ids = {p.mentor_id for p in profiles.values() if p.mentor_id}
    mentors = {u.id: _person(u) for u in db.query(User).filter(User.id.in_(mentor_ids))} if mentor_ids else {}
    return {
        "people": [{
            "id": p.id, "name": names[p.id], "role": p.role.value,
            "path_id": profiles[p.id].path_id if p.id in profiles else None,
            "mentor": mentors.get(profiles[p.id].mentor_id or 0) if p.id in profiles else None,
            **progress[p.id],
            "practice": {status: sum(1 for s in submissions if s.user_id == p.id and s.status == status)
                         for status in ("submitted", "approved", "changes_requested")},
        } for p in people],
        "waiting": [{**_submission_response(db, s), "learner": names[s.user_id], "learner_id": s.user_id,
                     "task": tasks[s.task_id].title, "task_description": tasks[s.task_id].description}
                    for s in submissions if s.status == "submitted"],
    }


# ── Mentors (phase 21) ────────────────────────────────────────────────────────


def _profile_for(db: Session, user_id: int) -> LearningProfile:
    saved = service.profile(db, user_id)
    if not saved:
        saved = LearningProfile(user_id=user_id)
        db.add(saved)
    return saved


@router.get("/mentors")
async def list_mentors(current_user: User = Depends(require("learning.manage")), db: Session = Depends(get_db)):
    """The learners whose mentor I choose (a lead's own Trainees and Users), each with their mentor, and the Seniors
    who can mentor."""
    people = service.managed_learners(db, current_user)
    ids = [p.id for p in people]
    profiles = {p.user_id: p for p in db.query(LearningProfile).filter(LearningProfile.user_id.in_(ids))} if ids else {}
    seniors = (db.query(User).filter(User.role == SENIOR, User.is_active.is_(True))
               .order_by(User.full_name, User.username).all())
    return {
        "people": [{"id": p.id, "name": _person(p), "role": p.role.value,
                    "mentor_id": profiles[p.id].mentor_id if p.id in profiles else None} for p in people],
        "seniors": [{"id": s.id, "name": _person(s)} for s in seniors],
    }


class MentorChoice(BaseModel):
    mentor_id: Optional[int] = None  # None: no Senior mentor (the lead still mentors their own people)


@router.put("/mentors/{user_id}")
async def assign_mentor(user_id: int, payload: MentorChoice, current_user: User = Depends(require("learning.manage")),
                        db: Session = Depends(get_db)):
    """A lead assigns a Senior as mentor to one of their Trainees or Users; both are told."""
    learner = next((p for p in service.managed_learners(db, current_user) if p.id == user_id), None)
    if not learner:
        raise HTTPException(status_code=404, detail="Not one of the Trainees and Users you lead.")
    mentor = None
    if payload.mentor_id is not None:
        mentor = db.query(User).filter(User.id == payload.mentor_id, User.role == SENIOR,
                                       User.is_active.is_(True)).first()
        if not mentor:
            raise HTTPException(status_code=400, detail="A mentor is an active Automation Senior.")
    saved = _profile_for(db, learner.id)
    previous = saved.mentor_id
    saved.mentor_id = mentor.id if mentor else None
    db.commit()
    if mentor and previous != mentor.id:
        notify(db, [mentor.id], "mentoring", f"You now mentor {_person(learner)}",
               f"Assigned by {_person(current_user)}.", "/learning/mentor")
        notify(db, [learner.id], "mentoring", f"{_person(mentor)} is your mentor now",
               f"Assigned by {_person(current_user)}. Ask them about your lessons and practice.", "/learning/paths")
    return {"id": learner.id, "mentor_id": saved.mentor_id, "mentor": _person(mentor)}


# ── Learning paths (phase 21) ─────────────────────────────────────────────────


def _path_response(path: LearningPath) -> dict:
    return {"id": path.id, "title": path.title, "description": path.description, "programs": list(path.programs),
            "position": path.position, "updated_at": path.updated_at.isoformat()}


def _ordered_paths(db: Session) -> list[LearningPath]:
    return db.query(LearningPath).order_by(LearningPath.position, LearningPath.title).all()


@router.get("/paths")
async def list_paths(current_user: User = Depends(require("learning.use")), db: Session = Depends(get_db)):
    """The learning paths, in the order leads chose."""
    return [_path_response(p) for p in _ordered_paths(db)]


class PathPayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    programs: list[str] = Field(min_length=1, max_length=20)


def _clean_programs(programs: list[str]) -> list[str]:
    cleaned = [_item(p) for p in programs]
    if len(set(cleaned)) != len(cleaned):
        raise HTTPException(status_code=400, detail="A program is listed twice.")
    return cleaned


def _slug(db: Session, title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80] or "path"
    slug, number = base, 2
    while db.query(LearningPath).filter(LearningPath.id == slug).first():
        slug, number = f"{base}-{number}", number + 1
    return slug


@router.post("/paths", status_code=201)
async def create_path(payload: PathPayload, current_user: User = Depends(require("learning.manage")),
                      db: Session = Depends(get_db)):
    if db.query(LearningPath).count() >= MAX_PATHS:
        raise HTTPException(status_code=400, detail=f"There are already {MAX_PATHS} paths.")
    last = db.query(LearningPath).order_by(LearningPath.position.desc()).first()
    path = LearningPath(id=_slug(db, payload.title), title=payload.title.strip(),
                        description=payload.description.strip(), programs=_clean_programs(payload.programs),
                        position=(last.position + 1) if last else 0, updated_by_id=current_user.id)
    db.add(path)
    db.commit()
    return _path_response(path)


class PathOrder(BaseModel):
    ids: list[str] = Field(max_length=MAX_PATHS)


@router.post("/paths/reorder")
async def reorder_paths(payload: PathOrder, current_user: User = Depends(require("learning.manage")),
                        db: Session = Depends(get_db)):
    """Every path's id, in the new order."""
    paths = {p.id: p for p in _ordered_paths(db)}
    if sorted(payload.ids) != sorted(paths):
        raise HTTPException(status_code=400, detail="List every path once.")
    for position, path_id in enumerate(payload.ids):
        paths[path_id].position = position
    db.commit()
    return [_path_response(p) for p in _ordered_paths(db)]


def _path(db: Session, path_id: str) -> LearningPath:
    path = db.query(LearningPath).filter(LearningPath.id == path_id).first()
    if not path:
        raise HTTPException(status_code=404, detail="Learning path not found.")
    return path


@router.put("/paths/{path_id}")
async def update_path(path_id: str, payload: PathPayload, current_user: User = Depends(require("learning.manage")),
                      db: Session = Depends(get_db)):
    path = _path(db, path_id)
    path.title, path.description = payload.title.strip(), payload.description.strip()
    path.programs = _clean_programs(payload.programs)
    path.updated_by_id = current_user.id
    db.commit()
    return _path_response(path)


@router.delete("/paths/{path_id}")
async def delete_path(path_id: str, current_user: User = Depends(require("learning.manage")),
                      db: Session = Depends(get_db)):
    """Delete a path. Progress on its lessons is kept; those who chose it choose again, and its practice tasks are
    for any path."""
    path = _path(db, path_id)
    db.query(LearningProfile).filter(LearningProfile.path_id == path.id).update({"path_id": None})
    db.query(PracticeTask).filter(PracticeTask.path_id == path.id).update({"path_id": None})
    title = path.title
    db.delete(path)
    db.commit()
    record(db, "path.delete", f"{name_of(current_user)} deleted the learning path {title}", actor_id=current_user.id,
           details={"path": title, "path_id": path_id})
    return {"deleted": path_id}


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
    if db.query(Hint).filter(Hint.id == hint_id).delete():
        db.commit()
        record(db, "hint.delete", f"{name_of(current_user)} deleted the hint {hint_id}", actor_id=current_user.id,
               details={"hint_id": hint_id})
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
    service.count_ai_use(db, current_user, "tutor")
    return {"answer": "".join(parts).strip()}
