"""The project's ATM service account (phase 18): a GitHub token set by a lead and a checkout ATM keeps on the station.
Scheduled runs use it, so they no longer depend on the person who set the schedule (their checkout or access)."""
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from app.core.config import settings
from app.core.crypto import SecretUnreadable, decrypt
from app.services.local_import_service import _git
from app.services.local_repo_service import LocalRepoError, LocalRepoService

logger = logging.getLogger("atm.service_account")


class ServiceAccountError(Exception):
    pass


def checkout_dir(project_id: int) -> Path:
    return Path(settings.ARTIFACTS_DIR) / "service-checkouts" / f"project-{project_id}"


def configured(project: Any) -> bool:
    return bool(project.service_github_token and (project.github_repo_url or "").strip())


def _token(project: Any) -> str:
    try:
        return decrypt(project.service_github_token)
    except SecretUnreadable as exc:
        raise ServiceAccountError("The service account token cannot be read; set it again.") from exc


async def _default_branch(authed_url: str) -> str:
    """The repository's default branch (HEAD on the remote)."""
    out = await _git(["ls-remote", "--symref", authed_url, "HEAD"], timeout=120)
    for line in out.splitlines():
        if line.startswith("ref: refs/heads/") and line.endswith("\tHEAD"):
            return line.removeprefix("ref: refs/heads/").removesuffix("\tHEAD")
    return "main"


async def sync(project: Any, token: Optional[str] = None) -> Path:
    """Clone the repository on first use, then bring the checkout to the latest default branch (local changes and
    untracked files are discarded; ignored files such as dependencies and run artifacts stay)."""
    repo_url = (project.github_repo_url or "").strip()
    if not repo_url:
        raise ServiceAccountError("This project has no GitHub repository.")
    authed = LocalRepoService._authenticated_url(repo_url, token if token is not None else _token(project))
    clean = LocalRepoService._sanitize_remote(repo_url)
    target = checkout_dir(project.id)
    try:
        branch = await _default_branch(authed)
        if not (target / ".git").exists():
            shutil.rmtree(target, ignore_errors=True)
            target.parent.mkdir(parents=True, exist_ok=True)
            await _git(["clone", "--", authed, str(target)], timeout=900)
            await _git(["remote", "set-url", "origin", clean], cwd=target)  # keep the token out of git's config
        await _git(["fetch", authed, f"+refs/heads/{branch}:refs/remotes/origin/{branch}"], cwd=target, timeout=900)
        await _git(["checkout", "-B", branch, f"origin/{branch}"], cwd=target)
        await _git(["reset", "--hard", f"origin/{branch}"], cwd=target)
        await _git(["clean", "-fd"], cwd=target)
    except LocalRepoError as exc:
        raise ServiceAccountError(str(exc)) from exc
    return target


def remove_checkout(project_id: int) -> None:
    shutil.rmtree(checkout_dir(project_id), ignore_errors=True)


def mark(project: Any, error: Optional[str]) -> None:
    project.service_error = error[:500] if error else None
    if not error:
        project.service_synced_at = datetime.utcnow()
