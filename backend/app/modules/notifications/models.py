"""In-app notifications and what each user wants to be notified about (phase 11)."""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# What a notification is about. Each kind can be switched off in the notification settings.
KINDS = ("deployment", "deployment_check", "repository_merge", "run_finished", "review_request", "review",
         "practice", "readiness", "promotion", "mentoring", "community")


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
    """A user's choices: the kinds switched off and the projects muted. No row means everything is on (in ATM only).
    Phase 20: the kinds also sent by e-mail or to the user's own Teams workflow webhook (none by default)."""
    __tablename__ = "notification_subscriptions"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    muted_kinds: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    muted_project_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    email_kinds: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    teams_kinds: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    teams_webhook: Mapped[Optional[str]] = mapped_column(Text)  # encrypted (app.core.crypto)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                                                 nullable=False)


class MailServer(Base):
    """The SMTP server ATM sends e-mail notifications through (one row, set by a Super Admin; phase 20)."""
    __tablename__ = "mail_server"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    security: Mapped[str] = mapped_column(String(10), nullable=False)  # starttls | ssl | none
    username: Mapped[Optional[str]] = mapped_column(String(255))
    password: Mapped[Optional[str]] = mapped_column(Text)  # encrypted
    sender: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                                                 nullable=False)
