"""Reports after the decisions review (phase 19): share links, deleting a report, the zip download, automatic
Confluence publishing, and installing Allure from Maven Central."""
import hashlib
import io
import json
import uuid
import zipfile
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ProjectMember, ReportPublication
from app.modules.reporting import allure, auto_publish
from app.modules.settings.connections import set_secret
from app.modules.work import integrations
from app.services import station_tools_service


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def run(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ARTIFACTS_DIR", str(tmp_path / "artifacts"))
    with SessionLocal() as db:
        project = Project(key=f"R{uuid.uuid4().hex[:8].upper()}", name="Shop", community_id="general",
                          organization_id=1, confluence_space_key="QA", confluence_parent_page_id="555")
        db.add(project)
        db.flush()
        suite = AnalyticsSuite(project_id=project.id, name="Checkout", tags=[], active=True)
        db.add(suite)
        db.flush()
        finished = datetime.utcnow()
        run = AnalyticsRun(suite_id=suite.id, status="passed", name="Nightly", total_tests=1, passed_tests=1,
                           started_at=finished - timedelta(seconds=5), finished_at=finished, results_json=[])
        db.add(run)
        db.commit()
        report = allure.run_report_dir(project.id, suite.id, run.id) / "allure-report"
        report.mkdir(parents=True)
        (report / "index.html").write_text("<html>Allure</html>")
        return {"project_id": project.id, "suite_id": suite.id, "run_id": run.id, "rid": f"manual-{run.id}"}


def _user(role: str, project_id: int) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="project_base" if role.startswith("automation_s") else None,
                    is_active=True, full_name=f"E2E {name}",
                    settings_json={"confluence_mcp_base_url": "http://confluence.test"})
        db.add(user)
        db.flush()
        set_secret(user, "confluence", "conf-token")
        db.add(ProjectMember(project_id=project_id, user_id=user.id))
        db.commit()
        return {"id": user.id, "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def test_share_links_work_without_signing_in_until_a_lead_revokes_them(client, run):
    senior, user, viewer, lead = (_user(r, run["project_id"]) for r in
                                  ("automation_senior", "automation_user", "viewer", "automation_lead"))
    url = f"/api/runs/{run['rid']}/share-links"
    assert client.post(url, headers=user["headers"]).status_code == 403  # those who publish reports share them
    link = client.post(url, headers=senior["headers"])
    assert link.status_code == 201, link.text
    shared = link.json()["url"]
    page = client.get(shared)  # no Authorization header
    assert page.status_code == 200 and "Allure" in page.text and "sandbox" in page.headers["content-security-policy"]
    assert client.get(url, headers=viewer["headers"]).json()[0]["views"] == 1
    listing = f"/api/reports/projects/{run['project_id']}/share-links"
    assert client.get(listing, headers=senior["headers"]).status_code == 403
    links = client.get(listing, headers=lead["headers"]).json()
    assert client.delete(f"{listing}/{links[0]['id']}", headers=senior["headers"]).status_code == 403
    assert client.delete(f"{listing}/{links[0]['id']}", headers=lead["headers"]).status_code == 200
    assert client.get(shared).status_code == 404


def test_zip_download_and_deleting_a_report(client, run):
    senior, lead = _user("automation_senior", run["project_id"]), _user("automation_lead", run["project_id"])
    archive = client.get(f"/api/runs/{run['rid']}/report.zip", headers=senior["headers"])
    assert archive.status_code == 200 and archive.headers["content-type"] == "application/zip"
    assert "allure-report/index.html" in zipfile.ZipFile(io.BytesIO(archive.content)).namelist()
    shared = client.post(f"/api/runs/{run['rid']}/share-links", headers=senior["headers"]).json()["url"]

    assert client.delete(f"/api/runs/{run['rid']}/report", headers=senior["headers"]).status_code == 403
    assert client.delete(f"/api/runs/{run['rid']}/report", headers=lead["headers"]).status_code == 200
    assert not allure.run_report_dir(run["project_id"], run["suite_id"], run["run_id"]).exists()
    assert client.get(shared).status_code == 404  # its share links went with it
    assert client.get(f"/api/runs/{run['rid']}/report.zip", headers=senior["headers"]).status_code == 409
    listed = client.get(f"/api/reports/projects/{run['project_id']}/runs", headers=senior["headers"]).json()
    assert listed[0]["report"] == "deleted"
    with SessionLocal() as db:
        assert db.query(AnalyticsRun).filter(AnalyticsRun.id == run["run_id"]).count() == 1  # the run stays


def test_publish_automatically_after_each_run(client, run, monkeypatch):
    senior, user = _user("automation_senior", run["project_id"]), _user("automation_user", run["project_id"])
    writes: list[str] = []

    def confluence(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/rest/api")
        if request.method == "GET" and path == "/content":
            return httpx.Response(200, json={"results": []})
        writes.append(f"{request.method} {path}")
        if path == "/content":
            body = json.loads(request.content)
            return httpx.Response(200, json={"id": "77", "title": body["title"], "version": {"number": 1},
                                             "_links": {"webui": "/pages/77"}})
        return httpx.Response(200, json={"results": [{"id": "a1"}]})

    monkeypatch.setattr(integrations, "HTTP_TRANSPORT", httpx.MockTransport(confluence))
    url = f"/api/suites/{run['suite_id']}/auto-publish"
    assert client.put(url, headers=user["headers"], json={"enabled": True}).status_code == 403
    switched = client.put(url, headers={**senior["headers"], "Origin": "https://atm.test"}, json={"enabled": True})
    assert switched.json()["auto_publish"] is True
    suites = client.get(f"/api/suites/projects/{run['project_id']}", headers=senior["headers"]).json()
    assert next(s for s in suites if s["id"] == str(run["suite_id"]))["auto_publish"] is True

    client.portal.call(auto_publish.after_run, run["run_id"], "passed")
    assert writes == ["POST /content", "POST /content/77/child/attachment"]
    with SessionLocal() as db:
        publication = db.query(ReportPublication).filter_by(run_id=run["run_id"]).one()
        assert publication.status == "published" and publication.published_by_id == senior["id"]
    client.portal.call(auto_publish.after_run, run["run_id"], "error")  # only passed and failed runs
    assert len(writes) == 2
    assert client.put(url, headers=senior["headers"], json={"enabled": False}).json()["auto_publish"] is False


def _maven(version: str, archive: bytes, checksum: str):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("maven-metadata.xml"):
            metadata = f"<metadata><versioning><release>{version}</release></versioning></metadata>"
            return httpx.Response(200, text=metadata)
        if path.endswith(".zip.sha1"):
            return httpx.Response(200, text=f"{checksum}  allure-commandline-{version}.zip")
        if path.endswith(".zip"):
            return httpx.Response(200, content=archive)
        return httpx.Response(404)
    return handler


def test_install_allure_from_maven_central(client, run, monkeypatch, tmp_path):
    lead, senior = _user("automation_lead", run["project_id"]), _user("automation_senior", run["project_id"])
    monkeypatch.setenv("ATM_TOOLS_DIR", str(tmp_path / "tools"))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("allure-2.30.0/bin/allure", "#!/bin/sh\necho allure\n")
        bundle.writestr("allure-2.30.0/lib/allure.jar", "jar")
    archive = buffer.getvalue()
    monkeypatch.setattr(station_tools_service, "HTTP_TRANSPORT",
                        httpx.MockTransport(_maven("2.30.0", archive, "0" * 40)))
    assert client.post("/api/reports/allure/install", headers=senior["headers"]).status_code == 403
    refused = client.post("/api/reports/allure/install", headers=lead["headers"])
    assert refused.status_code == 502 and "checksum" in refused.json()["detail"]
    assert station_tools_service.managed_path("allure") is None

    monkeypatch.setattr(station_tools_service, "HTTP_TRANSPORT",
                        httpx.MockTransport(_maven("2.30.0", archive, hashlib.sha1(archive).hexdigest())))
    installed = client.post("/api/reports/allure/install", headers=lead["headers"])
    assert installed.status_code == 200, installed.text
    assert installed.json()["path"] == station_tools_service.managed_path("allure")
    assert installed.json()["path"].endswith("allure/dist/bin/allure")
    status = client.get("/api/reports/allure", headers=senior["headers"]).json()
    assert status["installed"] and isinstance(status["java"], bool)
