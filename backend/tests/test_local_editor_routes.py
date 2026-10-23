import asyncio
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.permissions import PermissionDenied, ensure
from app.modules.identity.models import UserRole
from app.modules.workspace import router as routes


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    path = tmp_path / "repo"
    path.mkdir()
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "t@example.com")
    _git(path, "config", "user.name", "T")
    (path / "bruno.json").write_text('{"name": "x"}\n')
    (path / "win.txt").write_bytes(b"a\r\nb\r\n")
    _git(path, "add", ".")
    _git(path, "commit", "-q", "-m", "init")
    _git(path, "branch", "feature")
    return path


def _patch(monkeypatch, repo: Path, role: str = "editor"):
    monkeypatch.setattr(routes, "get_project_or_404",
                        lambda db, pid: SimpleNamespace(id=pid, github_repo_url=""))
    monkeypatch.setattr(routes, "require_checkout", lambda user, pid: repo)
    return SimpleNamespace(id=1, role=role, settings_json={})


def test_editor_reads_and_saves_files_of_the_linked_checkout(monkeypatch, repo):
    user = _patch(monkeypatch, repo)
    data = asyncio.run(routes.read_project_local_file(5, "bruno.json", user, None))
    assert data == {"path": "bruno.json", "content": '{"name": "x"}\n', "size": 14, "binary": False,
                    "too_large": False}
    request = routes.LocalFileWriteRequest(path="win.txt", content="a\nb\nc\n")
    asyncio.run(routes.write_project_local_file(5, request, user, None))
    assert (repo / "win.txt").read_bytes() == b"a\r\nb\r\nc\r\n"  # line endings are kept

    for bad in ("../outside.txt", ".git/config", "/etc/passwd"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(routes.read_project_local_file(5, bad, user, None))
        assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        asyncio.run(routes.read_project_local_file(5, "missing.txt", user, None))
    assert exc.value.status_code == 404


def test_viewers_cannot_save():
    # Saving is guarded by require("code.edit") on the route; viewers do not have it.
    with pytest.raises(PermissionDenied):
        ensure(None, SimpleNamespace(role=UserRole.VIEWER), "code.edit")


def test_branches_and_checkout(monkeypatch, repo):
    user = _patch(monkeypatch, repo)
    data = asyncio.run(routes.list_project_local_branches(5, False, user, None))
    assert data["current_branch"] == "main" and data["branches"] == ["feature", "main"]
    assert data["github_connected"] is False

    status = asyncio.run(routes.checkout_project_local_branch(5, routes.LocalCheckoutRequest(branch="feature"),
                                                              user, None))
    assert status["current_branch"] == "feature"

    (repo / "bruno.json").write_text("changed")
    with pytest.raises(HTTPException, match="uncommitted changes"):
        asyncio.run(routes.checkout_project_local_branch(5, routes.LocalCheckoutRequest(branch="main"), user, None))
    with pytest.raises(HTTPException):
        asyncio.run(routes.checkout_project_local_branch(5, routes.LocalCheckoutRequest(branch="--force"),
                                                         user, None))
