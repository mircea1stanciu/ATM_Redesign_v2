"""The Work area: inbox, story detail, start work, board, trace links and Jira write-back (phase 06)."""
import json
import subprocess
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User, UserRole
from app.modules.projects.checkouts import save_linked_path
from app.modules.projects.models import BranchOwner, Project, ProjectMember
from app.modules.settings.connections import set_secret
from app.modules.work import integrations, service
from app.modules.work.models import WorkItem

JIRA = "http://jira.test"
CONFLUENCE = "http://confluence.test"

ISSUE = {
    "key": "SHOP-7",
    "fields": {
        "summary": "Login shows an error for a wrong password",
        "status": {"name": "To Do"},
        "issuetype": {"name": "Story"},
        "assignee": None,
        "reporter": {"displayName": "Product Owner"},
        "labels": ["auth"],
        "description": "As a user I see a clear error.",
        "customfield_100": "Given a wrong password, the error is shown.",
        "issuelinks": [{"type": {"outward": "blocks"}, "outwardIssue": {
            "key": "SHOP-8", "fields": {"summary": "Reset password", "status": {"name": "Done"}}}}],
        "attachment": [{"filename": "mock.png", "size": 10, "mimeType": "image/png"}],
        "comment": {"comments": [{"author": {"displayName": "QA"}, "created": "2026-01-01", "body": "Looks fine"}]},
        "updated": "2026-01-02",
    },
    "renderedFields": {"description": "<p>As a user I see a clear error.</p>", "customfield_100": "<p>Given…</p>",
                       "comment": {"comments": [{"body": "<p>Looks fine</p>"}]}},
    "names": {"customfield_100": "Acceptance Criteria"},
}


class FakeAtlassian:
    """Jira and Confluence as httpx sees them; records every request."""

    def __init__(self):
        self.requests: list[tuple[str, str, dict]] = []
        self.jira_status = 200

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        self.requests.append((request.method, request.url.path, {**dict(request.url.params), **body}))
        path = request.url.path
        if request.url.host == "jira.test":
            if self.jira_status != 200:
                return httpx.Response(self.jira_status, json={"errorMessages": ["nope"]})
            path = path.removeprefix("/rest/api/2")
            if path == "/project/SHOP":
                types = [{"name": "Story"}, {"name": "Technical Story"}, {"name": "Bug"},
                         {"name": "Sub-task", "subtask": True}]
                return httpx.Response(200, json={"issueTypes": types})
            if path == "/project/SHOP/statuses":
                return httpx.Response(200, json=[{"statuses": [{"name": "To Do"}, {"name": "Done"}]}])
            if path == "/search":
                return httpx.Response(200, json={"issues": [ISSUE], "total": 1})
            if path == "/issue/SHOP-7":
                return httpx.Response(200, json=ISSUE)
            if path == "/issue/SHOP-7/transitions" and request.method == "GET":
                transition = {"id": "31", "name": "Start", "to": {"name": "In Progress"}}
                return httpx.Response(200, json={"transitions": [transition]})
            if path.startswith("/issue/SHOP-7/") and request.method == "POST":
                return httpx.Response(204 if path.endswith("transitions") else 201, json={})
            return httpx.Response(404, json={"errorMessages": ["Issue does not exist"]})
        if path == "/rest/api/content/search":
            return httpx.Response(200, json={"results": [{"id": "42", "title": "Checkout requirements",
                                                          "_links": {"webui": "/pages/42"}}], "size": 1})
        if path == "/rest/api/content/42":
            return httpx.Response(200, json={"id": "42", "title": "Checkout requirements", "space": {"key": "REQ"},
                                             "body": {"view": {"value": "<p>Pay by card</p>"}}})
        return httpx.Response(404, json={"message": "Not Found"})


@pytest.fixture
def atlassian(monkeypatch):
    fake = FakeAtlassian()
    monkeypatch.setattr(integrations, "HTTP_TRANSPORT", httpx.MockTransport(fake.handler))
    return fake


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _git(*args, cwd):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True,
                   capture_output=True)


@pytest.fixture
def project(client, tmp_path):
    with SessionLocal() as db:
        project = Project(key=f"W{uuid.uuid4().hex[:8].upper()}", name="Shop", community_id="general",
                          organization_id=1, jira_project_key="SHOP", confluence_space_key="REQ")
        db.add(project)
        db.commit()
        repo = tmp_path / "checkout"
        (repo / "tests" / "ui").mkdir(parents=True)
        (repo / "tests" / "ui" / "login_error.spec.ts").write_text("test('x', () => {})\n")
        (repo / "tests" / "ui" / "cart.spec.ts").write_text("\n")
        (repo / "README.md").write_text("# shop\n")
        _git("init", "--initial-branch=main", cwd=repo)
        _git("add", ".", cwd=repo)
        _git("commit", "-m", "init", cwd=repo)
        return {"id": project.id, "repo": repo}


def _user(role: str, project_id: int, tag=None, checkout=None) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        user = User(username=name, email=f"{name}@example.com", hashed_password=User.hash_password("pw-123456"),
                    role=UserRole(role), scope_tag=tag, is_active=True,
                    settings_json={"jira_mcp_base_url": JIRA, "confluence_mcp_base_url": CONFLUENCE})
        db.add(user)
        db.flush()
        set_secret(user, "jira", "jira-token")
        set_secret(user, "confluence", "conf-token")
        db.add(ProjectMember(project_id=project_id, user_id=user.id))
        if checkout:
            save_linked_path(db, user, project_id, str(checkout))
        db.commit()
        return {"id": user.id, "headers": {"Authorization": f"Bearer {create_access_token({'user_id': user.id})}"}}


def test_jql_and_branch_names():
    jql = service.build_jql("SHOP", q="login", story_types=["Story", "Technical Story"], assignee="me",
                            sprint="current", label='a"b')
    assert jql == ('project = "SHOP" AND issuetype in ("Story", "Technical Story") AND assignee = currentUser() '
                   'AND sprint in openSprints() AND labels = "a\\"b" AND text ~ "login" ORDER BY updated DESC')
    assert 'key = "SHOP-7"' in service.build_jql("SHOP", q="shop-7", story_types=[])
    assert "issuetype" not in service.build_jql("SHOP", issue_type="all", story_types=["Story"])
    assert service.branch_name("SHOP-7", "Login shows an error for a wrong password!") == \
        "feature/SHOP-7-login-shows-an-error-for-a"
    assert service.kind_of("Technical Story") == "technical_story" and service.kind_of("Bug") == "other"


def test_suggestions_rank_matching_test_files(project):
    found = service.suggest_test_files(project["repo"], "SHOP-7", "Login error message")
    assert found[0]["path"] == "tests/ui/login_error.spec.ts"
    assert all(f["path"] != "README.md" for f in found)


def test_inbox_detail_and_confluence(client, project, atlassian):
    viewer = _user("automation_user", project["id"], tag="project_base")  # phase 15: viewers have no Work
    base = f"/api/projects/{project['id']}/work"
    inbox = client.get(f"{base}/jira/issues", params={"q": "login"}, headers=viewer["headers"])
    assert inbox.status_code == 200, inbox.text
    assert inbox.json()["items"][0] == {**inbox.json()["items"][0], "key": "SHOP-7", "kind": "user_story",
                                        "url": f"{JIRA}/browse/SHOP-7", "work_item": None}
    search = next(r for r in atlassian.requests if r[1].endswith("/search"))
    assert 'issuetype in ("Story", "Technical Story")' in search[2]["jql"]

    detail = client.get(f"{base}/jira/issues/SHOP-7", headers=viewer["headers"]).json()
    assert detail["acceptance_criteria_text"].startswith("Given a wrong password")
    assert detail["links"] == [{"relation": "blocks", "key": "SHOP-8", "title": "Reset password", "status": "Done"}]
    assert detail["comments"][0]["body_html"] == "<p>Looks fine</p>"
    assert client.get(f"{base}/jira/issues/OTHER-1", headers=viewer["headers"]).status_code == 404

    pages = client.get(f"{base}/confluence/pages", headers=viewer["headers"]).json()
    assert pages["items"][0]["title"] == "Checkout requirements"
    page = client.get(f"{base}/confluence/pages/42", headers=viewer["headers"]).json()
    assert page["body_html"] == "<p>Pay by card</p>"


def test_jira_errors_are_explained(client, project, atlassian):
    viewer = _user("automation_user", project["id"], tag="project_base")
    atlassian.jira_status = 401
    response = client.get(f"/api/projects/{project['id']}/work/jira/issues", headers=viewer["headers"])
    assert response.status_code == 400 and "refused your token" in response.json()["detail"]


def test_start_work_creates_branch_item_links_and_comment(client, project, atlassian):
    senior = _user("automation_senior", project["id"], tag="project_base", checkout=project["repo"])
    base = f"/api/projects/{project['id']}/work"
    response = client.post(f"{base}/items", headers=senior["headers"], json={
        "source": "jira", "external_key": "shop-7", "comment_in_jira": True,
        "tests": [{"type": "test_file", "ref": "tests/ui/login_error.spec.ts"}]})
    assert response.status_code == 201, response.text
    item = response.json()
    assert item["status"] == "in_progress" and item["branch"] == "feature/SHOP-7-login-shows-an-error-for-a"
    assert item["assignee_id"] == str(senior["id"]) and item["warning"] is None
    assert item["links"][0]["target_ref"] == "tests/ui/login_error.spec.ts"
    assert item["context"]["text"].startswith("As a user I see a clear error.")
    head = subprocess.run(["git", "branch", "--show-current"], cwd=project["repo"], capture_output=True, text=True)
    assert head.stdout.strip() == item["branch"]
    comment = next(r for r in atlassian.requests if r[1].endswith("/comment"))
    assert item["branch"] in comment[2]["body"]
    with SessionLocal() as db:
        owner = db.query(BranchOwner).filter_by(project_id=project["id"], branch=item["branch"]).one()
        assert owner.user_id == senior["id"]

    # Starting again switches to the existing branch instead of failing.
    again = client.post(f"{base}/items", headers=senior["headers"], json={"source": "jira", "external_key": "SHOP-7"})
    assert again.status_code == 201 and again.json()["id"] == item["id"]

    # The inbox shows the work item next to the story.
    inbox = client.get(f"{base}/jira/issues", headers=senior["headers"]).json()
    assert inbox["items"][0]["work_item"]["status"] == "in_progress"


def test_board_permissions_and_trace_links(client, project, atlassian):
    trainee = _user("automation_trainee", project["id"], tag="project_base", checkout=project["repo"])
    user = _user("automation_user", project["id"], tag="project_base")
    lead = _user("automation_lead", project["id"])
    viewer = _user("viewer", project["id"])
    base = f"/api/projects/{project['id']}/work"

    assert client.post(f"{base}/items", headers=viewer["headers"],
                       json={"source": "jira", "external_key": "SHOP-7"}).status_code == 403
    started = client.post(f"{base}/items", headers=trainee["headers"], json={
        "source": "jira", "external_key": "SHOP-7", "branch": "feature/SHOP-7-trainee", "comment_in_jira": True})
    assert started.status_code == 201, started.text
    item = started.json()
    assert "does not write to Jira" in item["warning"]  # trainees have no jira.write
    assert not any(r[1].endswith("/comment") for r in atlassian.requests)

    # Someone else's item: a user may not move it, a lead may.
    url = f"{base}/items/{item['id']}"
    assert client.patch(url, headers=user["headers"], json={"status": "done"}).status_code == 403
    assert client.patch(url, headers=lead["headers"], json={"status": "in_review"}).json()["status"] == "in_review"
    assert client.patch(url, headers=user["headers"], json={"assignee_id": user["id"]}).status_code == 403

    linked = client.post(f"{url}/links", headers=trainee["headers"],
                         json={"target_type": "run", "target_ref": "manual-1", "label": "Run #1"})
    assert linked.json()["links"][-1]["target_ref"] == "manual-1"
    link_id = linked.json()["links"][-1]["id"]
    assert client.delete(f"{url}/links/{link_id}", headers=trainee["headers"]).json()["links"] == []

    # A pull request from the item's branch traces back and moves it to review.
    with SessionLocal() as db:
        db.query(WorkItem).filter_by(id=item["id"]).update({"status": "in_progress"})
        db.commit()
        service.link_pull_request(db, project["id"], "feature/SHOP-7-trainee", "https://gh/pr/5", "PR 5")
    assert client.get(f"{base}/items", headers=viewer["headers"]).status_code == 403  # phase 15: viewers have no Work
    board = client.get(f"{base}/items", headers=user["headers"]).json()["items"]
    mine = next(i for i in board if i["id"] == item["id"])
    assert mine["status"] == "in_review"
    assert client.get(url, headers=user["headers"]).json()["links"][0]["target_type"] == "pull_request"


def test_jira_write_back(client, project, atlassian):
    lead = _user("automation_lead", project["id"])
    trainee = _user("automation_trainee", project["id"], tag="project_base")
    base = f"/api/projects/{project['id']}/work"
    item = client.post(f"{base}/items", headers=lead["headers"],
                       json={"source": "jira", "external_key": "SHOP-7", "start": False}).json()
    assert item["status"] == "todo" and item["branch"] is None
    url = f"{base}/items/{item['id']}/jira"

    assert client.get(f"{url}/transitions", headers=lead["headers"]).json()["transitions"][0]["to"] == "In Progress"
    assert client.post(f"{url}/transition", headers=lead["headers"], json={"transition_id": "31"}).status_code == 200
    assert client.post(f"{url}/comment", headers=lead["headers"], json={"body": "Tests added"}).status_code == 200
    assert client.post(f"{url}/link", headers=lead["headers"],
                       json={"url": "https://gh/pr/5", "title": "PR 5"}).status_code == 200
    posted = [(r[1].rsplit("/", 1)[-1], r[2]) for r in atlassian.requests if r[0] == "POST"]
    assert ("transitions", {"transition": {"id": "31"}}) in posted
    assert ("comment", {"body": "Tests added"}) in posted
    assert any(name == "remotelink" and body["object"]["url"] == "https://gh/pr/5" for name, body in posted)
    assert client.post(f"{url}/comment", headers=trainee["headers"], json={"body": "x"}).status_code == 403


def test_story_prompt_for_the_assistant():
    item = WorkItem(external_key="SHOP-7", title="Login error", kind="user_story",
                    context_json={"type": "Story", "text": "Acceptance criteria:\nGiven…"})
    assert service.story_prompt(item).startswith("The user is working on SHOP-7: Login error (Story).")
    assert "Given…" in service.story_prompt(item)


def test_project_jira_and_confluence_keys(client, project):
    senior = _user("automation_senior", project["id"], tag="project_base")
    lead = _user("automation_lead", project["id"])
    url = f"/api/projects/{project['id']}"
    saved = client.patch(url, headers=senior["headers"],
                         json={"jira_project_key": " shop ", "confluence_space_key": ""})
    assert saved.status_code == 200
    assert saved.json()["project"]["jira_project_key"] == "SHOP"
    assert saved.json()["project"]["confluence_space_key"] is None
    # Choosing the project's lead is people management: not for seniors.
    assert client.patch(url, headers=senior["headers"], json={"lead_user_id": senior["id"]}).status_code == 403
    assert client.patch(url, headers=lead["headers"], json={"lead_user_id": lead["id"]}).status_code == 200


def test_pushed_test_files_trace_to_the_work_item(client, project):
    with SessionLocal() as db:
        item = WorkItem(project_id=project["id"], source="jira", external_key="SHOP-9", kind="user_story",
                        title="Pushed", status="in_progress", branch="feature/SHOP-9-pushed")
        db.add(item)
        db.commit()
        paths = ["tests/ui/login_error.spec.ts", "src/app.ts", "tests/test_cart.py"]
        assert service.link_pushed_files(db, project["id"], "feature/SHOP-9-pushed", paths) == 2
        assert service.link_pushed_files(db, project["id"], "feature/SHOP-9-pushed", paths) == 0  # once
        assert service.link_pushed_files(db, project["id"], "feature/other", paths) == 0
        db.refresh(item)
        assert sorted(link.target_ref for link in item.links) == ["tests/test_cart.py", "tests/ui/login_error.spec.ts"]


def test_trainees_get_a_default_suite_for_their_runs(client, project):
    trainee = _user("automation_trainee", project["id"], tag="project_base")
    viewer = _user("viewer", project["id"])
    url = f"/api/suites/projects/{project['id']}/default-suite"
    assert client.post(f"/api/suites/projects/{project['id']}/suites", headers=trainee["headers"],
                       json={"name": "Mine"}).status_code == 403  # creating suites needs suite.manage
    first = client.post(url, headers=trainee["headers"])
    assert first.status_code == 200 and first.json()["name"] == "Default Suite"
    assert client.post(url, headers=trainee["headers"]).json()["id"] == first.json()["id"]
    assert client.post(url, headers=viewer["headers"]).status_code == 403


def test_run_artifacts_stay_out_of_commits(tmp_path):
    from app.modules.testing.runs import _manual_run_artifact_dir

    repo = tmp_path / "repo"
    repo.mkdir()
    _git("init", cwd=repo)
    _manual_run_artifact_dir(repo, "manual-1")
    _manual_run_artifact_dir(repo, "manual-2")
    exclude = (repo / ".git" / "info" / "exclude").read_text().splitlines()
    assert exclude.count(".automationtestmanager/") == 1
