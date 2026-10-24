"""Writing audit entries. Call ``record`` after the change itself succeeded; it commits."""
from typing import Optional

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
