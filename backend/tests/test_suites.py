"""Suites, environments, running a suite, schedules and performance metrics (phase 08)."""
import json
import subprocess
import time
import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.projects.checkouts import save_linked_path
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ProjectMember
from app.modules.testing import cron, scheduler
from app.services.framework_run_service import k6_performance

TEST_FILE = "tests/test_env.py"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _git(*args, cwd):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True,
                   capture_output=True)


@pytest.fixture
def project(client, tmp_path):
    repo = tmp_path / "checkout"
    (repo / "tests").mkdir(parents=True)
    # Passes only when the run's environment handed BASE_URL to pytest.
    (repo / TEST_FILE).write_text("import os\n\ndef test_base_url():\n"
                                  "    assert os.environ['BASE_URL'] == 'https://uat.example.test'\n")
    (repo / "pytest.ini").write_text("[pytest]\n")
    _git("init", "--initial-branch=main", cwd=repo)
    _git("add", ".", cwd=repo)
    _git("commit", "-m", "init", cwd=repo)
    with SessionLocal() as db:
        project = Project(key=f"S{uuid.uuid4().hex[:8].upper()}", name="Suites", community_id="general",
                          organization_id=1)
        db.add(project)
        db.commit()
        return {"id": project.id, "repo": repo}


def _user(role: str, project: dict, tag=None, checkout=False) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag=tag, is_active=True)
        db.add(user)
        db.flush()
        db.add(ProjectMember(project_id=project["id"], user_id=user.id))
        db.commit()
        if checkout:
            save_linked_path(db, user, project["id"], str(project["repo"]))
        return {"id": user.id, "email": user.email,
                "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def _target(client, project, user) -> str:
    detection = client.get(f"/api/projects/{project['id']}/local/frameworks", params={"refresh": True},
                           headers=user["headers"]).json()
    return next(t["id"] for fw in detection["frameworks"] for t in fw["targets"] if t["label"] == TEST_FILE)


def _wait_for(run_id: int, timeout: float = 60) -> AnalyticsRun:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with SessionLocal() as db:
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == run_id).one()
            if run.status not in ("pending", "running"):
                return run
        time.sleep(0.5)
    raise AssertionError(f"run {run_id} did not finish")


def test_cron_expressions():
    weekday_mornings = cron.parse("0 6 * * 1-5")
    assert weekday_mornings.matches(datetime(2026, 10, 26, 6, 0))  # Monday
    assert not weekday_mornings.matches(datetime(2026, 10, 25, 6, 0))  # Sunday
    assert not weekday_mornings.matches(datetime(2026, 10, 26, 6, 1))
    every_15 = cron.parse("*/15 * * * *")
    assert every_15.matches(datetime(2026, 1, 1, 3, 45)) and not every_15.matches(datetime(2026, 1, 1, 3, 50))
    assert cron.parse("0 0 1 * 0").matches(datetime(2026, 11, 1, 0, 0))  # day 1 or a Sunday
    assert cron.parse("30 2 * * 7").matches(datetime(2026, 10, 25, 2, 30))  # 7 is Sunday too
    for bad in ("* * *", "60 * * * *", "*/0 * * * *", "a * * * *", "5-1 * * * *"):
        with pytest.raises(cron.CronError):
            cron.parse(bad)


def test_k6_performance_metrics(tmp_path):
    summary = tmp_path / "k6-summary.json"
    summary.write_text(json.dumps({"metrics": {
        "http_req_duration": {"avg": 120.456, "p(90)": 180.0, "p(95)": 210.5, "max": 400.0},
        "http_reqs": {"count": 500, "rate": 49.9},
        "http_req_failed": {"value": 0.02},
        "vus_max": {"value": 10, "max": 10},
        "iterations": {"count": 250},
    }}))
    assert k6_performance(summary) == {"p95_ms": 210.5, "p90_ms": 180.0, "avg_ms": 120.46, "max_ms": 400.0,
                                       "requests": 500, "requests_per_second": 49.9, "error_rate": 0.02,
                                       "virtual_users": 10, "iterations": 250}
    assert k6_performance(tmp_path / "missing.json") is None


def test_suites_and_environments_permissions(client, project):
    user = _user("automation_user", project, "project_base")
    other_user = _user("automation_user", project, "project_base")
    senior = _user("automation_senior", project, "project_base")
    trainee = _user("automation_trainee", project, "project_base")
    base = f"/api/suites/projects/{project['id']}/suites"

    assert client.post(base, headers=trainee["headers"], json={"name": "Nope"}).status_code == 403
    created = client.post(base, headers=user["headers"], json={
        "name": "Login", "test_type": "smoke", "cron_expression": "0 6 * * 1-5", "ci_workflow": "tests.yml"})
    assert created.status_code == 200, created.text
    suite = created.json()
    assert suite["test_type"] == "smoke" and suite["cron_expression"] == "0 6 * * 1-5"
    bad_cron = client.post(base, headers=user["headers"], json={"name": "Bad", "cron_expression": "nope"})
    assert bad_cron.status_code == 400
    assert client.post(base, headers=user["headers"], json={"name": "Bad", "test_type": "chaos"}).status_code == 422
    assert client.post(base, headers=user["headers"], json={"name": "Bad", "ci_workflow": "../x"}).status_code == 400

    url = f"/api/suites/{suite['id']}"
    assert client.patch(url, headers=other_user["headers"], json={"name": "Mine now"}).status_code == 403
    changed = client.patch(url, headers=senior["headers"], json={"test_type": "regression"})
    assert changed.json()["test_type"] == "regression"

    environments = f"/api/projects/{project['id']}/environments"
    assert client.post(environments, headers=user["headers"], json={"name": "UAT"}).status_code == 403
    uat = client.post(environments, headers=senior["headers"],
                      json={"name": "UAT", "variables": {"BASE_URL": "https://uat.example.test"}})
    assert uat.status_code == 201
    assert client.post(environments, headers=senior["headers"], json={"name": "UAT"}).status_code == 400
    assert client.post(environments, headers=senior["headers"],
                       json={"name": "X", "variables": {"bad name": "1"}}).status_code == 400
    assert client.get(environments, headers=trainee["headers"]).json()[0]["variables"]["BASE_URL"].startswith("https")

    linked = client.patch(url, headers=senior["headers"], json={"environment_id": int(uat.json()["id"])})
    assert linked.json()["environment_id"] == uat.json()["id"]
    assert client.delete(f"{environments}/{uat.json()['id']}", headers=senior["headers"]).status_code == 200
    with SessionLocal() as db:
        assert db.query(AnalyticsSuite).filter_by(id=int(suite["id"])).one().environment_id is None
    # Phase 17: archive instead of delete; only leads and super admins delete an archived suite permanently.
    lead = _user("automation_lead", project)
    assert client.post(f"{url}/archive", headers=other_user["headers"]).status_code == 403
    assert client.post(f"{url}/archive", headers=user["headers"]).json()["archived_at"]
    listed = client.get(f"/api/suites/projects/{project['id']}", headers=user["headers"]).json()
    assert suite["id"] not in [s["id"] for s in listed]
    archived = client.get(f"/api/suites/projects/{project['id']}?archived=true", headers=user["headers"]).json()
    assert [s["id"] for s in archived] == [suite["id"]]
    assert client.delete(url, headers=user["headers"]).status_code == 403
    assert client.delete(url, headers=senior["headers"]).status_code == 403
    assert client.post(f"{url}/restore", headers=user["headers"]).json()["archived_at"] is None
    assert client.delete(url, headers=lead["headers"]).status_code == 400  # archive first
    client.post(f"{url}/archive", headers=lead["headers"])
    assert client.delete(url, headers=lead["headers"]).json()["deleted"] is True


def test_run_a_suite_with_its_environment(client, project):
    senior = _user("automation_senior", project, "project_base", checkout=True)
    viewer = _user("viewer", project)
    uat = client.post(f"/api/projects/{project['id']}/environments", headers=senior["headers"],
                      json={"name": "UAT", "variables": {"BASE_URL": "https://uat.example.test"}}).json()
    suite = client.post(f"/api/suites/projects/{project['id']}/suites", headers=senior["headers"], json={
        "name": "Env check", "target": _target(client, project, senior), "environment_id": int(uat["id"])}).json()

    assert client.post(f"/api/suites/{suite['id']}/runs", headers=viewer["headers"], json={}).status_code == 403
    started = client.post(f"/api/suites/{suite['id']}/runs", headers=senior["headers"], json={})
    assert started.status_code == 200, started.text
    run = started.json()["run"]
    assert run["trigger"] == "manual" and run["environment_id"] == uat["id"]
    assert run["triggered_by"] == senior["email"]
    finished = _wait_for(int(run["id"].removeprefix("manual-")))
    assert finished.status == "passed", finished.logs_json[-10:]

    # GitHub Actions needs a workflow on the suite.
    assert client.post(f"/api/suites/{suite['id']}/runs", headers=senior["headers"],
                       json={"where": "actions"}).status_code == 400


def test_secret_variables_reach_the_run_but_never_the_browser(client, project):
    senior = _user("automation_senior", project, "project_base", checkout=True)
    trainee = _user("automation_trainee", project, "project_base")
    secret = "https://uat.example.test"  # the sample test passes only when BASE_URL arrives
    environments = f"/api/projects/{project['id']}/environments"
    created = client.post(environments, headers=senior["headers"],
                          json={"name": "Secret UAT", "variables": {"USER": "qa"}, "secrets": {"BASE_URL": secret}})
    assert created.status_code == 201, created.text
    assert created.json()["secret_names"] == ["BASE_URL"] and secret not in created.text
    listed = client.get(environments, headers=trainee["headers"])
    assert secret not in listed.text and listed.json()[0]["secret_names"] == ["BASE_URL"]
    env_id = created.json()["id"]
    both = client.put(f"{environments}/{env_id}", headers=senior["headers"],
                      json={"name": "Secret UAT", "variables": {"BASE_URL": "x"}})
    assert both.status_code == 400  # a name is a variable or a secret, not both

    suite = client.post(f"/api/suites/projects/{project['id']}/suites", headers=senior["headers"], json={
        "name": "Secret run", "target": _target(client, project, senior), "environment_id": int(env_id)}).json()
    run = client.post(f"/api/suites/{suite['id']}/runs", headers=senior["headers"], json={}).json()["run"]
    finished = _wait_for(int(run["id"].removeprefix("manual-")))
    assert finished.status == "passed", finished.logs_json[-10:]
    assert secret not in json.dumps(finished.logs_json)

    # Changing other fields keeps the secret; an empty value removes it.
    kept = client.put(f"{environments}/{env_id}", headers=senior["headers"], json={"name": "Secret UAT 2"}).json()
    assert kept["secret_names"] == ["BASE_URL"]
    removed = client.put(f"{environments}/{env_id}", headers=senior["headers"],
                         json={"name": "Secret UAT 2", "secrets": {"BASE_URL": ""}}).json()
    assert removed["secret_names"] == []
    # An archived suite does not run.
    client.post(f"/api/suites/{suite['id']}/archive", headers=senior["headers"])
    assert client.post(f"/api/suites/{suite['id']}/runs", headers=senior["headers"], json={}).status_code == 400


def test_secret_values_are_masked_in_logs():
    from app.modules.testing import secrets

    assert secrets.mask("token=abcd1234 and abc", ["abcd1234", "abc"]) == "token=*** and abc"  # short values stay


def test_scheduler_starts_due_suites_once_per_minute(client, project):
    owner = _user("automation_senior", project, "project_base", checkout=True)
    viewer = _user("viewer", project)
    target = _target(client, project, owner)
    uat = client.post(f"/api/projects/{project['id']}/environments", headers=owner["headers"],
                      json={"name": "UAT", "variables": {"BASE_URL": "https://uat.example.test"}}).json()
    due = client.post(f"/api/suites/projects/{project['id']}/suites", headers=owner["headers"], json={
        "name": "Nightly", "target": target, "environment_id": int(uat["id"]), "cron_expression": "30 2 * * *"}).json()
    client.post(f"/api/suites/projects/{project['id']}/suites", headers=owner["headers"], json={
        "name": "Later", "target": target, "cron_expression": "0 3 * * *"})
    with SessionLocal() as db:
        # A schedule whose owner may not run tests is skipped.
        orphan = AnalyticsSuite(project_id=project["id"], name="Orphan", target=target, cron_expression="30 2 * * *",
                                schedule_user_id=viewer["id"], active=True, tags=[])
        db.add(orphan)
        db.commit()
        orphan_id = orphan.id

    at = datetime(2026, 10, 25, 2, 30)
    # On the app's event loop (the TestClient's portal), where the run's background task lives on.
    started = client.portal.call(scheduler.run_due_suites, at)
    assert int(due["id"]) in started and orphan_id not in started
    assert client.portal.call(scheduler.run_due_suites, at) == []  # once per minute
    with SessionLocal() as db:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.suite_id == int(due["id"])).one()
        assert run.trigger == "schedule" and run.triggered_by == "schedule"
    assert _wait_for(run.id).status == "passed"


def test_runs_of_other_projects_are_out_of_scope(client, project, tmp_path):
    insider = _user("automation_user", project, "project_base")
    with SessionLocal() as db:
        other = Project(key=f"O{uuid.uuid4().hex[:8].upper()}", name="Other", community_id="general",
                        organization_id=1)
        db.add(other)
        db.flush()
        suite = AnalyticsSuite(project_id=other.id, name="Theirs", tags=[], active=True)
        db.add(suite)
        db.flush()
        run = AnalyticsRun(suite_id=suite.id, status="passed")
        db.add(run)
        db.commit()
        run_id, suite_id = run.id, suite.id
    assert client.get(f"/api/runs/manual-{run_id}", headers=insider["headers"]).status_code == 403
    assert client.get("/api/runs/manual-999999", headers=insider["headers"]).status_code == 404
    assert client.post(f"/api/suites/{suite_id}/runs", headers=insider["headers"], json={}).status_code == 403
