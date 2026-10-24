"""In-app notifications and what each user wants to be notified about (phase 11)."""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# What a notification is about. Each kind can be switched off in the notification settings.
KINDS = ("deployment", "deployment_check", "run_finished", "review_request", "review", "promotion")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(String(1000))
    link: Mapped[Optional[str]] = mapped_column(String(1024))  # an ATM path (/deployments/3) or an external URL
    project_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"))
    deployment_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("deployments.id", ondelete="CASCADE"),
                                                         index=True)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class NotificationSubscription(Base):
    """A user's choices: the kinds switched off and the projects muted. No row means everything is on."""
    __tablename__ = "notification_subscriptions"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    muted_kinds: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    muted_project_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                                                 nullable=False)
