"""The audit log since phase 22: sign-ins and failed attempts, settings changes and deletions (never secret values)."""
import json
import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.rate_limit import limiter
from app.core.security import create_access_token
from app.main import app
from app.modules.audit.models import AuditEntry
from app.modules.deployments.models import Service
from app.modules.identity.models import User, UserRole
from app.modules.learning.progress_models import Hint
from app.modules.projects.models import AnalyticsSuite, Project, ProjectMember


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _user(role: str, lead_id=None) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="shared" if role in (
                        "automation_senior", "automation_user", "automation_trainee") else None,
                    is_active=True, full_name=f"E2E {name}", organization_id=1, assigned_lead_id=lead_id)
        db.add(user)
        db.commit()
        return {"id": user.id, "username": name, "name": user.full_name,
                "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def _entries(**filters) -> list[AuditEntry]:
    with SessionLocal() as db:
        return db.query(AuditEntry).filter_by(**filters).order_by(AuditEntry.id).all()


def test_sign_ins_and_failed_attempts_are_recorded(client):
    limiter.reset()  # the login endpoint allows five attempts a minute per address
    lead = _user("automation_lead")
    trainee = _user("automation_trainee", lead["id"])
    login = "/api/auth/login"
    assert client.post(login, json={"username": trainee["username"], "password": "nope"}).status_code == 401
    assert client.post(login, json={"username": "ghost-account", "password": "x"}).status_code == 401
    assert client.post(login, json={"username": trainee["username"], "password": "pw-123456"}).status_code == 200

    failed = _entries(action="sign_in.failed", subject_user_id=trainee["id"])[-1]
    assert failed.actor_id is None and failed.details["username"] == trainee["username"]
    assert failed.details["reason"] == "Wrong user name or password" and "nope" not in json.dumps(failed.details)
    ghost = [e for e in _entries(action="sign_in.failed") if e.details.get("username") == "ghost-account"][-1]
    assert ghost.subject_user_id is None
    signed_in = _entries(action="sign_in", actor_id=trainee["id"])[-1]
    assert signed_in.summary == f"{trainee['name']} signed in"

    # The lead sees their trainee's sign-ins; failed attempts of unknown names only Super Admins see.
    seen = client.get("/api/audit", headers=lead["headers"]).json()
    assert {"sign_in", "sign_in.failed"} <= set(seen["actions"])
    assert not any("ghost-account" in item["summary"] for item in seen["items"])
    admin = client.get("/api/audit?action=sign_in.failed", headers=_user("super_admin")["headers"]).json()
    assert any("ghost-account" in item["summary"] for item in admin["items"])


def test_settings_changes_are_recorded_without_their_values(client):
    lead = _user("automation_lead")
    with SessionLocal() as db:
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name="Audited", community_id="general",
                          organization_id=1, lead_user_id=lead["id"])
        db.add(project)
        db.commit()
        project_id = project.id
    assert client.patch(f"/api/projects/{project_id}", headers=lead["headers"],
                        json={"jira_project_key": "aud"}).status_code == 200
    change = _entries(action="settings.project", project_id=project_id)[-1]
    assert change.details == {"fields": ["jira_project_key"]} and change.actor_id == lead["id"]

    assert client.patch("/api/settings/github", headers=lead["headers"],
                        json={"github_token": "ghp_secret_value"}).status_code == 200
    connection = _entries(action="settings.connection", actor_id=lead["id"])[-1]
    assert connection.details == {"fields": ["github_token"], "kind": "GitHub"}
    assert "ghp_secret_value" not in json.dumps(connection.details) + connection.summary

    ai_settings = {"provider": "github", "api_key": "ai-secret-key", "model": "openai/gpt-4.1"}
    assert client.put("/api/ai/settings", headers=lead["headers"], json=ai_settings).status_code == 200
    ai = _entries(action="settings.ai", actor_id=lead["id"])[-1]
    assert ai.details["provider"] == "github" and "ai-secret-key" not in json.dumps(ai.details)
    client.delete("/api/ai/settings", headers=lead["headers"])
    assert _entries(action="settings.ai", actor_id=lead["id"])[-1].details == {"fields": ["removed"]}


def test_deletions_are_recorded(client):
    admin, lead = _user("super_admin"), _user("automation_lead")
    trainee = _user("automation_trainee", lead["id"])
    with SessionLocal() as db:
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name="Doomed", community_id="general",
                          organization_id=1, lead_user_id=lead["id"])
        db.add(project)
        db.flush()
        db.add(ProjectMember(project_id=project.id, user_id=trainee["id"]))
        suite = AnalyticsSuite(project_id=project.id, name="Old smoke", tags=[], active=True,
                               archived_at=datetime.utcnow())
        service = Service(name=f"cart-{uuid.uuid4().hex[:4]}", kind="backend", webhook_secret="x",
                          created_by_id=lead["id"])
        hint = Hint(id=f"old-hint-{uuid.uuid4().hex[:4]}", title="Old", text="Old hint", details="", topics=[])
        db.add_all([suite, service, hint])
        db.commit()
        project_id, suite_id, service_id, hint_id = project.id, suite.id, service.id, hint.id
    assert client.delete(f"/api/suites/{suite_id}", headers=lead["headers"]).status_code == 200
    assert client.delete(f"/api/learning/hints/{hint_id}", headers=lead["headers"]).status_code == 200
    assert client.delete(f"/api/deployments/services/{service_id}", headers=admin["headers"]).status_code == 200
    assert client.delete(f"/api/users/{trainee['id']}", headers=lead["headers"]).status_code == 200
    assert client.delete(f"/api/projects/{project_id}", headers=admin["headers"]).status_code == 200

    assert _entries(action="suite.delete", actor_id=lead["id"])[-1].details["suite"] == "Old smoke"
    assert _entries(action="hint.delete", actor_id=lead["id"])[-1].details == {"hint_id": hint_id}
    assert _entries(action="service.delete", actor_id=admin["id"])[-1].details["service_id"] == service_id
    deleted_user = _entries(action="user.delete", actor_id=lead["id"])[-1]
    assert deleted_user.details["username"] == trainee["username"] and trainee["name"] in deleted_user.summary
    deleted_project = _entries(action="project.delete", actor_id=admin["id"])[-1]
    assert deleted_project.details["project"] == "Doomed" and deleted_project.project_id is None
