"""Files changed in the linked checkout and the tests they map to ("test only new/modified features").

Two kinds of changes are reported:
* ``uncommitted`` – staged, unstaged and untracked files (what the AI assistant applied or the user edited);
* ``committed`` – commits on the current branch that are not on the base branch (``git merge-base``).

Bruno requests are grouped by collection so they can be run with ``bru run <file> <file> …``. Other
frameworks are mapped to their runnable targets in the browser (``findTargetForFile``).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

_STATUS = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed", "C": "added", "T": "modified",
           "U": "modified", "?": "added"}
_BRUNO_CONFIG = {"collection.bru", "folder.bru"}
MAX_FILES = 2000


class ChangedTestsError(Exception):
    pass


def _git(repo: Path, *args: str) -> tuple[int, str]:
    completed = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=False)
    return completed.returncode, completed.stdout


def _ref_exists(repo: Path, ref: str) -> bool:
    return _git(repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")[0] == 0


def default_base(repo: Path, default_branch: str = "main") -> str | None:
    """The branch new work is compared with: origin/<default>, then the local default, main, master."""
    candidates = [f"origin/{default_branch}", default_branch, "origin/main", "main", "origin/master", "master"]
    current = _git(repo, "rev-parse", "--abbrev-ref", "HEAD")[1].strip()
    for ref in dict.fromkeys(candidates):
        if ref != current and _ref_exists(repo, ref):
            return ref
    return None


def _uncommitted(repo: Path) -> dict[str, str]:
    code, out = _git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    if code != 0:
        raise ChangedTestsError("Could not read the git status of the linked checkout.")
    changes: dict[str, str] = {}
    entries = out.split("\0")
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        code_x, code_y, path = entry[0], entry[1], entry[3:]
        if code_x in "RC":
            i += 1  # the original path follows a rename/copy
        letter = "?" if code_x == "?" else ("D" if "D" in (code_x, code_y) else (code_x if code_x != " " else code_y))
        changes[path] = _STATUS.get(letter, "modified")
    return changes


def _committed(repo: Path, base: str) -> dict[str, str]:
    code, merge_base = _git(repo, "merge-base", base, "HEAD")
    if code != 0 or not merge_base.strip():
        raise ChangedTestsError(f"'{base}' has no common history with the current branch.")
    code, out = _git(repo, "diff", "--name-status", "-z", "--no-renames", merge_base.strip(), "HEAD")
    if code != 0:
        raise ChangedTestsError(f"Could not compare the current branch with '{base}'.")
    parts = [p for p in out.split("\0") if p]
    return {parts[i + 1]: _STATUS.get(parts[i][0], "modified") for i in range(0, len(parts) - 1, 2)}


def _bruno_collection(repo: Path, rel: str) -> str | None:
    folder = (repo / rel).parent
    while True:
        if (folder / "bruno.json").is_file():
            return folder.relative_to(repo).as_posix() or "."
        if folder == repo or repo not in folder.parents:
            return None
        folder = folder.parent


def _bruno_groups(repo: Path, files: list[dict]) -> list[dict]:
    """Changed Bruno requests per collection; a changed folder.bru / collection.bru selects that folder."""
    groups: dict[str, dict] = {}
    for item in files:
        rel = item["path"]
        if item["status"] == "deleted" or not rel.endswith(".bru"):
            continue
        collection = _bruno_collection(repo, rel)
        if collection is None:
            continue
        inside = rel if collection == "." else rel[len(collection) + 1:]
        parts = inside.split("/")
        group = groups.setdefault(collection, {"collection": collection, "requests": [], "environments_changed": []})
        if parts[0] == "environments":
            group["environments_changed"].append(inside)
            continue
        name = parts[-1]
        target = ("/".join(parts[:-1]) or ".") if name in _BRUNO_CONFIG else inside
        if target not in group["requests"]:
            group["requests"].append(target)
    result = []
    for group in groups.values():
        # A whole folder that is selected already includes its requests.
        folders = [r for r in group["requests"] if not r.endswith(".bru")]
        if "." in folders:
            group["requests"] = ["."]
        else:
            group["requests"] = sorted(r for r in group["requests"]
                                       if not any(r != f and r.startswith(f"{f}/") for f in folders))
        environments_dir = repo / group["collection"] / "environments"
        group["environments"] = (sorted(p.stem for p in environments_dir.glob("*.bru"))
                                 if environments_dir.is_dir() else [])
        if group["requests"]:
            result.append(group)
    return sorted(result, key=lambda g: g["collection"])


def changed_files(repo: Path, base: str | None = None, default_branch: str = "main",
                  include_committed: bool = True) -> dict:
    """Changed files (uncommitted + committed since ``base``) and the Bruno requests among them."""
    if not (repo / ".git").exists():
        raise ChangedTestsError("No local checkout exists yet. Link or import a repository first.")
    base = (base or "").strip() or None
    if base and (base.startswith("-") or not _ref_exists(repo, base)):
        raise ChangedTestsError(f"Branch '{base}' was not found in the linked checkout. Refresh the branches.")
    if include_committed and base is None:
        base = default_base(repo, default_branch)
    files: dict[str, dict] = {}
    if include_committed and base:
        for path, status in _committed(repo, base).items():
            files[path] = {"path": path, "status": status, "scope": "committed"}
    for path, status in _uncommitted(repo).items():
        files[path] = {"path": path, "status": status, "scope": "uncommitted"}
    ordered = sorted(files.values(), key=lambda f: f["path"])
    truncated = len(ordered) > MAX_FILES
    ordered = ordered[:MAX_FILES]
    branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD")[1].strip() or None
    return {"branch": branch, "base": base if include_committed else None, "files": ordered,
            "truncated": truncated, "bruno": _bruno_groups(repo, ordered)}
