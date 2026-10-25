"""E-mail and personal Teams notifications (phase 20), with a fake SMTP server and a fake Teams webhook."""
import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.notifications import channels
from app.modules.notifications.models import MailServer, Notification
from app.modules.notifications.service import notify
from app.modules.projects.models import Project


class FakeSMTP:
    sent: list = []
    logins: list = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self):
        FakeSMTP.logins.append("starttls")

    def login(self, username, password):
        FakeSMTP.logins.append((username, password))

    def send_message(self, message):
        FakeSMTP.sent.append({"to": message["To"], "from": message["From"], "subject": message["Subject"],
                              "text": message.get_content(), "server": f"{self.host}:{self.port}"})


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def outside(monkeypatch):
    """Deliver in the test's thread, to the fake SMTP server and a fake Teams webhook; no mail server to start with."""
    posts: list = []

    def teams(request: httpx.Request) -> httpx.Response:
        posts.append({"url": str(request.url), "card": json.loads(request.content)["attachments"][0]["content"]})
        return httpx.Response(202)

    FakeSMTP.sent, FakeSMTP.logins = [], []
    monkeypatch.setattr(channels, "INLINE", True)
    monkeypatch.setattr(channels, "SMTP_CLASS", FakeSMTP)
    monkeypatch.setattr(channels, "HTTP_TRANSPORT", httpx.MockTransport(teams))
    monkeypatch.setattr(channels.settings, "ATM_PUBLIC_URL", "https://atm.example.test")
    with SessionLocal() as db:
        db.query(MailServer).delete()
        db.commit()
    yield posts
    with SessionLocal() as db:
        db.query(MailServer).delete()
        db.commit()


def _user(role: str) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="shared" if role == "automation_user" else None, is_active=True)
        db.add(user)
        db.commit()
        return {"id": user.id, "email": user.email,
                "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


SERVER = {"host": "smtp.example.test", "port": 587, "security": "starttls", "username": "atm", "password": "pw",
          "sender": "atm@example.test"}


def test_a_super_admin_sets_the_mail_server_and_sends_a_test(client, outside):
    admin, lead = _user("super_admin"), _user("automation_lead")
    assert client.get("/api/admin/mail-server", headers=admin["headers"]).json() == {"configured": False}
    assert client.put("/api/admin/mail-server", headers=lead["headers"], json=SERVER).status_code == 403
    saved = client.put("/api/admin/mail-server", headers=admin["headers"], json=SERVER).json()
    assert saved["configured"] and saved["password_set"] and "password" not in saved
    with SessionLocal() as db:
        assert db.query(MailServer).one().password != "pw"  # encrypted
    kept = client.put("/api/admin/mail-server", headers=admin["headers"], json={**SERVER, "password": None}).json()
    assert kept["password_set"]
    bad = client.put("/api/admin/mail-server", headers=admin["headers"], json={**SERVER, "sender": "atm"})
    assert bad.status_code == 400

    tested = client.post("/api/admin/mail-server/test", headers=admin["headers"])
    assert tested.json() == {"sent_to": admin["email"]}
    assert FakeSMTP.sent[-1]["subject"] == "ATM test e-mail" and FakeSMTP.sent[-1]["server"] == "smtp.example.test:587"
    assert FakeSMTP.logins == ["starttls", ("atm", "pw")]
    assert client.delete("/api/admin/mail-server", headers=admin["headers"]).json() == {"configured": False}


def test_notifications_reach_email_and_teams_as_chosen_per_kind(client, outside):
    admin, user = _user("super_admin"), _user("automation_user")
    client.put("/api/admin/mail-server", headers=admin["headers"], json=SERVER)
    with SessionLocal() as db:
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name="Channels", community_id="general",
                          organization_id=1)
        db.add(project)
        db.commit()
        project_id = project.id

    choices = client.get("/api/notifications/subscriptions", headers=user["headers"]).json()
    assert choices["channels"] == {"email_available": True, "email": user["email"], "teams_webhook_set": False}
    assert not any(k["email"] or k["teams"] for k in choices["kinds"])  # nothing outside ATM by default
    assert client.put("/api/notifications/teams-webhook", headers=user["headers"],
                      json={"url": "teams.example.test"}).status_code == 400
    set_hook = client.put("/api/notifications/teams-webhook", headers=user["headers"],
                          json={"url": "https://teams.example.test/hook/me"})
    assert set_hook.json()["channels"]["teams_webhook_set"] is True
    assert client.post("/api/notifications/teams-webhook/test", headers=user["headers"]).json() == {"sent": True}
    assert outside[-1]["card"]["body"][0]["text"] == "ATM test message"
    # Deployments by e-mail and Teams, not in ATM; finished runs by e-mail only.
    client.put("/api/notifications/subscriptions", headers=user["headers"], json={
        "muted_kinds": ["deployment"], "muted_project_ids": [], "email_kinds": ["deployment", "run_finished"],
        "teams_kinds": ["deployment"]})

    with SessionLocal() as db:
        notify(db, [user["id"]], "deployment", "shop 1.2 deployed to UAT", "Channels tests this service.",
               "/deployments/3", project_id=project_id)
        assert db.query(Notification).filter_by(user_id=user["id"]).count() == 0
    mail = FakeSMTP.sent[-1]
    assert (mail["to"], mail["from"], mail["subject"]) == (user["email"], "atm@example.test", "shop 1.2 deployed to UAT")
    assert "Open in ATM: https://atm.example.test/deployments/3" in mail["text"]
    assert outside[-1]["url"] == "https://teams.example.test/hook/me"
    assert outside[-1]["card"]["body"][0]["text"] == "shop 1.2 deployed to UAT"
    assert outside[-1]["card"]["actions"][0]["url"] == "https://atm.example.test/deployments/3"

    sent, posted = len(FakeSMTP.sent), len(outside)
    with SessionLocal() as db:
        notify(db, [user["id"]], "run_finished", "Run passed: Checkout", "3 passed", project_id=project_id)
        assert db.query(Notification).filter_by(user_id=user["id"], kind="run_finished").count() == 1
    assert len(FakeSMTP.sent) == sent + 1 and len(outside) == posted

    # A muted project mutes every channel.
    client.put("/api/notifications/subscriptions", headers=user["headers"], json={
        "muted_kinds": [], "muted_project_ids": [project_id]})
    with SessionLocal() as db:
        notify(db, [user["id"]], "deployment", "shop 1.3 deployed to UAT", project_id=project_id)
    assert len(FakeSMTP.sent) == sent + 1 and len(outside) == posted


def test_a_failing_channel_never_breaks_the_notification(client, outside, monkeypatch):
    user = _user("automation_user")
    client.put("/api/notifications/teams-webhook", headers=user["headers"], json={"url": "https://teams.example.test/x"})
    client.put("/api/notifications/subscriptions", headers=user["headers"], json={
        "muted_kinds": [], "muted_project_ids": [], "email_kinds": ["review"], "teams_kinds": ["review"]})
    monkeypatch.setattr(channels, "HTTP_TRANSPORT", httpx.MockTransport(lambda request: httpx.Response(500)))
    with SessionLocal() as db:  # no mail server is set, and Teams answers 500
        created = notify(db, [user["id"]], "review", "Lead approved your pull request")
    assert len(created) == 1 and FakeSMTP.sent == []
    tested = client.post("/api/notifications/teams-webhook/test", headers=user["headers"])
    assert tested.status_code == 400 and "500" in tested.json()["detail"]
