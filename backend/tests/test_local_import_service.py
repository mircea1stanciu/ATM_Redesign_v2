import asyncio
import subprocess
from pathlib import Path

import pytest

from app.services.local_import_service import (
    checkout_local_branch,
    describe_checkout,
    import_branch,
    normalize_user_path,
    repo_identity,
    resolve_target,
)
from app.services.local_repo_service import LocalRepoError


def _git(*args, cwd=None):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture()
def remote(tmp_path: Path) -> str:
    """Bare repo at <tmp>/remote/acme/tests.git with branches main and feature/x."""
    bare = tmp_path / "remote" / "acme" / "tests.git"
    bare.mkdir(parents=True)
    _git("init", "--bare", "-b", "main", str(bare))
    work = tmp_path / "seed"
    _git("clone", str(bare), str(work))
    _git("config", "user.email", "t@example.com", cwd=work)
    _git("config", "user.name", "t", cwd=work)
    (work / "a.txt").write_text("main")
    _git("add", ".", cwd=work)
    _git("commit", "-m", "init", cwd=work)
    _git("push", "origin", "HEAD:main", cwd=work)
    _git("checkout", "-b", "feature/x", cwd=work)
    (work / "b.txt").write_text("feature")
    _git("add", ".", cwd=work)
    _git("commit", "-m", "feature", cwd=work)
    _git("push", "origin", "feature/x", cwd=work)
    return f"file://{bare}"


def _branch(path: Path) -> str:
    return subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=path,
                          capture_output=True, text=True, check=True).stdout.strip()


def test_repo_identity_handles_https_and_ssh():
    assert repo_identity("https://github.com/Acme/Tests.git") == ("acme", "tests")
    assert repo_identity("git@code.example.com:Acme/tests") == ("acme", "tests")
    assert repo_identity("https://github.com/") is None


def test_resolve_target_creates_missing_folder(tmp_path):
    assert resolve_target(tmp_path / "new", "https://h/acme/tests") == (tmp_path / "new", "clone")


def test_resolve_target_uses_repo_subfolder_when_folder_has_other_files(tmp_path):
    (tmp_path / "notes.txt").write_text("x")
    assert resolve_target(tmp_path, "https://h/acme/tests") == (tmp_path / "tests", "clone")


def test_resolve_target_rejects_checkout_of_another_repo(tmp_path):
    (tmp_path / ".git").mkdir()
    with pytest.raises(LocalRepoError, match="other/repo"):
        resolve_target(tmp_path, "https://h/acme/tests", origin_of=lambda _: "https://h/other/repo.git")


def test_import_clones_selected_branch_into_new_folder(tmp_path, remote):
    target, cloned = asyncio.run(import_branch(tmp_path / "out" / "copy", remote, "", "feature/x"))
    assert cloned and target == tmp_path / "out" / "copy"
    assert _branch(target) == "feature/x"
    assert (target / "b.txt").exists()


def test_import_into_existing_checkout_switches_and_creates_branch(tmp_path, remote):
    target, _ = asyncio.run(import_branch(tmp_path / "copy", remote, "", "main"))
    assert _branch(target) == "main"
    again, cloned = asyncio.run(import_branch(tmp_path / "copy", remote, "", "feature/x"))
    assert again == target and not cloned
    assert _branch(target) == "feature/x"
    assert (target / "b.txt").exists()


def test_import_rejects_option_like_branch(tmp_path, remote):
    with pytest.raises(LocalRepoError, match="Invalid branch"):
        asyncio.run(import_branch(tmp_path / "copy", remote, "", "--upload-pack=x"))


def test_normalize_user_path_accepts_shell_escaped_spaces(tmp_path):
    folder = tmp_path / "Mircea stuff" / "repo (1)"
    folder.mkdir(parents=True)
    escaped = str(folder).replace(" ", "\\ ").replace("(", "\\(").replace(")", "\\)") + "/"
    assert normalize_user_path(escaped, windows=False) == folder
    assert normalize_user_path(f'"{folder}"', windows=False) == folder
    assert normalize_user_path(str(folder), windows=False) == folder


def test_normalize_user_path_keeps_backslashes_on_windows():
    assert str(normalize_user_path("/missing/a\\ b", windows=True)) == "/missing/a\\ b"


def test_normalize_user_path_requires_absolute_path():
    with pytest.raises(LocalRepoError, match="absolute"):
        normalize_user_path("relative/folder", windows=False)


def test_describe_and_checkout_local_branch(tmp_path, remote):
    target, _ = asyncio.run(import_branch(tmp_path / "copy", remote, "", "feature/x"))
    _git("checkout", "-b", "local-only", cwd=target)
    info = describe_checkout(target, remote)
    assert info["matches_project"] and info["error"] is None
    assert info["current_branch"] == "local-only"
    assert {"feature/x", "local-only"} <= set(info["branches"])
    asyncio.run(checkout_local_branch(target, "feature/x"))
    assert _branch(target) == "feature/x"
    with pytest.raises(LocalRepoError, match="does not exist"):
        asyncio.run(checkout_local_branch(target, "nope"))


def test_describe_reports_wrong_repository(tmp_path, remote):
    target, _ = asyncio.run(import_branch(tmp_path / "copy", remote, "", "main"))
    info = describe_checkout(target, "https://h/other/project.git")
    assert not info["matches_project"] and "other/project" in info["error"]
