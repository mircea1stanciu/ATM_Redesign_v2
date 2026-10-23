"""Shared project helpers: lookup, access checks and GitHub API access for a project."""
import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.identity.models import UserRole
from app.modules.projects.models import Project
from app.modules.settings.connections import get_secret, set_secret, store_settings


# Helper functions for access control
def check_product_manager_access(current_user):
    """Check if user has Product Manager access for create/update/delete operations
    
    Requirements:
    - Must have "product" in assigned_communities (any role), OR
    - Super Admin or Org Admin
    """
    # Super admins and org admins have full access
    if current_user.role in [UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN]:
        return True
    
    # Check if user has "product" in their assigned communities (works for both community_lead and user roles)
    if current_user.assigned_communities:
        try:
            communities = json.loads(current_user.assigned_communities)
            if "product" in communities:
                return True
        except Exception:
            pass
    
    raise HTTPException(
        status_code=403, 
        detail=(
            "Access denied. Only users assigned to Product Management "
            "community can create, edit, or delete projects."
        )
    )


def check_organization_member(current_user):
    """Check if user belongs to an organization (for read operations)"""
    if not current_user.organization_id:
        raise HTTPException(
            status_code=403, 
            detail="Access denied. User must belong to an organization."
        )
    return True


def user_settings(user) -> dict:
    """The user's non-secret settings (tokens are in user_connections, see app.modules.settings.connections)."""
    return dict(getattr(user, "settings_json", None) or {})


def project_github_token(user, project_id) -> str:
    return get_secret(user, "github_project", str(project_id))


def set_project_github_token(db: Session, user, project_id, token: str) -> None:
    set_secret(user, "github_project", token, str(project_id))
    db.commit()
    db.refresh(user)


def token_preview(token: str) -> str:
    return ("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else "")


def github_user_endpoint(base_url: str) -> str:
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


def github_repository_context(project, current_user, project_id: int):
    token = project_github_token(current_user, project_id)
    if not token:
        raise HTTPException(status_code=400, detail="No GitHub token configured for your account on this project.")

    repo_url = (project.github_repo_url or "").strip()
    owner, repo, parsed = github_repository_identity(repo_url)
    host = parsed.netloc.lower()
    if host == "github.com" or host.endswith(".github.com"):
        api_base = "https://api.github.com"
    else:
        api_base = f"{parsed.scheme}://{parsed.netloc}/api/v3"
    return owner, repo, api_base, token


def github_repository_identity(repo_url: str):
    normalized_url = repo_url
    if repo_url.startswith("git@") and ":" in repo_url:
        host, path = repo_url[4:].split(":", 1)
        normalized_url = f"https://{host}/{path}"
    parsed = urlparse(normalized_url)
    path_parts = parsed.path.strip("/").removesuffix(".git").split("/")
    if len(path_parts) < 2 or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Could not parse GitHub repo URL.")
    return path_parts[-2].lower(), path_parts[-1].lower(), parsed


def github_headers(token: str, scheme: str = "Bearer") -> dict:
    return {
        "Authorization": f"{scheme} {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def github_get(
    client: httpx.AsyncClient, url: str, token: str, accept: str = "application/vnd.github+json", **kwargs
):
    headers = github_headers(token)
    headers["Accept"] = accept
    response = await client.get(url, headers=headers, **kwargs)
    if response.status_code == 401:
        headers = github_headers(token, "token")
        headers["Accept"] = accept
        response = await client.get(url, headers=headers, **kwargs)
    return response


async def list_github_folder(
    client, api_base: str, owner: str, repo: str, folder: str, ref: str, token: str
) -> list[dict]:
    response = await github_get(
        client,
        f"{api_base}/repos/{owner}/{repo}/contents/{folder}",
        token,
        params={"ref": ref},
    )
    if response.status_code == 404:
        return []
    if response.status_code != 200:
        raise HTTPException(
            status_code=400 if response.status_code == 401 else response.status_code, detail=response.text[:200]
        )
    data = response.json()
    return data if isinstance(data, list) else []


def get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def parse_github_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse a GitHub API ISO8601 timestamp (e.g. 2024-01-01T00:00:00Z) to naive UTC."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def local_status(repo_path: Path) -> dict:
    git_path = repo_path / ".git"
    response = {
        "path": str(repo_path),
        "exists": repo_path.exists(),
        "is_git_repo": git_path.exists(),
        "current_branch": None,
        "branches": [],
        "last_commit": None,
        "dirty": False,
        "has_upstream": False,
        "ahead": 0,
        "behind": 0,
    }
    if not git_path.exists():
        return response

    def git(*args: str) -> str:
        completed = subprocess.run(["git", *args], cwd=repo_path, text=True, capture_output=True, check=False)
        return completed.stdout.strip() if completed.returncode == 0 else ""

    response["current_branch"] = git("rev-parse", "--abbrev-ref", "HEAD") or None
    response["branches"] = [branch for branch in git("branch", "--format=%(refname:short)").splitlines() if branch]
    response["dirty"] = bool(git("status", "--porcelain"))
    upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if upstream:
        response["has_upstream"] = True
        counts = git("rev-list", "--left-right", "--count", f"HEAD...{upstream}").split()
        if len(counts) == 2:
            response["ahead"], response["behind"] = int(counts[0]), int(counts[1])
    commit_lines = git("log", "-1", "--pretty=%H%n%an%n%ad%n%s", "--date=iso").splitlines()
    if commit_lines:
        response["last_commit"] = {
            "sha": commit_lines[0],
            "author": commit_lines[1] if len(commit_lines) > 1 else "",
            "date": commit_lines[2] if len(commit_lines) > 2 else "",
            "message": commit_lines[3] if len(commit_lines) > 3 else "",
        }
    return response


def require_editor(current_user) -> None:
    role = getattr(current_user.role, "value", str(current_user.role))
    if str(role).lower() == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot edit project files.")


def script_configs(user, project_id) -> dict:
    """The user's saved input values per script id for a project's checkout."""
    by_project = user_settings(user).get("project_script_configs")
    if not isinstance(by_project, dict):
        return {}
    configs = by_project.get(str(project_id))
    return dict(configs) if isinstance(configs, dict) else {}


def save_script_config(db: Session, user, project_id, script_id: str, values: dict) -> None:
    data = user_settings(user)
    by_project = dict(data.get("project_script_configs") or {})
    configs = dict(by_project.get(str(project_id)) or {})
    configs[script_id] = values
    by_project[str(project_id)] = configs
    data["project_script_configs"] = by_project
    store_settings(user, data)
    db.commit()
    db.refresh(user)
