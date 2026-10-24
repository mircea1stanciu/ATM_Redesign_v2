"""Team task board (the Task Management panel), work items and trace links."""
import enum
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def now_utc():
    return datetime.now(timezone.utc)


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class Task(Base):
    """Lightweight, team-scoped task tracker."""
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    team_name = Column(String(255), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    status = Column(Enum(TaskStatus), default=TaskStatus.todo, nullable=False)
    assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


# ── Work items and traceability (docs/redesign/03-target-architecture.md, section 3.4) ──────────────────────────

WORK_SOURCES = ("jira", "confluence")
WORK_KINDS = ("user_story", "technical_story", "requirement_page", "other")
WORK_STATUSES = ("todo", "in_progress", "in_review", "done")
TRACE_TARGETS = ("test_file", "suite", "run", "pull_request")


class WorkItem(Base):
    """One Jira story or Confluence page that someone works on in a project."""
    __tablename__ = "work_items"
    __table_args__ = (UniqueConstraint("project_id", "source", "external_key", name="uq_work_item_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(16))
    external_key: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32), default="other")
    title: Mapped[str] = mapped_column(String(500))
    url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="todo")
    assignee_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    branch: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # A snapshot of the story (description, acceptance criteria) taken when work starts; the AI assistant reads it.
    context_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    links: Mapped[list["TraceLink"]] = relationship(
        back_populates="work_item", cascade="all, delete-orphan", order_by="TraceLink.id")


class TraceLink(Base):
    """What a work item touched: test files, suites, runs and its pull request."""
    __tablename__ = "trace_links"
    __table_args__ = (UniqueConstraint("work_item_id", "target_type", "target_ref", name="uq_trace_link"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("work_items.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[str] = mapped_column(String(32))
    target_ref: Mapped[str] = mapped_column(String(1024))
    label: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    work_item: Mapped[WorkItem] = relationship(back_populates="links")


class SavedFilter(Base):
    """An inbox filter saved under a name, per user and project (phase 16); one of them can open the inbox."""
    __tablename__ = "saved_filters"
    __table_args__ = (UniqueConstraint("user_id", "project_id", "name", name="uq_saved_filter_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
