"""The project's ATM service account for scheduled runs (phase 18)."""
import subprocess
import time
import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.projects.checkouts import save_linked_path
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ProjectMember
from app.modules.testing import scheduler, service_account

TEST_FILE = "tests/test_service.py"


def _git(*args, cwd):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True,
                   capture_output=True)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def project(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ARTIFACTS_DIR", str(tmp_path / "artifacts"))
    work = tmp_path / "work"
    (work / "tests").mkdir(parents=True)
    (work / TEST_FILE).write_text("def test_service():\n    assert True\n")
    (work / "pytest.ini").write_text("[pytest]\n")
    _git("init", "--initial-branch=main", cwd=work)
    _git("add", ".", cwd=work)
    _git("commit", "-m", "init", cwd=work)
    bare = tmp_path / "origin.git"
    _git("clone", "--bare", str(work), str(bare), cwd=tmp_path)
    with SessionLocal() as db:
        project = Project(key=f"S{uuid.uuid4().hex[:8].upper()}", name="Scheduled", community_id="general",
                          organization_id=1, github_repo_url=str(bare))
        db.add(project)
        db.commit()
        return {"id": project.id, "bare": bare, "work": work}


def _user(role: str, project_id: int, checkout=None) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="project_base" if role.startswith("automation_s") else None,
                    is_active=True)
        db.add(user)
        db.flush()
        db.add(ProjectMember(project_id=project_id, user_id=user.id))
        db.commit()
        if checkout:
            save_linked_path(db, user, project_id, str(checkout))
        return {"id": user.id, "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def _wait_for(suite_id: int, timeout: float = 60) -> AnalyticsRun:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with SessionLocal() as db:
            run = (db.query(AnalyticsRun).filter(AnalyticsRun.suite_id == suite_id)
                   .order_by(AnalyticsRun.id.desc()).first())
            if run and run.status not in ("pending", "running"):
                return run
        time.sleep(0.5)
    raise AssertionError(f"no finished run of suite {suite_id}")


def test_schedules_run_with_the_service_account(client, project, tmp_path):
    lead = _user("automation_lead", project["id"])  # leads have no checkout: before phase 18 their schedule failed
    senior = _user("automation_senior", project["id"], checkout=project["work"])
    detection = client.get(f"/api/projects/{project['id']}/local/frameworks", params={"refresh": True},
                           headers=senior["headers"]).json()
    target = next(t["id"] for fw in detection["frameworks"] for t in fw["targets"] if t["label"] == TEST_FILE)
    suite = client.post(f"/api/suites/projects/{project['id']}/suites", headers=lead["headers"],
                        json={"name": "Nightly", "target": target, "cron_expression": "* * * * *"}).json()
    suite_id = int(suite["id"])

    # Without a service account, the lead's schedule cannot run (no checkout).
    assert client.portal.call(scheduler.run_due_suites, datetime(2026, 10, 25, 6, 0)) == []

    url = f"/api/projects/{project['id']}/service-account"
    assert client.put(url, headers=senior["headers"], json={"github_token": "t"}).status_code == 403
    bad = client.put(url, headers=lead["headers"], json={"github_token": "t"})
    assert bad.status_code == 200, bad.text  # a local repository needs no token; the clone is the check
    status = bad.json()
    assert status["configured"] and status["checkout_ready"] and status["synced_at"]
    assert (service_account.checkout_dir(project["id"]) / TEST_FILE).is_file()

    assert client.portal.call(scheduler.run_due_suites, datetime(2026, 10, 25, 6, 1)) == [suite_id]
    run = _wait_for(suite_id)
    assert run.status == "passed", run.logs_json[-10:]
    assert run.started_by_id is None and run.triggered_by == "schedule" and run.trigger == "schedule"

    # The next scheduled run uses the latest default branch.
    (project["work"] / TEST_FILE).write_text("def test_service():\n    assert False\n")
    _git("commit", "-am", "break it", cwd=project["work"])
    _git("push", str(project["bare"]), "main", cwd=project["work"])
    assert client.portal.call(scheduler.run_due_suites, datetime(2026, 10, 25, 6, 2)) == [suite_id]
    time.sleep(1)
    assert _wait_for(suite_id).status == "failed"

    removed = client.delete(url, headers=lead["headers"]).json()
    assert removed["configured"] is False and not service_account.checkout_dir(project["id"]).exists()


def test_a_broken_repository_is_reported(client, project):
    lead = _user("automation_lead", project["id"])
    with SessionLocal() as db:
        db.query(Project).filter(Project.id == project["id"]).update({"github_repo_url": "/no/such/repo.git"})
        db.commit()
    refused = client.put(f"/api/projects/{project['id']}/service-account", headers=lead["headers"],
                         json={"github_token": "t"})
    assert refused.status_code == 400 and "could not clone" in refused.json()["detail"]
    with SessionLocal() as db:
        assert db.query(Project).filter(Project.id == project["id"]).one().service_github_token is None
        assert db.query(AnalyticsSuite).filter(AnalyticsSuite.project_id == project["id"]).count() == 0
