"""Personal connections: each user's tokens for GitHub, Jira, Confluence and the AI assistant, encrypted."""
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.modules.identity.models import User


class UserConnection(Base):
    __tablename__ = "user_connections"
    __table_args__ = (UniqueConstraint("user_id", "kind", "ref", name="uq_user_connection"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # github | jira | confluence | github_project | zephyr_session | ai_assistant
    kind: Mapped[str] = mapped_column(String(40))
    # Qualifier within a kind, e.g. the project id for github_project; "" otherwise.
    ref: Mapped[str] = mapped_column(String(64), default="")
    secret: Mapped[str] = mapped_column(Text)  # Fernet token (app.core.crypto)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="connections")
