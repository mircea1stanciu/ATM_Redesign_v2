"""Workspace: branches, checkout, changes, the file editor, source comparison and publishing (commit/push/PR)."""
import asyncio
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import check_trainee_push, require
from app.modules.notifications.service import notify, reviewers
from app.modules.projects.checkouts import checkout_path, require_checkout, save_linked_path, service_project
from app.modules.projects.models import BranchOwner
from app.modules.projects.service import (
    get_project_or_404,
    github_headers,
    github_repository_context,
    local_status,
    project_github_token,
)
from app.modules.reviews import github
from app.modules.reviews.router import record_opened, request_reviewers
from app.modules.work.service import link_pull_request, link_pushed_files

router = APIRouter(prefix="/api/projects", tags=["Workspace"])


@router.get("/{project_id}/local/branches")
async def list_project_local_branches(
    project_id: int,
    fetch: bool = False,
    current_user=Depends(require("project.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Local and GitHub (origin) branches of the linked checkout; ``fetch`` refreshes the GitHub ones first."""
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    project = get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    repo_url = str(project.github_repo_url or "")
    fetch_error = None
    if fetch and repo_url:
        token = project_github_token(current_user, project_id)
        try:
            await LocalRepoService.fetch_remote(service_project(project.id, repo_path), repo_url,
                                                token or None)
        except LocalRepoError as exc:
            fetch_error = str(exc)
    status = await asyncio.to_thread(local_status, repo_path)
    _, out, _ = await LocalRepoService._run_git(
        ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], cwd=repo_path)
    remote = sorted({ref.split("/", 1)[1] for ref in out.splitlines() if "/" in ref and ref != "origin/HEAD"})
    return {**status, "remote_branches": remote, "github_connected": bool(repo_url), "fetch_error": fetch_error}


class LocalCheckoutRequest(BaseModel):
    branch: str


@router.post("/{project_id}/local/checkout")
async def checkout_project_local_branch(
    project_id: int,
    payload: LocalCheckoutRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Switch the linked checkout to a local branch, or create a tracking branch from ``origin/<branch>``."""
    from app.services.local_import_service import _check_branch_name, _git
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    branch = payload.branch.strip()
    try:
        _check_branch_name(branch)
        status = await asyncio.to_thread(local_status, repo_path)
        if branch == status["current_branch"]:
            return status
        if status["dirty"]:
            raise LocalRepoError("The project has uncommitted changes. Commit or discard them before switching "
                                 "branch (Projects › Local and GIT project Management).")

        async def has_ref(ref: str) -> bool:
            return (await LocalRepoService._run_git(["rev-parse", "--verify", "--quiet", ref], cwd=repo_path))[0] == 0

        if await has_ref(f"refs/heads/{branch}"):
            await _git(["checkout", branch], cwd=repo_path)
        elif await has_ref(f"refs/remotes/origin/{branch}"):
            await _git(["checkout", "-b", branch, "--track", f"origin/{branch}"], cwd=repo_path)
        else:
            raise LocalRepoError(f"Branch '{branch}' was not found locally or on GitHub. Refresh the branches.")
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return await asyncio.to_thread(local_status, repo_path)


@router.get("/{project_id}/local/changes")
async def get_project_local_changes(
    project_id: int,
    base: str = "",
    committed: bool = True,
    current_user=Depends(require("project.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """New/modified files of the linked checkout (uncommitted, plus commits not on ``base``) for focused runs."""
    from app.services import changed_tests_service

    project = get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    try:
        return await asyncio.to_thread(changed_tests_service.changed_files, repo_path, base or None,
                                       getattr(project, "default_branch", None) or "main", committed)
    except changed_tests_service.ChangedTestsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


_MAX_EDITOR_FILE_BYTES = 2_000_000


class LocalFileWriteRequest(BaseModel):
    path: str
    content: str


def _ai_project_service():
    from app.services import ai_project_service

    return ai_project_service


def _editor_target(repo_path: Path, rel_path: str) -> tuple[Path, str]:
    try:
        target, rel = _ai_project_service().resolve_project_path(repo_path, rel_path)
    except _ai_project_service().ProjectAIError as exc:
        raise HTTPException(status_code=400, detail=exc.message)
    if target.exists() and not target.is_file():
        raise HTTPException(status_code=400, detail=f"'{rel}' is not a file.")
    return target, rel


def _read_editor_file(repo_path: Path, rel_path: str) -> dict:
    target, rel = _editor_target(repo_path, rel_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"'{rel}' does not exist in the linked checkout.")
    size = target.stat().st_size
    if size > _MAX_EDITOR_FILE_BYTES:
        return {"path": rel, "content": None, "size": size, "binary": True, "too_large": True}
    data = target.read_bytes()
    try:
        if b"\x00" in data[:8192]:
            raise UnicodeDecodeError("utf-8", data, 0, 1, "binary")
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        return {"path": rel, "content": None, "size": size, "binary": True, "too_large": False}
    return {"path": rel, "content": content, "size": size, "binary": False, "too_large": False}


def _write_editor_file(repo_path: Path, rel_path: str, content: str) -> dict:
    if len(content.encode("utf-8")) > _MAX_EDITOR_FILE_BYTES:
        raise HTTPException(status_code=400, detail="The file is too large to save through the editor.")
    target, rel = _editor_target(repo_path, rel_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Keep the file's line endings: browsers edit with \n only.
    if target.is_file() and b"\r\n" in target.read_bytes()[:65536]:
        content = content.replace("\r\n", "\n").replace("\n", "\r\n")
    with open(target, "w", encoding="utf-8", newline="") as handle:
        handle.write(content)
    return _read_editor_file(repo_path, rel)


@router.get("/{project_id}/local/file")
async def read_project_local_file(
    project_id: int,
    path: str,
    current_user=Depends(require("project.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Read a text file of the linked checkout (for the editors)."""
    from app.services import ai_project_service  # noqa: F401 - imported in the event loop, not the worker thread

    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_read_editor_file, repo_path, path)


@router.put("/{project_id}/local/file")
async def write_project_local_file(
    project_id: int,
    payload: LocalFileWriteRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Save a text file in the linked checkout (not for viewers)."""
    get_project_or_404(db, project_id)
    from app.services import ai_project_service  # noqa: F401 - imported in the event loop, not the worker thread

    repo_path = require_checkout(current_user, project_id)
    return await asyncio.to_thread(_write_editor_file, repo_path, payload.path, payload.content)


@router.get("/{project_id}/local/tree")
async def get_project_local_tree(
    project_id: int,
    path: str = "",
    current_user=Depends(require("project.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """List an immediate directory in the user's linked local checkout."""
    get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    target_path = (repo_path / path).resolve()
    if target_path != repo_path and repo_path not in target_path.parents:
        raise HTTPException(status_code=400, detail="Invalid local repository path.")
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="The requested local repository path is not a directory.")

    entries = []
    for entry in sorted(target_path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        if entry.name == ".git":
            continue
        relative_path = entry.relative_to(repo_path).as_posix()
        entries.append(
            {
                "name": entry.name,
                "path": relative_path,
                "type": "dir" if entry.is_dir() else "file",
                "size": None if entry.is_dir() else entry.stat().st_size,
                "sha": "",
                "download_url": None,
            }
        )
    return entries


@router.get("/{project_id}/local/compare")
async def compare_project_local_repository(
    project_id: int,
    base: str = "main",
    head: str = "local",
    fetch: bool = True,
    current_user=Depends(require("project.view", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Compare the linked local checkout with the project's GitHub refs."""
    project = get_project_or_404(db, project_id)
    repo_path = require_checkout(current_user, project_id)

    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    legacy_project = service_project(project.id, repo_path)
    try:
        return await LocalRepoService.compare(
            legacy_project,
            base_spec=base,
            head_spec=head,
            repo_url=str(project.github_repo_url or "") or None,
            token=project_github_token(current_user, project_id) or None,
            do_fetch=fetch,
        )
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Publish: link a folder, sync, branch, commit, push, pull request ─────────


class LocalRepoConfigRequest(BaseModel):
    local_repo_path: Optional[str] = None


class LocalRepoSyncRequest(BaseModel):
    branch: Optional[str] = None


class LocalBranchRequest(BaseModel):
    branch: str
    from_ref: Optional[str] = None


class LocalCommitRequest(BaseModel):
    message: str


class LocalPushRequest(BaseModel):
    branch: Optional[str] = None


class PullRequestCreate(BaseModel):
    head: str
    base: Optional[str] = None
    title: str
    body: str = ""
    draft: bool = False
    # Phase 20: asked for a review on GitHub (logins and team slugs from /api/reviews/projects/{id}/reviewer-options).
    reviewers: list[str] = Field(default_factory=list, max_length=15)
    team_reviewers: list[str] = Field(default_factory=list, max_length=15)


def _publish_context(db: Session, current_user, project_id: int):
    """Project, the user's checkout folder and the service view of it, for publish operations."""
    project = get_project_or_404(db, project_id)
    repo_path = checkout_path(current_user, project_id)
    return project, repo_path, service_project(project.id, repo_path)


def _repository_url_and_token(project, current_user, project_id: int) -> tuple[str, str]:
    token = project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    repo_url = (project.github_repo_url or "").strip()
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")
    return repo_url, token


@router.patch("/{project_id}/local/config")
async def set_project_local_config(
    project_id: int,
    payload: LocalRepoConfigRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Point the project at another folder on this station, or clear the link with an empty path."""
    get_project_or_404(db, project_id)
    value = (payload.local_repo_path or "").strip()
    if value:
        folder = Path(value).expanduser().resolve()
        if not folder.is_dir():
            raise HTTPException(status_code=400, detail=f"Folder '{folder}' does not exist on this station.")
        save_linked_path(db, current_user, project_id, str(folder))
    else:
        save_linked_path(db, current_user, project_id, "")
    return await asyncio.to_thread(local_status, checkout_path(current_user, project_id))


@router.post("/{project_id}/local/sync")
async def sync_project_local_repo(
    project_id: int,
    payload: LocalRepoSyncRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Clone the GitHub repository into the checkout folder, or fetch and pull when it already exists."""
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    project, _, service_view = _publish_context(db, current_user, project_id)
    repo_url, token = _repository_url_and_token(project, current_user, project_id)
    try:
        return await LocalRepoService.sync(service_view, repo_url, token, branch=payload.branch)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{project_id}/local/branch")
async def create_project_local_branch(
    project_id: int,
    payload: LocalBranchRequest,
    current_user=Depends(require("code.push", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Create a branch in the checkout (from ``from_ref`` or the current HEAD) and switch to it."""
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    _, _, service_view = _publish_context(db, current_user, project_id)
    require_checkout(current_user, project_id)
    try:
        status = await LocalRepoService.create_branch(service_view, payload.branch, payload.from_ref)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # Remember who started the branch: trainees may push only their own branches.
    branch = status.get("current_branch") or payload.branch.strip()
    if not db.query(BranchOwner).filter(BranchOwner.project_id == project_id, BranchOwner.branch == branch).first():
        db.add(BranchOwner(project_id=project_id, branch=branch, user_id=current_user.id))
        db.commit()
    return status


@router.post("/{project_id}/local/commit")
async def commit_project_local_changes(
    project_id: int,
    payload: LocalCommitRequest,
    current_user=Depends(require("code.push", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Stage every change in the checkout and commit it."""
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    _, _, service_view = _publish_context(db, current_user, project_id)
    require_checkout(current_user, project_id)
    try:
        return await LocalRepoService.commit(service_view, payload.message)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{project_id}/local/push")
async def push_project_local_branch(
    project_id: int,
    payload: LocalPushRequest,
    current_user=Depends(require("code.push", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Push a branch (default: the current one) to the project's GitHub repository."""
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    project, repo_path, service_view = _publish_context(db, current_user, project_id)
    require_checkout(current_user, project_id)
    branch = (payload.branch or "").strip() or (await asyncio.to_thread(local_status, repo_path))["current_branch"]
    check_trainee_push(db, current_user, project_id, branch or "")
    repo_url, token = _repository_url_and_token(project, current_user, project_id)
    try:
        result = await LocalRepoService.push(service_view, repo_url, token, branch=branch)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {**result, "linked_tests": await _link_pushed_tests(db, project, repo_path, branch or "")}


async def _link_pushed_tests(db: Session, project, repo_path, branch: str) -> int:
    """Trace the test files the branch changed (compared with the default branch) to its work item."""
    from app.services import changed_tests_service

    try:
        changes = await asyncio.to_thread(changed_tests_service.changed_files, repo_path, None,
                                          getattr(project, "default_branch", None) or "main", True)
    except changed_tests_service.ChangedTestsError:
        return 0
    paths = [f["path"] for f in changes["files"] if f["status"] != "deleted" and f["scope"] == "committed"]
    return link_pushed_files(db, project.id, branch, paths)


@router.post("/{project_id}/github/pull-request")
async def create_project_pull_request(
    project_id: int,
    payload: PullRequestCreate,
    current_user=Depends(require("pr.create", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Open a pull request on GitHub from ``head`` into ``base`` (default ``main``)."""
    project, _, _ = _publish_context(db, current_user, project_id)
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    base = (payload.base or "main").strip()
    head = payload.head.strip()
    title = payload.title.strip()
    if not head:
        raise HTTPException(status_code=400, detail="A head (source) branch is required.")
    if head == base:
        raise HTTPException(status_code=400, detail="Head and base branches must be different.")
    if not title:
        raise HTTPException(status_code=400, detail="A pull request title is required.")

    body = {"title": title, "body": payload.body or "", "head": head, "base": base, "draft": payload.draft}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(f"{api_base}/repos/{owner}/{repo}/pulls", json=body,
                                     headers=github_headers(token, "token"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {exc}")

    if resp.status_code in (200, 201):
        pr = resp.json()
        url = pr.get("html_url", "")
        # A pull request from a work item's branch traces to the item and moves it to "in review".
        item = link_pull_request(db, project_id, head, url, pr.get("title", title)) if url else None
        number = pr.get("number", 0)
        record_opened(db, project_id, number, pr.get("title", title), url, head, base, current_user)
        requested, reviewers_error = [], None
        if number and (payload.reviewers or payload.team_reviewers):
            try:
                requested = await request_reviewers(github.Repo(api_base, owner, repo, token), number,
                                                    payload.reviewers, payload.team_reviewers)
            except HTTPException as exc:  # the pull request is open; say why the reviewers were not asked
                reviewers_error = str(exc.detail)
        author = current_user.full_name or current_user.username
        notify(db, reviewers(db, project_id, current_user), "review_request",
               f"{author} asks for a review: {pr.get('title', title)}",
               f"{project.name} · {head} → {base}", f"/reviews/{project_id}/{number}" if number else (url or None),
               project_id=project_id)
        return {"number": pr.get("number", 0), "url": url, "state": pr.get("state", "open"),
                "title": pr.get("title", title), "head": head, "base": base,
                "requested_reviewers": requested,
                "requested_teams": [] if reviewers_error else payload.team_reviewers,
                "reviewers_error": reviewers_error,
                "work_item": {"id": item.id, "external_key": item.external_key} if item else None}
    if resp.status_code == 401:
        raise HTTPException(status_code=400, detail="GitHub token invalid or expired for this project.")
    if resp.status_code == 422:
        # Most often a pull request already exists, or the branch was not pushed.
        detail = "GitHub rejected the pull request."
        try:
            data = resp.json()
            errors = data.get("errors") or []
            messages = [str(e["message"]) for e in errors if isinstance(e, dict) and e.get("message")]
            detail = data.get("message", detail) + (f": {'; '.join(messages)}" if messages else "")
        except ValueError:
            pass
        raise HTTPException(status_code=422, detail=detail)
    raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
