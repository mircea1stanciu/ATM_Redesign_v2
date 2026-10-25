"""Readiness and promotion, and the audit log (phase 14)."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.audit.models import AuditEntry
from app.modules.identity.models import User, UserRole
from app.modules.learning.progress_models import LearningProfile, LearningProgress, PracticeSubmission, PracticeTask
from app.modules.notifications.models import Notification
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ProjectMember
from app.modules.reviews.models import PullRequest, PullRequestReview
from app.modules.work.models import WorkItem


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
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name="Shop", community_id="general",
                          organization_id=1)
        db.add(project)
        db.commit()
        project_id = project.id
    lead = _user("automation_lead")
    trainee = _user("automation_trainee", lead["id"], project_id)
    senior = _user("automation_senior", project_id=project_id)
    with SessionLocal() as db:  # the lead made the senior the trainee's mentor (phase 21)
        db.add(LearningProfile(user_id=trainee["id"], mentor_id=senior["id"]))
        db.commit()
    return {"lead": lead, "project_id": project_id, "trainee": trainee, "senior": senior}


def _evidence_for(person_id: int, project_id: int, senior_id: int) -> None:
    with SessionLocal() as db:
        db.add_all([LearningProgress(user_id=person_id, kind="lesson", item_id="bruno-m1-l1", passed=True, attempts=1),
                    LearningProgress(user_id=person_id, kind="quiz", item_id="bruno-m1", passed=True, attempts=2,
                                     best_score=9, total=10)])
        task = PracticeTask(title="Assert", description="Add an assertion")
        db.add(task)
        db.flush()
        db.add(PracticeSubmission(task_id=task.id, user_id=person_id, branch="practice/x", status="approved"))
        db.add(WorkItem(project_id=project_id, source="jira", external_key="SHOP-1", title="Login", status="done",
                        assignee_id=person_id))
        db.add(PullRequest(project_id=project_id, number=3, title="Login test", head="feature/SHOP-1", base="main",
                           author_id=person_id))
        db.add(PullRequestReview(project_id=project_id, number=3, reviewer_id=senior_id, event="APPROVE"))
        suite = AnalyticsSuite(project_id=project_id, name="Smoke", tags=[], active=True)
        db.add(suite)
        db.flush()
        db.add_all([AnalyticsRun(suite_id=suite.id, status="passed", started_by_id=person_id),
                    AnalyticsRun(suite_id=suite.id, status="failed", started_by_id=person_id)])
        db.commit()


def test_the_evidence_a_lead_sees(client, team):
    trainee = team["trainee"]
    _evidence_for(trainee["id"], team["project_id"], team["senior"]["id"])
    seen = client.get(f"/api/readiness/people/{trainee['id']}", headers=team["lead"]["headers"]).json()
    evidence = seen["evidence"]
    assert list(evidence["lessons"]) == ["bruno-m1-l1"] and evidence["quizzes"]["bruno-m1"]["passed"]
    assert evidence["practice"]["approved"] == 1 and evidence["work_items"]["done"] == 1
    assert evidence["pull_requests"] == {"opened": 1, "approved": 1}
    assert (evidence["runs"]["total"], evidence["runs"]["passed"], evidence["runs"]["failed"]) == (2, 1, 1)
    assert seen["promote_to"] == ["automation_user", "automation_senior"]  # leads go up to Senior
    # The trainee sees their own evidence; a senior mentor sees it but decides nothing; others see nothing.
    assert client.get(f"/api/readiness/people/{trainee['id']}", headers=trainee["headers"]).status_code == 200
    assert client.get(f"/api/readiness/people/{trainee['id']}",
                      headers=team["senior"]["headers"]).json()["promote_to"] == []
    other = _user("automation_trainee", _user("automation_lead")["id"])
    assert client.get(f"/api/readiness/people/{trainee['id']}", headers=other["headers"]).status_code == 404


def test_request_and_promotion_with_a_note(client, team):
    trainee, lead = team["trainee"], team["lead"]
    url = f"/api/readiness/people/{trainee['id']}"
    requested = client.post(f"{url}/request", headers=trainee["headers"], json={"note": "I finished the Bruno path"})
    assert requested.status_code == 201
    assert client.post(f"{url}/request", headers=team["senior"]["headers"], json={}).status_code == 400  # one open
    with SessionLocal() as db:
        assert db.query(Notification).filter_by(user_id=lead["id"], kind="readiness").one().link == \
            f"/learning/readiness/{trainee['id']}"
    assert [r["user_id"] for r in client.get("/api/readiness/requests", headers=lead["headers"]).json()] == \
        [trainee["id"]]

    decide = f"{url}/decision"
    assert client.post(decide, headers=team["senior"]["headers"],
                       json={"decision": "promote", "role": "automation_user", "note": "x"}).status_code == 403
    assert client.post(decide, headers=lead["headers"], json={"decision": "promote", "role": "automation_user",
                                                              "note": ""}).status_code == 422
    assert client.post(decide, headers=lead["headers"], json={"decision": "promote", "role": "viewer",
                                                              "note": "down"}).status_code == 400
    assert client.post(decide, headers=lead["headers"], json={"decision": "promote", "role": "automation_lead",
                                                              "note": "too far"}).status_code == 403
    me_before = client.get("/api/me", headers=trainee["headers"]).json()
    assert "jira.write" not in me_before["permissions"]
    promoted = client.post(decide, headers=lead["headers"],
                           json={"decision": "promote", "role": "automation_user", "note": "Solid practice, go!"})
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["decision"] == "promoted" and promoted.json()["to_role"] == "automation_user"
    me = client.get("/api/me", headers=trainee["headers"]).json()  # the same token: effective at once
    assert me["role"] == "automation_user" and "jira.write" in me["permissions"]
    with SessionLocal() as db:
        user = db.query(User).filter(User.id == trainee["id"]).one()
        assert user.scope_tag == "project_base"
        note = db.query(Notification).filter_by(user_id=trainee["id"], kind="promotion").one()
        assert note.title == "You are now Automation User" and "Solid practice, go!" in (note.body or "")
        entry = db.query(AuditEntry).filter_by(subject_user_id=trainee["id"], action="promotion").one()
        assert entry.actor_id == lead["id"] and entry.details["note"] == "Solid practice, go!"
    history = client.get(url, headers=trainee["headers"]).json()
    assert history["open_request"] is None and history["history"][0]["decided_by"] == lead["name"]


def test_not_yet_is_recorded_and_told(client, team):
    trainee, lead = team["trainee"], team["lead"]
    url = f"/api/readiness/people/{trainee['id']}"
    client.post(f"{url}/request", headers=team["senior"]["headers"], json={"note": "Asked by the mentor"})
    answer = client.post(f"{url}/decision", headers=lead["headers"],
                         json={"decision": "not_yet", "note": "Finish two more practice tasks first."}).json()
    assert answer["decision"] == "not_yet" and answer["requested_by"] == team["senior"]["name"]
    with SessionLocal() as db:
        assert db.query(User).filter(User.id == trainee["id"]).one().role == UserRole.AUTOMATION_TRAINEE
        assert db.query(Notification).filter_by(user_id=trainee["id"], kind="readiness").one().title == \
            "Your readiness review: not yet"
        assert db.query(AuditEntry).filter_by(subject_user_id=trainee["id"], action="readiness.not_yet").count() == 1


def test_audit_log_scope(client, team):
    trainee, lead = team["trainee"], team["lead"]
    assert client.patch(f"/api/users/{trainee['id']}", headers=lead["headers"],
                        json={"role": "automation_user"}).status_code == 200
    mine = client.get("/api/audit", headers=lead["headers"]).json()
    assert "role.change" in mine["actions"]
    change = next(e for e in mine["items"] if e["action"] == "role.change" and e["subject"] == trainee["name"])
    assert change["actor"] == lead["name"] and change["details"] == {"from": "automation_trainee",
                                                                     "to": "automation_user"}
    other_lead = _user("automation_lead")
    others = client.get("/api/audit", headers=other_lead["headers"]).json()["items"]
    assert all(e["subject"] != trainee["name"] for e in others)
    assert client.get("/api/audit", headers=team["senior"]["headers"]).status_code == 403
    admin = _user("super_admin")
    assert any(e["subject"] == trainee["name"] for e in client.get(
        "/api/audit?action=role.change", headers=admin["headers"]).json()["items"])
