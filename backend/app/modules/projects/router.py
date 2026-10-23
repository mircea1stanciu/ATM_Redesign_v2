"""Projects: CRUD, the GitHub link and overview, the local checkout link, starter projects."""
import asyncio
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.modules.projects.checkouts import (
    checkout_path,
    read_linked_path,
    save_linked_path,
)
from app.modules.projects.models import Project
from app.modules.projects.service import (
    check_organization_member,
    check_product_manager_access,
    get_project_or_404,
    github_get,
    github_repository_context,
    github_user_endpoint,
    list_github_folder,
    local_status,
    project_github_token,
    set_project_github_token,
    token_preview,
    user_settings,
)

router = APIRouter(prefix="/api/projects", tags=["Projects"])


# Pydantic Schemas
class ProjectCreate(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    community_id: str
    icon: str = "📋"
    color: str = "blue"


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    lead_user_id: Optional[int] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


# Project Endpoints
@router.get("/")
async def list_projects(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return projects in the test-automation client contract."""
    if not current_user.organization_id:
        return []

    projects = db.query(Project).filter(
        Project.organization_id == current_user.organization_id,
        Project.is_archived.is_(False)
    ).all()

    return [
        {
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "git_repo_url": project.github_repo_url or "",
            "git_provider": "github",
            "default_branch": "main",
            "framework": None,
            "config_json": None,
            "created_at": project.created_at.isoformat() if project.created_at else None,
        }
        for project in projects
    ]


@router.post("/")
async def create_project(
    project_data: ProjectCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new project - Only Product Managers"""
    # Check access
    check_product_manager_access(current_user)
    
    # Check if project key already exists
    existing = db.query(Project).filter(Project.key == project_data.key.upper()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Project key already exists")
    
    project = Project(
        key=project_data.key.upper(),
        name=project_data.name,
        description=project_data.description,
        community_id=project_data.community_id,
        organization_id=current_user.organization_id,
        icon=project_data.icon,
        color=project_data.color,
        created_by_user_id=current_user.id,
        lead_user_id=current_user.id
    )
    
    db.add(project)
    db.commit()
    db.refresh(project)
    
    return {"message": "Project created successfully", "project": project}


@router.get("/{project_id}")
async def get_project(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get project details - All organization members can view"""
    # Check user belongs to organization
    check_organization_member(current_user)
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {"project": project}


@router.patch("/{project_id}")
async def update_project(
    project_id: int,
    project_data: ProjectUpdate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update project - Only Product Managers"""
    # Check access
    check_product_manager_access(current_user)
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Update fields
    for field, value in project_data.dict(exclude_unset=True).items():
        setattr(project, field, value)
    
    db.commit()
    db.refresh(project)
    
    return {"message": "Project updated successfully", "project": project}


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete project - Only Product Managers"""
    # Check access
    check_product_manager_access(current_user)
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Delete the project (cascade will delete related issues, sprints, etc.)
    db.delete(project)
    db.commit()
    
    return {"message": "Project deleted successfully"}


# ── Per-project GitHub settings ───────────────────────────────────────────────
class ProjectGitHubConfig(BaseModel):
    github_token: Optional[str] = None
    github_repo_url: Optional[str] = None


class ProjectGitHubResponse(BaseModel):
    github_token_set: bool
    github_token_preview: str
    github_repo_url: str


class ProjectGitHubTestResponse(BaseModel):
    ok: bool
    login: Optional[str] = None
    name: Optional[str] = None
    error: Optional[str] = None


class LocalRepoLinkExistingRequest(BaseModel):
    path: str
    branch: Optional[str] = None


class LocalRepoImportRequest(BaseModel):
    path: str
    branch: Optional[str] = None


_GITHUB_OVERVIEW_TTL_SECONDS = 300


_github_overview_cache: dict[tuple[int, int], tuple[float, dict]] = {}


def _count_label(items, page_size: int):
    if not isinstance(items, list):
        return None
    return f"{len(items)}+" if len(items) >= page_size else len(items)


def _forget_github_overview(project_id: int) -> None:
    for key in [k for k in _github_overview_cache if k[0] == project_id]:
        _github_overview_cache.pop(key, None)


@router.get("/{project_id}/github/overview")
async def get_project_github_overview(
    project_id: int,
    refresh: bool = False,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Repository metadata, recent activity and detected test setup for the Overview page."""
    import time as time_module

    from app.services import github_overview_service as overview

    check_organization_member(current_user)
    project = get_project_or_404(db, project_id)
    if not (project.github_repo_url or "").strip():
        raise HTTPException(status_code=400, detail="No GitHub repository is configured for this project.")
    cache_key = (project_id, current_user.id)
    cached = _github_overview_cache.get(cache_key)
    if cached and not refresh and time_module.monotonic() - cached[0] < _GITHUB_OVERVIEW_TTL_SECONDS:
        return cached[1]

    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    base = f"{api_base}/repos/{owner}/{repo}"

    async def get_json(client, url, **params):
        try:
            response = await github_get(client, url, token, params=params or None)
        except httpx.HTTPError:
            return None
        return response.json() if response.status_code == 200 else None

    async def get_raw(client, path, ref):
        try:
            response = await github_get(client, f"{base}/contents/{path}", token,
                                         accept="application/vnd.github.raw+json", params={"ref": ref})
        except httpx.HTTPError:
            return None
        return response.text if response.status_code == 200 else None

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            meta_response = await github_get(client, base, token)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {exc}")
        if meta_response.status_code in (401, 403):
            raise HTTPException(status_code=400, detail="GitHub rejected the token for this repository.")
        if meta_response.status_code == 404:
            raise HTTPException(status_code=404,
                                detail=f"Repository {owner}/{repo} was not found or is not accessible.")
        if meta_response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"GitHub returned {meta_response.status_code}.")
        meta = meta_response.json()
        branch = meta.get("default_branch") or "main"

        tree, commit, languages, branches, contributors, runs = await asyncio.gather(
            get_json(client, f"{base}/git/trees/{branch}", recursive="1"),
            get_json(client, f"{base}/commits/{branch}"),
            get_json(client, f"{base}/languages"),
            get_json(client, f"{base}/branches", per_page="100"),
            get_json(client, f"{base}/contributors", per_page="5"),
            get_json(client, f"{base}/actions/runs", per_page="1"),
        )
        paths = [item.get("path", "") for item in (tree or {}).get("tree", []) if item.get("type") == "blob"]
        pom_text, package_text = await asyncio.gather(
            get_raw(client, "pom.xml", branch) if "pom.xml" in paths else asyncio.sleep(0, None),
            get_raw(client, "package.json", branch) if "package.json" in paths else asyncio.sleep(0, None),
        )

    commit_info = (commit or {}).get("commit") or {}
    latest_run = ((runs or {}).get("workflow_runs") or [None])[0]
    license_info = meta.get("license") or {}
    result = {
        "branch": branch,
        "analyzed_at": datetime.utcnow().isoformat(),
        "repository": {
            "full_name": meta.get("full_name"),
            "html_url": meta.get("html_url"),
            "description": meta.get("description"),
            "visibility": meta.get("visibility") or ("private" if meta.get("private") else "public"),
            "archived": bool(meta.get("archived")),
            "default_branch": branch,
            "language": meta.get("language"),
            "topics": meta.get("topics") or [],
            "stars": meta.get("stargazers_count"),
            "forks": meta.get("forks_count"),
            "open_issues": meta.get("open_issues_count"),
            "size_kb": meta.get("size"),
            "license": license_info.get("spdx_id") or license_info.get("name"),
            "created_at": meta.get("created_at"),
            "pushed_at": meta.get("pushed_at"),
            "branches_count": _count_label(branches, 100),
            "languages": overview.language_shares(languages or {}),
            "contributors": [
                {"login": c.get("login"), "contributions": c.get("contributions"), "html_url": c.get("html_url")}
                for c in (contributors if isinstance(contributors, list) else [])
            ],
            "latest_commit": {
                "sha": (commit or {}).get("sha"),
                "message": (commit_info.get("message") or "").split("\n", 1)[0],
                "author": (commit_info.get("author") or {}).get("name"),
                "date": (commit_info.get("author") or {}).get("date"),
                "html_url": (commit or {}).get("html_url"),
            } if commit else None,
            "latest_workflow_run": {
                "name": latest_run.get("name"),
                "status": latest_run.get("status"),
                "conclusion": latest_run.get("conclusion"),
                "branch": latest_run.get("head_branch"),
                "created_at": latest_run.get("created_at"),
                "html_url": latest_run.get("html_url"),
            } if latest_run else None,
        },
        "detection": {
            **overview.analyze_tree(paths, pom_text, package_text),
            "tree_truncated": bool((tree or {}).get("truncated")),
            "tree_available": tree is not None,
        },
    }
    try:
        result["local"] = await get_project_local_status(project_id, current_user, db)
    except HTTPException:
        result["local"] = None
    _github_overview_cache[cache_key] = (time_module.monotonic(), result)
    return result


@router.get("/{project_id}/github/analyze")
async def analyze_project_repository(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect test frameworks and collections from the GitHub repository tree."""
    check_organization_member(current_user)
    project = get_project_or_404(db, project_id)
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await github_get(
            client,
            f"{api_base}/repos/{owner}/{repo}/git/trees/main",
            token,
            params={"recursive": "1"},
        )
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code == 401 else response.status_code, detail=response.text[:200]
        )

    from app.services.framework_detector import FrameworkDetector

    files = [item.get("path", "") for item in response.json().get("tree", []) if item.get("type") == "blob"]
    return {
        "frameworks": FrameworkDetector.detect_frameworks(files),
        "projects": FrameworkDetector.detect_projects(files),
        "files_count": len(files),
    }


@router.get("/{project_id}/github/templates")
async def get_project_github_templates(
    project_id: int,
    ref: str = "",
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List dispatchable workflows and structured issue templates from GitHub."""
    check_organization_member(current_user)
    project = get_project_or_404(db, project_id)
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    branch = ref or "main"

    from app.services.github_workflow_service import parse_issue_template, parse_workflow_dispatch

    workflows = []
    issue_templates = []
    async with httpx.AsyncClient(timeout=20) as client:
        workflow_files = await list_github_folder(
            client, api_base, owner, repo, ".github/workflows", branch, token
        )
        for entry in workflow_files:
            name = str(entry.get("name") or "")
            if entry.get("type") != "file" or not name.endswith((".yml", ".yaml")):
                continue
            raw = await github_get(
                client,
                f"{api_base}/repos/{owner}/{repo}/contents/{entry.get('path')}",
                token,
                accept="application/vnd.github.raw+json",
                params={"ref": branch},
            )
            if raw.status_code != 200:
                continue
            parsed = parse_workflow_dispatch(raw.text)
            if parsed:
                workflows.append({
                    "id": name,
                    "path": entry.get("path") or "",
                    "name": parsed["name"] or name,
                    "inputs": parsed["inputs"],
                })

        template_files = await list_github_folder(
            client, api_base, owner, repo, ".github/ISSUE_TEMPLATE", branch, token
        )
        for entry in template_files:
            name = str(entry.get("name") or "")
            if entry.get("type") != "file" or not name.endswith((".yml", ".yaml")):
                continue
            raw = await github_get(
                client,
                f"{api_base}/repos/{owner}/{repo}/contents/{entry.get('path')}",
                token,
                accept="application/vnd.github.raw+json",
                params={"ref": branch},
            )
            if raw.status_code != 200:
                continue
            parsed = parse_issue_template(raw.text)
            if parsed:
                issue_templates.append({
                    "id": name,
                    "path": entry.get("path") or "",
                    "name": parsed["name"] or name,
                    "description": parsed["description"],
                    "fields": parsed["fields"],
                })

    return {"ref": branch, "workflows": workflows, "issue_templates": issue_templates}


_MAX_BRANCH_PAGES = 20


@router.get("/{project_id}/branches")
async def get_project_branches(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return GitHub branches using the legacy project's saved repository URL."""
    check_organization_member(current_user)
    project = get_project_or_404(db, project_id)
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    branches: list[dict] = []
    async with httpx.AsyncClient(timeout=15) as client:
        meta = await github_get(client, f"{api_base}/repos/{owner}/{repo}", token)
        default_branch = (meta.json() or {}).get("default_branch") if meta.status_code == 200 else None
        # GitHub pages branch listings; follow pages so large repos are complete.
        for page in range(1, _MAX_BRANCH_PAGES + 1):
            response = await github_get(client, f"{api_base}/repos/{owner}/{repo}/branches", token,
                                         params={"per_page": 100, "page": page})
            if response.status_code != 200:
                if page > 1:
                    break
                raise HTTPException(status_code=400 if response.status_code == 401 else response.status_code,
                                    detail=response.text[:200])
            batch = response.json() or []
            branches.extend(batch)
            if len(batch) < 100:
                break
    default_branch = default_branch or "main"
    return [
        {
            "name": branch.get("name", ""),
            "commit_sha": (branch.get("commit") or {}).get("sha", ""),
            "is_default": branch.get("name") == default_branch,
        }
        for branch in branches
    ]


@router.get("/{project_id}/github/tree")
async def get_project_repo_tree(
    project_id: int,
    path: str = "",
    ref: str = "",
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a repository folder in the frontend's file-tree contract."""
    check_organization_member(current_user)
    project = get_project_or_404(db, project_id)
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    branch = ref or "main"
    contents_path = f"/contents/{path.strip('/')}".rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await github_get(
            client,
            f"{api_base}/repos/{owner}/{repo}{contents_path}",
            token,
            params={"ref": branch},
        )
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code == 401 else response.status_code, detail=response.text[:200]
        )
    contents = response.json()
    if not isinstance(contents, list):
        contents = [contents]
    return [
        {
            "name": item.get("name", ""),
            "path": item.get("path", ""),
            "type": "dir" if item.get("type") == "dir" else "file",
            "size": item.get("size"),
            "sha": item.get("sha", ""),
            "download_url": item.get("download_url"),
        }
        for item in contents
    ]


@router.get("/{project_id}/github/commit")
async def get_project_github_commit(
    project_id: int,
    ref: str = "",
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the commit metadata at the requested GitHub branch or ref."""
    check_organization_member(current_user)
    project = get_project_or_404(db, project_id)
    owner, repo, api_base, token = github_repository_context(project, current_user, project_id)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await github_get(client, f"{api_base}/repos/{owner}/{repo}/commits/{ref or 'main'}", token)
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code == 401 else response.status_code, detail=response.text[:200]
        )
    data = response.json()
    commit = data.get("commit") or {}
    author = commit.get("author") or {}
    return {
        "sha": data.get("sha", ""),
        "author": author.get("name", ""),
        "date": author.get("date", ""),
        "message": (commit.get("message") or "").split("\n", 1)[0],
    }


@router.get("/{project_id}/local/status")
async def get_project_local_status(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report whether the legacy managed local checkout exists for a project."""
    check_organization_member(current_user)
    get_project_or_404(db, project_id)
    repo_path = checkout_path(current_user, project_id)
    return await asyncio.to_thread(local_status, repo_path)


@router.post("/{project_id}/local/link-existing")
async def link_existing_local_repo(
    project_id: int,
    payload: LocalRepoLinkExistingRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Link an existing checkout (optionally switching to one of its local branches)."""
    from app.services import local_import_service
    from app.services.local_repo_service import LocalRepoError

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    project = get_project_or_404(db, project_id)
    repo_url = (project.github_repo_url or "").strip()
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")
    try:
        repo_path = local_import_service.normalize_user_path(payload.path).resolve()
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    info = local_import_service.describe_checkout(repo_path, repo_url)
    if info["error"]:
        raise HTTPException(status_code=400, detail=info["error"])

    branch = (payload.branch or "").strip()
    if branch and branch != info["current_branch"]:
        try:
            await local_import_service.checkout_local_branch(repo_path, branch)
        except LocalRepoError as exc:
            raise HTTPException(status_code=400, detail=f"Could not switch to '{branch}': {exc}") from exc

    save_linked_path(db, current_user, project_id, str(repo_path))
    return await get_project_local_status(project_id, current_user, db)


@router.get("/{project_id}/local/inspect")
async def inspect_local_folder(
    project_id: int,
    path: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Check a folder before linking it: git status, origin match and local branches."""
    from app.services import local_import_service
    from app.services.local_repo_service import LocalRepoError

    check_organization_member(current_user)
    project = get_project_or_404(db, project_id)
    try:
        repo_path = local_import_service.normalize_user_path(path).resolve()
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return local_import_service.describe_checkout(repo_path, (project.github_repo_url or "").strip())


@router.post("/{project_id}/local/import")
async def import_local_repo(
    project_id: int,
    payload: LocalRepoImportRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clone the chosen branch into a folder (created if missing) and remember it for this project."""
    from app.services import local_import_service
    from app.services.local_repo_service import LocalRepoError

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    project = get_project_or_404(db, project_id)
    try:
        repo_path = local_import_service.normalize_user_path(payload.path)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    repo_url = (project.github_repo_url or "").strip()
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")
    token = project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")

    try:
        target, cloned = await local_import_service.import_branch(repo_path.resolve(), repo_url, token, payload.branch)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not use '{repo_path}': {exc.strerror or exc}") from exc

    previously_managed = (user_settings(current_user).get("project_local_repo_managed") or {}).get(str(project_id))
    save_linked_path(db, current_user, project_id, str(target),
                                 managed=cloned or previously_managed == str(target))
    return await get_project_local_status(project_id, current_user, db)


@router.delete("/{project_id}/local")
async def remove_local_repo(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Forget the local checkout; folders ATM cloned itself are deleted from disk too."""
    check_organization_member(current_user)
    check_product_manager_access(current_user)
    get_project_or_404(db, project_id)
    saved_path = read_linked_path(current_user, project_id)
    managed_path = (user_settings(current_user).get("project_local_repo_managed") or {}).get(str(project_id))
    deleted = False
    if saved_path and managed_path == saved_path:
        folder = Path(saved_path)
        if (folder / ".git").exists():
            dirty = subprocess.run(["git", "status", "--porcelain"], cwd=folder,
                                   text=True, capture_output=True, check=False).stdout.strip()
            if dirty:
                raise HTTPException(status_code=400,
                                    detail="The local copy has uncommitted changes. Commit or discard them first.")
            shutil.rmtree(folder)
            deleted = True
    save_linked_path(db, current_user, project_id, "")
    return {"removed": True, "deleted_from_disk": deleted}


class ScaffoldCreateRequest(BaseModel):
    framework: str
    language: str
    path: str


def _project_scaffold_info(user, project_id: int) -> Optional[dict]:
    info = (user_settings(user).get("project_scaffolds") or {}).get(str(project_id))
    return info if isinstance(info, dict) else None


def _set_project_scaffold_info(db: Session, user, project_id: int, info: Optional[dict]) -> None:
    data = user_settings(user)
    scaffolds = dict(data.get("project_scaffolds") or {})
    if info:
        scaffolds[str(project_id)] = info
    else:
        scaffolds.pop(str(project_id), None)
    data["project_scaffolds"] = scaffolds
    user.settings_json = data
    db.commit()
    db.refresh(user)


@router.get("/{project_id}/scaffold/catalog")
async def get_scaffold_catalog(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Starter templates (framework x language) and which tools this station has."""
    from app.services import scaffold_service

    check_organization_member(current_user)
    get_project_or_404(db, project_id)
    return await asyncio.to_thread(scaffold_service.catalog)


@router.get("/{project_id}/scaffold")
async def get_project_scaffold(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The starter project generated for this project (if any) and its latest install & run check."""
    from app.services import scaffold_service

    check_organization_member(current_user)
    get_project_or_404(db, project_id)
    info = _project_scaffold_info(current_user, project_id)
    if info and info.get("path") != read_linked_path(current_user, project_id):
        info = None  # The local copy was removed or replaced since the starter was created.
    job = scaffold_service.latest_job(project_id)
    if info:
        info = {**info, "remotes": await asyncio.to_thread(scaffold_service.git_remotes, Path(info["path"]))}
    return {"scaffold": info, "verify": job.to_dict() if job and info and job.path == info["path"] else None}


@router.delete("/{project_id}/scaffold")
async def delete_project_scaffold(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete the generated starter folder (only if it was never connected to a remote) and unlink it."""
    from app.services import scaffold_service

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    get_project_or_404(db, project_id)
    info = _project_scaffold_info(current_user, project_id)
    if not info or info.get("path") != read_linked_path(current_user, project_id):
        raise HTTPException(status_code=404, detail="This project has no generated starter project.")
    try:
        await asyncio.to_thread(scaffold_service.delete_project, Path(info["path"]))
    except scaffold_service.ScaffoldError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete '{info['path']}': {exc}") from exc
    save_linked_path(db, current_user, project_id, "")
    _set_project_scaffold_info(db, current_user, project_id, None)
    return {"deleted": True, "path": info["path"]}


@router.post("/{project_id}/scaffold")
async def create_project_scaffold(
    project_id: int,
    payload: ScaffoldCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a working starter project in a local folder and link it as the project's local copy."""
    from app.services import local_import_service, scaffold_service
    from app.services.local_repo_service import LocalRepoError

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    project = get_project_or_404(db, project_id)
    try:
        path = local_import_service.normalize_user_path(payload.path).resolve()
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        target = await asyncio.to_thread(
            scaffold_service.create_project, path, payload.framework, payload.language, project.name,
            current_user.full_name or current_user.username, current_user.email,
        )
    except scaffold_service.ScaffoldError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Could not write to '{path}': {exc.strerror or exc}") from exc

    save_linked_path(db, current_user, project_id, str(target), managed=True)
    info = {"framework": payload.framework, "language": payload.language, "path": str(target),
            "created_at": datetime.utcnow().isoformat()}
    _set_project_scaffold_info(db, current_user, project_id, info)
    return {"scaffold": info, "local": await get_project_local_status(project_id, current_user, db)}


@router.post("/{project_id}/scaffold/verify")
async def start_project_scaffold_verify(
    project_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Install dependencies and run the starter's sample tests in the background."""
    from app.services import scaffold_service

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    get_project_or_404(db, project_id)
    info = _project_scaffold_info(current_user, project_id)
    if not info:
        raise HTTPException(status_code=404, detail="This project has no generated starter project.")
    try:
        job = scaffold_service.start_verify(project_id, Path(info["path"]), info["framework"], info["language"])
    except scaffold_service.ScaffoldError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return job.to_dict()


@router.get("/{project_id}/scaffold/verify/{job_id}")
async def get_project_scaffold_verify(
    project_id: int,
    job_id: str,
    since: int = 0,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services import scaffold_service

    check_organization_member(current_user)
    get_project_or_404(db, project_id)
    job = scaffold_service.get_job(job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Check not found.")
    return job.to_dict(max(0, since))


@router.post("/{project_id}/scaffold/verify/{job_id}/cancel")
async def cancel_project_scaffold_verify(
    project_id: int,
    job_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services import scaffold_service

    check_organization_member(current_user)
    check_product_manager_access(current_user)
    get_project_or_404(db, project_id)
    job = scaffold_service.get_job(job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Check not found.")
    return scaffold_service.cancel_job(job_id).to_dict()


@router.get("/{project_id}/github", response_model=ProjectGitHubResponse)
async def get_project_github(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get project GitHub URL and current user's token state for the project."""
    check_organization_member(current_user)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    token = project_github_token(current_user, project_id)
    return ProjectGitHubResponse(
        github_token_set=bool(token),
        github_token_preview=token_preview(token),
        github_repo_url=project.github_repo_url or "",
    )


@router.patch("/{project_id}/github", response_model=ProjectGitHubResponse)
async def update_project_github(
    project_id: int,
    payload: ProjectGitHubConfig,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save current user's GitHub token; repo URL requires manage access."""
    check_organization_member(current_user)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if payload.github_repo_url is not None:
        check_product_manager_access(current_user)
        project.github_repo_url = payload.github_repo_url
        db.commit()
        db.refresh(project)

    if payload.github_token is not None:
        set_project_github_token(db, current_user, project_id, payload.github_token)
    _forget_github_overview(project_id)

    token = project_github_token(current_user, project_id)
    return ProjectGitHubResponse(
        github_token_set=bool(token),
        github_token_preview=token_preview(token),
        github_repo_url=project.github_repo_url or "",
    )


@router.delete("/{project_id}/github", status_code=204)
async def disconnect_project_github(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove current user's GitHub token for this project."""
    check_organization_member(current_user)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    set_project_github_token(db, current_user, project_id, "")
    _forget_github_overview(project_id)
    return None


@router.post("/{project_id}/github/test", response_model=ProjectGitHubTestResponse)
async def test_project_github(
    project_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Test current user's GitHub token for the selected project repository."""
    check_organization_member(current_user)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    token = project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(
            status_code=400,
            detail="No GitHub token configured for your account on this project.",
        )

    user_endpoint = github_user_endpoint(project.github_repo_url or "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                user_endpoint,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
        # Some enterprise setups expect the `token` auth scheme.
        if resp.status_code == 401:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    user_endpoint,
                    headers={
                        "Authorization": f"token {token}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
        if resp.status_code == 200:
            data = resp.json()
            return ProjectGitHubTestResponse(ok=True, login=data.get("login"), name=data.get("name"))
        return ProjectGitHubTestResponse(
            ok=False, error=f"GitHub returned {resp.status_code}: {resp.text[:120]}"
        )
    except Exception as exc:
        return ProjectGitHubTestResponse(ok=False, error=str(exc))
