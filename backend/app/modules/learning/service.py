"""Who mentors whom, the AI tutor setting, and each person's learning progress."""
from typing import Optional

from sqlalchemy.orm import Session

from app.core.permissions import LEAD, SA, SENIOR, TRAINEE, USER
from app.modules.identity.models import User
from app.modules.learning.progress_models import LearningProfile, LearningProgress

LEARNER_ROLES = frozenset({TRAINEE, USER})
QUIZ_PASS_MARK = 7  # of 10 questions (or all of them, for a shorter quiz)


def quiz_passed(score: int, total: int) -> bool:
    return total > 0 and score >= min(QUIZ_PASS_MARK, total)


def mentees(db: Session, mentor: User) -> list[User]:
    """The Trainees and Users a mentor follows: a lead's own people; for a senior, the people a lead assigned to them
    (phase 21); everyone for a super admin."""
    query = db.query(User).filter(User.role.in_(LEARNER_ROLES), User.is_active.is_(True), User.id != mentor.id)
    if mentor.role == LEAD:
        query = query.filter(User.assigned_lead_id == mentor.id)
    elif mentor.role == SENIOR:
        assigned = [uid for (uid,) in db.query(LearningProfile.user_id).filter(LearningProfile.mentor_id == mentor.id)]
        query = query.filter(User.id.in_(assigned))
    elif mentor.role != SA:
        return []
    return query.order_by(User.full_name, User.username).all()


def managed_learners(db: Session, manager: User) -> list[User]:
    """The Trainees and Users whose mentor this person may choose: a lead's own people; everyone for a super admin."""
    query = db.query(User).filter(User.role.in_(LEARNER_ROLES), User.is_active.is_(True))
    if manager.role == LEAD:
        query = query.filter(User.assigned_lead_id == manager.id)
    elif manager.role != SA:
        return []
    return query.order_by(User.full_name, User.username).all()


def mentor_of(db: Session, user_id: int) -> Optional[User]:
    saved = profile(db, user_id)
    if not saved or not saved.mentor_id:
        return None
    return db.query(User).filter(User.id == saved.mentor_id, User.is_active.is_(True)).first()


def is_mentee(db: Session, mentor: User, learner_id: int) -> bool:
    return any(person.id == learner_id for person in mentees(db, mentor))


def profile(db: Session, user_id: int) -> Optional[LearningProfile]:
    return db.query(LearningProfile).filter(LearningProfile.user_id == user_id).first()


def tutor_mode(db: Session, user: User) -> bool:
    """On for Trainees and Users unless they switch it off (Users since phase 21); off for the others unless they
    switch it on."""
    saved = profile(db, user.id)
    if saved is not None and saved.tutor_mode is not None:
        return bool(saved.tutor_mode)
    return user.role in LEARNER_ROLES


def progress_of(db: Session, user_ids: list[int]) -> dict[int, dict]:
    """Per user: completed lesson ids, quizzes (best score, attempts, passed) and the last activity."""
    out: dict[int, dict] = {uid: {"lessons": {}, "quizzes": {}, "last_activity": None} for uid in user_ids}
    if not user_ids:
        return out
    for row in db.query(LearningProgress).filter(LearningProgress.user_id.in_(user_ids)):
        entry = out[row.user_id]
        if row.kind == "lesson" and row.passed:
            entry["lessons"][row.item_id] = row.completed_at.isoformat() if row.completed_at else None
        elif row.kind == "quiz":
            entry["quizzes"][row.item_id] = {"best_score": row.best_score, "total": row.total,
                                             "attempts": row.attempts, "passed": row.passed,
                                             "passed_at": row.completed_at.isoformat() if row.completed_at else None}
        stamp = row.updated_at.isoformat()
        if not entry["last_activity"] or stamp > entry["last_activity"]:
            entry["last_activity"] = stamp
    return out


TUTOR_RULES = (
    "Tutor mode is on: the user is a manual tester learning test automation. Teach rather than do the work. Explain "
    "the idea and the steps in plain words, show short snippets, and ask one guiding question when it helps them find "
    "the answer. Only write complete files when the user explicitly asks you to write them; then explain each part."
)
