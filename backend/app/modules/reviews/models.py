"""Pull requests opened from ATM and the reviews submitted through ATM (phase 12). GitHub stays the source of truth;
these rows say who in ATM opened or reviewed what (notifications, "waiting for me", readiness evidence)."""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PullRequest(Base):
    __tablename__ = "pull_requests"
    __table_args__ = (UniqueConstraint("project_id", "number", name="uq_pull_request_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
                                            index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[Optional[str]] = mapped_column(String(1024))
    head: Mapped[str] = mapped_column(String(255), nullable=False)
    base: Mapped[str] = mapped_column(String(255), nullable=False)
    author_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class PullRequestReview(Base):
    __tablename__ = "pr_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
                                            index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    reviewer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                                                       index=True)
    event: Mapped[str] = mapped_column(String(20), nullable=False)  # APPROVE | REQUEST_CHANGES | COMMENT
    comments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # line comments in the review
    ai_suggestions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # of which suggested by the AI
    github_review_id: Mapped[Optional[int]] = mapped_column(Integer)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class PullRequestComment(Base):
    """A line comment posted from ATM (phase 20: posted at once, not held for the review). Counted into the
    reviewer's next review of the pull request."""
    __tablename__ = "pr_line_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
                                            index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    author_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True)
    github_comment_id: Mapped[Optional[int]] = mapped_column(Integer)
    suggested_by_ai: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    review_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("pr_reviews.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
