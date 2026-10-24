"""Creating notifications: who receives them (and wants them), storing them, and pushing them to open tabs."""
from collections.abc import Iterable
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.permissions import LEAD, SENIOR, TRAINEE, USER
from app.modules.identity.models import User
from app.modules.notifications.hub import hub
from app.modules.notifications.models import Notification, NotificationSubscription
from app.modules.projects.models import Project, ProjectMember

TESTER_ROLES = frozenset({LEAD, SENIOR, USER, TRAINEE})


def notification_response(notification: Notification) -> dict:
    return {
        "id": notification.id,
        "kind": notification.kind,
        "title": notification.title,
        "body": notification.body,
        "link": notification.link,
        "project_id": notification.project_id,
        "deployment_id": notification.deployment_id,
        "read": notification.read_at is not None,
        "created_at": notification.created_at.isoformat(),
    }


def project_testers(db: Session, project_id: int) -> list[int]:
    """The project's members and its lead who test (Lead, Senior, User, Trainee), active."""
    project = db.query(Project).filter(Project.id == project_id).first()
    member_ids = [uid for (uid,) in db.query(ProjectMember.user_id).filter(ProjectMember.project_id == project_id)]
    lead_id = project.lead_user_id if project else None
    users = db.query(User).filter(or_(User.id.in_(member_ids), User.id == lead_id), User.is_active.is_(True)).all()
    return sorted(user.id for user in users if user.role in TESTER_ROLES)


def reviewers(db: Session, project_id: int, author: User) -> list[int]:
    """Who reviews the author's pull requests: the project's Seniors and lead, and the author's lead."""
    project = db.query(Project).filter(Project.id == project_id).first()
    member_ids = [uid for (uid,) in db.query(ProjectMember.user_id).filter(ProjectMember.project_id == project_id)]
    leads = {project.lead_user_id if project else None, author.assigned_lead_id}
    users = db.query(User).filter(or_(User.id.in_(member_ids), User.id.in_(leads - {None})),
                                  User.is_active.is_(True)).all()
    return sorted(user.id for user in users if user.id != author.id
                  and (user.role in (LEAD, SENIOR) or user.id in leads))


def subscription(db: Session, user_id: int) -> NotificationSubscription:
    found = db.query(NotificationSubscription).filter(NotificationSubscription.user_id == user_id).first()
    return found or NotificationSubscription(user_id=user_id, muted_kinds=[], muted_project_ids=[])


def wants(db: Session, user_id: int, kind: str, project_id: Optional[int]) -> bool:
    choice = subscription(db, user_id)
    if kind in (choice.muted_kinds or []):
        return False
    return project_id is None or project_id not in (choice.muted_project_ids or [])


def notify(db: Session, user_ids: Iterable[int], kind: str, title: str, body: str = "", link: Optional[str] = None,
           project_id: Optional[int] = None, deployment_id: Optional[int] = None) -> list[Notification]:
    """Store one notification per user who wants this kind (and project), commit, and push it to their open tabs."""
    created = [
        Notification(user_id=user_id, kind=kind, title=title[:255], body=body[:1000] or None, link=link,
                     project_id=project_id, deployment_id=deployment_id)
        for user_id in dict.fromkeys(user_ids) if wants(db, user_id, kind, project_id)
    ]
    if not created:
        return []
    db.add_all(created)
    db.commit()
    for notification in created:
        hub.publish(notification.user_id, {"type": "notification", "notification": notification_response(notification)})
    return created
