"""Publishing reports to Confluence (phase 10)."""
import json
import uuid
import zipfile
from datetime import datetime, timedelta
from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ProjectMember, ReportPublication
from app.modules.reporting import allure
from app.modules.settings.connections import set_secret
from app.modules.work import integrations

CONFLUENCE = "http://confluence.test"


class FakeConfluence:
    def __init__(self):
        self.pages: dict[str, dict] = {}
        self.writes: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/rest/api")
        if request.method == "GET" and path == "/content":
            title = request.url.params.get("title")
            found = [p for p in self.pages.values() if p["title"] == title]
            return httpx.Response(200, json={"results": found})
        if request.method == "POST" and path == "/content":
            body = json.loads(request.content)
            page = {"id": str(1000 + len(self.pages)), "title": body["title"], "version": {"number": 1},
                    "_links": {"webui": f"/pages/{1000 + len(self.pages)}"}}
            self.pages[page["id"]] = page
            self.writes.append({"action": "create", **body})
            return httpx.Response(200, json=page)
        if request.method == "PUT" and path.startswith("/content/"):
            body = json.loads(request.content)
            page = self.pages[path.split("/")[2]]
            page["version"] = {"number": body["version"]["number"]}
            self.writes.append({"action": "update", **body})
            return httpx.Response(200, json=page)
        if request.method == "POST" and path.endswith("/child/attachment"):
            assert request.headers["X-Atlassian-Token"] == "no-check"
            self.writes.append({"action": "attach", "page": path.split("/")[2], "content": request.content})
            return httpx.Response(200, json={"results": [{"id": "att1"}]})
        return httpx.Response(404, json={"message": "Not Found"})


@pytest.fixture
def confluence(monkeypatch, tmp_path):
    fake = FakeConfluence()
    monkeypatch.setattr(integrations, "HTTP_TRANSPORT", httpx.MockTransport(fake.handler))
    monkeypatch.setattr(settings, "ARTIFACTS_DIR", str(tmp_path / "artifacts"))
    return fake


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def run(client, confluence):
    """A finished run of a suite with a generated report (just index.html)."""
    with SessionLocal() as db:
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name="Shop", community_id="general",
                          organization_id=1, confluence_space_key="QA", confluence_parent_page_id="555")
        db.add(project)
        db.flush()
        suite = AnalyticsSuite(project_id=project.id, name="Checkout", tags=[], active=True, test_type="regression")
        db.add(suite)
        db.flush()
        finished = datetime.utcnow()
        run = AnalyticsRun(suite_id=suite.id, status="failed", name="Nightly", total_tests=2, passed_tests=1,
                           failed_tests=1, started_at=finished - timedelta(seconds=75), finished_at=finished,
                           branch="main", results_json=[
                               {"class_name": "Checkout", "test_name": "pays", "status": "passed"},
                               {"class_name": "Checkout", "test_name": "<script>alert(1)</script>",
                                "status": "failed", "error_message": "Expected 201 & got 500"}])
        db.add(run)
        db.commit()
        report_dir = allure.run_report_dir(project.id, suite.id, run.id) / "allure-report"
        report_dir.mkdir(parents=True)
        (report_dir / "index.html").write_text("<html>Allure</html>")
        (report_dir / "data").mkdir()
        (report_dir / "data" / "suites.json").write_text("{}")
        return {"project_id": project.id, "run_id": run.id}


def _user(role: str, project_id: int) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="project_base" if role.startswith("automation_") else None,
                    is_active=True, full_name=f"E2E {role}", settings_json={"confluence_mcp_base_url": CONFLUENCE})
        db.add(user)
        db.flush()
        set_secret(user, "confluence", "conf-token")
        db.add(ProjectMember(project_id=project_id, user_id=user.id))
        db.commit()
        return {"id": user.id, "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def test_publish_creates_then_updates_the_suite_page(client, confluence, run):
    senior = _user("automation_senior", run["project_id"])
    url = f"/api/runs/manual-{run['run_id']}/publish"
    first = client.post(url, headers={**senior["headers"], "Origin": "https://atm.example.test"})
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "published" and first.json()["page_version"] == 1
    assert first.json()["page_url"] == f"{CONFLUENCE}/pages/1000"

    create = confluence.writes[0]
    assert create["action"] == "create" and create["title"] == "Shop · Checkout · Test report"
    assert create["space"] == {"key": "QA"} and create["ancestors"] == [{"id": "555"}]
    body = create["body"]["storage"]["value"]
    assert "50.0 %" in body and "1 min 15 s" in body and "regression" in body
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in body and "<script>" not in body  # escaped
    assert "Expected 201 &amp; got 500" in body
    assert f"https://atm.example.test/reports/runs/manual-{run['run_id']}" in body
    attach = confluence.writes[1]
    assert attach["action"] == "attach" and attach["page"] == "1000"
    assert f'filename="allure-report-run-{run["run_id"]}.zip"'.encode() in attach["content"]
    archive_start = attach["content"].index(b"PK")
    names = zipfile.ZipFile(BytesIO(attach["content"][archive_start:attach["content"].rindex(b"\r\n--")])).namelist()
    assert "allure-report/index.html" in names and "allure-report/data/suites.json" in names

    second = client.post(url, headers=senior["headers"]).json()
    assert second["page_version"] == 2 and confluence.writes[2]["action"] == "update"
    history = client.get(f"/api/runs/manual-{run['run_id']}/publications", headers=senior["headers"]).json()
    assert [p["page_version"] for p in history] == [2, 1] and history[0]["published_by"] == "E2E automation_senior"


def test_who_may_publish_and_failures_are_recorded(client, confluence, run):
    user = _user("automation_user", run["project_id"])
    viewer = _user("viewer", run["project_id"])
    lead = _user("automation_lead", run["project_id"])
    url = f"/api/runs/manual-{run['run_id']}/publish"
    assert client.post(url, headers=user["headers"]).status_code == 403  # report.publish: SA, Lead, Senior
    assert client.post(url, headers=viewer["headers"]).status_code == 403
    assert client.get(f"/api/runs/manual-{run['run_id']}/publications", headers=viewer["headers"]).status_code == 200

    with SessionLocal() as db:
        db.query(Project).filter(Project.id == run["project_id"]).update({"confluence_parent_page_id": None})
        db.commit()
    refused = client.post(url, headers=lead["headers"])
    assert refused.status_code == 400 and "parent page" in refused.json()["detail"]
    with SessionLocal() as db:
        failed = db.query(ReportPublication).filter_by(run_id=run["run_id"]).one()
        assert failed.status == "failed" and "parent page" in failed.error
    assert confluence.writes == []


def test_project_parent_page_is_a_page_id(client, run):
    lead = _user("automation_lead", run["project_id"])
    url = f"/api/projects/{run['project_id']}"
    assert client.patch(url, headers=lead["headers"], json={"confluence_parent_page_id": "abc"}).status_code == 400
    saved = client.patch(url, headers=lead["headers"], json={"confluence_parent_page_id": " 777 "})
    assert saved.json()["project"]["confluence_parent_page_id"] == "777"
