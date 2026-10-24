"""Learning (phase 13): progress, profile and tutor mode, practice tasks and their review, mentor view, hints."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.learning import service
from app.modules.notifications.models import Notification
from app.modules.projects.models import Project, ProjectMember
from app.services import ai_provider_service


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _user(role: str, lead_id=None, project_id=None) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="project_base" if role in (
                        "automation_senior", "automation_user", "automation_trainee") else None,
                    is_active=True, full_name=f"E2E {name}", assigned_lead_id=lead_id)
        db.add(user)
        db.flush()
        if project_id:
            db.add(ProjectMember(project_id=project_id, user_id=user.id))
        db.commit()
        return {"id": user.id, "name": user.full_name,
                "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


@pytest.fixture
def team(client):
    with SessionLocal() as db:
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name="Sandbox", community_id="general",
                          organization_id=1)
        db.add(project)
        db.commit()
        project_id = project.id
    lead = _user("automation_lead")
    return {"lead": lead, "project_id": project_id,
            "trainee": _user("automation_trainee", lead["id"], project_id),
            "senior": _user("automation_senior", project_id=project_id),
            "viewer": _user("viewer", project_id=project_id)}


def _notes(user_id: int, kind: str) -> list[Notification]:
    with SessionLocal() as db:
        return db.query(Notification).filter_by(user_id=user_id, kind=kind).all()


def test_lessons_and_quizzes_are_saved(client, team):
    trainee = team["trainee"]["headers"]
    done = client.put("/api/learning/me/lessons/bruno-m1-l1", headers=trainee).json()
    assert "bruno-m1-l1" in done["progress"]["lessons"]
    assert client.put("/api/learning/me/lessons/Not An Id", headers=trainee).status_code == 400

    failed = client.post("/api/learning/me/quizzes/bruno-m1", headers=trainee, json={"score": 5, "total": 10}).json()
    assert failed["passed"] is False and failed["progress"]["quizzes"]["bruno-m1"]["passed"] is False
    client.post("/api/learning/me/quizzes/bruno-m1", headers=trainee, json={"score": 8, "total": 10})
    lower = client.post("/api/learning/me/quizzes/bruno-m1", headers=trainee, json={"score": 6, "total": 10}).json()
    quiz = lower["progress"]["quizzes"]["bruno-m1"]
    assert (quiz["best_score"], quiz["attempts"], quiz["passed"]) == (8, 3, True)  # passing stays, best is kept
    assert client.post("/api/learning/me/quizzes/bruno-m1", headers=trainee,
                       json={"score": 11, "total": 10}).status_code == 400

    reopened = client.delete("/api/learning/me/lessons/bruno-m1-l1", headers=trainee).json()
    assert reopened["progress"]["lessons"] == {}


def test_profile_and_tutor_mode(client, team):
    trainee, senior = team["trainee"]["headers"], team["senior"]["headers"]
    assert client.get("/api/learning/me", headers=trainee).json()["profile"] == {"path_id": None, "tutor_mode": True}
    assert client.get("/api/learning/me", headers=senior).json()["profile"]["tutor_mode"] is False
    saved = client.put("/api/learning/me/profile", headers=trainee,
                       json={"path_id": "api-bruno", "tutor_mode": False}).json()
    assert saved["profile"] == {"path_id": "api-bruno", "tutor_mode": False}
    with SessionLocal() as db:
        assert service.tutor_mode(db, db.query(User).filter(User.id == team["trainee"]["id"]).one()) is False


def test_practice_is_handed_in_and_reviewed(client, team):
    lead, trainee, senior, viewer = (team[k]["headers"] for k in ("lead", "trainee", "senior", "viewer"))
    task = {"title": "Assert the login message", "description": "Add an assertion to tests/test_login_error.py.",
            "path_id": "api-bruno", "project_id": team["project_id"]}
    assert client.post("/api/learning/practice", headers=senior, json=task).status_code == 403  # learning.manage
    created = client.post("/api/learning/practice", headers=lead, json=task)
    assert created.status_code == 201
    task_id = created.json()["id"]
    assert created.json()["project"]["name"] == "Sandbox"

    url = f"/api/learning/practice/{task_id}/submit"
    assert client.post(url, headers=trainee, json={}).status_code == 400  # where is the work?
    assert client.post(url, headers=viewer, json={"branch": "practice/x"}).status_code == 403
    handed = client.post(url, headers=trainee, json={"branch": "practice/login", "note": "First try"}).json()
    assert handed["my_submission"]["status"] == "submitted"
    assert _notes(team["lead"]["id"], "review_request")[0].link == "/learning/mentor"

    mentor = client.get("/api/learning/mentor", headers=lead).json()
    person = next(p for p in mentor["people"] if p["id"] == team["trainee"]["id"])
    assert person["practice"] == {"submitted": 1, "approved": 0, "changes_requested": 0}
    waiting = next(w for w in mentor["waiting"] if w["learner_id"] == team["trainee"]["id"])
    assert waiting["task"] == "Assert the login message" and waiting["branch"] == "practice/login"

    review = f"/api/learning/practice/submissions/{waiting['id']}/review"
    assert client.post(review, headers=lead, json={"decision": "changes_requested"}).status_code == 400
    assert client.post(review, headers=_user("automation_lead")["headers"],
                       json={"decision": "approved"}).status_code == 404  # not their trainee
    asked = client.post(review, headers=lead, json={"decision": "changes_requested", "feedback": "Assert the text."})
    assert asked.json()["status"] == "changes_requested"
    client.post(url, headers=trainee, json={"branch": "practice/login", "note": "Fixed"})
    # A senior mentors the learners of the projects they see.
    approved = client.post(review, headers=senior, json={"decision": "approved", "feedback": "Well done"}).json()
    assert approved["status"] == "approved" and approved["reviewer"] == team["senior"]["name"]
    assert [n.title for n in _notes(team["trainee"]["id"], "practice")][-1].endswith(
        "approved your practice: Assert the login message")
    assert client.post(url, headers=trainee, json={"branch": "again"}).status_code == 400  # already approved
    tasks = client.get("/api/learning/practice", headers=trainee).json()
    assert next(t for t in tasks if t["id"] == task_id)["my_submission"]["status"] == "approved"


def test_hint_library(client, team):
    assert client.get("/api/learning/hints", headers=team["viewer"]["headers"]).status_code == 403  # no Learning
    hints = client.get("/api/learning/hints", headers=team["trainee"]["headers"]).json()
    assert {"no-assertion", "fixed-wait", "bruno-environments"} <= {h["id"] for h in hints}
    body = {"title": "Name tests after behaviour", "text": "Say what the test checks.", "topics": ["playwright"]}
    url = "/api/learning/hints/test-names"
    assert client.put(url, headers=team["trainee"]["headers"], json=body).status_code == 403
    saved = client.put(url, headers=team["lead"]["headers"], json=body).json()
    assert saved["topics"] == ["playwright"]
    assert client.put("/api/learning/hints/Bad Id", headers=team["lead"]["headers"], json=body).status_code == 400
    assert client.delete("/api/learning/hints/test-names", headers=team["lead"]["headers"]).status_code == 200


def test_ai_tutor(client, team, monkeypatch):
    trainee = team["trainee"]["headers"]
    assert client.put("/api/ai/settings", headers=trainee,
                      json={"provider": "github", "api_key": "k", "model": "openai/gpt-4.1"}).status_code == 200
    seen = {}

    async def fake_stream(config, system, messages, transport=None):
        seen.update(system=system, messages=messages)
        yield "An environment holds the variables of one system, "
        yield "such as its base URL."

    monkeypatch.setattr(ai_provider_service, "stream_chat", fake_stream)
    answer = client.post("/api/learning/tutor", headers=trainee, json={
        "lesson": "Environments", "context": "Step: create a UAT environment", "question": "What is an environment?",
        "history": [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello"}]}).json()
    assert answer["answer"] == "An environment holds the variables of one system, such as its base URL."
    assert "# Lesson: Environments" in seen["system"] and seen["messages"][-1]["content"] == "What is an environment?"
    assert client.post("/api/learning/tutor", headers=team["viewer"]["headers"],
                       json={"lesson": "x", "question": "y"}).status_code == 403  # viewers have no AI
