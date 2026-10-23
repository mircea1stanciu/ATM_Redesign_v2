"""Server-side managed local git working copies for projects.

Each project can have a local checkout of its repository living on the machine
that runs the backend. This service handles cloning/pulling that checkout,
reporting its git status, and safely browsing its files. The authentication
token is only ever used transiently as part of the remote URL for
clone/fetch/pull and is never persisted into the repo's git config.
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse


class LocalRepoError(Exception):
    """Raised when a local git operation fails."""


def _default_base_dir() -> Path:
    from app.modules.projects.checkouts import managed_checkouts_dir

    return managed_checkouts_dir()


class LocalRepoService:
    """Manage a per-project local git working copy on the backend host."""

    @staticmethod
    def get_local_path(project) -> Path:
        """Return the on-disk path of the project's local working copy.

        Uses a custom path from ``config_json["local_repo_path"]`` when set,
        otherwise a managed directory under ``LOCAL_REPOS_DIR``/<project_id>.
        """
        cfg = project.config_json or {}
        custom = cfg.get("local_repo_path")
        if custom:
            return Path(str(custom)).expanduser().resolve()
        return (_default_base_dir() / str(project.id)).resolve()

    # ── git plumbing ─────────────────────────────────────────────────────────

    @staticmethod
    async def _run_git(args: list[str], cwd: Path | None = None, timeout: int = 120) -> tuple[int, str, str]:
        """Run a git command, returning (returncode, stdout, stderr).

        ``GIT_TERMINAL_PROMPT=0`` prevents git from hanging on an interactive
        credential prompt when a token is missing or invalid.
        """
        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["GCM_INTERACTIVE"] = "never"
        proc = await asyncio.create_subprocess_exec(
            "git",
            *args,
            cwd=str(cwd) if cwd else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise LocalRepoError("git command timed out")
        return proc.returncode or 0, stdout_b.decode(errors="replace"), stderr_b.decode(errors="replace")

    @staticmethod
    def _authenticated_url(repo_url: str, token: str) -> str:
        """Embed the token into an HTTPS clone URL (used transiently only).

        SSH URLs are converted to HTTPS so the token can be used. Returns the
        original URL unchanged when no token is provided.
        """
        if not token:
            return repo_url

        # Normalise SSH form git@host:owner/repo(.git) -> https://host/owner/repo.git
        ssh_match = re.match(r"^git@([^:]+):(.+)$", repo_url)
        if ssh_match:
            repo_url = f"https://{ssh_match.group(1)}/{ssh_match.group(2)}"

        parsed = urlparse(repo_url)
        if parsed.scheme not in {"http", "https"}:
            return repo_url

        # x-access-token is accepted by GitHub / GHES for both classic and
        # fine-grained tokens as the git-over-HTTPS username.
        netloc = f"x-access-token:{quote(token, safe='')}@{parsed.hostname}"
        if parsed.port:
            netloc += f":{parsed.port}"
        return urlunparse((parsed.scheme, netloc, parsed.path, "", "", ""))

    @staticmethod
    def _sanitize_remote(text: str) -> str:
        """Strip any embedded credentials from git output before returning it."""
        return re.sub(r"://[^@/]+@", "://", text)

    # ── high-level operations ────────────────────────────────────────────────

    @classmethod
    async def status(cls, project) -> dict:
        """Return the current state of the local working copy."""
        path = cls.get_local_path(project)
        git_dir = path / ".git"
        result: dict = {
            "path": str(path),
            "exists": path.exists(),
            "is_git_repo": git_dir.exists(),
            "current_branch": None,
            "branches": [],
            "last_commit": None,
            "dirty": False,
            "has_upstream": False,
            "ahead": 0,
            "behind": 0,
        }
        if not git_dir.exists():
            return result

        rc, out, _ = await cls._run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=path)
        if rc == 0:
            result["current_branch"] = out.strip()

        rc, out, _ = await cls._run_git(
            ["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd=path
        )
        if rc == 0:
            result["branches"] = [b for b in out.splitlines() if b.strip()]

        rc, out, _ = await cls._run_git(
            ["log", "-1", "--pretty=%H%n%an%n%ad%n%s", "--date=iso"], cwd=path
        )
        if rc == 0 and out.strip():
            lines = out.splitlines()
            result["last_commit"] = {
                "sha": lines[0] if len(lines) > 0 else "",
                "author": lines[1] if len(lines) > 1 else "",
                "date": lines[2] if len(lines) > 2 else "",
                "message": lines[3] if len(lines) > 3 else "",
            }

        rc, out, _ = await cls._run_git(["status", "--porcelain"], cwd=path)
        if rc == 0:
            result["dirty"] = bool(out.strip())

        # Whether HEAD has an upstream (i.e. the branch has been pushed at
        # least once) and, if so, how far ahead/behind it is.
        rc, _, _ = await cls._run_git(
            ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd=path
        )
        result["has_upstream"] = rc == 0
        if result["has_upstream"]:
            rc, out, _ = await cls._run_git(
                ["rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd=path
            )
            if rc == 0:
                parts = out.split()
                if len(parts) == 2:
                    try:
                        result["ahead"] = int(parts[0])
                        result["behind"] = int(parts[1])
                    except ValueError:
                        pass

        return result

    @classmethod
    async def sync(cls, project, repo_url: str, token: str, branch: str | None = None) -> dict:
        """Clone the repository if absent, otherwise fetch and pull.

        The token is only used transiently in the remote URL for the network
        operation; the persisted remote ``origin`` keeps a clean, token-free URL.
        """
        path = cls.get_local_path(project)
        git_dir = path / ".git"
        clean_url = cls._sanitize_remote(repo_url)
        authed_url = cls._authenticated_url(repo_url, token)

        if not git_dir.exists():
            # Fresh clone into an empty/nonexistent directory.
            if path.exists() and any(path.iterdir()):
                raise LocalRepoError(
                    f"Local path '{path}' already exists and is not empty but is not a git repo."
                )
            path.parent.mkdir(parents=True, exist_ok=True)
            args = ["clone"]
            if branch:
                args += ["--branch", branch]
            args += [authed_url, str(path)]
            rc, _, err = await cls._run_git(args, timeout=600)
            if rc != 0:
                raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git clone failed")
            # Reset origin to a token-free URL so no credential is persisted.
            await cls._run_git(["remote", "set-url", "origin", clean_url], cwd=path)
        else:
            # Existing repo: fetch + pull the (optionally specified) branch.
            rc, _, err = await cls._run_git(
                ["fetch", authed_url, "--prune", "--tags"], cwd=path, timeout=600
            )
            if rc != 0:
                raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git fetch failed")

            if branch:
                rc, _, err = await cls._run_git(["checkout", branch], cwd=path)
                if rc != 0:
                    # Branch may only exist on the remote — create a tracking branch.
                    rc, _, err = await cls._run_git(
                        ["checkout", "-B", branch, f"origin/{branch}"], cwd=path
                    )
                    if rc != 0:
                        raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git checkout failed")

            rc, cur_out, _ = await cls._run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=path)
            current = cur_out.strip() or (branch or "")
            if current:
                rc, _, err = await cls._run_git(
                    ["pull", authed_url, current], cwd=path, timeout=600
                )
                if rc != 0:
                    raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git pull failed")

        return await cls.status(project)

    @classmethod
    async def checkout(cls, project, branch: str) -> dict:
        """Checkout an existing local branch."""
        path = cls.get_local_path(project)
        if not (path / ".git").exists():
            raise LocalRepoError("No local checkout exists yet. Sync the repository first.")
        rc, _, err = await cls._run_git(["checkout", branch], cwd=path)
        if rc != 0:
            raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git checkout failed")
        return await cls.status(project)

    @classmethod
    async def link_existing(cls, path: Path, repo_url: str) -> None:
        """Verify an existing on-disk folder is a git checkout of ``repo_url``.

        Raises :class:`LocalRepoError` if the folder isn't a git repo, has no
        ``origin`` remote, or points at a different owner/repo than expected.
        Only the owner+repo pair is compared, so http(s)/ssh/host differences
        (e.g. GHES vs github.com mirrors) don't cause false mismatches.
        """
        from app.services.github_service import GitHubService

        if not path.exists() or not path.is_dir():
            raise LocalRepoError(f"Path '{path}' does not exist or is not a directory.")
        if not (path / ".git").exists():
            raise LocalRepoError(f"'{path}' is not a git repository (no .git folder found).")

        rc, out, err = await cls._run_git(["remote", "get-url", "origin"], cwd=path)
        if rc != 0 or not out.strip():
            raise LocalRepoError(
                "The existing repository has no 'origin' remote configured, "
                "so it cannot be verified against this project's GitHub repo."
            )
        origin_url = cls._sanitize_remote(out.strip())

        try:
            expected_owner, expected_repo = GitHubService.parse_github_url(repo_url)
            actual_owner, actual_repo = GitHubService.parse_github_url(origin_url)
        except ValueError as exc:
            raise LocalRepoError(f"Could not parse repository URL: {exc}") from exc

        if expected_owner.lower() != actual_owner.lower() or expected_repo.lower() != actual_repo.lower():
            raise LocalRepoError(
                f"This folder's origin remote points to '{actual_owner}/{actual_repo}', "
                f"which doesn't match this project's repository '{expected_owner}/{expected_repo}'. "
                "Choose a folder checked out from the same repository."
            )

    # ── branch / commit / push ───────────────────────────────────────────────

    @classmethod
    async def create_branch(cls, project, branch: str, from_ref: str | None = None) -> dict:
        """Create and checkout a new local branch (optionally from a ref)."""
        path = cls.get_local_path(project)
        if not (path / ".git").exists():
            raise LocalRepoError("No local checkout exists yet. Sync the repository first.")
        branch = (branch or "").strip()
        if not branch:
            raise LocalRepoError("A branch name is required.")
        args = ["checkout", "-b", branch]
        if from_ref:
            args.append(from_ref)
        rc, _, err = await cls._run_git(args, cwd=path)
        if rc != 0:
            raise LocalRepoError(cls._sanitize_remote(err.strip()) or "Could not create branch")
        return await cls.status(project)

    @classmethod
    async def commit(cls, project, message: str, add_all: bool = True) -> dict:
        """Stage (optionally everything) and commit local changes."""
        path = cls.get_local_path(project)
        if not (path / ".git").exists():
            raise LocalRepoError("No local checkout exists yet. Sync the repository first.")
        message = (message or "").strip()
        if not message:
            raise LocalRepoError("A commit message is required.")

        if add_all:
            rc, _, err = await cls._run_git(["add", "-A"], cwd=path)
            if rc != 0:
                raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git add failed")

        # Nothing staged → make it a clear, friendly error.
        rc, _, _ = await cls._run_git(["diff", "--cached", "--quiet"], cwd=path)
        if rc == 0:
            raise LocalRepoError("Nothing to commit — there are no staged changes.")

        # Provide a fallback identity so the commit doesn't fail on fresh hosts.
        env_args = [
            "-c", "user.name=AutomationTestManager",
            "-c", "user.email=automation@localhost",
        ]
        rc, _, err = await cls._run_git([*env_args, "commit", "-m", message], cwd=path)
        if rc != 0:
            raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git commit failed")
        return await cls.status(project)

    @classmethod
    async def push(
        cls,
        project,
        repo_url: str,
        token: str,
        branch: str | None = None,
        set_upstream: bool = True,
    ) -> dict:
        """Push a local branch to ``origin`` using the token transiently.

        Returns ``{status, branch, pushed}``. The token is embedded only in the
        one-off push URL and is stripped from any surfaced output.
        """
        path = cls.get_local_path(project)
        if not (path / ".git").exists():
            raise LocalRepoError("No local checkout exists yet. Sync the repository first.")
        if not repo_url:
            raise LocalRepoError("No repository URL configured for this project.")
        if not token:
            raise LocalRepoError("No GitHub token configured for your account on this project.")

        if not branch:
            rc, out, _ = await cls._run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=path)
            branch = out.strip()
        if not branch or branch == "HEAD":
            raise LocalRepoError("Could not determine the current branch to push.")

        authed_url = cls._authenticated_url(repo_url, token)
        args = ["push"]
        if set_upstream:
            args.append("-u")
        args += [authed_url, f"{branch}:{branch}"]
        rc, _, err = await cls._run_git(args, cwd=path, timeout=600)
        if rc != 0:
            raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git push failed")

        status = await cls.status(project)
        return {"status": status, "branch": branch, "pushed": True}

    # ── comparison (3-way diff) ──────────────────────────────────────────────

    # Safety caps so a huge diff can't blow up the response payload.
    MAX_FILES = 800
    MAX_PATCH_LINES = 3000

    @classmethod
    async def fetch_remote(cls, project, repo_url: str, token: str | None) -> None:
        """Update ``origin/*`` refs without touching the working tree.

        Used before a compare so the GitHub-side selectors reflect the live
        remote. The token (when present) is used only for this transient fetch.
        """
        path = cls.get_local_path(project)
        if not (path / ".git").exists():
            raise LocalRepoError("No local checkout exists yet. Sync the repository first.")
        if not repo_url:
            return
        fetch_url = cls._authenticated_url(repo_url, token) if token else repo_url
        rc, _, err = await cls._run_git(
            ["fetch", "--prune", fetch_url, "+refs/heads/*:refs/remotes/origin/*"],
            cwd=path,
            timeout=300,
        )
        if rc != 0:
            raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git fetch failed")

    @classmethod
    async def _resolve_default_branch(cls, path: Path, fallback: str | None) -> str:
        rc, out, _ = await cls._run_git(
            ["rev-parse", "--abbrev-ref", "origin/HEAD"], cwd=path
        )
        if rc == 0 and out.strip().startswith("origin/"):
            return out.strip().split("/", 1)[1]
        return fallback or "main"

    @staticmethod
    def _resolve_selector(spec: str, default_branch: str) -> tuple[str | None, str]:
        """Map a compare selector to a git treeish (or None for the working tree).

        Selectors: ``local`` | ``main`` | ``branch:<name>``.
        Returns ``(treeish_or_None, human_label)``.
        """
        spec = (spec or "").strip()
        if spec == "local":
            return None, "Local copy"
        if spec == "main":
            return f"origin/{default_branch}", f"GitHub · {default_branch}"
        if spec.startswith("branch:"):
            name = spec.split(":", 1)[1].strip()
            if not name:
                raise LocalRepoError("Branch selector is missing a name.")
            return f"origin/{name}", f"GitHub · {name}"
        raise LocalRepoError(f"Invalid compare selector: {spec!r}")

    @classmethod
    async def compare(
        cls,
        project,
        base_spec: str,
        head_spec: str,
        repo_url: str | None = None,
        token: str | None = None,
        do_fetch: bool = True,
    ) -> dict:
        """Produce a PR-style file diff between two of {local, main, branch:x}.

        Direction cases (base → head):
          * ref → ref     : ``git diff base head``
          * ref → local   : ``git diff base``            (working tree is head)
          * local → ref   : ``git diff -R head``         (reverse so local is base)
          * local → local : empty
        """
        path = cls.get_local_path(project)
        if not (path / ".git").exists():
            raise LocalRepoError("No local checkout exists yet. Sync the repository first.")

        if do_fetch and repo_url and token:
            # Best-effort refresh; a stale-but-present clone still compares.
            try:
                await cls.fetch_remote(project, repo_url, token)
            except LocalRepoError:
                pass

        default_branch = await cls._resolve_default_branch(path, project.default_branch)
        base_ref, base_label = cls._resolve_selector(base_spec, default_branch)
        head_ref, head_label = cls._resolve_selector(head_spec, default_branch)

        # Verify remote refs exist locally (i.e. were fetched).
        for ref in (base_ref, head_ref):
            if ref:
                rc, _, _ = await cls._run_git(
                    ["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], cwd=path
                )
                if rc != 0:
                    raise LocalRepoError(
                        f"Ref '{ref}' not found locally. Sync the local copy so the "
                        "branch is fetched, then try again."
                    )

        empty_result = {
            "base": base_spec,
            "head": head_spec,
            "base_label": base_label,
            "head_label": head_label,
            "default_branch": default_branch,
            "files": [],
            "total_files": 0,
            "total_additions": 0,
            "total_deletions": 0,
            "truncated": False,
        }

        if base_ref is None and head_ref is None:
            return empty_result

        if base_ref and head_ref:
            diff_args = [base_ref, head_ref]
        elif base_ref and head_ref is None:
            diff_args = [base_ref]
        else:  # base_ref is None, head_ref present → reverse so local is the base side
            diff_args = ["-R", head_ref]

        # 1) Structured file list with statuses (rename-aware).
        rc, name_status_out, err = await cls._run_git(
            ["diff", "--name-status", "-M", *diff_args], cwd=path, timeout=180
        )
        if rc != 0:
            raise LocalRepoError(cls._sanitize_remote(err.strip()) or "git diff failed")

        files: list[dict] = []
        order: list[str] = []
        by_path: dict[str, dict] = {}
        for line in name_status_out.splitlines():
            if not line.strip():
                continue
            parts = line.split("\t")
            code = parts[0]
            letter = code[0]
            old_path = None
            if letter in ("R", "C") and len(parts) >= 3:
                old_path = parts[1]
                new_path = parts[2]
            else:
                new_path = parts[-1]
            status = {
                "A": "added",
                "M": "modified",
                "D": "deleted",
                "R": "renamed",
                "C": "copied",
                "T": "modified",
            }.get(letter, "modified")
            entry = {
                "path": new_path,
                "old_path": old_path,
                "status": status,
                "additions": 0,
                "deletions": 0,
                "binary": False,
                "patch": None,
                "patch_truncated": False,
            }
            files.append(entry)
            order.append(new_path)
            by_path[new_path] = entry

        # Include untracked files when comparing against the local working tree.
        # Plain `git diff` does not surface them, but users expect to see all
        # uncommitted local changes in the Compare view.
        local_is_head = bool(base_ref and head_ref is None)
        local_is_base = bool(base_ref is None and head_ref)
        extra_patches: list[tuple[str, str]] = []
        if local_is_head or local_is_base:
            rc, status_out, _ = await cls._run_git(
                ["status", "--porcelain", "--untracked-files=all", "-z"],
                cwd=path,
                timeout=120,
            )
            if rc == 0 and status_out:
                for item in status_out.split("\0"):
                    if not item.startswith("?? "):
                        continue
                    rel_path = item[3:]
                    if not rel_path or rel_path in by_path:
                        continue

                    entry = {
                        "path": rel_path,
                        "old_path": None,
                        "status": "added" if local_is_head else "deleted",
                        "additions": 0,
                        "deletions": 0,
                        "binary": False,
                        "patch": None,
                        "patch_truncated": False,
                    }
                    files.append(entry)
                    order.append(rel_path)
                    by_path[rel_path] = entry

                    left = "/dev/null" if local_is_head else rel_path
                    right = rel_path if local_is_head else "/dev/null"
                    rc_patch, patch_text, _ = await cls._run_git(
                        ["diff", "--no-color", "--no-index", "--", left, right],
                        cwd=path,
                        timeout=120,
                    )
                    # git diff --no-index returns 1 when files differ; that's expected.
                    if rc_patch in (0, 1) and patch_text:
                        extra_patches.append((rel_path, patch_text))

        truncated = False
        if len(files) > cls.MAX_FILES:
            truncated = True
            files = files[: cls.MAX_FILES]
            kept = {f["path"] for f in files}
            by_path = {p: e for p, e in by_path.items() if p in kept}

        # 2) Full unified patch, split per file and attached to the entries.
        rc, full_patch, _ = await cls._run_git(
            ["diff", "--no-color", "-M", *diff_args], cwd=path, timeout=180
        )
        if rc == 0 and full_patch:
            cls._attach_patches(full_patch, by_path)

        for rel_path, patch_text in extra_patches:
            entry = by_path.get(rel_path)
            if entry is not None:
                cls._attach_patches(patch_text, {rel_path: entry})

        total_add = sum(f["additions"] for f in files)
        total_del = sum(f["deletions"] for f in files)

        return {
            "base": base_spec,
            "head": head_spec,
            "base_label": base_label,
            "head_label": head_label,
            "default_branch": default_branch,
            "files": files,
            "total_files": len(files),
            "total_additions": total_add,
            "total_deletions": total_del,
            "truncated": truncated,
        }

    _DIFF_HEADER_RE = re.compile(r'^diff --git a/(.+?) b/(.+?)\s*$')

    @classmethod
    def _attach_patches(cls, full_patch: str, by_path: dict[str, dict]) -> None:
        """Split a unified diff into per-file blocks and attach to entries."""
        lines = full_patch.splitlines()
        blocks: list[list[str]] = []
        current: list[str] = []
        for line in lines:
            if line.startswith("diff --git "):
                if current:
                    blocks.append(current)
                current = [line]
            else:
                if current:
                    current.append(line)
        if current:
            blocks.append(current)

        for block in blocks:
            header = block[0]
            m = cls._DIFF_HEADER_RE.match(header)
            if not m:
                continue
            b_path = m.group(2).strip().strip('"')
            entry = by_path.get(b_path)
            if entry is None:
                # Fall back to the a/ path (deletes, or quoting differences).
                a_path = m.group(1).strip().strip('"')
                entry = by_path.get(a_path)
            if entry is None:
                continue

            additions = 0
            deletions = 0
            binary = False
            for ln in block:
                if ln.startswith("Binary files ") and ln.rstrip().endswith("differ"):
                    binary = True
                elif ln.startswith("+") and not ln.startswith("+++"):
                    additions += 1
                elif ln.startswith("-") and not ln.startswith("---"):
                    deletions += 1

            entry["binary"] = binary
            entry["additions"] = additions
            entry["deletions"] = deletions
            if binary:
                entry["patch"] = None
            elif len(block) > cls.MAX_PATCH_LINES:
                entry["patch"] = "\n".join(block[: cls.MAX_PATCH_LINES])
                entry["patch_truncated"] = True
            else:
                entry["patch"] = "\n".join(block)

    @classmethod
    def list_tree(cls, project, rel_path: str = "") -> list[dict]:
        """List files/directories in the local working copy at ``rel_path``.

        Guards against path traversal outside the repo root.
        """
        root = cls.get_local_path(project)
        if not root.exists():
            raise LocalRepoError("No local checkout exists yet. Sync the repository first.")

        target = (root / rel_path).resolve() if rel_path else root
        # Prevent escaping the repo root via ".." or symlinks.
        if root != target and root not in target.parents:
            raise LocalRepoError("Invalid path.")
        if not target.exists() or not target.is_dir():
            raise LocalRepoError("Path not found.")

        items: list[dict] = []
        for entry in sorted(target.iterdir(), key=lambda e: e.name.lower()):
            if entry.name == ".git":
                continue
            is_dir = entry.is_dir()
            rel = entry.relative_to(root).as_posix()
            size = None
            if not is_dir:
                try:
                    size = entry.stat().st_size
                except OSError:
                    size = None
            items.append(
                {
                    "name": entry.name,
                    "path": rel,
                    "type": "dir" if is_dir else "file",
                    "size": size,
                    "sha": rel,  # stable key for the UI; not a git sha
                    "download_url": None,
                }
            )
        return items

    @classmethod
    def remove(cls, project) -> None:
        """Delete the local working copy from disk, if we own it.

        Only folders inside the server's managed base directory (i.e. no
        custom ``local_repo_path`` override, or one explicitly marked
        ``local_repo_managed``) are actually deleted from disk. A folder the
        user pointed us at via "Existing project" is never deleted here —
        it's their pre-existing checkout, not ours to remove.
        """
        cfg = project.config_json or {}
        custom_path = cfg.get("local_repo_path")
        managed = bool(cfg.get("local_repo_managed")) if custom_path else True
        path = cls.get_local_path(project)
        if managed and path.exists():
            shutil.rmtree(path, ignore_errors=True)
