"""Writing audit entries. Call ``record`` after the change itself succeeded; it commits. Since phase 22 the log also
holds sign-ins (and failed attempts), settings changes and deletions."""
from collections.abc import Iterable
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.modules.audit.models import AuditEntry


def record(db: Session, action: str, summary: str, *, actor_id: Optional[int] = None,
           subject_user_id: Optional[int] = None, project_id: Optional[int] = None,
           details: Optional[dict] = None) -> AuditEntry:
    entry = AuditEntry(action=action, summary=summary[:500], actor_id=actor_id, subject_user_id=subject_user_id,
                       project_id=project_id, details=details or {})
    db.add(entry)
    db.commit()
    return entry


def name_of(user: Any) -> str:
    return user.full_name or user.username


def record_change(db: Session, user: Any, action: str, what: str, fields: Iterable[str], *,
                  project_id: Optional[int] = None, details: Optional[dict] = None) -> AuditEntry:
    """A settings change: which fields changed, never their values (tokens and passwords stay out of the log)."""
    return record(db, action, f"{name_of(user)} changed {what}", actor_id=user.id, project_id=project_id,
                  details={"fields": sorted(set(fields)), **(details or {})})
