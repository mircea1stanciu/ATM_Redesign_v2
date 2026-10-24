"""Who mentors whom, the AI tutor setting, and each person's learning progress."""
from typing import Optional

from sqlalchemy.orm import Session

from app.core.permissions import LEAD, SA, SENIOR, TRAINEE, USER, visible_project_ids
from app.modules.identity.models import User
from app.modules.learning.progress_models import LearningProfile, LearningProgress
from app.modules.projects.models import ProjectMember

LEARNER_ROLES = frozenset({TRAINEE, USER})
QUIZ_PASS_MARK = 7  # of 10 questions (or all of them, for a shorter quiz)


def quiz_passed(score: int, total: int) -> bool:
    return total > 0 and score >= min(QUIZ_PASS_MARK, total)


def mentees(db: Session, mentor: User) -> list[User]:
    """The Trainees and Users a mentor follows: a lead's own people; for a senior, the learners of the projects they
    see; everyone for a super admin."""
    query = db.query(User).filter(User.role.in_(LEARNER_ROLES), User.is_active.is_(True), User.id != mentor.id)
    if mentor.role == LEAD:
        query = query.filter(User.assigned_lead_id == mentor.id)
    elif mentor.role == SENIOR:
        visible = visible_project_ids(db, mentor)
        if visible is not None:
            members = {uid for (uid,) in db.query(ProjectMember.user_id).filter(ProjectMember.project_id.in_(visible))}
            query = query.filter(User.id.in_(members))
    elif mentor.role != SA:
        return []
    return query.order_by(User.full_name, User.username).all()


def is_mentee(db: Session, mentor: User, learner_id: int) -> bool:
    return any(person.id == learner_id for person in mentees(db, mentor))


def profile(db: Session, user_id: int) -> Optional[LearningProfile]:
    return db.query(LearningProfile).filter(LearningProfile.user_id == user_id).first()


def tutor_mode(db: Session, user: User) -> bool:
    """On for Trainees unless they switch it off; off for everyone else unless they switch it on."""
    saved = profile(db, user.id)
    if saved is not None and saved.tutor_mode is not None:
        return bool(saved.tutor_mode)
    return user.role == TRAINEE


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
