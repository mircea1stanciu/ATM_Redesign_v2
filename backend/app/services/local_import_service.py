"""Clone a project's GitHub branch into a user-chosen folder (or update an existing checkout).

Target folder rules for ``path``:
* missing or empty -> the folder is created and the branch is cloned into it;
* already a checkout of the same repository -> the branch is fetched and checked out
  (a local branch is created when it doesn't exist yet);
* a non-empty folder holding other files -> the clone goes into ``<path>/<repo-name>``
  (same rules apply to that subfolder).
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

from app.services.local_repo_service import LocalRepoError, LocalRepoService


def normalize_user_path(raw: str, windows: bool | None = None) -> Path:
    """Turn a path typed or pasted by the user into a usable absolute path.

    Accepts surrounding quotes, ``~`` and shell-escaped characters such as
    ``Mircea\\ stuff`` (as copied from a macOS/Linux terminal). On Windows,
    backslashes are path separators, so they are left alone.
    """
    windows = os.name == "nt" if windows is None else windows
    text = (raw or "").strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "'\"":
        text = text[1:-1].strip()
    if not text:
        raise LocalRepoError("A local folder path is required.")
    path = Path(text).expanduser()
    if not windows and "\\" in text and not path.exists():
        path = Path(re.sub(r"\\(.)", r"\1", text)).expanduser()
    if not path.is_absolute():
        raise LocalRepoError("An absolute folder path is required.")
    return path


def _git_out(path: Path, *args: str) -> str | None:
    completed = subprocess.run(["git", *args], cwd=path, text=True, capture_output=True, check=False)
    return completed.stdout.strip() if completed.returncode == 0 else None


def describe_checkout(path: Path, repo_url: str) -> dict:
    """Inspect an existing folder for the "Existing project" dialog."""
    info: dict = {
        "path": str(path),
        "exists": path.is_dir(),
        "is_git_repo": False,
        "origin": None,
        "matches_project": False,
        "current_branch": None,
        "branches": [],
        "dirty": False,
        "error": None,
    }
    if not info["exists"]:
        info["error"] = f"'{path}' does not exist."
        return info
    if not (path / ".git").exists():
        info["error"] = f"'{path}' is not a git repository (no .git folder)."
        return info
    info["is_git_repo"] = True
    origin = _git_out(path, "remote", "get-url", "origin")
    info["origin"] = LocalRepoService._sanitize_remote(origin) if origin else None
    expected, actual = repo_identity(repo_url), repo_identity(origin or "")
    info["matches_project"] = bool(expected and actual == expected)
    if not origin:
        info["error"] = "The repository has no 'origin' remote configured."
    elif not info["matches_project"]:
        found = "/".join(actual) if actual else origin
        info["error"] = f"This folder's origin points to '{found}', not '{'/'.join(expected or ('?', '?'))}'."
    info["current_branch"] = _git_out(path, "rev-parse", "--abbrev-ref", "HEAD")
    branches = _git_out(path, "for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads")
    info["branches"] = [b for b in (branches or "").splitlines() if b]
    info["dirty"] = bool(_git_out(path, "status", "--porcelain"))
    return info


async def checkout_local_branch(path: Path, branch: str) -> None:
    """Switch an existing checkout to one of its local branches."""
    _check_branch_name(branch)
    rc = (await LocalRepoService._run_git(["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=path))[0]
    if rc != 0:
        raise LocalRepoError(f"Local branch '{branch}' does not exist in '{path}'.")
    await _git(["checkout", branch], cwd=path)


def repo_identity(url: str) -> tuple[str, str] | None:
    """Return ``(owner, repo)`` (lower-case) for an https/ssh GitHub URL, or None."""
    url = (url or "").strip()
    if url.startswith("git@") and ":" in url:
        host, rest = url[4:].split(":", 1)
        url = f"https://{host}/{rest}"
    parts = urlparse(url).path.strip("/").removesuffix(".git").split("/")
    if len(parts) < 2 or not all(parts[-2:]):
        return None
    return parts[-2].lower(), parts[-1].lower()


def git_origin(path: Path) -> str | None:
    completed = subprocess.run(["git", "remote", "get-url", "origin"], cwd=path,
                               text=True, capture_output=True, check=False)
    return completed.stdout.strip() if completed.returncode == 0 else None


def resolve_target(path: Path, repo_url: str,
                   origin_of: Callable[[Path], str | None] = git_origin) -> tuple[Path, str]:
    """Pick the folder to use and whether to ``clone`` into it or ``update`` it."""
    expected = repo_identity(repo_url)
    if not expected:
        raise LocalRepoError("Could not parse the project's repository URL.")

    def classify(candidate: Path) -> str | None:
        if not candidate.exists():
            return "clone"
        if not candidate.is_dir():
            raise LocalRepoError(f"'{candidate}' is a file, not a folder.")
        if (candidate / ".git").exists():
            actual = repo_identity(origin_of(candidate) or "")
            if actual != expected:
                found = "/".join(actual) if actual else "an unknown remote"
                raise LocalRepoError(
                    f"'{candidate}' is a checkout of {found}, not {'/'.join(expected)}."
                )
            return "update"
        if not any(candidate.iterdir()):
            return "clone"
        return None

    mode = classify(path)
    if mode:
        return path, mode
    nested = path / expected[1]
    mode = classify(nested)
    if mode:
        return nested, mode
    raise LocalRepoError(
        f"'{path}' already contains other files, and '{nested}' exists but is not a checkout of this repository."
    )


def _check_branch_name(branch: str) -> None:
    if branch.startswith("-") or any(ch in branch for ch in " ~^:?*[\\") or ".." in branch:
        raise LocalRepoError(f"Invalid branch name '{branch}'.")


async def _git(args: list[str], cwd: Path | None = None, timeout: int = 120) -> str:
    rc, out, err = await LocalRepoService._run_git(args, cwd=cwd, timeout=timeout)
    if rc != 0:
        message = LocalRepoService._sanitize_remote((err or out).strip())
        raise LocalRepoError(message or f"git {args[0]} failed")
    return out


async def import_branch(path: Path, repo_url: str, token: str, branch: str | None) -> tuple[Path, bool]:
    """Clone or update ``branch`` under ``path``. Returns ``(checkout_path, cloned)``."""
    branch = (branch or "").strip() or None
    if branch:
        _check_branch_name(branch)
    target, mode = resolve_target(path, repo_url)
    clean_url = LocalRepoService._sanitize_remote(repo_url)
    authed_url = LocalRepoService._authenticated_url(repo_url, token)

    if mode == "clone":
        target.mkdir(parents=True, exist_ok=True)
        args = ["clone"]
        if branch:
            args += ["--branch", branch]
        await _git([*args, "--", authed_url, str(target)], timeout=900)
        # Keep the token out of the persisted git config.
        await _git(["remote", "set-url", "origin", clean_url], cwd=target)
        return target, True

    if not branch:
        branch = (await _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=target)).strip()
        _check_branch_name(branch)
    await _git(["fetch", authed_url, f"+refs/heads/{branch}:refs/remotes/origin/{branch}"], cwd=target, timeout=900)
    has_local = (await LocalRepoService._run_git(["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"],
                                                 cwd=target))[0] == 0
    if has_local:
        await _git(["checkout", branch], cwd=target)
        await _git(["merge", "--ff-only", f"origin/{branch}"], cwd=target)
    else:
        await _git(["checkout", "-b", branch, "--track", f"origin/{branch}"], cwd=target)
    return target, False
