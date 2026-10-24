"""Access after the decisions review (phase 15): the role hierarchy in people lists, leads taking people on, and
what viewers see."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.audit.models import AuditEntry
from app.modules.identity.models import User, UserRole


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _user(role: str, lead_id=None) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="project_base" if role in (
                        "automation_senior", "automation_user", "automation_trainee") else None,
                    is_active=True, full_name=f"E2E {name}", assigned_lead_id=lead_id)
        db.add(user)
        db.commit()
        return {"id": user.id, "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def test_people_lists_follow_the_hierarchy(client):
    admin, lead, other_lead = _user("super_admin"), _user("automation_lead"), _user("automation_lead")
    senior, viewer = _user("automation_senior", lead["id"]), _user("viewer")
    seen = {int(u["id"]) for u in client.get("/api/users", headers=lead["headers"]).json()}
    assert {lead["id"], senior["id"], viewer["id"]} <= seen
    assert admin["id"] not in seen and other_lead["id"] not in seen  # nobody above, no peers
    everyone = {int(u["id"]) for u in client.get("/api/users", headers=admin["headers"]).json()}
    assert {admin["id"], lead["id"], other_lead["id"]} <= everyone
    assert client.get("/api/users", headers=senior["headers"]).status_code == 403  # Admin is for leads and up


def test_leads_take_on_people_without_a_lead(client):
    admin, lead, other_lead = _user("super_admin"), _user("automation_lead"), _user("automation_lead")
    newcomer, taken = _user("viewer"), _user("automation_user", other_lead["id"])
    claimed = client.post(f"/api/users/{newcomer['id']}/claim", headers=lead["headers"])
    assert claimed.status_code == 200, claimed.text
    assert str(claimed.json()["assigned_lead_id"]) == str(lead["id"])
    assert client.post(f"/api/users/{newcomer['id']}/claim", headers=lead["headers"]).status_code == 400
    assert client.post(f"/api/users/{taken['id']}/claim", headers=lead["headers"]).status_code == 400
    assert client.post(f"/api/users/{other_lead['id']}/claim", headers=lead["headers"]).status_code == 404
    assert client.post(f"/api/users/{newcomer['id']}/claim", headers=admin["headers"]).status_code == 400
    with SessionLocal() as db:
        assert db.query(AuditEntry).filter_by(action="user.claim", subject_user_id=newcomer["id"]).count() == 1


def test_viewers_have_no_work_or_learning(client):
    viewer = _user("viewer")
    permissions = client.get("/api/me", headers=viewer["headers"]).json()["permissions"]
    assert "work.view" not in permissions and "learning.use" not in permissions
    assert {"run.view", "report.view", "pr.view", "deployment.view"} <= set(permissions)
