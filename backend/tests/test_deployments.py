"""Deployments, the service map, environment checks and notifications (phase 11)."""
import json
import time
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.deployments import service as deployments
from app.modules.deployments.models import Deployment, DeploymentCheck
from app.modules.identity.models import User, UserRole
from app.modules.notifications import teams
from app.modules.notifications.models import Notification
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ProjectMember, TestEnvironment
from app.modules.testing import suites_router

WEBHOOK = "/api/deployments/webhook"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def teams_posts(monkeypatch):
    posts: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        posts.append({"url": str(request.url), "card": json.loads(request.content)})
        return httpx.Response(202)

    monkeypatch.setattr(teams, "HTTP_TRANSPORT", httpx.MockTransport(handler))
    return posts


def _project(lead_id=None) -> int:
    with SessionLocal() as db:
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name=f"Shop {uuid.uuid4().hex[:4]}",
                          community_id="general", organization_id=1, lead_user_id=lead_id)
        db.add(project)
        db.commit()
        return project.id


def _user(role: str, project_id=None, lead_id=None) -> dict:
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
        token = create_access_token({"user_id": user.id})
        return {"id": user.id, "name": user.full_name, "token": token,
                "headers": {"Authorization": f"Bearer {token}"}}


def _send(client, name: str, secret: str, timestamp=None, **fields):
    body = json.dumps({"service": name, "version": "2.4.1", "environment": "UAT", **fields}).encode()
    ts = str(int(timestamp if timestamp is not None else time.time()))
    return client.post(WEBHOOK, content=body, headers={"Content-Type": "application/json", "X-ATM-Timestamp": ts,
                                                       "X-ATM-Signature": deployments.signature(secret, ts, body)})


@pytest.fixture
def setup(client):
    """A lead with a project tested by a new service; a senior and a viewer in the project."""
    lead = _user("automation_lead")
    project_id = _project(lead_id=lead["id"])
    senior = _user("automation_senior", project_id, lead_id=lead["id"])
    viewer = _user("viewer", project_id)
    name = f"payment-{uuid.uuid4().hex[:6]}"
    created = client.post("/api/deployments/services", headers=lead["headers"],
                          json={"name": name, "kind": "backend", "description": "Payments"})
    assert created.status_code == 201, created.text
    service = created.json()
    assert client.put(f"/api/deployments/services/{service['id']}/projects/{project_id}", headers=lead["headers"],
                      json={}).status_code == 200
    return {"lead": lead, "senior": senior, "viewer": viewer, "project_id": project_id, "service": service,
            "name": name, "secret": service["secret"]}


def _notifications(user_id: int, kind: str) -> list[Notification]:
    with SessionLocal() as db:
        return db.query(Notification).filter(Notification.user_id == user_id, Notification.kind == kind).all()


def test_signed_webhook_records_the_deployment_once(client, setup):
    sent = _send(client, setup["name"], setup["secret"], source="Jenkins #12", commit="abc123",
                 delivery_id="d-1", deployed_at="2026-10-24T10:00:00+02:00")
    assert sent.status_code == 202, sent.text
    again = _send(client, setup["name"], setup["secret"], delivery_id="d-1")
    assert again.json() == {"id": sent.json()["id"], "duplicate": True}
    with SessionLocal() as db:
        deployment = db.query(Deployment).filter(Deployment.id == sent.json()["id"]).one()
        assert (deployment.version, deployment.environment, deployment.source) == ("2.4.1", "UAT", "Jenkins #12")
        assert deployment.deployed_at.isoformat() == "2026-10-24T08:00:00"  # stored in UTC


def test_webhook_rejects_bad_signatures(client, setup):
    assert _send(client, setup["name"], "wrong-secret").status_code == 401
    assert _send(client, "no-such-service", setup["secret"]).status_code == 401
    assert _send(client, setup["name"], setup["secret"], timestamp=time.time() - 3600).status_code == 401
    assert client.post(WEBHOOK, json={"service": setup["name"]}).status_code == 401  # unsigned
    body = b'{"service": "x"}'
    ts = str(int(time.time()))
    invalid = client.post(WEBHOOK, content=body, headers={
        "X-ATM-Timestamp": ts, "X-ATM-Signature": deployments.signature(setup["secret"], ts, body)})
    assert invalid.status_code == 400
    # A new secret replaces the old one at once.
    fresh = client.post(f"/api/deployments/services/{setup['service']['id']}/secret", headers=setup["lead"]["headers"])
    assert _send(client, setup["name"], setup["secret"]).status_code == 401
    assert _send(client, setup["name"], fresh.json()["secret"]).status_code == 202


def test_testers_are_notified_and_see_the_deployment(client, setup, teams_posts):
    assert client.patch(f"/api/projects/{setup['project_id']}", headers=setup["lead"]["headers"],
                        json={"teams_webhook": "https://teams.example.test/hook"}).status_code == 200
    deployment_id = _send(client, setup["name"], setup["secret"], source="Jenkins").json()["id"]

    notes = _notifications(setup["senior"]["id"], "deployment")
    assert [n.title for n in notes] == [f"{setup['name']} 2.4.1 deployed to UAT"]
    assert notes[0].link == f"/deployments/{deployment_id}"
    assert _notifications(setup["lead"]["id"], "deployment")  # the project's lead tests too
    assert _notifications(setup["viewer"]["id"], "deployment") == []  # viewers are not testers
    assert teams_posts[0]["url"] == "https://teams.example.test/hook"
    content = teams_posts[0]["card"]["attachments"][0]["content"]
    assert content["body"][0]["text"] == f"{setup['name']} 2.4.1 deployed to UAT"

    timeline = client.get("/api/deployments", headers=setup["senior"]["headers"]).json()
    assert timeline["items"][0]["id"] == deployment_id and "UAT" in timeline["environments"]
    detail = client.get(f"/api/deployments/{deployment_id}", headers=setup["viewer"]["headers"]).json()
    assert detail["source"] == "Jenkins"
    assert sorted(n["name"] for n in detail["notified"]) == sorted([setup["lead"]["name"], setup["senior"]["name"]])
    outsider = _user("automation_senior", _project())
    assert client.get(f"/api/deployments/{deployment_id}", headers=outsider["headers"]).status_code == 404
    assert client.get("/api/deployments", headers=outsider["headers"]).json()["items"] == []


def test_muted_kinds_and_projects_are_not_notified(client, setup):
    senior = setup["senior"]
    choice = client.put("/api/notifications/subscriptions", headers=senior["headers"],
                        json={"muted_kinds": [], "muted_project_ids": [setup["project_id"]]})
    assert choice.status_code == 200
    assert next(p for p in choice.json()["projects"] if p["id"] == setup["project_id"])["on"] is False
    _send(client, setup["name"], setup["secret"])
    assert _notifications(senior["id"], "deployment") == []
    assert client.put("/api/notifications/subscriptions", headers=senior["headers"],
                      json={"muted_kinds": ["nonsense"], "muted_project_ids": []}).status_code == 400


def test_smoke_check_runs_and_its_result_is_announced(client, setup, teams_posts, monkeypatch):
    project_id, lead, senior = setup["project_id"], setup["lead"], setup["senior"]
    with SessionLocal() as db:
        suite = AnalyticsSuite(project_id=project_id, name="Smoke", tags=[], active=True, test_type="smoke",
                               target="pytest:tests")
        db.add(suite)
        db.add(TestEnvironment(project_id=project_id, name="uat", variables={}))
        db.commit()
        suite_id = suite.id
    options = client.get(f"/api/deployments/projects/{project_id}/check-options", headers=lead["headers"]).json()
    assert senior["id"] in [u["id"] for u in options["users"]] and suite_id in [s["id"] for s in options["suites"]]
    mapped = client.put(f"/api/deployments/services/{setup['service']['id']}/projects/{project_id}",
                        headers=lead["headers"], json={"smoke_suite_id": suite_id, "check_user_id": senior["id"]})
    assert mapped.json()["projects"][0]["smoke_suite"]["name"] == "Smoke"
    started = []

    async def fake_start(db, user, suite, environment_id, trigger="manual", branch=None):
        run = AnalyticsRun(suite_id=suite.id, status="running", trigger=trigger, started_by_id=user.id,
                           passed_tests=3, failed_tests=0)
        db.add(run)
        db.commit()
        started.append((user.id, environment_id, trigger))
        return run

    monkeypatch.setattr(suites_router, "start_suite_run", fake_start)
    deployment_id = _send(client, setup["name"], setup["secret"]).json()["id"]
    assert started and started[0][0] == senior["id"] and started[0][2] == "deployment"  # env matched "uat"
    with SessionLocal() as db:
        check = db.query(DeploymentCheck).filter(DeploymentCheck.deployment_id == deployment_id).one()
        assert check.status == "running"
        run_id = check.run_id
    client.portal.call(deployments.on_run_finished, run_id, "passed")

    detail = client.get(f"/api/deployments/{deployment_id}", headers=senior["headers"]).json()
    assert detail["checks"][0]["status"] == "passed" and detail["check_status"] == "passed"
    assert detail["checks"][0]["run_id"] == f"manual-{run_id}"
    titles = [n.title for n in _notifications(senior["id"], "deployment_check")]
    assert titles == [f"Smoke check passed: {setup['name']} 2.4.1 on UAT"]
    assert _notifications(senior["id"], "run_finished") == []  # announced as a check, not as the senior's run


def test_check_is_skipped_without_an_environment_of_that_name(client, setup, monkeypatch):
    with SessionLocal() as db:
        suite = AnalyticsSuite(project_id=setup["project_id"], name="Smoke", tags=[], active=True, target="x")
        db.add(suite)
        db.commit()
        suite_id = suite.id
    client.put(f"/api/deployments/services/{setup['service']['id']}/projects/{setup['project_id']}",
               headers=setup["lead"]["headers"], json={"smoke_suite_id": suite_id,
                                                       "check_user_id": setup["senior"]["id"]})
    deployment_id = _send(client, setup["name"], setup["secret"], environment="PROD").json()["id"]
    check = client.get(f"/api/deployments/{deployment_id}", headers=setup["lead"]["headers"]).json()["checks"][0]
    assert check["status"] == "skipped" and "no environment named PROD" in check["detail"]


def test_who_configures_the_service_map(client, setup):
    senior, lead, service = setup["senior"], setup["lead"], setup["service"]
    assert client.post("/api/deployments/services", headers=senior["headers"],
                       json={"name": "web-app"}).status_code == 403
    assert client.post("/api/deployments/services", headers=lead["headers"],
                       json={"name": "bad name!"}).status_code == 400
    assert client.post("/api/deployments/services", headers=lead["headers"],
                       json={"name": setup["name"]}).status_code == 400  # taken
    listed = client.get("/api/deployments/services", headers=senior["headers"]).json()
    assert [s["name"] for s in listed] == [setup["name"]] and "secret" not in listed[0]
    other_lead = _user("automation_lead")
    assert client.patch(f"/api/deployments/services/{service['id']}", headers=other_lead["headers"],
                        json={"description": "mine"}).status_code == 403
    assert client.put(f"/api/deployments/services/{service['id']}/projects/{setup['project_id']}",
                      headers=other_lead["headers"], json={}).status_code == 403
    assert client.put(f"/api/deployments/services/{service['id']}/projects/{setup['project_id']}",
                      headers=lead["headers"], json={"smoke_suite_id": 999999, "check_user_id": senior["id"]}
                      ).status_code == 400
    assert client.patch(f"/api/projects/{setup['project_id']}", headers=senior["headers"],
                        json={"teams_webhook": "https://x.test"}).status_code == 403  # Seniors configure, not this
    assert client.patch(f"/api/projects/{setup['project_id']}", headers=lead["headers"],
                        json={"teams_webhook": "not a url"}).status_code == 400
    saved = client.patch(f"/api/projects/{setup['project_id']}", headers=lead["headers"],
                         json={"teams_webhook": "https://x.test/hook"}).json()["project"]
    assert saved["teams_webhook_set"] is True and "teams_webhook" not in saved
    assert client.delete(f"/api/deployments/services/{service['id']}", headers=lead["headers"]).status_code == 200


def test_notification_centre_and_live_socket(client, setup):
    senior = setup["senior"]
    with client.websocket_connect("/api/ws/notifications", subprotocols=["atm-token", senior["token"]]) as socket:
        assert socket.receive_json() == {"type": "hello"}
        _send(client, setup["name"], setup["secret"])
        pushed = socket.receive_json()
        assert pushed["type"] == "notification" and pushed["notification"]["kind"] == "deployment"
    listed = client.get("/api/notifications", headers=senior["headers"]).json()
    assert listed["unread"] == 1 and listed["items"][0]["read"] is False
    assert client.post(f"/api/notifications/{listed['items'][0]['id']}/read",
                       headers=senior["headers"]).json() == {"unread": 0}
    other = _user("automation_user", setup["project_id"])
    assert client.post(f"/api/notifications/{listed['items'][0]['id']}/read",
                       headers=other["headers"]).status_code == 404  # someone else's
    _send(client, setup["name"], setup["secret"])
    assert client.post("/api/notifications/read-all", headers=senior["headers"]).json() == {"unread": 0}
    with pytest.raises(Exception):
        with client.websocket_connect("/api/ws/notifications", subprotocols=["atm-token", "bad"]) as socket:
            socket.receive_json()


def test_role_changes_and_finished_runs_are_notified(client, setup):
    trainee = _user("automation_trainee", setup["project_id"], lead_id=setup["lead"]["id"])
    changed = client.patch(f"/api/users/{trainee['id']}", headers=setup["lead"]["headers"],
                           json={"role": "automation_user"})
    assert changed.status_code == 200, changed.text
    note = _notifications(trainee["id"], "promotion")[0]
    assert note.title == "Your role is now Automation User"
    assert "from Automation Trainee to Automation User" in (note.body or "")

    with SessionLocal() as db:
        suite = AnalyticsSuite(project_id=setup["project_id"], name="Nightly", tags=[], active=True)
        db.add(suite)
        db.flush()
        run = AnalyticsRun(suite_id=suite.id, status="failed", name="Nightly", started_by_id=trainee["id"],
                           passed_tests=4, failed_tests=1, trigger="schedule")
        db.add(run)
        db.commit()
        run_id = run.id
    client.portal.call(deployments.on_run_finished, run_id, "failed")
    finished = _notifications(trainee["id"], "run_finished")[0]
    assert finished.title == "Run failed: Nightly" and finished.link == f"/reports/runs/manual-{run_id}"
    assert "4 passed, 1 failed" in (finished.body or "") and "scheduled" in (finished.body or "")
