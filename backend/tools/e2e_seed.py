"""Seed a throwaway database for the UI tests (frontend/e2e).

Creates one user per role and a sample project. Writes the users' names and access tokens to a JSON file, so the
tests can open authenticated pages without going through the rate-limited login endpoint.

The lead leads the sample project; the senior is shared; the user and the trainee are project based, members of the
sample project and assigned to the lead; the viewer is a member of the sample project.

When the harness passes E2E_FAKE_URL, the sample project's Jira project and Confluence space are E2E, the lead, the
senior and the viewer have the fake Jira/Confluence base URLs (the others inherit the lead's); everyone but the super admin
has Jira and Confluence tokens. E2E_SENIOR_CHECKOUT_DIR is the senior's own checkout, for the Work tests, and
E2E_TRAINEE_CHECKOUT_DIR the trainee's (with a GitHub token), for the workspace tests.

When the harness passes E2E_REPO_URL and E2E_CHECKOUT_DIR, the sample project points at that repository (served by
the fake GitHub) and the super admin and automation user have the checkout linked and a GitHub token for it.

Usage (from backend/):
    ATM_DATABASE_PATH=/tmp/e2e.db E2E_PASSWORD=... python -m tools.e2e_seed <sessions.json>
"""
import json
import os
import sys

if not os.getenv("ATM_DATABASE_PATH"):
    sys.exit("ATM_DATABASE_PATH must point to a throwaway database; refusing to seed the real one.")

from app.core.db import SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.main import prepare_database  # noqa: E402
from app.modules.identity.models import User, UserRole  # noqa: E402
from app.modules.identity.service import get_default_organization  # noqa: E402
from app.modules.projects.checkouts import save_linked_path  # noqa: E402
from app.modules.projects.models import Project, ProjectMember  # noqa: E402
from app.modules.projects.service import set_project_github_token  # noqa: E402
from app.modules.settings.connections import set_secret  # noqa: E402

SAMPLE_PROJECT_KEY = "E2E"
SAMPLE_GITHUB_TOKEN = "e2e-github-token"
PUBLISHING_ROLES = {UserRole.SUPER_ADMIN, UserRole.AUTOMATION_USER}
SCOPE_TAGS = {
    UserRole.AUTOMATION_SENIOR: "shared",
    UserRole.AUTOMATION_USER: "project_base",
    UserRole.AUTOMATION_TRAINEE: "project_base",
}
MEMBER_ROLES = {UserRole.AUTOMATION_USER, UserRole.AUTOMATION_TRAINEE, UserRole.VIEWER}
LEAD_ASSIGNED_ROLES = {UserRole.AUTOMATION_USER, UserRole.AUTOMATION_TRAINEE}
# Base URLs come from the lead for the people assigned to one; the senior and the viewer have no lead.
CONNECTION_OWNERS = {UserRole.AUTOMATION_LEAD, UserRole.AUTOMATION_SENIOR, UserRole.VIEWER}


def seed(sessions_path: str) -> None:
    password = os.environ["E2E_PASSWORD"]
    prepare_database()
    db = SessionLocal()
    try:
        org = get_default_organization(db)
        sessions = {}
        for role in UserRole:
            username = f"e2e_{role.value}"
            user = db.query(User).filter(User.username == username).first()
            if not user:
                user = User(
                    username=username,
                    email=f"{username}@e2e.test",
                    hashed_password=User.hash_password(password),
                    full_name=f"E2E {role.value.replace('_', ' ').title()}",
                    role=role,
                    scope_tag=SCOPE_TAGS.get(role),
                    organization_id=org.id,
                    is_active=True,
                )
                db.add(user)
                db.commit()
                db.refresh(user)
            token = create_access_token(
                data={
                    "user_id": user.id,
                    "username": user.username,
                    "role": user.role.value,
                    "organization_id": user.organization_id,
                }
            )
            sessions[role.value] = {"username": username, "token": token}

        project = db.query(Project).filter(Project.key == SAMPLE_PROJECT_KEY).first()
        if not project:
            project = Project(
                key=SAMPLE_PROJECT_KEY,
                name="E2E Sample Project",
                description="Seeded for the UI tests",
                community_id="qa",
                organization_id=org.id,
            )
            db.add(project)
            db.commit()
            db.refresh(project)

        users = {user.role: user for user in db.query(User).filter(User.username.like("e2e_%")).all()}
        lead = users[UserRole.AUTOMATION_LEAD]
        project.lead_user_id = lead.id
        for role in LEAD_ASSIGNED_ROLES:
            users[role].assigned_lead_id = lead.id
        for role in MEMBER_ROLES:
            user_id = users[role].id
            if not db.query(ProjectMember).filter_by(project_id=project.id, user_id=user_id).first():
                db.add(ProjectMember(project_id=project.id, user_id=user_id))
        db.commit()

        fake_url = os.getenv("E2E_FAKE_URL")
        if fake_url:
            project.jira_project_key = "E2E"
            project.confluence_space_key = "E2E"
            project.confluence_parent_page_id = "900"
            for role, user in users.items():
                if role == UserRole.SUPER_ADMIN:
                    continue  # the phase 03 tests connect the super admin through the UI
                if role in CONNECTION_OWNERS:
                    user.settings_json = {
                        **(user.settings_json or {}),
                        "jira_mcp_base_url": f"{fake_url}/jira",
                        "confluence_mcp_base_url": f"{fake_url}/confluence",
                    }
                set_secret(user, "jira", f"e2e-jira-{role.value}")
                set_secret(user, "confluence", f"e2e-confluence-{role.value}")
            db.commit()

        senior_checkout = os.getenv("E2E_SENIOR_CHECKOUT_DIR")
        if senior_checkout:
            save_linked_path(db, users[UserRole.AUTOMATION_SENIOR], project.id, senior_checkout)
        trainee_checkout = os.getenv("E2E_TRAINEE_CHECKOUT_DIR")
        if trainee_checkout:
            trainee = users[UserRole.AUTOMATION_TRAINEE]
            save_linked_path(db, trainee, project.id, trainee_checkout)
            set_project_github_token(db, trainee, project.id, SAMPLE_GITHUB_TOKEN)

        repo_url, checkout = os.getenv("E2E_REPO_URL"), os.getenv("E2E_CHECKOUT_DIR")
        if repo_url and checkout:
            project.github_repo_url = repo_url
            db.commit()
            for user in db.query(User).filter(User.role.in_(PUBLISHING_ROLES)).all():
                save_linked_path(db, user, project.id, checkout)
                set_project_github_token(db, user, project.id, SAMPLE_GITHUB_TOKEN)
            # Pull requests are read with each person's own GitHub token: the senior reviews with their own account
            # (the fake answers its own login), the viewer reads with the shared one.
            set_project_github_token(db, users[UserRole.AUTOMATION_SENIOR], project.id, f"{SAMPLE_GITHUB_TOKEN}-senior")
            set_project_github_token(db, users[UserRole.VIEWER], project.id, SAMPLE_GITHUB_TOKEN)
    finally:
        db.close()

    with open(sessions_path, "w") as handle:
        json.dump(sessions, handle, indent=2)


if __name__ == "__main__":
    seed(sys.argv[1])
