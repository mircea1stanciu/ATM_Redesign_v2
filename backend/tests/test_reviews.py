"""Reviews of pull requests (phase 12), against a fake GitHub."""
import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.notifications.models import Notification
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project, ProjectMember
from app.modules.projects.service import set_project_github_token
from app.modules.reviews import github
from app.modules.reviews.models import PullRequestReview
from app.modules.reviews.router import record_opened
from app.modules.work.models import WorkItem
from app.services import ai_provider_service

PATCH = "@@ -1,3 +1,4 @@\n def test_checkout():\n-    pay()\n+    order = pay()\n+    assert order.id\n     done()"


class FakeGitHub:
    def __init__(self):
        self.writes: list[dict] = []
        self.pr = {"number": 7, "title": "Checkout test asserts the order", "body": "Adds an assertion.",
                   "state": "open", "draft": False, "html_url": "https://ghe.test/acme/shop/pull/7",
                   "user": {"login": "user-gh"}, "head": {"ref": "feature/E2E-9", "sha": "abc123"},
                   "base": {"ref": "main"}, "created_at": "2026-10-24T09:00:00Z", "updated_at": "2026-10-24T10:00:00Z",
                   "requested_reviewers": [{"login": "senior-gh"}]}

    def handler(self, request: httpx.Request) -> httpx.Response:
        token = request.headers["Authorization"].split()[-1]
        path = request.url.path.removeprefix("/api/v3")
        repo = "/repos/acme/shop"
        if path == "/user":
            return httpx.Response(200, json={"login": token.removeprefix("tok-") + "-gh"})
        if request.method == "POST":
            self.writes.append({"path": path, "body": json.loads(request.content), "token": token})
            return httpx.Response(201, json={"id": 99, "state": "APPROVED"})
        routes = {
            f"{repo}/pulls": [self.pr],
            f"{repo}/pulls/7": self.pr,
            f"{repo}/pulls/7/files": [{"filename": "tests/test_checkout.py", "status": "modified", "additions": 2,
                                       "deletions": 1, "patch": PATCH}],
            f"{repo}/pulls/7/comments": [{"id": 5, "path": "tests/test_checkout.py", "line": 3, "side": "RIGHT",
                                          "position": 4, "body": "Good", "user": {"login": "lead-gh"},
                                          "created_at": "2026-10-24T09:30:00Z"}],
            f"{repo}/issues/7/comments": [{"id": 6, "body": "Please look", "user": {"login": "user-gh"},
                                           "created_at": "2026-10-24T09:10:00Z"}],
            f"{repo}/pulls/7/reviews": [{"id": 8, "state": "COMMENTED", "body": "Started", "user": {"login": "lead-gh"},
                                         "submitted_at": "2026-10-24T09:20:00Z"}],
            f"{repo}/commits/abc123/check-runs": {"check_runs": [{"name": "ci", "status": "completed",
                                                                 "conclusion": "success", "html_url": "https://ci"}]},
        }
        if path in routes:
            if request.url.params.get("page") not in (None, "1"):
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=routes[path])
        return httpx.Response(404, json={"message": "Not Found"})


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def gh(monkeypatch):
    fake = FakeGitHub()
    monkeypatch.setattr(github, "HTTP_TRANSPORT", httpx.MockTransport(fake.handler))
    return fake


def _user(role: str, project_id: int, token: str | None = None, lead_id=None) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag="project_base" if role in (
                        "automation_senior", "automation_user", "automation_trainee") else None,
                    is_active=True, full_name=f"E2E {name}", assigned_lead_id=lead_id)
        db.add(user)
        db.flush()
        db.add(ProjectMember(project_id=project_id, user_id=user.id))
        db.commit()
        if token:
            set_project_github_token(db, user, project_id, token)
        return {"id": user.id, "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


@pytest.fixture
def setup(client, gh):
    with SessionLocal() as db:
        project = Project(key=f"P{uuid.uuid4().hex[:8].upper()}", name=f"Shop {uuid.uuid4().hex[:4]}",
                          community_id="general", organization_id=1, github_repo_url="https://ghe.test/acme/shop")
        db.add(project)
        db.commit()
        project_id = project.id
    return {
        "project_id": project_id,
        "senior": _user("automation_senior", project_id, "tok-senior"),
        "user": _user("automation_user", project_id, "tok-user"),
        "viewer": _user("viewer", project_id, "tok-viewer"),
        "base": f"/api/reviews/projects/{project_id}/pulls/7",
    }


def test_commentable_lines_follow_the_hunks():
    assert github.commentable_lines(PATCH) == {("RIGHT", 1), ("LEFT", 1), ("LEFT", 2), ("RIGHT", 2), ("RIGHT", 3),
                                               ("RIGHT", 4), ("LEFT", 3)}
    assert "   3 +    assert order.id" in github.numbered_patch(PATCH)


def test_waiting_for_me_and_all_open(client, setup):
    mine = client.get("/api/reviews/pulls", headers=setup["senior"]["headers"]).json()
    item = next(i for i in mine["items"] if i["project_id"] == setup["project_id"])
    assert item["waiting_for_me"] and item["author"] == "user-gh" and item["head"] == "feature/E2E-9"
    users = client.get("/api/reviews/pulls", headers=setup["user"]["headers"]).json()
    assert all(i["project_id"] != setup["project_id"] for i in users["items"])  # the author waits for nobody
    every = client.get("/api/reviews/pulls?scope=all", headers=setup["user"]["headers"]).json()
    assert any(i["project_id"] == setup["project_id"] and not i["waiting_for_me"] for i in every["items"])
    tokenless = _user("automation_user", setup["project_id"])
    listed = client.get("/api/reviews/pulls", headers=tokenless["headers"]).json()
    assert any(name.startswith("Shop") for name in listed["missing_token"])


def test_pull_request_view(client, setup):
    with SessionLocal() as db:
        suite = AnalyticsSuite(project_id=setup["project_id"], name="Checkout", tags=[], active=True)
        db.add(suite)
        db.flush()
        db.add(AnalyticsRun(suite_id=suite.id, status="passed", branch="feature/E2E-9", name="Checkout"))
        db.add(WorkItem(project_id=setup["project_id"], source="jira", external_key="E2E-9", title="Checkout story",
                        branch="feature/E2E-9"))
        db.commit()
    pr = client.get(setup["base"], headers=setup["viewer"]["headers"]).json()
    assert pr["files"][0]["patch"] == PATCH and pr["comments"][0]["line"] == 3
    assert [c["body"] for c in pr["conversation"]] == ["Please look", "Started"]  # by time
    assert pr["checks"] == [{"name": "ci", "status": "completed", "conclusion": "success", "url": "https://ci"}]
    assert pr["runs"][0]["status"] == "passed" and pr["work_item"]["key"] == "E2E-9"
    assert pr["me"] == {"login": "viewer-gh", "is_author": False, "can_comment": False, "can_review": False}
    assert client.get(setup["base"], headers=setup["senior"]["headers"]).json()["me"]["can_review"] is True


def test_senior_approves_with_a_line_comment_and_the_author_is_told(client, setup, gh):
    with SessionLocal() as db:
        author = db.query(User).filter(User.id == setup["user"]["id"]).one()
        record_opened(db, setup["project_id"], 7, "Checkout test asserts the order", "u", "feature/E2E-9", "main",
                      author)
    sent = client.post(f"{setup['base']}/reviews", headers=setup["senior"]["headers"], json={
        "event": "APPROVE", "body": "Looks good",
        "comments": [{"path": "tests/test_checkout.py", "line": 3, "side": "RIGHT", "body": "Nice assertion",
                      "suggested_by_ai": True}]})
    assert sent.status_code == 201, sent.text
    review = gh.writes[-1]
    assert review["path"] == "/repos/acme/shop/pulls/7/reviews" and review["token"] == "tok-senior"
    assert review["body"] == {"event": "APPROVE", "commit_id": "abc123", "body": "Looks good", "comments": [
        {"path": "tests/test_checkout.py", "line": 3, "side": "RIGHT", "body": "Nice assertion"}]}
    with SessionLocal() as db:
        saved = db.query(PullRequestReview).filter_by(project_id=setup["project_id"], number=7).one()
        assert (saved.event, saved.comments, saved.ai_suggestions, saved.github_review_id) == ("APPROVE", 1, 1, 99)
        note = db.query(Notification).filter_by(user_id=setup["user"]["id"], kind="review").one()
        assert "approved your pull request: Checkout test asserts the order" in note.title
        assert note.link == f"/reviews/{setup['project_id']}/7"


def test_who_may_comment_and_review(client, setup, gh):
    user, viewer = setup["user"]["headers"], setup["viewer"]["headers"]
    assert client.post(f"{setup['base']}/reviews", headers=user, json={"event": "APPROVE"}).status_code == 403
    assert client.post(f"{setup['base']}/reviews", headers=user,
                       json={"event": "REQUEST_CHANGES", "body": "x"}).status_code == 403
    old_line = {"path": "tests/test_checkout.py", "line": 2, "side": "LEFT", "body": "Why?"}
    commented = client.post(f"{setup['base']}/reviews", headers=user, json={"event": "COMMENT", "comments": [old_line]})
    assert commented.status_code == 201
    off_diff = {"path": "tests/test_checkout.py", "line": 40, "body": "?"}
    assert client.post(f"{setup['base']}/reviews", headers=user,
                       json={"event": "COMMENT", "comments": [off_diff]}).status_code == 400
    assert client.post(f"{setup['base']}/reviews", headers=user, json={"event": "COMMENT"}).status_code == 400
    assert client.post(f"{setup['base']}/comments", headers=viewer, json={"body": "hi"}).status_code == 403
    assert client.post(f"{setup['base']}/comments", headers=user, json={"body": "hi"}).status_code == 201
    assert gh.writes[-1]["path"] == "/repos/acme/shop/issues/7/comments"


def test_ai_suggestions_keep_only_lines_of_the_diff(client, setup, monkeypatch):
    senior = setup["senior"]["headers"]
    assert client.put("/api/ai/settings", headers=senior,
                      json={"provider": "github", "api_key": "k", "model": "openai/gpt-4.1"}).status_code == 200
    answers = ['Here you go:\n```json\n[{"path": "tests/test_checkout.py", "line": 3, "body": "Check the total too."},'
               ' {"path": "tests/test_checkout.py", "line": 30, "body": "Off the diff"}]\n```']
    prompts = []

    async def fake_stream(config, system, messages, transport=None):
        prompts.append(messages[0]["content"])
        yield answers[0]

    monkeypatch.setattr(ai_provider_service, "stream_chat", fake_stream)
    result = client.post(f"{setup['base']}/ai-review", headers=senior).json()
    assert result == {"suggestions": [{"path": "tests/test_checkout.py", "line": 3, "side": "RIGHT",
                                       "body": "Check the total too."}], "dropped": 1}
    assert "   3 +    assert order.id" in prompts[0]
    answers[0] = "I think it is fine."
    assert client.post(f"{setup['base']}/ai-review", headers=senior).status_code == 502
    assert client.post(f"{setup['base']}/ai-review", headers=setup["user"]["headers"]).status_code == 403
