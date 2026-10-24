"""Learning (phase 13): progress on lessons and quizzes, practice tasks and their review, the hint library, and each
learner's profile (chosen path, AI tutor mode). The lessons themselves ship with the frontend
(src/features/learning/content.ts); the server stores what each person did with them, by id."""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class LearningProgress(Base):
    """A lesson completed, or a module quiz taken (best score, attempts, when first passed)."""
    __tablename__ = "learning_progress"
    __table_args__ = (UniqueConstraint("user_id", "kind", "item_id", name="uq_learning_progress_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
                                         index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # lesson | quiz
    item_id: Mapped[str] = mapped_column(String(100), nullable=False)  # lesson id, or the module id of a quiz
    best_score: Mapped[Optional[int]] = mapped_column(Integer)
    total: Mapped[Optional[int]] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # a lesson: completed
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                                                 nullable=False)


class LearningProfile(Base):
    __tablename__ = "learning_profiles"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    path_id: Mapped[Optional[str]] = mapped_column(String(100))
    tutor_mode: Mapped[Optional[bool]] = mapped_column(Boolean)  # None: on for Trainees, off for everyone else
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                                                 nullable=False)


class PracticeTask(Base):
    """A small real change to make (in a sandbox project or on a branch of a project), reviewed by a mentor."""
    __tablename__ = "practice_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    path_id: Mapped[Optional[str]] = mapped_column(String(100))
    project_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("projects.id", ondelete="SET NULL"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class PracticeSubmission(Base):
    __tablename__ = "practice_submissions"
    __table_args__ = (UniqueConstraint("task_id", "user_id", name="uq_practice_submission"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("practice_tasks.id", ondelete="CASCADE"), nullable=False,
                                         index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
                                         index=True)
    branch: Mapped[Optional[str]] = mapped_column(String(255))
    link: Mapped[Optional[str]] = mapped_column(String(1024))  # the pull request, or another link to the work
    note: Mapped[Optional[str]] = mapped_column(String(2000))
    status: Mapped[str] = mapped_column(String(20), default="submitted", nullable=False)  # submitted | approved |
    # changes_requested
    feedback: Mapped[Optional[str]] = mapped_column(String(4000))
    reviewer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)


class Hint(Base):
    """One piece of advice, shown in lessons and in the workspace editor (where a rule in the frontend detects it)."""
    __tablename__ = "hints"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # a slug; the workspace rules use these ids
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    text: Mapped[str] = mapped_column(String(500), nullable=False)  # the short version shown in the editor
    details: Mapped[str] = mapped_column(Text, default="", nullable=False)  # the explanation shown in Learning
    topics: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # program ids; empty = every topic
    updated_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                                                 nullable=False)


class ReadinessRequest(Base):
    """A request to review whether someone is ready for the next role, and the lead's decision (phase 14)."""
    __tablename__ = "readiness_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
                                         index=True)
    requested_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[Optional[str]] = mapped_column(String(2000))
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)  # open | decided
    decision: Mapped[Optional[str]] = mapped_column(String(20))  # promoted | not_yet
    from_role: Mapped[Optional[str]] = mapped_column(String(40))
    to_role: Mapped[Optional[str]] = mapped_column(String(40))
    decision_note: Mapped[Optional[str]] = mapped_column(String(2000))
    decided_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
