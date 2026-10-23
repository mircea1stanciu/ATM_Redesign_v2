import subprocess
from pathlib import Path

import pytest

from app.services import changed_tests_service as svc


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    path = tmp_path / "repo"
    (path / "api" / "orders" / "environments").mkdir(parents=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "t@example.com")
    _git(path, "config", "user.name", "T")
    (path / "api" / "orders" / "bruno.json").write_text("{}")
    (path / "api" / "orders" / "environments" / "dev.bru").write_text("vars {}")
    (path / "api" / "orders" / "list.bru").write_text("get {}")
    (path / "README.md").write_text("x")
    _git(path, "add", ".")
    _git(path, "commit", "-q", "-m", "init")
    return path


def test_uncommitted_and_branch_changes_map_to_bruno_requests(repo):
    _git(repo, "checkout", "-q", "-b", "feature")
    (repo / "api" / "orders" / "create").mkdir()
    (repo / "api" / "orders" / "create" / "create.bru").write_text("post {}")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "create order")
    (repo / "api" / "orders" / "list.bru").write_text("get { changed }")
    (repo / "api" / "orders" / "environments" / "dev.bru").write_text("vars { a: 1 }")
    (repo / "notes.txt").write_text("new")

    data = svc.changed_files(repo)
    assert data["branch"] == "feature" and data["base"] == "main"
    files = {f["path"]: (f["status"], f["scope"]) for f in data["files"]}
    assert files == {
        "api/orders/create/create.bru": ("added", "committed"),
        "api/orders/list.bru": ("modified", "uncommitted"),
        "api/orders/environments/dev.bru": ("modified", "uncommitted"),
        "notes.txt": ("added", "uncommitted"),
    }
    assert data["bruno"] == [{"collection": "api/orders", "requests": ["create/create.bru", "list.bru"],
                              "environments_changed": ["environments/dev.bru"], "environments": ["dev"]}]

    only_local = svc.changed_files(repo, include_committed=False)
    assert {f["path"] for f in only_local["files"]} == {"api/orders/list.bru", "api/orders/environments/dev.bru",
                                                        "notes.txt"}


def test_folder_bru_selects_the_folder_and_deleted_requests_are_skipped(repo):
    (repo / "api" / "orders" / "folder.bru").write_text("meta {}")
    (repo / "api" / "orders" / "list.bru").unlink()
    data = svc.changed_files(repo)
    assert data["base"] is None  # on main there is nothing to compare with
    assert data["bruno"][0]["requests"] == ["."]


def test_unknown_base_is_rejected(repo):
    with pytest.raises(svc.ChangedTestsError):
        svc.changed_files(repo, base="--output=/tmp/x")
    with pytest.raises(svc.ChangedTestsError):
        svc.changed_files(repo, base="does-not-exist")
