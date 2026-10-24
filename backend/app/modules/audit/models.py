"""The audit log (phase 14): who did what, to whom, when. Entries are never changed."""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AuditEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False, index=True)  # e.g. promotion, role.change
    actor_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True)
    subject_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                                                           index=True)
    project_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("projects.id", ondelete="SET NULL"),
                                                      index=True)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
