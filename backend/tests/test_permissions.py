"""Roles, scope tags and permissions (docs/redesign/04-roles-and-permissions.md)."""
import json
import uuid

import pytest
import sqlalchemy as sa
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from alembic import command
from app.core.db import SessionLocal
from app.core.migrations import _alembic_config
from app.core.permissions import (
    PERMISSIONS,
    PermissionDenied,
    check_role_change,
    check_trainee_push,
    visible_project_ids,
)
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.projects.models import BranchOwner, Project, ProjectMember

ROLES = ["super_admin", "automation_lead", "automation_senior", "automation_user", "automation_trainee", "viewer"]

# Section 4.3, column by column: Super Admin, Lead, Senior, User, Trainee, Viewer.
PLAN = {
    "project.view": "111111", "project.create": "110000", "project.delete": "110000",
    "project.configure": "111000", "project.members.manage": "110000",
    "project.service_account": "110000",
    "work.view": "111110", "work.start": "111110", "work.assign": "111000", "jira.write": "111100",
    "code.edit": "111110", "code.push": "111110", "pr.create": "111110", "ai.use": "111110",
    "run.view": "111111", "run.execute": "111110", "run.execute.ci": "111100", "suite.manage": "111100",
    "suite.delete": "110000", "environment.manage": "111000", "device.manage": "111110",
    "report.view": "111111", "report.publish": "111000", "report.manage": "110000",
    "pr.view": "111111", "pr.comment": "111110", "pr.review": "111000",
    "deployment.view": "111111", "deployment.configure": "110000",
    "learning.use": "111110", "learning.mentor": "111000", "learning.manage": "110000",
    "readiness.decide": "110000",
    "user.view": "110000", "user.manage": "110000", "settings.system": "100000", "audit.view": "110000",
}

# Endpoints any signed-in user may call: their own profile, password, 2FA and personal connection settings.
PERSONAL = {
    "/api/me", "/api/auth/me", "/api/auth/logout", "/api/auth/change-password", "/api/auth/profile",
    "/api/auth/profile/picture", "/api/auth/2fa/setup", "/api/auth/2fa/enable", "/api/auth/2fa/disable",
    "/api/auth/2fa/status", "/api/auth/delete-account", "/api/settings", "/api/settings/github",
    "/api/settings/github/test", "/api/settings/jira", "/api/settings/jira/test", "/api/settings/jira/projects",
    "/api/tasks/team-settings", "/api/zephyr-planner/session-cookie", "/api/ide/available",
    "/api/settings/requirements-filters", "/api/settings/confluence", "/api/settings/confluence/test",
    "/api/settings/confluence/spaces",
}
PERSONAL_PREFIXES = ("/api/settings/security", "/api/settings/preferences", "/api/notifications")
# Authorised by a signature: a signed, expiring token in the URL (made by POST /api/runs/{id}/report-link after
# report.view), the HMAC of a deployment event with the service's secret, or a report share link's random token.
SIGNED = {"/api/reports/view/{token}/{path:path}", "/api/deployments/webhook",
          "/api/reports/shared/{token}/{path:path}"}
PUBLIC = {"/api/auth/login", "/api/auth/login/verify-2fa", "/api/auth/register", "/api/health"}


def test_matrix_matches_the_plan():
    assert set(PERMISSIONS) == set(PLAN)
    for permission, flags in PLAN.items():
        expected = {role for role, flag in zip(ROLES, flags) if flag == "1"}
        assert {r.value for r in PERMISSIONS[permission]} == expected, permission


def _required_permission(route: APIRoute):
    for dependency in route.dependant.dependencies:
        permission = getattr(dependency.call, "permission", None)
        if permission:
            return permission
    return None


def api_routes(routes, prefix: str = ""):
    """Every APIRoute with its full path. FastAPI 0.16x keeps included routers as wrappers (`include_context`), so
    `app.routes` alone lists only the top level."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route
        context = getattr(route, "include_context", None)
        if context is not None:
            yield from api_routes(context.included_router.routes, prefix + (context.prefix or ""))


def test_the_route_walk_sees_the_modules():
    paths = {path for path, _ in api_routes(app.routes)}
    assert len(paths) > 150
    assert {"/api/me", "/api/users", "/api/projects/{project_id}/work/items", "/api/suites/{suite_id}/runs"} <= paths


def test_every_endpoint_declares_a_permission():
    unguarded = []
    for path, route in api_routes(app.routes):
        if not path.startswith("/api"):
            continue
        if path in PUBLIC or path in PERSONAL or path in SIGNED or path.startswith(PERSONAL_PREFIXES):
            continue
        if _required_permission(route) is None:
            unguarded.append(f"{sorted(route.methods)} {path}")
    assert unguarded == []


# ── HTTP: each role against representative endpoints ────────────────────────


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _make_user(role: str, tag=None, lead_id=None) -> User:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag=tag, assigned_lead_id=lead_id, is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user


def _headers(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}


def _project(lead_id=None, members=()) -> int:
    with SessionLocal() as db:
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name="Scoped", community_id="general",
                          organization_id=1, lead_user_id=lead_id)
        db.add(project)
        db.flush()
        for user_id in members:
            db.add(ProjectMember(project_id=project.id, user_id=user_id))
        db.commit()
        return project.id


def _tag(role):
    return "shared" if role in ("automation_senior", "automation_user", "automation_trainee") else None


@pytest.mark.parametrize("role", ROLES)
def test_each_role_against_representative_endpoints(client, role):
    user = _make_user(role, _tag(role))
    headers = _headers(user)
    project_id = _project(members=[user.id])
    checks = [  # (method, path, json, permission)
        ("get", "/api/users", None, "user.view"),
        ("post", "/api/projects/", {"name": ""}, "project.create"),
        ("patch", f"/api/projects/{project_id}", {}, "project.configure"),
        ("put", f"/api/projects/{project_id}/local/file", {"path": "x.txt", "content": ""}, "code.edit"),
        ("post", f"/api/projects/{project_id}/local/commit", {"message": "m"}, "code.push"),
        ("post", f"/api/projects/{project_id}/github/pull-request", {"head": "a", "title": "t"}, "pr.create"),
        ("post", f"/api/projects/{project_id}/github/workflows/dispatch", {"workflow_id": "x"}, "run.execute.ci"),
        ("post", f"/api/suites/projects/{project_id}/suites", {"name": ""}, "suite.manage"),
        ("patch", "/api/settings/zephyr", {}, "settings.system"),
        ("put", "/api/learning/hints/x", {}, "learning.manage"),
        ("get", "/api/learning/mentor", None, "learning.mentor"),
        ("get", f"/api/runs/projects/{project_id}", None, "run.view"),
    ]
    for method, path, body, permission in checks:
        response = getattr(client, method)(path, headers=headers, **({"json": body} if body is not None else {}))
        allowed = role in {r.value for r in PERMISSIONS[permission]}
        if allowed:
            assert response.status_code != 403, (role, path, response.text)
        else:
            assert response.status_code == 403, (role, path, response.status_code)
            assert response.json()["code"] == "permission_denied"


def test_me_lists_permissions_and_projects(client):
    user = _make_user("automation_trainee", "project_base")
    project_id = _project(members=[user.id])
    me = client.get("/api/me", headers=_headers(user)).json()
    assert me["role"] == "automation_trainee" and me["scope_tag"] == "project_base"
    assert "code.push" in me["permissions"] and "pr.review" not in me["permissions"]
    assert me["project_ids"] == [str(project_id)] and me["all_projects"] is False


# ── Project scope ────────────────────────────────────────────────────────────


def test_project_scope_follows_tag_membership_and_lead():
    lead = _make_user("automation_lead")
    member = _make_user("automation_user", "project_base", lead_id=lead.id)
    shared = _make_user("automation_senior", "shared")
    viewer = _make_user("viewer")
    mine = _project(members=[member.id])
    led = _project(lead_id=lead.id)
    other = _project()
    with SessionLocal() as db:
        assert visible_project_ids(db, member) == {mine}
        assert visible_project_ids(db, shared) is None  # every project
        assert visible_project_ids(db, viewer) == set()
        assert {mine, led} <= visible_project_ids(db, lead) and other not in visible_project_ids(db, lead)


def test_out_of_scope_project_is_forbidden(client):
    user = _make_user("automation_user", "project_base")
    mine = _project(members=[user.id])
    other = _project()
    listed = [p["id"] for p in client.get("/api/projects/", headers=_headers(user)).json()]
    assert str(mine) in listed and str(other) not in listed
    response = client.get(f"/api/projects/{other}", headers=_headers(user))
    assert response.status_code == 403 and response.json()["code"] == "permission_denied"


# ── Footnotes: leads' own people, trainees' own branches ─────────────────────


def test_leads_change_roles_only_for_their_people_and_up_to_senior(client):
    lead = _make_user("automation_lead")
    mine = _make_user("automation_user", "project_base", lead_id=lead.id)
    not_mine = _make_user("automation_user", "project_base")
    headers = _headers(lead)

    promoted = client.patch(f"/api/users/{mine.id}", headers=headers, json={"role": "automation_senior"})
    assert promoted.status_code == 200 and promoted.json()["role"] == "automation_senior"
    assert promoted.json()["scope_tag"] == "project_base"
    assert client.patch(f"/api/users/{mine.id}", headers=headers,
                        json={"role": "automation_lead"}).status_code == 403
    assert client.patch(f"/api/users/{not_mine.id}", headers=headers,
                        json={"role": "automation_senior"}).status_code == 403
    admin = _make_user("super_admin")
    assert client.patch(f"/api/users/{not_mine.id}", headers=_headers(admin),
                        json={"role": "automation_lead"}).status_code == 200


def test_role_change_rules():
    lead = _make_user("automation_lead")
    with pytest.raises(PermissionDenied):
        check_role_change(lead, None, UserRole.SUPER_ADMIN)
    check_role_change(lead, None, UserRole.AUTOMATION_TRAINEE)


def test_trainees_push_only_their_own_branches():
    trainee = _make_user("automation_trainee", "project_base")
    other = _make_user("automation_user", "project_base")
    project_id = _project(members=[trainee.id, other.id])
    with SessionLocal() as db:
        db.add_all([BranchOwner(project_id=project_id, branch="feature/mine", user_id=trainee.id),
                    BranchOwner(project_id=project_id, branch="feature/theirs", user_id=other.id)])
        db.commit()
        check_trainee_push(db, trainee, project_id, "feature/mine")
        for branch in ("main", "feature/theirs", "feature/unknown"):
            with pytest.raises(PermissionDenied):
                check_trainee_push(db, trainee, project_id, branch)
        check_trainee_push(db, other, project_id, "main")  # the rule is for trainees only


# ── Migration of existing users (section 4.5) ────────────────────────────────


def test_existing_users_are_migrated_and_logged(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'roles.db'}")
    config = _alembic_config()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0003_user_connections")
    old_roles = ["SUPER_ADMIN", "ADMIN", "ORG_ADMIN", "AUTOMATION_LEAD", "COMMUNITY_LEAD", "AUTOMATION_USER",
                 "USER", "VIEWER"]
    with engine.begin() as connection:
        connection.execute(sa.text("insert into projects (id, key, name, community_id, organization_id)"
                                   " values (1, 'A', 'A', 'qa', 1)"))
        for i, role in enumerate(old_roles, start=1):
            connection.execute(sa.text("insert into users (id, username, email, hashed_password, role, settings_json)"
                                       " values (:id, :u, :e, 'x', :r, :s)"),
                               {"id": i, "u": f"u{i}", "e": f"u{i}@x.test", "r": role, "s": json.dumps({})})
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0011_readiness_audit")

    with engine.connect() as connection:
        users = dict(connection.execute(sa.text("select id, role || '/' || coalesce(scope_tag, '-') from users")).all())
        logged = connection.execute(sa.text("select count(*) from role_migration_log")).scalar()
        members = {uid for (uid,) in connection.execute(sa.text("select user_id from project_members"))}
    assert [users[i] for i in range(1, 9)] == [
        "SUPER_ADMIN/-", "AUTOMATION_LEAD/-", "AUTOMATION_LEAD/-", "AUTOMATION_LEAD/-", "AUTOMATION_SENIOR/shared",
        "AUTOMATION_USER/project_base", "AUTOMATION_USER/project_base", "VIEWER/-",
    ]
    assert logged == 8
    assert members == {6, 7, 8}  # until phase 15, project_base users and viewers kept seeing today's projects
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    with engine.connect() as connection:
        # Phase 15: those automatic memberships are gone; leads assign projects.
        assert connection.execute(sa.text("select count(*) from project_members")).scalar() == 0
