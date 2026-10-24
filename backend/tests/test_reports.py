"""The Allure pipeline, signed report links, the report list and trends (phase 09)."""
import base64
import json
import os
import stat
import sys
import time
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ProjectMember
from app.modules.reporting import allure, reports_router

# Stands in for `allure generate <results> -o <report> --clean`: writes index.html, and a history entry that records
# whether the previous report's history was copied into the results (so history chaining can be checked).
FAKE_ALLURE = """#!{python}
import json, os, sys
results, out = sys.argv[2], sys.argv[sys.argv.index('-o') + 1]
os.makedirs(os.path.join(out, 'history'), exist_ok=True)
had_history = os.path.isdir(os.path.join(results, 'history'))
count = len([f for f in os.listdir(results) if f.endswith('-result.json')])
open(os.path.join(out, 'index.html'), 'w').write('<html><title>Allure Report</title>%d results</html>' % count)
open(os.path.join(out, 'history', 'history-trend.json'), 'w').write(json.dumps({{'had_history': had_history}}))
"""


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def fake_allure(tmp_path, monkeypatch):
    script = tmp_path / "allure"
    script.write_text(FAKE_ALLURE.format(python=sys.executable))
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(allure, "allure_binary", lambda: str(script))
    monkeypatch.setattr(settings, "ARTIFACTS_DIR", str(tmp_path / "artifacts"))
    return script


@pytest.fixture
def project(client):
    with SessionLocal() as db:
        project = Project(key=f"R{uuid.uuid4().hex[:8].upper()}", name="Reports", community_id="general",
                          organization_id=1)
        db.add(project)
        db.flush()
        suite = AnalyticsSuite(project_id=project.id, name="Checkout", tags=[], active=True, test_type="regression")
        db.add(suite)
        db.commit()
        return {"id": project.id, "suite_id": suite.id}


def _user(role: str, project: dict | None) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="project_base" if role.startswith("automation_") else None,
                    is_active=True)
        db.add(user)
        db.flush()
        if project:
            db.add(ProjectMember(project_id=project["id"], user_id=user.id))
        db.commit()
        return {"id": user.id, "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def _run(project: dict, results: list[dict], minutes_ago: int = 0, **extra) -> int:
    with SessionLocal() as db:
        finished = datetime.utcnow() - timedelta(minutes=minutes_ago)
        passed = sum(r["status"] == "passed" for r in results)
        run = AnalyticsRun(suite_id=project["suite_id"], status="passed" if passed == len(results) else "failed",
                           results_json=results, total_tests=len(results), passed_tests=passed,
                           failed_tests=len(results) - passed, created_at=finished - timedelta(seconds=30),
                           started_at=finished - timedelta(seconds=30), finished_at=finished, **extra)
        db.add(run)
        db.commit()
        return run.id


def test_converted_results_and_adapter_copies(tmp_path):
    target = tmp_path / "results"
    allure.write_converted_results(target, [
        {"test_name": "pays", "class_name": "Checkout", "status": "passed", "duration_ms": 120},
        {"test_name": "refunds", "class_name": "Checkout", "status": "error", "error_message": "boom"},
    ], {"suite": "Checkout", "framework": "pytest"}, 1_000)
    by_name = {f["name"]: f for f in (json.loads(p.read_text()) for p in target.glob("*-result.json"))}
    assert by_name["pays"]["status"] == "passed" and by_name["pays"]["historyId"] == "Checkout.pays"
    assert by_name["refunds"]["status"] == "broken" and by_name["refunds"]["statusDetails"]["message"] == "boom"

    adapter = tmp_path / "repo" / "allure-results"
    adapter.mkdir(parents=True)
    old = adapter / "old-result.json"
    old.write_text("{}")
    os.utime(old, (time.time() - 3600, time.time() - 3600))
    (adapter / "new-result.json").write_text("{}")
    copied_to = tmp_path / "copied"
    assert allure.copy_adapter_results([adapter, tmp_path / "missing"], time.time() - 5, copied_to) == 1
    assert [p.name for p in copied_to.iterdir()] == ["new-result.json"]


def test_reports_are_generated_with_the_suites_history(client, project, fake_allure):
    first = _run(project, [{"test_name": "pays", "status": "passed"}], minutes_ago=10)
    second = _run(project, [{"test_name": "pays", "status": "passed"}, {"test_name": "refunds", "status": "failed"}])
    status = client.portal.call(allure.build_run_report, first, [], time.time())
    assert status["status"] == "ready" and status["source"] == "converted by ATM"
    client.portal.call(allure.build_run_report, second, [], time.time())

    suite_dir = allure.run_report_dir(project["id"], project["suite_id"], second).parent
    second_dir = suite_dir / f"run-{second}"
    trend = json.loads((second_dir / "allure-report" / "history" / "history-trend.json").read_text())
    assert trend["had_history"] is True  # the first report's history went into the second run's results
    assert "2 results" in (second_dir / "allure-report" / "index.html").read_text()
    environment = (second_dir / "allure-results" / "environment.properties").read_text()
    assert "Test.type=regression" in environment and "Suite=Checkout" in environment
    with SessionLocal() as db:
        assert db.query(AnalyticsRun).filter_by(id=second).one().details_json["report"]["status"] == "ready"


def test_without_allure_the_run_says_why(client, project, monkeypatch, tmp_path):
    monkeypatch.setattr(allure, "allure_binary", lambda: None)
    monkeypatch.setattr(settings, "ARTIFACTS_DIR", str(tmp_path / "artifacts"))
    run_id = _run(project, [{"test_name": "pays", "status": "passed"}])
    status = client.portal.call(allure.build_run_report, run_id, [], time.time())
    assert status["status"] == "unavailable" and "not installed" in status["message"]
    tester = _user("automation_user", project)
    response = client.post(f"/api/runs/manual-{run_id}/report-link", headers=tester["headers"])
    assert response.status_code == 409 and "not installed" in response.json()["detail"]


def test_signed_links_serve_the_report_and_nothing_else(client, project, fake_allure):
    run_id = _run(project, [{"test_name": "pays", "status": "passed"}])
    client.portal.call(allure.build_run_report, run_id, [], time.time())
    viewer = _user("viewer", project)
    outsider = _user("automation_user", None)
    assert client.post(f"/api/runs/manual-{run_id}/report-link", headers=outsider["headers"]).status_code == 403

    url = client.post(f"/api/runs/manual-{run_id}/report-link", headers=viewer["headers"]).json()["url"]
    page = client.get(url)  # no Authorization header: the token is the permission
    assert page.status_code == 200 and "Allure Report" in page.text
    assert page.headers["content-security-policy"].startswith("sandbox allow-scripts")  # never ATM's origin
    assert client.get(url.replace("index.html", "history/history-trend.json")).status_code == 200
    assert client.get(url.replace("index.html", "../allure-results/environment.properties")).status_code == 404

    token = url.split("/")[4]
    tampered = token[:-1] + ("0" if token[-1] != "0" else "1")
    assert client.get(url.replace(token, tampered)).status_code == 404
    expired = json.loads(base64.urlsafe_b64decode(token.split(".")[0] + "=="))
    expired["e"] = int(time.time()) - 1
    body = base64.urlsafe_b64encode(json.dumps(expired).encode()).decode().rstrip("=")
    assert client.get(f"/api/reports/view/{body}.{reports_router._sign(body)}/index.html").status_code == 410


def test_report_list_and_trends(client, project):
    viewer = _user("viewer", project)
    for minutes_ago, outcome in ((30, "passed"), (20, "failed"), (10, "passed")):
        _run(project, [{"class_name": "Checkout", "test_name": "pays", "status": outcome},
                       {"class_name": "Checkout", "test_name": "lists", "status": "passed"}], minutes_ago=minutes_ago,
             details_json={"performance": {"p95_ms": 100.0 + minutes_ago}})
    listed = client.get(f"/api/reports/projects/{project['id']}/runs", headers=viewer["headers"]).json()
    assert len(listed) == 3 and listed[0]["pass_rate"] == 100.0 and listed[1]["pass_rate"] == 50.0
    assert listed[0]["suite"] == "Checkout" and listed[0]["duration_seconds"] == 30.0

    trends = client.get(f"/api/reports/projects/{project['id']}/trends", params={"suite_id": project["suite_id"]},
                        headers=viewer["headers"]).json()
    assert [p["pass_rate"] for p in trends["points"]] == [100.0, 50.0, 100.0]  # oldest first
    assert [p["p95_ms"] for p in trends["points"]] == [130.0, 120.0, 110.0]
    assert trends["flaky_tests"] == ["Checkout pays"]
