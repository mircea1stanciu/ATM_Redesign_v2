from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user, require_lead_or_above
from app.db.session import get_db
from app.schemas.projects import BranchListResponse, ProjectCreate, ProjectResponse, ProjectUpdate, TagListResponse
from app.services.github_service import GitHubService
from app.services.project_service import ProjectService

logger = logging.getLogger(__name__)

router = APIRouter()


def _role(user) -> str:
    """Return role as a plain string, regardless of which UserRole enum the user model uses."""
    r = user.role
    return r.value if hasattr(r, 'value') else str(r)


_LEAD_OR_ABOVE = {"admin", "super_admin", "org_admin", "automation_lead"}
_USER_OR_VIEWER = {"automation_user", "viewer", "developer", "user"}


def _project_assigned_lead_id(project) -> str | None:
    cfg = project.config_json or {}
    assigned_lead = cfg.get("assigned_lead_id")
    return str(assigned_lead) if assigned_lead else None


def _project_created_by_id(project) -> str | None:
    cfg = project.config_json or {}
    created_by = cfg.get("created_by_id")
    return str(created_by) if created_by else None


def _can_view_project(project, user) -> bool:
    user_id = str(user.id)
    assigned_lead_id = _project_assigned_lead_id(project)
    created_by_id = _project_created_by_id(project)

    role = _role(user)

    if role == "automation_lead":
        # Lead sees projects assigned to them, or that they created.
        if assigned_lead_id == user_id:
            return True
        return bool(created_by_id) and created_by_id == user_id

    if role in _LEAD_OR_ABOVE:
        # Admin/org admin sees only projects they created.
        # Legacy fallback: projects with no created_by_id AND no assigned_lead_id.
        if created_by_id:
            return created_by_id == user_id
        return not assigned_lead_id  # legacy unassigned project

    if role in _USER_OR_VIEWER:
        # User/Viewer sees only projects from their assigned lead.
        user_assigned_lead = str(user.assigned_lead_id) if user.assigned_lead_id else None
        return bool(user_assigned_lead and assigned_lead_id == user_assigned_lead)

    return False


def _enforce_view_project(project, user) -> None:
    if not _can_view_project(project, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this project")


def _enforce_manage_project(project, user) -> None:
    user_id = str(user.id)
    role = _role(user)

    if role != "automation_lead" and role in _LEAD_OR_ABOVE:
        # Admin can only manage projects they created.
        created_by_id = _project_created_by_id(project)
        assigned_lead_id = _project_assigned_lead_id(project)
        if created_by_id and created_by_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only manage your own projects")
        if not created_by_id and assigned_lead_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only manage your own projects")
        return

    if role != "automation_lead":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for this action")

    assigned_lead_id = _project_assigned_lead_id(project)
    created_by_id = _project_created_by_id(project)
    if assigned_lead_id:
        if assigned_lead_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Automation Lead can manage only their assigned projects",
            )
    elif created_by_id and created_by_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Automation Lead can manage only their assigned projects",
        )


def _user_settings(user) -> dict:
    return dict(getattr(user, "settings_json", {}) or {})


def _read_user_project_github_token(user, project_id: str) -> str:
    data = _user_settings(user)
    token_map = data.get("project_github_tokens")
    if not isinstance(token_map, dict):
        return ""
    return str(token_map.get(project_id) or "")


async def _set_user_project_github_token(db: AsyncSession, user, project_id: str, token: str) -> None:
    data = _user_settings(user)
    # Copy the nested dict rather than mutating the reference shared with the
    # currently-loaded user.settings_json. Mutating it in place would make the
    # "old" value SQLAlchemy compares against for change-tracking equal to the
    # "new" value, so the assignment below would be silently seen as
    # unchanged and never flushed to the database.
    token_map = dict(data.get("project_github_tokens") or {})

    if token:
        token_map[project_id] = token
    else:
        token_map.pop(project_id, None)

    data["project_github_tokens"] = token_map
    user.settings_json = data
    await db.commit()
    await db.refresh(user)


def _build_github_user_endpoint(base_url: str) -> str:
    """Build /user endpoint for GitHub.com or GitHub Enterprise hosts."""
    if not base_url:
        return "https://api.github.com/user"

    parsed = urlparse(base_url)
    if not parsed.scheme or not parsed.netloc:
        return "https://api.github.com/user"

    host = parsed.netloc.lower()
    path = (parsed.path or "").strip("/")

    if host == "github.com" or host.endswith(".github.com"):
        return "https://api.github.com/user"

    if path.startswith("api/v3"):
        return f"{parsed.scheme}://{parsed.netloc}/{path}/user"
    return f"{parsed.scheme}://{parsed.netloc}/api/v3/user"


def _build_github_api_base(base_url: str) -> str:
    """Build API base URL for GitHub.com or GitHub Enterprise hosts."""
    if not base_url:
        return "https://api.github.com"

    parsed = urlparse(base_url)
    if not parsed.scheme or not parsed.netloc:
        return "https://api.github.com"

    host = parsed.netloc.lower()
    path = (parsed.path or "").strip("/")

    if host == "github.com" or host.endswith(".github.com"):
        return "https://api.github.com"

    if path.startswith("api/v3"):
        return f"{parsed.scheme}://{parsed.netloc}/{path}"
    return f"{parsed.scheme}://{parsed.netloc}/api/v3"


async def _diagnose_repo_404(api_base: str, owner: str, repo: str, token: str) -> str:
    """When /repos/{owner}/{repo} returns 404, probe search API to diagnose why."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{api_base}/search/repositories",
                params={"q": f"{repo} org:{owner}"},
                headers={
                    "Authorization": f"token {token}",
                    "Accept": "application/vnd.github+json",
                },
            )
        if r.status_code == 200:
            items = r.json().get("items", [])
            match = next(
                (i for i in items if i.get("full_name", "").lower() == f"{owner}/{repo}".lower()),
                None,
            )
            if match:
                return (
                    f"The repository '{owner}/{repo}' exists and your account can find it via search, "
                    "but the token cannot access it through the REST API. "
                    "This is a known issue with fine-grained personal access tokens (github_pat_*) "
                    "on GitHub Enterprise Server. "
                    "Fix: regenerate the token as a Classic personal access token (ghp_*) with 'repo' scope, "
                    "or recreate the fine-grained PAT with the organization as resource owner "
                    "and grant 'Contents: Read' permission for this specific repository."
                )
        return (
            "Repository not found. Verify the repository URL, default branch, "
            "and that the project token has access to this repository."
        )
    except Exception:
        return (
            "Repository not found. Verify the repository URL, default branch, "
            "and that the project token has access to this repository."
        )


@router.post("", response_model=ProjectResponse)
async def create_project(
    project_data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_lead_or_above),
):
    """Create a new project. Requires Automation Lead or Admin."""
    try:
        cfg = dict(project_data.config_json or {})
        cfg["created_by_id"] = str(current_user.id)
        if _role(current_user) == "automation_lead":
            cfg["assigned_lead_id"] = str(current_user.id)
        project_data = project_data.model_copy(update={"config_json": cfg})
        project = await ProjectService.create_project(db, project_data)
        return ProjectResponse.model_validate(project)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get a project by ID."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_view_project(project, current_user)
    return ProjectResponse.model_validate(project)


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """List all projects with pagination."""
    try:
        projects = await ProjectService.list_projects(db, skip=skip, limit=limit)
        projects = [p for p in projects if _can_view_project(p, current_user)]
        return [ProjectResponse.model_validate(p) for p in projects]
    except Exception as e:
        # Handle case where projects table doesn't exist (UnifiedWork database schema)
        if "no such table" in str(e).lower() or "no such column" in str(e).lower():
            return []
        raise


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    project_data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_lead_or_above),
):
    """Update a project."""
    existing = await ProjectService.get_project(db, project_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_manage_project(existing, current_user)

    if _role(current_user) == "automation_lead":
        cfg = dict(existing.config_json or {})
        if "assigned_lead_id" not in cfg or not cfg.get("assigned_lead_id"):
            cfg["assigned_lead_id"] = str(current_user.id)
            incoming_cfg = dict(project_data.config_json or {})
            incoming_cfg.setdefault("assigned_lead_id", str(current_user.id))
            project_data = project_data.model_copy(
                update={
                    "config_json": incoming_cfg if project_data.config_json is not None else cfg
                }
            )

    project = await ProjectService.update_project(db, project_id, project_data)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    return ProjectResponse.model_validate(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_lead_or_above),
):
    """Delete a project."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_manage_project(project, current_user)

    success = await ProjectService.delete_project(db, project_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    return None


@router.get("/{project_id}/branches", response_model=list[BranchListResponse])
async def get_project_branches(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get list of branches for a project's repository."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")

    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    try:
        owner, repo = GitHubService.parse_github_url(repo_url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Could not parse GitHub repo URL.")

    api_base = _build_github_api_base(repo_url)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{api_base}/repos/{owner}/{repo}/branches",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
            if resp.status_code == 401:
                resp = await client.get(
                    f"{api_base}/repos/{owner}/{repo}/branches",
                    headers={
                        "Authorization": f"token {token}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )

        if resp.status_code == 200:
            default_branch = project.default_branch or "main"
            branches = [
                {
                    "name": b.get("name", ""),
                    "commit_sha": (b.get("commit") or {}).get("sha", ""),
                    "is_default": b.get("name") == default_branch,
                }
                for b in resp.json()
            ]
            return [BranchListResponse(**b) for b in branches]

        if resp.status_code == 401:
            raise HTTPException(
                status_code=400,
                detail="GitHub token invalid or expired for this project. Please reconnect your GitHub token.",
            )

        if resp.status_code == 404:
            detail = await _diagnose_repo_404(api_base, owner, repo, token)
            raise HTTPException(status_code=404, detail=detail)

        raise HTTPException(status_code=resp.status_code, detail=resp.text[:200])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch branches: {str(exc)}"
        )


@router.get("/{project_id}/tags", response_model=list[TagListResponse])
async def get_project_tags(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get list of tags for a project's repository."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    try:
        tags = await ProjectService.get_project_tags(project_id, db)
        return [TagListResponse(**t) for t in tags]
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch tags: {str(e)}"
        )


# ── Per-project GitHub settings ───────────────────────────────────────────────

class ProjectGitHubConfig(BaseModel):
    github_token: str | None = None
    github_repo_url: str | None = None


class ProjectGitHubResponse(BaseModel):
    github_token_set: bool
    github_token_preview: str
    github_repo_url: str


class ProjectGitHubTestResponse(BaseModel):
    ok: bool
    login: str | None = None
    name: str | None = None
    error: str | None = None


@router.delete("/{project_id}/github", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_project_github(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Remove current user's GitHub token for this project."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)
    await _set_user_project_github_token(db, current_user, project_id, "")
    return None


@router.get("/{project_id}/github", response_model=ProjectGitHubResponse)
async def get_project_github(
    project_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get project GitHub URL and current user's token state for the project."""
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["Vary"] = "Authorization"

    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)
    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    return ProjectGitHubResponse(
        github_token_set=bool(token),
        github_token_preview=("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else ""),
        github_repo_url=cfg.get("github_repo_url", project.git_repo_url or ""),
    )


@router.patch("/{project_id}/github", response_model=ProjectGitHubResponse)
async def update_project_github(
    project_id: str,
    payload: ProjectGitHubConfig,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Save current user's GitHub token; repo URL can be changed by lead/admin only."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    cfg = dict(project.config_json or {})

    if payload.github_repo_url is not None:
        _enforce_manage_project(project, current_user)
        if _role(current_user) == "automation_lead":
            cfg.setdefault("assigned_lead_id", str(current_user.id))
        cfg["github_repo_url"] = payload.github_repo_url
        from app.schemas.projects import ProjectUpdate
        project = await ProjectService.update_project(db, project_id, ProjectUpdate(config_json=cfg))
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    if payload.github_token is not None:
        await _set_user_project_github_token(db, current_user, project_id, payload.github_token)

    token = _read_user_project_github_token(current_user, project_id)
    latest_cfg = project.config_json or {}
    return ProjectGitHubResponse(
        github_token_set=bool(token),
        github_token_preview=("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else ""),
        github_repo_url=latest_cfg.get("github_repo_url", project.git_repo_url or ""),
    )


@router.post("/{project_id}/github/test", response_model=ProjectGitHubTestResponse)
async def test_project_github(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Test current user's GitHub token for the selected project repository."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)
    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    user_endpoint = _build_github_user_endpoint(repo_url)
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

        # Some enterprise setups expect `token` auth scheme.
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
        return ProjectGitHubTestResponse(ok=False, error=f"GitHub returned {resp.status_code}: {resp.text[:120]}")
    except Exception as exc:
        return ProjectGitHubTestResponse(ok=False, error=str(exc))


@router.get("/{project_id}/github/analyze")
async def analyze_project_repo(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Analyze the repository to detect test frameworks and suites."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)
    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    try:
        owner, repo = GitHubService.parse_github_url(repo_url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Could not parse GitHub repo URL.")

    api_base = _build_github_api_base(repo_url)
    branch = project.default_branch or "main"
    
    # Get the recursive tree
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{api_base}/repos/{owner}/{repo}/git/trees/{branch}",
                params={"recursive": "1"},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )

            if resp.status_code == 401:
                resp = await client.get(
                    f"{api_base}/repos/{owner}/{repo}/git/trees/{branch}",
                    params={"recursive": "1"},
                    headers={
                        "Authorization": f"token {token}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
        if resp.status_code != 200:
            if resp.status_code == 401:
                raise HTTPException(
                    status_code=400,
                    detail="GitHub token invalid or expired for this project. Please reconnect your GitHub token.",
                )
            if resp.status_code == 404:
                detail = await _diagnose_repo_404(api_base, owner, repo, token)
                raise HTTPException(status_code=404, detail=detail)
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:200])
        
        tree_data = resp.json()
        files = [item["path"] for item in tree_data.get("tree", []) if item["type"] == "blob"]
        
        # Use framework detector to analyze
        from app.services.framework_detector import FrameworkDetector
        detector = FrameworkDetector()
        detected_frameworks = detector.detect_frameworks(files)
        detected_projects = detector.detect_projects(files)
        
        return {
            "frameworks": detected_frameworks,
            "projects": detected_projects,
            "files_count": len(files),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}/github/tree")
async def get_project_repo_tree(
    project_id: str,
    path: str = "",
    ref: str = "",
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Fetch the GitHub repository tree at a given path on an optional branch/ref."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)
    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    try:
        owner, repo = GitHubService.parse_github_url(repo_url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Could not parse GitHub repo URL.")

    api_base = _build_github_api_base(repo_url)
    branch = ref or project.default_branch or "main"
    api_path = f"/repos/{owner}/{repo}/contents/{path}".rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{api_base}{api_path}",
                params={"ref": branch},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
            if resp.status_code == 401:
                resp = await client.get(
                    f"{api_base}{api_path}",
                    params={"ref": branch},
                    headers={
                        "Authorization": f"token {token}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code == 401:
            raise HTTPException(
                status_code=400,
                detail="GitHub token invalid or expired for this project. Please reconnect your GitHub token.",
            )
        if resp.status_code == 404:
            detail = await _diagnose_repo_404(api_base, owner, repo, token)
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:200])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Local repository (server-side managed working copy) ───────────────────────

class LocalRepoCommit(BaseModel):
    sha: str
    author: str
    date: str
    message: str


class LocalRepoStatusResponse(BaseModel):
    path: str
    exists: bool
    is_git_repo: bool
    current_branch: str | None = None
    branches: list[str] = []
    last_commit: LocalRepoCommit | None = None
    dirty: bool = False
    has_upstream: bool = False
    ahead: int = 0
    behind: int = 0


class LocalRepoConfig(BaseModel):
    local_repo_path: str | None = None


class LocalRepoSyncRequest(BaseModel):
    branch: str | None = None


class LocalRepoCheckoutRequest(BaseModel):
    branch: str


class LocalRepoImportRequest(BaseModel):
    path: str
    branch: str | None = None


class LocalRepoLinkExistingRequest(BaseModel):
    path: str


class GitHubCommitInfo(BaseModel):
    sha: str
    author: str
    date: str
    message: str


class RepoCompareFile(BaseModel):
    path: str
    old_path: str | None = None
    status: str
    additions: int = 0
    deletions: int = 0
    binary: bool = False
    patch: str | None = None
    patch_truncated: bool = False


class RepoCompareResponse(BaseModel):
    base: str
    head: str
    base_label: str
    head_label: str
    default_branch: str
    files: list[RepoCompareFile] = []
    total_files: int = 0
    total_additions: int = 0
    total_deletions: int = 0
    truncated: bool = False


class ScriptParam(BaseModel):
    name: str
    type: str  # "positional" | "flag"
    value_type: str = "string"  # "string" | "boolean"
    required: bool = False


class LocalScriptItem(BaseModel):
    id: str
    type: str
    name: str
    description: str = ""
    command: str
    cwd: str = ""
    source: str = ""
    usage: str | None = None
    example: str | None = None
    params: list[ScriptParam] = []
    configured: bool = False
    config_values: dict[str, Any] = {}


class LocalScriptConfigRequest(BaseModel):
    script_id: str
    values: dict[str, Any] = {}


class LocalScriptRunRequest(BaseModel):
    script_id: str
    timeout: int | None = None


class LocalScriptRunResult(BaseModel):
    script_id: str
    command: str
    cwd: str = ""
    exit_code: int
    timed_out: bool = False
    duration_seconds: float = 0.0
    stdout: str = ""
    stderr: str = ""


class LocalFileContent(BaseModel):
    path: str
    content: str | None = None
    size: int = 0
    binary: bool = False
    too_large: bool = False


class LocalFileWriteRequest(BaseModel):
    path: str
    content: str


class LocalBranchRequest(BaseModel):
    branch: str
    from_ref: str | None = None


class LocalCommitRequest(BaseModel):
    message: str


class LocalPushRequest(BaseModel):
    branch: str | None = None


class LocalPushResponse(BaseModel):
    branch: str
    pushed: bool
    status: LocalRepoStatusResponse


class PullRequestCreate(BaseModel):
    head: str
    base: str | None = None
    title: str
    body: str = ""
    draft: bool = False


class PullRequestResponse(BaseModel):
    number: int
    url: str
    state: str
    title: str
    head: str
    base: str


class WorkflowInput(BaseModel):
    name: str
    description: str = ""
    required: bool = False
    default: Any = None
    type: str = "string"
    options: list[str] = []
    example: str = ""


class WorkflowItem(BaseModel):
    id: str          # workflow file name, e.g. "test.yml"
    path: str        # full repo path, e.g. ".github/workflows/test.yml"
    name: str        # workflow "name:" or file name
    inputs: list[WorkflowInput] = []


class IssueTemplateField(BaseModel):
    id: str = ""
    type: str = "input"
    label: str = ""
    description: str = ""
    placeholder: str = ""
    required: bool = False
    options: list[str] = []


class IssueTemplateItem(BaseModel):
    id: str          # template file name
    path: str        # full repo path
    name: str
    description: str = ""
    fields: list[IssueTemplateField] = []


class GitHubTemplatesResponse(BaseModel):
    ref: str
    workflows: list[WorkflowItem] = []
    issue_templates: list[IssueTemplateItem] = []


class WorkflowDispatchRequest(BaseModel):
    workflow_id: str                       # workflow file name, e.g. "test.yml"
    ref: str | None = None              # branch/tag to run on
    inputs: dict[str, Any] = {}
    collection: str | None = None       # label shown in runs list/analytics


class WorkflowDispatchResponse(BaseModel):
    dispatched: bool
    workflow_id: str
    ref: str
    actions_url: str = ""
    run_id: str | None = None


class WorkflowRunsSyncRequest(BaseModel):
    workflow_id: str | None = None      # limit to one workflow file; else all repo runs
    collection: str | None = None       # override collection label for every synced run
    branch: str | None = None           # optional head_branch filter
    limit: int = 100                       # max runs to fetch (paged, capped at 300)


class WorkflowRunsSyncResponse(BaseModel):
    synced: int
    created: int
    updated: int
    total_available: int = 0


class GitHubRunItem(BaseModel):
    id: str
    run_number: int | None = None
    name: str = ""
    status: str = ""                 # queued | in_progress | completed
    conclusion: str | None = None # success | failure | cancelled | ...
    branch: str | None = None
    event: str | None = None
    actor: str | None = None
    created_at: str | None = None
    run_started_at: str | None = None
    updated_at: str | None = None
    html_url: str = ""


class LibraryItem(BaseModel):
    name: str
    version: str = ""


class LibraryManifest(BaseModel):
    id: str
    manifest: str
    path: str
    ecosystem: str
    install_command: str = ""
    libraries: list[LibraryItem] = []
    count: int = 0


class LibraryInstallRequest(BaseModel):
    manifest_id: str
    timeout: int | None = None


class LibraryInstallResult(BaseModel):
    manifest_id: str
    command: str
    cwd: str = ""
    exit_code: int
    timed_out: bool = False
    duration_seconds: float = 0.0
    stdout: str = ""
    stderr: str = ""


class SetupPlanStep(BaseModel):
    id: str
    label: str
    command: str
    cwd: str = ""
    kind: str  # "workflow" | "framework"
    source: str = ""


class SetupPlanResponse(BaseModel):
    run_workflow: str = ""
    frameworks: list[str] = []
    steps: list[SetupPlanStep] = []


class SetupInstallRequest(BaseModel):
    timeout: int | None = None


class SetupStepResult(SetupPlanStep):
    exit_code: int
    timed_out: bool = False
    skipped: bool = False
    duration_seconds: float = 0.0
    stdout: str = ""
    stderr: str = ""


class SetupInstallResult(BaseModel):
    run_workflow: str = ""
    frameworks: list[str] = []
    exit_code: int
    steps: list[SetupStepResult] = []


def _local_status_response(status_dict: dict) -> LocalRepoStatusResponse:
    commit = status_dict.get("last_commit")
    return LocalRepoStatusResponse(
        path=status_dict.get("path", ""),
        exists=bool(status_dict.get("exists")),
        is_git_repo=bool(status_dict.get("is_git_repo")),
        current_branch=status_dict.get("current_branch"),
        branches=status_dict.get("branches", []),
        last_commit=LocalRepoCommit(**commit) if commit else None,
        dirty=bool(status_dict.get("dirty")),
    )


@router.get("/{project_id}/local/status", response_model=LocalRepoStatusResponse)
async def get_local_repo_status(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Report the state of the project's server-side local working copy."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        status_dict = await LocalRepoService.status(project)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _local_status_response(status_dict)


@router.patch("/{project_id}/local/config", response_model=LocalRepoStatusResponse)
async def set_local_repo_config(
    project_id: str,
    payload: LocalRepoConfig,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Configure a custom local path for the working copy (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    cfg = dict(project.config_json or {})
    if payload.local_repo_path is not None:
        value = payload.local_repo_path.strip()
        if value:
            cfg["local_repo_path"] = value
        else:
            cfg.pop("local_repo_path", None)
    project = await ProjectService.update_project(db, project_id, ProjectUpdate(config_json=cfg))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        status_dict = await LocalRepoService.status(project)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _local_status_response(status_dict)


@router.post("/{project_id}/local/sync", response_model=LocalRepoStatusResponse)
async def sync_local_repo(
    project_id: str,
    payload: LocalRepoSyncRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Clone the repo into the local working copy, or fetch+pull if it exists."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        status_dict = await LocalRepoService.sync(project, repo_url, token, branch=payload.branch)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _local_status_response(status_dict)


@router.post("/{project_id}/local/import", response_model=LocalRepoStatusResponse)
async def import_local_repo(
    project_id: str,
    payload: LocalRepoImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """"Import new project": clone the GitHub repo into a chosen local folder.

    The folder must not already exist, or must be empty. The chosen path is
    saved on the project so it is always reused afterwards (lead/admin only).
    """
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    path = payload.path.strip()
    if not path:
        raise HTTPException(status_code=400, detail="A local folder path is required.")

    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")

    # Persist the chosen path first so it's remembered even if the clone fails
    # partway (the user can retry Sync without re-entering the path). Marked
    # "managed" because we own this clone (created by us) and it's therefore
    # safe to delete from disk if the user later clicks "Remove".
    new_cfg = dict(cfg)
    new_cfg["local_repo_path"] = path
    new_cfg["local_repo_managed"] = True
    project = await ProjectService.update_project(db, project_id, ProjectUpdate(config_json=new_cfg))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        status_dict = await LocalRepoService.sync(project, repo_url, token, branch=payload.branch)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _local_status_response(status_dict)


@router.post("/{project_id}/local/link-existing", response_model=LocalRepoStatusResponse)
async def link_existing_local_repo(
    project_id: str,
    payload: LocalRepoLinkExistingRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """"Existing project": point this project at an already-cloned local folder.

    Verifies the folder's git 'origin' remote matches this project's GitHub
    repository before saving the path, so it always reopens there afterwards
    (lead/admin only).
    """
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    raw_path = payload.path.strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="A local folder path is required.")

    cfg = project.config_json or {}
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")

    from pathlib import Path as _Path

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    candidate_path = _Path(raw_path).expanduser().resolve()
    try:
        await LocalRepoService.link_existing(candidate_path, repo_url)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    new_cfg = dict(cfg)
    new_cfg["local_repo_path"] = str(candidate_path)
    # Not "managed" — this is the user's own pre-existing folder, so
    # "Remove" should unlink it without ever deleting it from disk.
    new_cfg["local_repo_managed"] = False
    project = await ProjectService.update_project(db, project_id, ProjectUpdate(config_json=new_cfg))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        status_dict = await LocalRepoService.status(project)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _local_status_response(status_dict)


@router.get("/{project_id}/github/commit", response_model=GitHubCommitInfo)
async def get_github_commit_info(
    project_id: str,
    ref: str = "",
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Fetch the tip commit (sha/author/date/message) of a GitHub branch."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    try:
        owner, repo = GitHubService.parse_github_url(repo_url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Could not parse GitHub repo URL.")

    api_base = _build_github_api_base(repo_url)
    branch = ref or project.default_branch or "main"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{api_base}/repos/{owner}/{repo}/commits/{branch}",
                headers={
                    "Authorization": f"token {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
        if resp.status_code == 200:
            data = resp.json()
            commit = data.get("commit", {}) or {}
            author = commit.get("author", {}) or {}
            message = (commit.get("message") or "").split("\n", 1)[0]
            return GitHubCommitInfo(
                sha=data.get("sha", ""),
                author=author.get("name", ""),
                date=author.get("date", ""),
                message=message,
            )
        if resp.status_code == 401:
            raise HTTPException(status_code=400, detail="GitHub token invalid or expired for this project.")
        if resp.status_code == 404:
            detail = await _diagnose_repo_404(api_base, owner, repo, token)
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:200])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── GitHub Actions workflows & issue templates ───────────────────────────────

def _resolve_project_github_ctx(project, current_user, project_id: str):
    """Return (owner, repo, api_base, token) for a project's GitHub repo, after
    enforcing view access and a configured per-user token."""
    _enforce_view_project(project, current_user)
    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    try:
        owner, repo = GitHubService.parse_github_url(repo_url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Could not parse GitHub repo URL.")
    api_base = _build_github_api_base(repo_url)
    return owner, repo, api_base, token


def _github_headers(token: str, scheme: str = "Bearer", accept: str = "application/vnd.github+json") -> dict:
    return {
        "Authorization": f"{scheme} {token}",
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def _github_get(
    client: httpx.AsyncClient, url: str, token: str, *, accept: str = "application/vnd.github+json", **kwargs
):
    """GET a GitHub API URL, retrying with the ``token`` auth scheme on 401
    (some GitHub Enterprise hosts reject ``Bearer``)."""
    resp = await client.get(url, headers=_github_headers(token, "Bearer", accept), **kwargs)
    if resp.status_code == 401:
        resp = await client.get(url, headers=_github_headers(token, "token", accept), **kwargs)
    return resp


async def _list_github_folder(client, api_base, owner, repo, folder, ref, token) -> list:
    """Return the contents array of a repo folder, or [] if it does not exist."""
    resp = await _github_get(
        client,
        f"{api_base}/repos/{owner}/{repo}/contents/{folder}",
        token,
        params={"ref": ref},
    )
    if resp.status_code == 404:
        return []
    if resp.status_code == 401:
        raise HTTPException(
            status_code=400,
            detail="GitHub token invalid or expired for this project. Please reconnect your GitHub token.",
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:200])
    data = resp.json()
    return data if isinstance(data, list) else []


@router.get("/{project_id}/github/templates", response_model=GitHubTemplatesResponse)
async def list_github_templates(
    project_id: str,
    ref: str = "",
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List dispatchable GitHub Actions workflows (with their ``workflow_dispatch``
    inputs) and issue-form templates, parsed from the remote repository."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    owner, repo, api_base, token = _resolve_project_github_ctx(project, current_user, project_id)
    branch = ref or project.default_branch or "main"

    from app.services.github_workflow_service import parse_issue_template, parse_workflow_dispatch

    workflows: list[WorkflowItem] = []
    issue_templates: list[IssueTemplateItem] = []
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            # Workflows
            wf_files = await _list_github_folder(client, api_base, owner, repo, ".github/workflows", branch, token)
            for entry in wf_files:
                name = entry.get("name", "")
                if entry.get("type") != "file" or not name.endswith((".yml", ".yaml")):
                    continue
                raw = await _github_get(
                    client, f"{api_base}/repos/{owner}/{repo}/contents/{entry.get('path')}", token,
                    accept="application/vnd.github.raw+json", params={"ref": branch},
                )
                if raw.status_code != 200:
                    continue
                parsed = parse_workflow_dispatch(raw.text)
                if parsed is None:
                    continue  # not manually dispatchable
                workflows.append(WorkflowItem(
                    id=name,
                    path=entry.get("path", ""),
                    name=parsed["name"] or name,
                    inputs=[WorkflowInput(**i) for i in parsed["inputs"]],
                ))

            # Issue templates
            it_files = await _list_github_folder(client, api_base, owner, repo, ".github/ISSUE_TEMPLATE", branch, token)
            for entry in it_files:
                name = entry.get("name", "")
                if entry.get("type") != "file" or not name.endswith((".yml", ".yaml")):
                    continue
                raw = await _github_get(
                    client, f"{api_base}/repos/{owner}/{repo}/contents/{entry.get('path')}", token,
                    accept="application/vnd.github.raw+json", params={"ref": branch},
                )
                if raw.status_code != 200:
                    continue
                parsed = parse_issue_template(raw.text)
                if parsed is None:
                    continue
                issue_templates.append(IssueTemplateItem(
                    id=name,
                    path=entry.get("path", ""),
                    name=parsed["name"] or name,
                    description=parsed["description"],
                    fields=[IssueTemplateField(**f) for f in parsed["fields"]],
                ))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return GitHubTemplatesResponse(ref=branch, workflows=workflows, issue_templates=issue_templates)


@router.post("/{project_id}/github/workflows/dispatch", response_model=WorkflowDispatchResponse)
async def dispatch_github_workflow(
    project_id: str,
    payload: WorkflowDispatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Trigger a GitHub Actions ``workflow_dispatch`` run for the selected
    workflow with the chosen inputs (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)
    owner, repo, api_base, token = _resolve_project_github_ctx(project, current_user, project_id)
    branch = payload.ref or project.default_branch or "main"

    workflow_id = payload.workflow_id.strip()
    if not workflow_id or "/" in workflow_id:
        raise HTTPException(status_code=400, detail="Invalid workflow id.")

    # GitHub only accepts string input values for workflow_dispatch.
    inputs = {k: (str(v).lower() if isinstance(v, bool) else str(v)) for k, v in (payload.inputs or {}).items()}
    body: dict[str, Any] = {"ref": branch}
    if inputs:
        body["inputs"] = inputs

    url = f"{api_base}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"
    from datetime import datetime, timedelta, timezone
    dispatch_time = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(url, headers=_github_headers(token, "Bearer"), json=body)
            if resp.status_code == 401:
                resp = await client.post(url, headers=_github_headers(token, "token"), json=body)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if resp.status_code == 204:
        actions_url = f"https://github.com/{owner}/{repo}/actions/workflows/{workflow_id}"

        run_id: str | None = None
        try:
            import asyncio

            from app.services.test_run_service import TestRunService

            gh_suite = await _get_or_create_gh_suite(db, project_id)
            collection_label = (payload.collection or "").strip() or workflow_id

            # GitHub returns 204 with no run id, and it takes a moment to register
            # the run. Poll a few times to locate the run we just triggered so we
            # persist the REAL GitHub run (id + live status) instead of simulating
            # a portal-side "running" row that never reflects the actual execution.
            matched: dict | None = None
            cutoff = dispatch_time - timedelta(seconds=30)
            for attempt in range(4):
                await asyncio.sleep(2 if attempt else 1)
                try:
                    runs, _ = await _fetch_github_workflow_runs(
                        owner, repo, api_base, token, workflow_id=workflow_id, branch=branch, limit=10,
                    )
                except HTTPException:
                    runs = []
                candidates = [
                    r for r in runs
                    if r.get("event") == "workflow_dispatch"
                    and (_parse_gh_dt(r.get("created_at")) or dispatch_time) >= cutoff
                ]
                if candidates:
                    matched = max(candidates, key=lambda r: _parse_gh_dt(r.get("created_at")) or dispatch_time)
                    break

            if matched:
                normalized = _normalize_gh_run(
                    matched, collection_override=(payload.collection or ""), fallback_label=workflow_id
                )
                if normalized:
                    await TestRunService.sync_github_action_runs(db, str(gh_suite.id), [normalized])
                    run_id = normalized["external_id"]
            else:
                # Couldn't find it yet (GitHub still registering) — record a
                # placeholder so the user sees it immediately; a later Sync/refresh
                # reconciles the real status by external_id once available.
                triggered_by = getattr(current_user, "email", None) or str(getattr(current_user, "id", ""))
                run = await TestRunService.create_github_action_run(
                    db,
                    suite_id=str(gh_suite.id),
                    branch=branch,
                    triggered_by=triggered_by,
                    collection=collection_label,
                )
                run_id = str(run.id)
        except Exception:
            # Dispatch already succeeded on GitHub; failing to record the local
            # run entry shouldn't fail the whole request.
            logger.exception("Failed to record local run for dispatched workflow %s", workflow_id)

        return WorkflowDispatchResponse(
            dispatched=True, workflow_id=workflow_id, ref=branch, actions_url=actions_url, run_id=run_id
        )
    if resp.status_code in (401, 403):
        raise HTTPException(
            status_code=400, detail="GitHub token lacks 'workflow'/'actions' permission, or is invalid for this repo."
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Workflow not found, or it does not declare 'workflow_dispatch'.")
    if resp.status_code == 422:
        raise HTTPException(status_code=422, detail=f"GitHub rejected the dispatch: {resp.text[:300]}")
    raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])


def _parse_gh_dt(value):
    """Parse a GitHub ISO-8601 timestamp (``...Z``) into an aware datetime, or None."""
    if not value:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _map_gh_run_status(status: str, conclusion: str | None):
    """Map a GitHub Actions run ``status``/``conclusion`` pair to a RunStatus."""
    from app.models.models import RunStatus
    if (status or "").lower() != "completed":
        if (status or "").lower() in ("queued", "waiting", "pending", "requested"):
            return RunStatus.pending
        return RunStatus.running
    c = (conclusion or "").lower()
    if c == "success":
        return RunStatus.passed
    if c in ("failure", "startup_failure"):
        return RunStatus.failed
    if c == "cancelled":
        return RunStatus.cancelled
    return RunStatus.error


async def _get_or_create_gh_suite(db: AsyncSession, project_id: str):
    """Return the project's 'GitHub Actions' TestSuite, creating it on first use."""
    from app.schemas.test_suites import TestSuiteCreate
    from app.services.test_suite_service import TestSuiteService
    suites = await TestSuiteService.list_suites_by_project(db, project_id)
    gh_suite = next((s for s in suites if s.name == "GitHub Actions"), None)
    if not gh_suite:
        gh_suite = await TestSuiteService.create_suite(
            db, project_id, TestSuiteCreate(name="GitHub Actions", tags=["github-actions"]),
        )
    return gh_suite


async def _fetch_github_workflow_runs(
    owner: str, repo: str, api_base: str, token: str,
    workflow_id: str = "", branch: str = "", limit: int = 100,
) -> tuple[list[dict], int]:
    """Fetch raw GitHub Actions workflow-run objects (paged) for a repo, optionally
    scoped to a single workflow file and/or branch. Returns (runs, total_count)."""
    limit = max(1, min(int(limit or 100), 300))
    if workflow_id:
        base_url = f"{api_base}/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
    else:
        base_url = f"{api_base}/repos/{owner}/{repo}/actions/runs"

    params: dict[str, Any] = {"per_page": min(limit, 100)}
    if branch:
        params["branch"] = branch

    collected: list[dict] = []
    total_available = 0
    async with httpx.AsyncClient(timeout=30) as client:
        page = 1
        while len(collected) < limit:
            resp = await _github_get(client, base_url, token, params={**params, "page": page})
            if resp.status_code in (401, 403):
                raise HTTPException(
                    status_code=400, detail="GitHub token lacks 'actions' read permission, or is invalid for this repo."
                )
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail="Workflow or repository not found.")
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
            data = resp.json()
            total_available = data.get("total_count", total_available)
            batch = data.get("workflow_runs", []) or []
            if not batch:
                break
            collected.extend(batch)
            page += 1
            if page > 10:  # hard safety cap
                break
    return collected[:limit], total_available


def _normalize_gh_run(
    run: dict, collection_override: str = "", fallback_label: str = "GitHub Actions"
) -> dict | None:
    """Map a raw GitHub run object to the normalized dict used by the run service."""
    run_id = run.get("id")
    if run_id is None:
        return None
    label = (collection_override or "").strip() or run.get("name") or run.get("display_title") or fallback_label
    started = _parse_gh_dt(run.get("run_started_at") or run.get("created_at"))
    finished = _parse_gh_dt(run.get("updated_at")) if (run.get("status") == "completed") else None
    return {
        "external_id": str(run_id),
        "collection": label,
        "branch": run.get("head_branch"),
        "commit_sha": (run.get("head_sha") or "")[:40] or None,
        "triggered_by": (run.get("actor") or {}).get("login"),
        "status": _map_gh_run_status(run.get("status", ""), run.get("conclusion")),
        "started_at": started,
        "finished_at": finished,
        "created_at": _parse_gh_dt(run.get("created_at")),
    }


@router.get("/{project_id}/github/runs", response_model=list[GitHubRunItem])
async def list_github_workflow_runs(
    project_id: str,
    workflow_id: str = "",
    branch: str = "",
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return the live GitHub Actions run history for the repo (optionally scoped
    to one workflow file), so the UI can show real execution status/conclusion
    straight from GitHub without simulating anything in the portal."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    owner, repo, api_base, token = _resolve_project_github_ctx(project, current_user, project_id)

    wf = (workflow_id or "").strip()
    if wf and "/" in wf:
        raise HTTPException(status_code=400, detail="Invalid workflow id.")

    try:
        runs, _ = await _fetch_github_workflow_runs(
            owner, repo, api_base, token, workflow_id=wf, branch=(branch or "").strip(),
            limit=max(1, min(int(limit or 30), 100)),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    items: list[GitHubRunItem] = []
    for run in runs:
        items.append(GitHubRunItem(
            id=str(run.get("id")),
            run_number=run.get("run_number"),
            name=run.get("name") or run.get("display_title") or "",
            status=run.get("status") or "",
            conclusion=run.get("conclusion"),
            branch=run.get("head_branch"),
            event=run.get("event"),
            actor=(run.get("actor") or {}).get("login"),
            created_at=run.get("created_at"),
            run_started_at=run.get("run_started_at"),
            updated_at=run.get("updated_at"),
            html_url=run.get("html_url") or "",
        ))
    return items


@router.post("/{project_id}/github/runs/sync", response_model=WorkflowRunsSyncResponse)
async def sync_github_workflow_runs(
    project_id: str,
    payload: WorkflowRunsSyncRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Fetch the actual GitHub Actions run history from the repo and upsert it
    into local ``test_runs`` (source=``github_actions``) so past runs show up in
    the Runs list, Dashboard and Analytics — de-duplicated by GitHub run id."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    owner, repo, api_base, token = _resolve_project_github_ctx(project, current_user, project_id)

    workflow_id = (payload.workflow_id or "").strip()
    if workflow_id and "/" in workflow_id:
        raise HTTPException(status_code=400, detail="Invalid workflow id.")
    limit = max(1, min(int(payload.limit or 100), 300))

    try:
        collected, total_available = await _fetch_github_workflow_runs(
            owner, repo, api_base, token,
            workflow_id=workflow_id, branch=(payload.branch or "").strip(), limit=limit,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    fallback_label = workflow_id or "GitHub Actions"
    normalized: list[dict] = []
    for run in collected:
        item = _normalize_gh_run(run, collection_override=(payload.collection or ""), fallback_label=fallback_label)
        if item:
            normalized.append(item)

    from app.services.test_run_service import TestRunService
    gh_suite = await _get_or_create_gh_suite(db, project_id)
    result = await TestRunService.sync_github_action_runs(db, str(gh_suite.id), normalized)

    return WorkflowRunsSyncResponse(
        synced=len(normalized),
        created=result["created"],
        updated=result["updated"],
        total_available=total_available,
    )


# ── Local dependency libraries ───────────────────────────────────────────────

@router.get("/{project_id}/local/libraries", response_model=list[LibraryManifest])
async def list_local_libraries(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Detect dependency manifests (requirements.txt, package.json, …) in the
    local working copy and list the libraries each declares."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    from app.services.local_library_service import LocalLibraryError, LocalLibraryService
    try:
        manifests = LocalLibraryService.detect(project)
    except LocalLibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return [LibraryManifest(**m) for m in manifests]


@router.post("/{project_id}/local/libraries/install", response_model=LibraryInstallResult)
async def install_local_libraries(
    project_id: str,
    payload: LibraryInstallRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Install a detected manifest's dependencies and capture the output
    (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    from app.services.local_library_service import LocalLibraryError, LocalLibraryService
    try:
        result = await LocalLibraryService.install(project, payload.manifest_id, payload.timeout or 600)
    except LocalLibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return LibraryInstallResult(**result)


@router.post("/{project_id}/local/setup-plan/install", response_model=SetupInstallResult)
async def install_setup_plan(
    project_id: str,
    payload: SetupInstallRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Run every step of the setup plan, in order, stopping at the first failure
    (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    timeout = (payload.timeout if payload else None) or 900
    from app.services.workflow_recipe_service import WorkflowRecipeError, WorkflowRecipeService
    try:
        result = await WorkflowRecipeService.install(project, timeout)
    except WorkflowRecipeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return SetupInstallResult(**result)


@router.get("/{project_id}/local/setup-plan", response_model=SetupPlanResponse)
async def get_setup_plan(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Derive the ordered dependency-install plan for the local working copy
    from its ``.github/workflows/*run*.yml`` file plus the project's framework."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    from app.services.workflow_recipe_service import WorkflowRecipeError, WorkflowRecipeService
    try:
        plan = WorkflowRecipeService.build_plan(project)
    except WorkflowRecipeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return SetupPlanResponse(**plan)


@router.post("/{project_id}/local/checkout", response_model=LocalRepoStatusResponse)
async def checkout_local_repo(
    project_id: str,
    payload: LocalRepoCheckoutRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Checkout an existing local branch in the working copy."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        status_dict = await LocalRepoService.checkout(project, payload.branch)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _local_status_response(status_dict)


@router.get("/{project_id}/local/tree")
async def get_local_repo_tree(
    project_id: str,
    path: str = "",
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List files/directories in the project's local working copy at a path."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        return LocalRepoService.list_tree(project, path)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{project_id}/local/compare", response_model=RepoCompareResponse)
async def compare_repo_sources(
    project_id: str,
    base: str = "main",
    head: str = "local",
    fetch: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Compare two of the three sources (local / main / branch:<name>).

    ``base`` and ``head`` accept: ``local``, ``main``, or ``branch:<name>``.
    Returns a PR-style list of changed files with per-file unified patches.
    """
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    cfg = project.config_json or {}
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    token = _read_user_project_github_token(current_user, project_id)

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        result = await LocalRepoService.compare(
            project,
            base_spec=base,
            head_spec=head,
            repo_url=repo_url or None,
            token=token,
            do_fetch=fetch,
        )
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@router.get("/{project_id}/local/scripts", response_model=list[LocalScriptItem])
async def list_local_scripts(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Detect runnable scripts in the local working copy."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    from app.services.local_script_service import LocalScriptError, LocalScriptService
    try:
        scripts = LocalScriptService.detect(project)
    except LocalScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    saved_configs = (project.config_json or {}).get("script_configs", {})
    items = []
    for s in scripts:
        values = saved_configs.get(s["id"], {})
        item = {k: v for k, v in s.items() if not k.startswith("_")}
        item["configured"] = s["id"] in saved_configs
        item["config_values"] = values
        items.append(LocalScriptItem(**item))
    return items


@router.put("/{project_id}/local/scripts/config", response_model=LocalScriptItem)
async def save_local_script_config(
    project_id: str,
    payload: LocalScriptConfigRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Save the input variables for a detected script's "Usage:" params (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    from app.services.local_script_service import LocalScriptError, LocalScriptService
    try:
        scripts = LocalScriptService.detect(project)
    except LocalScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    by_id = {s["id"]: s for s in scripts}
    script = by_id.get(payload.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found. Rescan and try again.")

    cfg = dict(project.config_json or {})
    script_configs = dict(cfg.get("script_configs", {}))
    script_configs[payload.script_id] = payload.values
    cfg["script_configs"] = script_configs
    project = await ProjectService.update_project(db, project_id, ProjectUpdate(config_json=cfg))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    item = {k: v for k, v in script.items() if not k.startswith("_")}
    item["configured"] = True
    item["config_values"] = payload.values
    return LocalScriptItem(**item)


@router.post("/{project_id}/local/scripts/run", response_model=LocalScriptRunResult)
async def run_local_script(
    project_id: str,
    payload: LocalScriptRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Run a detected script and capture its output (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    config_values = (project.config_json or {}).get("script_configs", {}).get(payload.script_id, {})

    from app.services.local_script_service import LocalScriptError, LocalScriptService
    try:
        result = await LocalScriptService.run(
            project, payload.script_id, payload.timeout or 300, config_values=config_values,
        )
    except LocalScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@router.get("/{project_id}/local/file", response_model=LocalFileContent)
async def read_local_file(
    project_id: str,
    path: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Read a text file from the local working copy."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_view_project(project, current_user)

    from app.services.local_script_service import LocalScriptError, LocalScriptService
    try:
        return LocalScriptService.read_file(project, path)
    except LocalScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{project_id}/local/file", response_model=LocalFileContent)
async def write_local_file(
    project_id: str,
    payload: LocalFileWriteRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Write a text file in the local working copy (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    from app.services.local_script_service import LocalScriptError, LocalScriptService
    try:
        return LocalScriptService.write_file(project, payload.path, payload.content)
    except LocalScriptError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{project_id}/local/branch", response_model=LocalRepoStatusResponse)
async def create_local_branch(
    project_id: str,
    payload: LocalBranchRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Create and checkout a new local branch (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        status_dict = await LocalRepoService.create_branch(project, payload.branch, payload.from_ref)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _local_status_response(status_dict)


@router.post("/{project_id}/local/commit", response_model=LocalRepoStatusResponse)
async def commit_local_changes(
    project_id: str,
    payload: LocalCommitRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Stage all changes and commit them in the local working copy (lead/admin)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        status_dict = await LocalRepoService.commit(project, payload.message)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _local_status_response(status_dict)


@router.post("/{project_id}/local/push", response_model=LocalPushResponse)
async def push_local_branch(
    project_id: str,
    payload: LocalPushRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Push a local branch to GitHub (lead/admin only)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")

    from app.services.local_repo_service import LocalRepoError, LocalRepoService
    try:
        result = await LocalRepoService.push(project, repo_url, token, branch=payload.branch)
    except LocalRepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return LocalPushResponse(
        branch=result["branch"],
        pushed=result["pushed"],
        status=_local_status_response(result["status"]),
    )


@router.post("/{project_id}/github/pull-request", response_model=PullRequestResponse)
async def create_pull_request(
    project_id: str,
    payload: PullRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Open a pull request on GitHub for this project's repository (lead/admin)."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    cfg = project.config_json or {}
    token = _read_user_project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")
    repo_url = cfg.get("github_repo_url", project.git_repo_url or "")
    if not repo_url:
        raise HTTPException(status_code=400, detail="No repository URL configured for this project.")

    base = (payload.base or project.default_branch or "main").strip()
    head = payload.head.strip()
    if not head:
        raise HTTPException(status_code=400, detail="A head (source) branch is required.")
    if head == base:
        raise HTTPException(status_code=400, detail="Head and base branches must be different.")
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="A pull request title is required.")

    owner, repo = GitHubService.parse_github_url(repo_url)
    api_base = _build_github_api_base(repo_url)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{api_base}/repos/{owner}/{repo}/pulls",
                json={
                    "title": payload.title.strip(),
                    "body": payload.body or "",
                    "head": head,
                    "base": base,
                    "draft": payload.draft,
                },
                headers={
                    "Authorization": f"token {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if resp.status_code in (200, 201):
        pr = resp.json()
        return PullRequestResponse(
            number=pr.get("number", 0),
            url=pr.get("html_url", ""),
            state=pr.get("state", "open"),
            title=pr.get("title", payload.title),
            head=head,
            base=base,
        )
    if resp.status_code == 401:
        raise HTTPException(status_code=400, detail="GitHub token invalid or expired for this project.")
    if resp.status_code == 422:
        # Most common: a PR already exists, or the branch wasn't pushed.
        detail = "GitHub rejected the pull request."
        try:
            body = resp.json()
            errors = body.get("errors") or []
            msgs = [e.get("message") for e in errors if isinstance(e, dict) and e.get("message")]
            detail = body.get("message", detail)
            if msgs:
                detail = f"{detail}: {'; '.join(msgs)}"
        except Exception:
            pass
        raise HTTPException(status_code=422, detail=detail)
    raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])


@router.delete("/{project_id}/local", status_code=status.HTTP_204_NO_CONTENT)
async def delete_local_repo(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Remove the project's local copy (lead/admin only).

    Disk files are only deleted if we created this checkout ourselves
    (the default managed folder, or an "Import new project" clone). A
    folder linked via "Existing project" is only unlinked, never deleted,
    since it's the user's own pre-existing checkout. Either way, the saved
    path is cleared so the "Local copy" panel reverts to offering
    "Import new project" / "Existing project" again.
    """
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _enforce_manage_project(project, current_user)

    from app.services.local_repo_service import LocalRepoService
    LocalRepoService.remove(project)

    cfg = project.config_json or {}
    if "local_repo_path" in cfg or "local_repo_managed" in cfg:
        new_cfg = dict(cfg)
        new_cfg.pop("local_repo_path", None)
        new_cfg.pop("local_repo_managed", None)
        await ProjectService.update_project(db, project_id, ProjectUpdate(config_json=new_cfg))
    return None
