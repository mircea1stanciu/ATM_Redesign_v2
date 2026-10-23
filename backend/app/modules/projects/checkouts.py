"""Where a user's local checkout of a project lives.

Each user links (or imports) their own working copy per project; the path is remembered in the user's settings.
Without a link, the managed folder <LOCAL_REPOS_DIR or backend/local_repos>/<project_id> is used.
"""
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import BACKEND_DIR, settings
from app.modules.settings.connections import store_settings

NO_CHECKOUT_DETAIL = "No local checkout exists yet. Link or import a repository first."


def managed_checkouts_dir() -> Path:
    if settings.LOCAL_REPOS_DIR:
        return Path(settings.LOCAL_REPOS_DIR).expanduser().resolve()
    return (BACKEND_DIR / "local_repos").resolve()


def read_linked_path(user, project_id) -> str:
    paths = dict(getattr(user, "settings_json", None) or {}).get("project_local_repo_paths")
    if not isinstance(paths, dict):
        return ""
    return str(paths.get(str(project_id)) or "")


def save_linked_path(db: Session, user, project_id, path: str, managed: bool = False) -> None:
    """Remember the checkout folder; ``managed`` marks folders ATM cloned itself (safe to delete)."""
    data = dict(getattr(user, "settings_json", None) or {})
    paths = dict(data.get("project_local_repo_paths") or {})
    managed_map = dict(data.get("project_local_repo_managed") or {})
    if path:
        paths[str(project_id)] = path
    else:
        paths.pop(str(project_id), None)
    if managed and path:
        managed_map[str(project_id)] = path
    else:
        managed_map.pop(str(project_id), None)
    data["project_local_repo_paths"] = paths
    data["project_local_repo_managed"] = managed_map
    # Assign a new dict: SQLAlchemy only flushes JSON changes when the attribute is set again.
    store_settings(user, data)
    db.commit()
    db.refresh(user)


def checkout_path(user, project_id) -> Path:
    """The user's linked checkout of the project, or the managed default folder (it may not exist)."""
    linked = read_linked_path(user, project_id)
    if linked:
        return Path(linked).expanduser().resolve()
    return managed_checkouts_dir() / str(project_id)


def require_checkout(user, project_id) -> Path:
    """Like checkout_path, but 400 when there is no git working copy there."""
    path = checkout_path(user, project_id)
    if not (path / ".git").exists():
        raise HTTPException(status_code=400, detail=NO_CHECKOUT_DETAIL)
    return path


def service_project(project_id, repo_path: Path, default_branch: str = "main") -> SimpleNamespace:
    """The project shape the local git/script/library services expect, pointing at `repo_path`."""
    return SimpleNamespace(
        id=project_id,
        config_json={"local_repo_path": str(repo_path)},
        framework=None,
        default_branch=default_branch,
    )
