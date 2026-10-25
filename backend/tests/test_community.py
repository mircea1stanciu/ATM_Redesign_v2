"""Community (phase 21): questions, answers, likes, moderation, and who may do what."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.notifications.models import Notification


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _user(role: str) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="shared" if role in (
                        "automation_senior", "automation_user", "automation_trainee") else None,
                    is_active=True, full_name=f"E2E {name}", organization_id=1)
        db.add(user)
        db.commit()
        return {"id": user.id, "name": user.full_name,
                "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def test_ask_answer_like_and_be_told(client):
    trainee, senior, viewer = _user("automation_trainee"), _user("automation_senior"), _user("viewer")
    title = f"How do I wait for a toast {uuid.uuid4().hex[:6]}?"
    assert client.post("/api/community/posts", headers=viewer["headers"], json={"title": title}).status_code == 403
    asked = client.post("/api/community/posts", headers=trainee["headers"],
                        json={"title": title, "body": "It disappears.", "tags": ["Playwright", "waits", "Playwright"]})
    assert asked.status_code == 201
    post = asked.json()
    assert post["tags"] == ["playwright", "waits"] and post["author"] == trainee["name"] and post["answers_list"] == []

    answered = client.post(f"/api/community/posts/{post['id']}/answers", headers=senior["headers"],
                           json={"body": "Assert it with toBeVisible() right after the click."}).json()
    answer = answered["answers_list"][0]
    assert answered["answers"] == 1 and answer["author"] == senior["name"] and answer["can_delete"] is True
    with SessionLocal() as db:
        note = db.query(Notification).filter_by(user_id=trainee["id"], kind="community").one()
        assert note.title == f"{senior['name']} answered your question: {title}"
        assert note.link == f"/community/{post['id']}"

    assert client.post(f"/api/community/answers/{answer['id']}/like", headers=trainee["headers"]).json() == \
        {"liked": True, "likes": 1}
    assert client.post(f"/api/community/posts/{post['id']}/like", headers=senior["headers"]).json() == \
        {"liked": True, "likes": 1}
    assert client.post(f"/api/community/posts/{post['id']}/like", headers=senior["headers"]).json() == \
        {"liked": False, "likes": 0}

    listed = client.get("/api/community/posts", headers=senior["headers"], params={"q": "wait for a toast"}).json()
    item = next(i for i in listed["items"] if i["id"] == post["id"])
    assert (item["answers"], item["can_edit"]) == (1, False) and "playwright" in listed["tags"]
    tagged = client.get("/api/community/posts", headers=senior["headers"], params={"tag": "waits"}).json()
    assert post["id"] in [i["id"] for i in tagged["items"]]

    # Only the author (or a lead) edits or removes; a removed answer disappears.
    assert client.delete(f"/api/community/answers/{answer['id']}", headers=trainee["headers"]).status_code == 403
    assert client.put(f"/api/community/posts/{post['id']}", headers=senior["headers"],
                      json={"title": title}).status_code == 403
    assert client.delete(f"/api/community/answers/{answer['id']}", headers=senior["headers"]).status_code == 200
    assert client.get(f"/api/community/posts/{post['id']}", headers=trainee["headers"]).json()["answers_list"] == []


def test_leads_pin_lock_and_remove(client):
    user, lead = _user("automation_user"), _user("automation_lead")
    post = client.post("/api/community/posts", headers=user["headers"], json={"title": "Where are the CI logs?"}).json()
    url = f"/api/community/posts/{post['id']}"
    assert client.post(f"{url}/moderate", headers=user["headers"], json={"pinned": True}).status_code == 403
    moderated = client.post(f"{url}/moderate", headers=lead["headers"], json={"pinned": True, "locked": True}).json()
    assert moderated["pinned"] and moderated["locked"]
    assert client.get("/api/community/posts", headers=user["headers"]).json()["items"][0]["id"] == post["id"]
    locked = client.post(f"{url}/answers", headers=user["headers"], json={"body": "Still there?"})
    assert locked.status_code == 400
    assert client.delete(url, headers=lead["headers"]).json() == {"deleted": post["id"]}
    assert client.get(url, headers=user["headers"]).status_code == 404
