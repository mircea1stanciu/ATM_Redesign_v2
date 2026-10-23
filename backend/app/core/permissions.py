"""Roles, scope tags and permissions (docs/redesign/04-roles-and-permissions.md).

The matrix below is the single source of truth. Endpoints declare what they need with
``Depends(require("pr.review", project_from="project_id"))``; the frontend receives the same list from /api/me.
"""
from typing import Callable, Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.modules.identity.models import User, UserRole

SA = UserRole.SUPER_ADMIN
LEAD = UserRole.AUTOMATION_LEAD
SENIOR = UserRole.AUTOMATION_SENIOR
USER = UserRole.AUTOMATION_USER
TRAINEE = UserRole.AUTOMATION_TRAINEE
VIEWER = UserRole.VIEWER

ALL = frozenset({SA, LEAD, SENIOR, USER, TRAINEE, VIEWER})
BUILDERS = frozenset({SA, LEAD, SENIOR, USER, TRAINEE})  # everyone who changes things

# Permission -> roles that have it (section 4.3). Project scope is applied on top, see visible_project_ids().
PERMISSIONS: dict[str, frozenset[UserRole]] = {
    # Projects
    "project.view": ALL,
    "project.create": frozenset({SA, LEAD}),
    "project.delete": frozenset({SA, LEAD}),
    "project.configure": frozenset({SA, LEAD, SENIOR}),
    "project.members.manage": frozenset({SA, LEAD}),
    # Work items (Jira and Confluence)
    "work.view": ALL,
    "work.start": BUILDERS,
    "work.assign": frozenset({SA, LEAD, SENIOR}),
    "jira.write": frozenset({SA, LEAD, SENIOR, USER}),
    # Workspace and code
    "code.edit": BUILDERS,
    "code.push": BUILDERS,  # trainees: own branches only, see check_trainee_push()
    "pr.create": BUILDERS,
    "ai.use": BUILDERS,
    # Testing
    "run.view": ALL,
    "run.execute": BUILDERS,
    "run.execute.ci": frozenset({SA, LEAD, SENIOR, USER}),
    "suite.manage": frozenset({SA, LEAD, SENIOR, USER}),  # users: own suites only, see can_manage_suite()
    "environment.manage": frozenset({SA, LEAD, SENIOR}),
    "device.manage": BUILDERS,
    # Reporting
    "report.view": ALL,
    "report.publish": frozenset({SA, LEAD, SENIOR}),
    # Reviews
    "pr.view": ALL,
    "pr.comment": BUILDERS,
    "pr.review": frozenset({SA, LEAD, SENIOR}),
    # Deployments and notifications
    "deployment.view": ALL,
    "deployment.configure": frozenset({SA, LEAD}),
    # Learning
    "learning.use": ALL,
    "learning.mentor": frozenset({SA, LEAD, SENIOR}),
    "learning.manage": frozenset({SA, LEAD}),
    "readiness.decide": frozenset({SA, LEAD}),  # leads: own people only, see check_role_change()
    # Administration
    "user.view": frozenset({SA, LEAD, SENIOR}),
    "user.manage": frozenset({SA, LEAD}),  # leads: own people only, see check_role_change()
    "settings.system": frozenset({SA}),
    "audit.view": frozenset({SA, LEAD}),
}

TAGGED_ROLES = frozenset({SENIOR, USER, TRAINEE})  # exactly one scope tag each
SCOPE_TAGS = ("project_base", "shared")
# Roles that configure team-wide connection settings (Jira/Confluence base URL); the others inherit their lead's.
LEAD_ROLES = frozenset({SA, LEAD})
# The highest role a lead may give (only a super admin creates leads and super admins).
LEAD_ASSIGNABLE_ROLES = frozenset({SENIOR, USER, TRAINEE, VIEWER})


class PermissionDenied(Exception):
    """403 with the API's error shape: {"detail": "...", "code": "permission_denied"} (handler in app.main)."""

    def __init__(self, detail: str = "You do not have permission to do this."):
        super().__init__(detail)
        self.detail = detail


def permission_denied(detail: str = "You do not have permission to do this.") -> PermissionDenied:
    return PermissionDenied(detail)


def has_permission(user: User, permission: str) -> bool:
    if permission not in PERMISSIONS:
        raise KeyError(f"Unknown permission '{permission}'")
    return user.role in PERMISSIONS[permission]


def permissions_for(user: User) -> list[str]:
    return sorted(name for name, roles in PERMISSIONS.items() if user.role in roles)


def visible_project_ids(db: Session, user: User) -> Optional[set[int]]:
    """Ids of the projects the user may see, or None when the user sees every project (section 4.2)."""
    from app.modules.projects.models import Project, ProjectMember

    if user.role == SA or (user.role in TAGGED_ROLES and user.scope_tag == "shared"):
        return None
    member_of = {pid for (pid,) in db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user.id)}
    if user.role != LEAD:
        return member_of
    led_ids: list[int] = list(db.scalars(select(Project.id).where(Project.lead_user_id == user.id)))
    led = set(led_ids)
    people = [uid for (uid,) in db.query(User.id).filter(User.assigned_lead_id == user.id)]
    of_people = (
        {pid for (pid,) in db.query(ProjectMember.project_id).filter(ProjectMember.user_id.in_(people))}
        if people else set()
    )
    return member_of | led | of_people


def can_see_project(db: Session, user: User, project_id: int) -> bool:
    visible = visible_project_ids(db, user)
    return visible is None or int(project_id) in visible


def ensure(db: Session, user: User, permission: str, project_id: Optional[int] = None) -> None:
    """403 unless the user has `permission` (and, for a project, can see it). For checks inside handlers."""
    if not has_permission(user, permission):
        raise permission_denied()
    if project_id is not None and not can_see_project(db, user, project_id):
        raise permission_denied("This project is not in your scope.")


def _project_of_run(db: Session, run_id) -> Optional[int]:
    from app.modules.projects.models import AnalyticsRun, AnalyticsSuite

    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == run_id).first()
    if not run:
        return None
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first()
    return int(suite.project_id) if suite else None


def require(permission: str, project_from: Optional[str] = None) -> Callable[..., User]:
    """Dependency: the current user, after checking `permission` (and the project's scope).

    ``project_from`` names the path parameter that identifies the project: ``project_id``, or ``run_id`` for
    endpoints addressed by run (its suite's project is checked).
    """
    if permission not in PERMISSIONS:
        raise KeyError(f"Unknown permission '{permission}'")

    def _check(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        project_id = None
        if project_from:
            raw = request.path_params.get(project_from)
            if raw is not None:
                project_id = _project_of_run(db, raw) if project_from == "run_id" else raw
        try:
            ensure(db, current_user, permission, int(project_id) if project_id is not None else None)
        except ValueError:
            raise HTTPException(status_code=404, detail="Project not found")
        return current_user

    _check.permission = permission  # type: ignore[attr-defined]  # lets tests list what every endpoint requires
    _check.project_from = project_from  # type: ignore[attr-defined]
    return _check


def can_manage_suite(user: User, suite) -> bool:
    """Footnote 2: users manage only the suites they created."""
    if not has_permission(user, "suite.manage"):
        return False
    return user.role != USER or suite.created_by_user_id == user.id


def check_role_change(actor: User, target: Optional[User], new_role: Optional[UserRole]) -> None:
    """Footnote 3: leads manage only their own people, and only up to automation_senior."""
    if actor.role == SA:
        return
    if actor.role != LEAD:
        raise permission_denied()
    if target is not None and target.assigned_lead_id != actor.id:
        raise permission_denied("Leads manage only the people assigned to them.")
    if target is not None and target.role not in LEAD_ASSIGNABLE_ROLES:
        raise permission_denied("Only a super admin can change leads and super admins.")
    if new_role is not None and new_role not in LEAD_ASSIGNABLE_ROLES:
        raise permission_denied("Leads can give roles up to Automation Senior.")


def check_trainee_push(db: Session, user: User, project_id: int, branch: str, default_branch: str = "main") -> None:
    """Footnote 1: trainees push only branches they started in ATM, never the default branch."""
    if user.role != TRAINEE:
        return
    from app.modules.projects.models import BranchOwner

    if branch == default_branch:
        raise permission_denied(f"Trainees cannot push to {default_branch}. Open a pull request from your own branch.")
    owner = db.query(BranchOwner).filter(BranchOwner.project_id == project_id, BranchOwner.branch == branch).first()
    if owner is None or owner.user_id != user.id:
        raise permission_denied("Trainees push only branches they started in ATM.")
