import re
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import BACKEND_DIR, settings
from app.core.db import get_db
from app.core.deps import get_current_user, require_admin, require_lead_or_above
from app.modules.identity.models import User
from app.modules.settings.connections import set_secret, settings_with_secrets, store_settings
from app.services.confluence_release_analyzer import (
    analyze_release_page_html,
    extract_jira_macro_jql_queries,
)
from app.services.test_manager_service import TestManagerService, clear_test_manager_caches
from app.services.zephyr_service import ZephyrAuthError, ZephyrPermissionError, ZephyrService

router = APIRouter()

ENV_FILE = str(BACKEND_DIR / ".env")


def _read_env() -> dict:
    """Read .env file into a dict."""
    env: dict = {}
    try:
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def _write_env_key(key: str, value: str):
    """Upsert a single key in the .env file."""
    try:
        with open(ENV_FILE) as f:
            lines = f.readlines()
    except FileNotFoundError:
        lines = []

    pattern = re.compile(rf"^{re.escape(key)}\s*=")
    found = False
    new_lines = []
    for line in lines:
        if pattern.match(line):
            new_lines.append(f'{key}="{value}"\n')
            found = True
        else:
            new_lines.append(line)

    if not found:
        new_lines.append(f'{key}="{value}"\n')

    with open(ENV_FILE, "w") as f:
        f.writelines(new_lines)


# ── Schemas ──────────────────────────────────────────────────────────────────

class GitHubMCPConfig(BaseModel):
    github_token: Optional[str] = None
    github_mcp_base_url: Optional[str] = None


class SettingsResponse(BaseModel):
    github_token_set: bool
    github_token_preview: str        # last 4 chars or ""
    github_mcp_base_url: str


class JiraMCPConfig(BaseModel):
    jira_token: Optional[str] = None
    jira_mcp_base_url: Optional[str] = None
    jira_project_key: Optional[str] = None
    jira_project_name: Optional[str] = None


class JiraSettingsResponse(BaseModel):
    jira_token_set: bool
    jira_token_preview: str
    jira_mcp_base_url: str
    jira_project_key: Optional[str] = None
    jira_project_name: Optional[str] = None


class JiraTestResponse(BaseModel):
    ok: bool
    user: Optional[str] = None
    error: Optional[str] = None


class JiraProjectItem(BaseModel):
    id: str
    key: str
    name: str
    project_type: Optional[str] = None


class JiraProjectsResponse(BaseModel):
    projects: list[JiraProjectItem]


class JiraIssueTypeItem(BaseModel):
    id: str
    name: str


class JiraCreateMetaResponse(BaseModel):
    project_key: str
    issue_types: list[JiraIssueTypeItem]


class JiraCreateIssueRequest(BaseModel):
    project_key: Optional[str] = None
    issue_type: str
    source_issue_key: Optional[str] = None
    issue_link_type: Optional[str] = "Relates"
    summary: str
    description: Optional[str] = None
    priority: Optional[str] = None
    components: Optional[str] = None
    team_name: Optional[str] = None
    epic_link: Optional[str] = None


class JiraCreateIssueResponse(BaseModel):
    key: str
    url: str
    linked_source: bool = False


class ConfluenceMCPConfig(BaseModel):
    confluence_token: Optional[str] = None
    confluence_mcp_base_url: Optional[str] = None
    confluence_space_key: Optional[str] = None
    confluence_space_name: Optional[str] = None
    confluence_release_container_id: Optional[str] = None
    confluence_release_container_title: Optional[str] = None
    confluence_release_container_url: Optional[str] = None
    confluence_selected_release_page_id: Optional[str] = None
    confluence_selected_release_page_title: Optional[str] = None
    confluence_selected_release_page_url: Optional[str] = None


class ConfluenceSettingsResponse(BaseModel):
    confluence_token_set: bool
    confluence_token_preview: str
    confluence_mcp_base_url: str
    confluence_space_key: Optional[str] = None
    confluence_space_name: Optional[str] = None
    confluence_release_container_id: Optional[str] = None
    confluence_release_container_title: Optional[str] = None
    confluence_release_container_url: Optional[str] = None
    confluence_selected_release_page_id: Optional[str] = None
    confluence_selected_release_page_title: Optional[str] = None
    confluence_selected_release_page_url: Optional[str] = None


class ConfluenceTestResponse(BaseModel):
    ok: bool
    user: Optional[str] = None
    error: Optional[str] = None


class ConfluenceSpaceItem(BaseModel):
    id: str
    key: str
    name: str


class ConfluenceSpacesResponse(BaseModel):
    spaces: list[ConfluenceSpaceItem]


class ConfluencePageItem(BaseModel):
    id: str
    title: str
    url: str
    updated: Optional[str] = None


class ConfluencePagesResponse(BaseModel):
    pages: list[ConfluencePageItem]


class ReleaseAnalysisBackendItem(BaseModel):
    service: str
    version: str
    component: Optional[str] = None
    component_color: Optional[str] = None
    live_env_details: Optional[str] = None
    live_env_details_color: Optional[str] = None
    new_service_or_operation: Optional[str] = None
    new_service_or_operation_color: Optional[str] = None
    developer: Optional[str] = None
    developer_color: Optional[str] = None
    context: str = ""


class ReleaseAnalysisFrontendItem(BaseModel):
    platform: str
    version: str
    environment: Optional[str] = None
    context: str = ""


class ReleaseAnalysisMetadata(BaseModel):
    release_date: Optional[str] = None
    status: Optional[str] = None
    team: Optional[str] = None


class ReleaseAnalysisTicketItem(BaseModel):
    key: str
    summary: str = ""
    issue_type: str = ""
    status: str = ""
    team_name: Optional[str] = None
    epic_link: Optional[str] = None
    components: Optional[str] = None
    url: str = ""


class ReleaseAnalysisResponse(BaseModel):
    page_id: str
    page_title: str
    page_url: str
    release_metadata: Optional[ReleaseAnalysisMetadata] = None
    backend_versions: list[ReleaseAnalysisBackendItem]
    frontend_versions: list[ReleaseAnalysisFrontendItem]
    additional_tickets: list[ReleaseAnalysisTicketItem] = []
    additional_tickets_error: Optional[str] = None


class ConfluenceReleasePage(BaseModel):
    id: str
    title: str
    url: str
    space_key: str
    updated: Optional[str] = None


class ConfluenceReleasesResponse(BaseModel):
    pages: list[ConfluenceReleasePage]


class ZephyrCycle(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created: Optional[str] = None
    updated: Optional[str] = None
    folder: Optional[str] = None


class ZephyrCyclesResponse(BaseModel):
    project_key: str
    cycles: list[ZephyrCycle]
    total: int


class ZephyrSettingsResponse(BaseModel):
    zephyr_project_key: str
    zephyr_selected_folder_id: str


class GitHubTestResponse(BaseModel):
    ok: bool
    login: Optional[str] = None
    name: Optional[str] = None
    plan: Optional[str] = None
    error: Optional[str] = None


class EpicStatusFilter(BaseModel):
    search: str = ""
    status: str = ""
    team: str = ""


class AutomationStatusFilter(BaseModel):
    search: str = ""
    filter: str = ""
    team: str = ""


class RequirementsFiltersPayload(BaseModel):
    epic_status_view: Optional[EpicStatusFilter] = None
    automation_status_management: Optional[AutomationStatusFilter] = None


class RequirementsFiltersResponse(BaseModel):
    epic_status_view: EpicStatusFilter
    automation_status_management: AutomationStatusFilter


def _user_settings(user) -> dict:
    """The user's settings with decrypted tokens filled in (tokens are stored in user_connections)."""
    return settings_with_secrets(user)


def _set_user_settings(user, data: dict) -> None:
    """Save the non-secret settings; tokens change only through set_secret."""
    store_settings(user, data)


def _read_setting(user_data: dict, key: str, fallback: str = "") -> str:
    if key in user_data:
        return str(user_data.get(key) or "")
    return fallback


def _role(user) -> str:
    """Return role as a plain string, regardless of which UserRole enum the user model uses."""
    r = user.role
    return r.value if hasattr(r, 'value') else str(r)


_LEAD_OR_ABOVE = {"admin", "super_admin", "org_admin", "automation_lead"}
_USER_OR_VIEWER = {"automation_user", "viewer"}


def _can_manage_jira_project_config(user) -> bool:
    if _role(user) in _LEAD_OR_ABOVE:
        return True

    return _role(user) in _USER_OR_VIEWER and bool(getattr(user, 'assigned_lead_id', None))


def _can_manage_confluence_space_config(user) -> bool:
    if _role(user) in _LEAD_OR_ABOVE:
        return True

    return _role(user) in _USER_OR_VIEWER and bool(getattr(user, 'assigned_lead_id', None))


def _build_github_user_endpoint(base_url: str) -> str:
    """Build the /user API endpoint from configured GitHub/GHE base URL."""
    if not base_url:
        return "https://api.github.com/user"

    parsed = urlparse(base_url)
    if not parsed.scheme or not parsed.netloc:
        return "https://api.github.com/user"

    host = parsed.netloc.lower()
    path = (parsed.path or "").strip("/")

    # Public GitHub
    if host == "github.com" or host.endswith(".github.com"):
        return "https://api.github.com/user"

    # If URL already points to API area, keep it.
    if path.startswith("api/v3"):
        return f"{parsed.scheme}://{parsed.netloc}/{path}/user"

    # GitHub Enterprise default REST root.
    return f"{parsed.scheme}://{parsed.netloc}/api/v3/user"


def _build_jira_api_candidates(base_url: str) -> list[str]:
    """Build Jira REST base candidates for Cloud/DC compatibility."""
    normalized = (base_url or "").strip().rstrip("/")
    if not normalized:
        return []

    return [
        f"{normalized}/rest/api/3",
        f"{normalized}/rest/api/2",
    ]


def _build_confluence_api_candidates(base_url: str) -> list[str]:
    """Build Confluence REST base candidates for Cloud/Server/DC compatibility."""
    normalized = (base_url or "").strip().rstrip("/")
    if not normalized:
        return []

    candidates = [f"{normalized}/rest/api"]
    if not normalized.endswith("/wiki"):
        candidates.append(f"{normalized}/wiki/rest/api")
    return candidates


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=SettingsResponse)
async def get_settings(_user=Depends(get_current_user)):
    """Return current user's GitHub integration settings."""
    data = _user_settings(_user)
    token = _read_setting(data, "github_token", "")
    base_url = _read_setting(data, "github_mcp_base_url", "")
    return SettingsResponse(
        github_token_set=bool(token),
        github_token_preview=("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else ""),
        github_mcp_base_url=base_url,
    )


@router.patch("/github", response_model=SettingsResponse)
async def update_github_settings(
    payload: GitHubMCPConfig,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save current user's GitHub token and/or base URL."""
    data = _user_settings(current_user)

    if payload.github_token is not None:
        data["github_token"] = payload.github_token
        set_secret(current_user, "github", payload.github_token)

    if payload.github_mcp_base_url is not None:
        data["github_mcp_base_url"] = payload.github_mcp_base_url

    _set_user_settings(current_user, data)
    db.commit()
    db.refresh(current_user)

    token = _read_setting(data, "github_token", "")
    base_url = _read_setting(data, "github_mcp_base_url", "")
    return SettingsResponse(
        github_token_set=bool(token),
        github_token_preview=("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else ""),
        github_mcp_base_url=base_url,
    )


@router.post("/github/test", response_model=GitHubTestResponse)
async def test_github_connection(_user=Depends(get_current_user)):
    """Verify current user's GitHub token by calling /user on the GitHub API."""
    data = _user_settings(_user)
    token = _read_setting(data, "github_token", "")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No GitHub token configured.",
        )
    base_url = _read_setting(data, "github_mcp_base_url", "")
    user_endpoint = _build_github_user_endpoint(base_url)
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

        # Some GitHub Enterprise setups expect `token` instead of `Bearer`.
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
            return GitHubTestResponse(
                ok=True,
                login=data.get("login"),
                name=data.get("name"),
                plan=data.get("plan", {}).get("name") if data.get("plan") else None,
            )
        return GitHubTestResponse(ok=False, error=f"GitHub returned {resp.status_code}: {resp.text[:120]}")
    except Exception as exc:
        return GitHubTestResponse(ok=False, error=str(exc))


@router.get("/jira", response_model=JiraSettingsResponse)
async def get_jira_settings(_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return current user's Jira integration settings.
    
    For Automation User/Viewer: Returns project and base_url configured by their Lead, with their own token.
    For Lead/Admin: Returns their own configuration.
    """
    # Determine where to read project configuration from
    import logging
    _log = logging.getLogger("settings.jira")
    assigned_lead_id = getattr(_user, 'assigned_lead_id', None)
    _log.debug(f"GET /jira: user={_user.email}, role={_user.role}, assigned_lead_id={assigned_lead_id}")
    config_source_user = _user
    if _role(_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        _log.debug(f"GET /jira: lead found={lead is not None}, lead_email={lead.email if lead else 'N/A'}")
        if lead:
            config_source_user = lead
            lead_settings = _user_settings(lead)
            _log.debug(
                "GET /jira: lead settings_json keys=%s, jira_mcp_base_url=%s",
                list(lead_settings.keys()) if lead_settings else 'NONE',
                lead_settings.get('jira_mcp_base_url', 'NOT_SET'),
            )

    # Get all settings from config source (lead for User/Viewer, self for Lead/Admin)
    config_data = _user_settings(config_source_user)
    project_key = _read_setting(config_data, "jira_project_key", "")
    project_name = _read_setting(config_data, "jira_project_name", "")
    base_url = _read_setting(config_data, "jira_mcp_base_url", "")
    _log.debug(f"GET /jira: returning base_url={base_url!r}, project_key={project_key!r}")
    
    # Get token from current user only
    user_data = _user_settings(_user)
    token = _read_setting(user_data, "jira_token", "")
    
    return JiraSettingsResponse(
        jira_token_set=bool(token),
        jira_token_preview=("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else ""),
        jira_mcp_base_url=base_url,
        jira_project_key=(project_key or None),
        jira_project_name=(project_name or None),
    )


@router.patch("/jira", response_model=JiraSettingsResponse)
async def update_jira_settings(
    payload: JiraMCPConfig,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save current user's Jira token; base URL is lead/admin and project selection is scoped."""
    data = _user_settings(current_user)

    tries_to_change_base_url = payload.jira_mcp_base_url is not None
    if tries_to_change_base_url and _role(current_user) not in _LEAD_OR_ABOVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin and Automation Lead can change Jira base URL",
        )

    tries_to_change_project = payload.jira_project_key is not None or payload.jira_project_name is not None
    if tries_to_change_project and not _can_manage_jira_project_config(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Automation Leads and assigned Automation Users/Visitors can change Jira project selection",
        )

    if payload.jira_token is not None:
        data["jira_token"] = payload.jira_token
        set_secret(current_user, "jira", payload.jira_token)

    if payload.jira_mcp_base_url is not None:
        data["jira_mcp_base_url"] = payload.jira_mcp_base_url

    if payload.jira_project_key is not None:
        data["jira_project_key"] = payload.jira_project_key

    if payload.jira_project_name is not None:
        data["jira_project_name"] = payload.jira_project_name

    _set_user_settings(current_user, data)
    db.commit()
    db.refresh(current_user)

    # The token/base URL/project just changed, so any previously cached
    # Epics/Test cases (Jira Management) fetched under the old configuration
    # are no longer trustworthy — drop them so the next load is a fresh fetch.
    if payload.jira_token is not None or payload.jira_mcp_base_url is not None:
        clear_test_manager_caches()
    elif payload.jira_project_key is not None:
        clear_test_manager_caches(payload.jira_project_key or None)

    # For the response, get base_url and project from lead if User/Viewer
    config_source_user = current_user
    assigned_lead_id = getattr(current_user, 'assigned_lead_id', None)
    if _role(current_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    config_data = _user_settings(config_source_user)
    token = _read_setting(data, "jira_token", "")
    base_url = _read_setting(config_data, "jira_mcp_base_url", "")
    project_key = _read_setting(config_data, "jira_project_key", "")
    project_name = _read_setting(config_data, "jira_project_name", "")
    return JiraSettingsResponse(
        jira_token_set=bool(token),
        jira_token_preview=("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else ""),
        jira_mcp_base_url=base_url,
        jira_project_key=(project_key or None),
        jira_project_name=(project_name or None),
    )


@router.post("/jira/test", response_model=JiraTestResponse)
async def test_jira_connection(_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Verify Jira token by calling /myself.
    
    For Automation User/Viewer: Uses their own token and Lead's base_url.
    For Lead/Admin: Uses their own token and base_url.
    """
    # Determine where to read configuration from
    config_source_user = _user
    assigned_lead_id = getattr(_user, 'assigned_lead_id', None)
    if _role(_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    # Get base_url from appropriate source (lead for User/Viewer, self for Lead/Admin)
    config_data = _user_settings(config_source_user)
    base_url = _read_setting(config_data, "jira_mcp_base_url", "")

    # Always use current user's own token
    user_data = _user_settings(_user)
    token = _read_setting(user_data, "jira_token", "")
    
    if not token or not base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira token or Jira base URL is not configured.",
        )

    candidates = _build_jira_api_candidates(base_url)
    last_error = ""

    for api_base in candidates:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{api_base}/myself",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                    },
                )

            if resp.status_code == 200:
                data = resp.json()
                user = data.get("displayName") or data.get("name") or data.get("emailAddress")
                return JiraTestResponse(ok=True, user=user)
            last_error = f"{resp.status_code}: {resp.text[:120]}"
        except HTTPException:
            raise
        except Exception as exc:
            last_error = str(exc)

    return JiraTestResponse(ok=False, error=last_error or "Unable to connect to Jira.")


@router.get("/jira/projects", response_model=JiraProjectsResponse)
async def list_jira_projects(_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """List Jira projects via configured Jira MCP/base URL and token.
    
    For Automation User/Viewer: Show projects configured by their assigned Lead, but use their own token.
    For Lead/Admin: Show all available projects with their own token.
    """
    if not _can_manage_jira_project_config(_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Jira project configuration is available only for Automation "
                "Leads and assigned Automation Users/Visitors"
            ),
        )

    # Determine where to read project configuration from
    config_source_user = _user
    assigned_lead_id = getattr(_user, 'assigned_lead_id', None)
    if _role(_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    # Get project config from appropriate source
    config_data = _user_settings(config_source_user)
    _read_setting(config_data, "jira_project_key", "")
    _read_setting(config_data, "jira_project_name", "")
    
    # For User/Viewer: get base_url from Lead's config
    # For Lead/Admin: get base_url from their own config
    base_url = _read_setting(config_data, "jira_mcp_base_url", "")
    
    # Always use current user's own token for authentication
    user_data = _user_settings(_user)
    token = _read_setting(user_data, "jira_token", "")
    
    if not token or not base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira token or Jira base URL is not configured.",
        )

    candidates = _build_jira_api_candidates(base_url)
    last_error = ""

    for api_base in candidates:
        for path in ("/project/search", "/project"):
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        f"{api_base}{path}",
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Accept": "application/json",
                        },
                    )

                if resp.status_code != 200:
                    last_error = f"{resp.status_code}: {resp.text[:120]}"
                    continue

                payload = resp.json()
                raw_items = payload.get("values", payload) if isinstance(payload, dict) else payload
                if not isinstance(raw_items, list):
                    raw_items = []

                projects = [
                    JiraProjectItem(
                        id=str(item.get("id", "")),
                        key=str(item.get("key", "")),
                        name=str(item.get("name", "")),
                        project_type=item.get("projectTypeKey"),
                    )
                    for item in raw_items
                    if item.get("id") and item.get("key") and item.get("name")
                ]
                projects.sort(key=lambda p: p.key)
                return JiraProjectsResponse(projects=projects)
            except Exception as exc:
                last_error = str(exc)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Failed to list Jira projects. {last_error}",
    )


def _resolve_jira_auth(user, db_lead: Optional[User]) -> tuple[str, str]:
    """Return (base_url, token) using the same Lead/User resolution rules as
    the other Jira endpoints: base_url comes from the Lead's config for
    Automation Users/Viewers, token always belongs to the current user."""
    config_source_user = db_lead or user
    config_data = _user_settings(config_source_user)
    base_url = _read_setting(config_data, "jira_mcp_base_url", "")

    user_data = _user_settings(user)
    token = _read_setting(user_data, "jira_token", "")
    return base_url, token


async def _get_config_source_lead(current_user, db: Session) -> Optional[User]:
    assigned_lead_id = getattr(current_user, 'assigned_lead_id', None)
    if _role(current_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        return result.scalar_one_or_none()
    return None


async def _find_jira_custom_field(
    client: httpx.AsyncClient,
    api_base: str,
    headers: dict,
    *,
    schema_custom: Optional[str] = None,
    name_contains: Optional[str] = None,
) -> tuple[Optional[str], Optional[dict]]:
    """Return (field_id_or_name, schema_dict) for the first Jira field matching
    either a custom schema type (e.g. epic link) or a case-insensitive name
    substring (e.g. "team name")."""
    try:
        resp = await client.get(f"{api_base}/field", headers=headers)
    except Exception:
        return None, None
    if resp.status_code != 200:
        return None, None

    for field in resp.json():
        field_name = (field.get("name") or "").strip()
        field_id = field.get("id", "")
        schema = field.get("schema") or {}

        if schema_custom and schema.get("custom") == schema_custom:
            return (field_id or field_name or None), schema
        if name_contains and name_contains.lower() in field_name.lower():
            return (field_id or field_name or None), schema

    return None, None


@router.get("/jira/create-meta", response_model=JiraCreateMetaResponse)
async def get_jira_create_meta(
    project_key: Optional[str] = Query(None),
    _user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the issue types available for creating a ticket in the configured
    (or given) Jira project, so the "Create Jira Ticket" popup can mirror
    Jira's own create-issue dialog."""
    lead = await _get_config_source_lead(_user, db)
    config_data = _user_settings(lead or _user)
    base_url, token = _resolve_jira_auth(_user, lead)
    resolved_project_key = (project_key or _read_setting(config_data, "jira_project_key", "")).strip()

    if not token or not base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira token or Jira base URL is not configured.",
        )
    if not resolved_project_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Jira project is configured.",
        )

    candidates = _build_jira_api_candidates(base_url)
    last_error = ""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    for api_base in candidates:
        # Modern per-project endpoint (Jira Cloud). The legacy bulk endpoint
        # below (`/issue/createmeta?expand=projects.issuetypes`) has been
        # fully retired on Jira Cloud — hitting it now 404s with
        # {"errorMessages":["Issue Does Not Exist"]} because "createmeta" is
        # matched against the single-issue-get route instead.
        try:
            issue_types: list[JiraIssueTypeItem] = []
            start_at = 0
            for _ in range(5):
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        f"{api_base}/issue/createmeta/{resolved_project_key}/issuetypes",
                        params={"startAt": start_at, "maxResults": 200},
                        headers=headers,
                    )
                if resp.status_code != 200:
                    last_error = f"{resp.status_code}: {resp.text[:120]}"
                    break

                payload = resp.json()
                values = payload.get("values") or []
                issue_types.extend(
                    JiraIssueTypeItem(id=str(v.get("id", "")), name=str(v.get("name", "")))
                    for v in values
                    if v.get("id") and v.get("name") and not v.get("subtask")
                )
                if payload.get("isLast", True) or not values:
                    break
                start_at += len(values)

            if issue_types:
                return JiraCreateMetaResponse(project_key=resolved_project_key, issue_types=issue_types)
        except Exception as exc:
            last_error = str(exc)

        # Legacy bulk endpoint (Jira Server/Data Center still supports it).
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{api_base}/issue/createmeta",
                    params={"projectKeys": resolved_project_key, "expand": "projects.issuetypes"},
                    headers=headers,
                )
            if resp.status_code != 200:
                last_error = f"{resp.status_code}: {resp.text[:120]}"
                continue

            payload = resp.json()
            projects = payload.get("projects") or []
            if not projects:
                continue

            issue_types = [
                JiraIssueTypeItem(id=str(it.get("id", "")), name=str(it.get("name", "")))
                for it in projects[0].get("issuetypes", [])
                if it.get("id") and it.get("name") and not it.get("subtask")
            ]
            if issue_types:
                return JiraCreateMetaResponse(project_key=resolved_project_key, issue_types=issue_types)
        except Exception as exc:
            last_error = str(exc)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Failed to load Jira issue types. {last_error}",
    )


@router.post("/jira/create-issue", response_model=JiraCreateIssueResponse)
async def create_jira_issue(
    payload: JiraCreateIssueRequest,
    _user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a Jira ticket directly through the configured Jira REST
    connection (the app's Jira MCP integration) instead of opening the Jira
    web portal."""
    lead = await _get_config_source_lead(_user, db)
    config_data = _user_settings(lead or _user)
    base_url, token = _resolve_jira_auth(_user, lead)
    resolved_project_key = (payload.project_key or _read_setting(config_data, "jira_project_key", "")).strip()

    if not token or not base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira token or Jira base URL is not configured.",
        )
    if not resolved_project_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Jira project is configured.",
        )
    if not payload.summary.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Summary is required.")

    candidates = _build_jira_api_candidates(base_url)
    last_error = ""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    for api_base in candidates:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                requested_type = (payload.issue_type or "").strip()
                issue_type_name = "Task"
                if requested_type and requested_type.lower() != "task":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Only issue type 'Task' is allowed for automation tickets.",
                    )

                fields: dict = {
                    "project": {"key": resolved_project_key},
                    "summary": payload.summary.strip(),
                    "issuetype": {"name": issue_type_name},
                }
                if payload.description:
                    fields["description"] = payload.description.strip()
                if payload.priority:
                    fields["priority"] = {"name": payload.priority.strip()}
                if payload.components:
                    component_names = [c.strip() for c in payload.components.split(",") if c.strip()]
                    if component_names:
                        fields["components"] = [{"name": name} for name in component_names]

                if payload.epic_link:
                    epic_field, _ = await _find_jira_custom_field(
                        client, api_base, headers,
                        schema_custom="com.pyxis.greenhopper.jira:gh-epic-link",
                    )
                    if epic_field:
                        fields[epic_field] = payload.epic_link.strip()

                if payload.team_name:
                    team_field, team_schema = await _find_jira_custom_field(
                        client, api_base, headers,
                        name_contains="team name",
                    )
                    if team_field:
                        field_type = (team_schema or {}).get("type")
                        if field_type == "array":
                            fields[team_field] = [{"value": payload.team_name.strip()}]
                        elif field_type == "string":
                            fields[team_field] = payload.team_name.strip()
                        else:
                            fields[team_field] = {"value": payload.team_name.strip()}

                resp = await client.post(f"{api_base}/issue", json={"fields": fields}, headers=headers)

            if resp.status_code in (200, 201):
                data = resp.json()
                key = data.get("key", "")
                linked_source = False
                source_issue_key = (payload.source_issue_key or "").strip().upper()
                if source_issue_key:
                    link_type_name = (payload.issue_link_type or "Relates").strip() or "Relates"
                    try:
                        async with httpx.AsyncClient(timeout=15) as client:
                            link_resp = await client.post(
                                f"{api_base}/issueLink",
                                json={
                                    "type": {"name": link_type_name},
                                    "inwardIssue": {"key": source_issue_key},
                                    "outwardIssue": {"key": key},
                                    "comment": {
                                        "body": f"Automation ticket {key} created from ATM for {source_issue_key}."
                                    },
                                },
                                headers=headers,
                            )
                        if link_resp.status_code in (200, 201):
                            linked_source = True
                        else:
                            last_error = (
                                f"Issue created ({key}) but link failed: "
                                f"{link_resp.status_code}: {link_resp.text[:250]}"
                            )
                    except Exception as exc:
                        last_error = f"Issue created ({key}) but link failed: {str(exc)}"

                if source_issue_key and not linked_source:
                    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=last_error)

                return JiraCreateIssueResponse(
                    key=key,
                    url=f"{base_url.rstrip('/')}/browse/{key}",
                    linked_source=linked_source,
                )
            last_error = f"{resp.status_code}: {resp.text[:300]}"
        except HTTPException:
            raise
        except Exception as exc:
            last_error = str(exc)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Failed to create Jira ticket. {last_error}",
    )


# ── Confluence MCP endpoints ──────────────────────────────────────────────────

@router.get("/confluence/releases", response_model=ConfluenceReleasesResponse)
async def list_confluence_releases(_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """List release-related pages from the configured Confluence space.

    Matches pages whose title contains "release" inside the configured space,
    to power the Projects → Confluence Release Management view.
    """
    config_source_user = _user
    assigned_lead_id = getattr(_user, 'assigned_lead_id', None)
    if _role(_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    config_data = _user_settings(config_source_user)
    base_url = _read_setting(config_data, "confluence_mcp_base_url", "")
    space_key = _read_setting(config_data, "confluence_space_key", "")

    user_data = _user_settings(_user)
    token = _read_setting(user_data, "confluence_token", "")

    if not token or not base_url or not space_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confluence is not fully configured (token, base URL, and space are required).",
        )

    candidates = _build_confluence_api_candidates(base_url)
    last_error = ""
    cql = f'space="{space_key}" and title~"release" and type=page'
    base_norm = (base_url or "").strip().rstrip("/")

    for api_base in candidates:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{api_base}/content/search",
                    params={"cql": cql, "limit": 50, "expand": "version"},
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                    },
                )

            if resp.status_code != 200:
                last_error = f"{resp.status_code}: {resp.text[:120]}"
                continue

            payload = resp.json()
            raw_items = payload.get("results", []) if isinstance(payload, dict) else []

            pages: list[ConfluenceReleasePage] = []
            for item in raw_items:
                content_id = str(item.get("id", ""))
                title = str(item.get("title", ""))
                if not content_id or not title:
                    continue
                links = item.get("_links", {}) or {}
                webui = links.get("webui", "")
                link_base = links.get("base", base_norm)
                url = f"{link_base}{webui}" if webui else base_norm
                version = item.get("version", {}) or {}
                pages.append(ConfluenceReleasePage(
                    id=content_id,
                    title=title,
                    url=url,
                    space_key=space_key,
                    updated=version.get("when"),
                ))
            return ConfluenceReleasesResponse(pages=pages)
        except Exception as exc:
            last_error = str(exc)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Failed to list Confluence release pages. {last_error}",
    )


@router.get("/confluence/release-containers/search", response_model=ConfluencePagesResponse)
async def search_confluence_release_containers(
    q: str = Query(default="", description="Page title search text"),
    _user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search Confluence pages in configured space to link one as release container."""
    if not _can_manage_confluence_space_config(_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Confluence release page configuration is available only for "
                "Automation Leads and assigned Automation Users/Visitors"
            ),
        )

    config_source_user = _user
    assigned_lead_id = getattr(_user, 'assigned_lead_id', None)
    if _role(_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    config_data = _user_settings(config_source_user)
    base_url = _read_setting(config_data, "confluence_mcp_base_url", "")
    space_key = _read_setting(config_data, "confluence_space_key", "")

    user_data = _user_settings(_user)
    token = _read_setting(user_data, "confluence_token", "")

    if not token or not base_url or not space_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confluence is not fully configured (token, base URL, and space are required).",
        )

    q_clean = (q or "").strip().replace('"', '\\"')
    cql = f'space="{space_key}" and type=page'
    if q_clean:
        cql += f' and title~"{q_clean}"'

    candidates = _build_confluence_api_candidates(base_url)
    last_error = ""
    base_norm = (base_url or "").strip().rstrip("/")

    for api_base in candidates:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{api_base}/content/search",
                    params={"cql": cql, "limit": 50, "expand": "version"},
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                    },
                )

            if resp.status_code != 200:
                last_error = f"{resp.status_code}: {resp.text[:120]}"
                continue

            payload = resp.json()
            raw_items = payload.get("results", []) if isinstance(payload, dict) else []
            pages: list[ConfluencePageItem] = []
            for item in raw_items:
                page_id = str(item.get("id", ""))
                title = str(item.get("title", ""))
                if not page_id or not title:
                    continue
                links = item.get("_links", {}) or {}
                webui = links.get("webui", "")
                link_base = links.get("base", base_norm)
                url = f"{link_base}{webui}" if webui else base_norm
                version = item.get("version", {}) or {}
                pages.append(ConfluencePageItem(
                    id=page_id,
                    title=title,
                    url=url,
                    updated=version.get("when"),
                ))
            return ConfluencePagesResponse(pages=pages)
        except Exception as exc:
            last_error = str(exc)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Failed to search Confluence pages. {last_error}",
    )


@router.get("/confluence/release-pages", response_model=ConfluencePagesResponse)
async def list_confluence_release_pages(
    container_id: Optional[str] = Query(
        default=None, description="Container page id; defaults to configured release container"
    ),
    _user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List child pages under the configured release container page."""
    config_source_user = _user
    assigned_lead_id = getattr(_user, 'assigned_lead_id', None)
    if _role(_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    config_data = _user_settings(config_source_user)
    base_url = _read_setting(config_data, "confluence_mcp_base_url", "")
    configured_container_id = _read_setting(config_data, "confluence_release_container_id", "")
    target_container_id = (container_id or "").strip() or configured_container_id

    user_data = _user_settings(_user)
    token = _read_setting(user_data, "confluence_token", "")

    if not token or not base_url or not target_container_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Confluence release page configuration is incomplete (token, base URL, "
                "and release container are required)."
            ),
        )

    candidates = _build_confluence_api_candidates(base_url)
    last_error = ""
    base_norm = (base_url or "").strip().rstrip("/")

    for api_base in candidates:
        try:
            all_items: list[dict] = []
            start = 0
            page_limit = 100

            while True:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        f"{api_base}/content/{target_container_id}/child/page",
                        params={"limit": page_limit, "start": start, "expand": "version"},
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Accept": "application/json",
                        },
                    )

                if resp.status_code != 200:
                    last_error = f"{resp.status_code}: {resp.text[:120]}"
                    break

                payload = resp.json()
                raw_items = payload.get("results", []) if isinstance(payload, dict) else []
                if not isinstance(raw_items, list):
                    raw_items = []
                all_items.extend(raw_items)

                returned = len(raw_items)
                links = (payload.get("_links", {}) or {}) if isinstance(payload, dict) else {}
                has_next = bool(links.get("next"))
                if not has_next or returned == 0:
                    break
                start += returned
                if start > 10000:
                    break

            if not all_items and last_error:
                continue

            pages: list[ConfluencePageItem] = []
            for item in all_items:
                page_id = str(item.get("id", ""))
                title = str(item.get("title", ""))
                if not page_id or not title:
                    continue
                links = item.get("_links", {}) or {}
                webui = links.get("webui", "")
                link_base = links.get("base", base_norm)
                url = f"{link_base}{webui}" if webui else base_norm
                version = item.get("version", {}) or {}
                pages.append(ConfluencePageItem(
                    id=page_id,
                    title=title,
                    url=url,
                    updated=version.get("when"),
                ))

            pages.sort(key=lambda p: p.title.lower())
            return ConfluencePagesResponse(pages=pages)
        except Exception as exc:
            last_error = str(exc)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Failed to list Confluence release pages. {last_error}",
    )


async def _resolve_additional_release_tickets(
    html: str, current_user, db: Session,
) -> tuple[list["ReleaseAnalysisTicketItem"], Optional[str]]:
    """Extract embedded Jira macro JQL queries (e.g. a "Stories/ Technical
    stories/ Bugs/ Tasks" section) from a release page and run them against
    the current user's configured Jira connection, for the "Additional
    information" table.
    """
    jql_queries = extract_jira_macro_jql_queries(html)
    if not jql_queries:
        return [], None

    config_source_user = current_user
    assigned_lead_id = getattr(current_user, 'assigned_lead_id', None)
    if _role(current_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    config_data = _user_settings(config_source_user)
    jira_base_url = _read_setting(config_data, "jira_mcp_base_url", "")

    user_data = _user_settings(current_user)
    jira_token = _read_setting(user_data, "jira_token", "")

    if not jira_token or not jira_base_url:
        return [], (
            "Jira is not configured for your account, so the embedded "
            "Stories/Bugs/Tasks section could not be loaded."
        )

    service = TestManagerService(jira_base_url, jira_token)
    merged: dict[str, dict] = {}
    error_message: Optional[str] = None
    for jql in jql_queries[:8]:  # safety cap on number of distinct macros processed
        try:
            issues = await service.search_release_tickets(jql, max_results=300)
            for issue in issues:
                merged[issue["key"]] = issue
        except Exception as exc:
            error_message = str(exc)

    tickets = [
        ReleaseAnalysisTicketItem(
            key=item["key"],
            summary=item.get("summary", ""),
            issue_type=item.get("issue_type", ""),
            status=item.get("status", ""),
            team_name=item.get("team_name") or None,
            epic_link=item.get("epic_link") or None,
            components=item.get("components") or None,
            url=item.get("url", ""),
        )
        for item in merged.values()
    ]
    tickets.sort(key=lambda t: (t.team_name or "", t.issue_type or "", t.key))
    return tickets[:500], (error_message if not tickets else None)


@router.get("/confluence/release-analysis", response_model=ReleaseAnalysisResponse)
async def analyze_confluence_release_page(
    page_id: Optional[str] = Query(
        default=None, description="Release page id; defaults to configured selected release page"
    ),
    _user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Run the 3-step BE/FE version analyzer against a release page.

    Step 1: find backend service names + versions mentioned under a BE/Backend section.
    Step 2: find Android/iOS build versions (with environment, when mentioned) under a FE/Frontend section.
    """
    config_source_user = _user
    assigned_lead_id = getattr(_user, 'assigned_lead_id', None)
    if _role(_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    config_data = _user_settings(config_source_user)
    base_url = _read_setting(config_data, "confluence_mcp_base_url", "")
    configured_page_id = _read_setting(config_data, "confluence_selected_release_page_id", "")
    target_page_id = (page_id or "").strip() or configured_page_id

    user_data = _user_settings(_user)
    token = _read_setting(user_data, "confluence_token", "")

    if not token or not base_url or not target_page_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Confluence release page configuration is incomplete (token, base URL, "
                "and selected release page are required)."
            ),
        )

    candidates = _build_confluence_api_candidates(base_url)
    last_error = ""
    base_norm = (base_url or "").strip().rstrip("/")

    for api_base in candidates:
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(
                    f"{api_base}/content/{target_page_id}",
                    params={"expand": "body.storage,version"},
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                    },
                )

            if resp.status_code != 200:
                last_error = f"{resp.status_code}: {resp.text[:120]}"
                continue

            content_type = (resp.headers.get("content-type") or "").lower()
            if "application/json" not in content_type:
                last_error = f"Unexpected content type '{content_type}' from {resp.url}"
                continue

            payload = resp.json()
            title = str(payload.get("title", "") or "")
            html = ((payload.get("body", {}) or {}).get("storage", {}) or {}).get("value", "") or ""
            links = payload.get("_links", {}) or {}
            webui = links.get("webui", "")
            link_base = links.get("base", base_norm)
            page_url = f"{link_base}{webui}" if webui else base_norm

            be_versions, fe_versions, release_metadata = analyze_release_page_html(html)
            additional_tickets, additional_tickets_error = await _resolve_additional_release_tickets(html, _user, db)

            return ReleaseAnalysisResponse(
                page_id=target_page_id,
                page_title=title,
                page_url=page_url,
                release_metadata=ReleaseAnalysisMetadata(
                    release_date=release_metadata.release_date,
                    status=release_metadata.status,
                    team=release_metadata.team,
                ) if release_metadata else None,
                backend_versions=[
                    ReleaseAnalysisBackendItem(
                        service=v.service,
                        version=v.version,
                        component=v.component,
                        component_color=v.component_color,
                        live_env_details=v.live_env_details,
                        live_env_details_color=v.live_env_details_color,
                        new_service_or_operation=v.new_service_or_operation,
                        new_service_or_operation_color=v.new_service_or_operation_color,
                        developer=v.developer,
                        developer_color=v.developer_color,
                        context=v.context,
                    )
                    for v in be_versions
                ],
                frontend_versions=[
                    ReleaseAnalysisFrontendItem(
                        platform=v.platform, version=v.version, environment=v.environment, context=v.context,
                    )
                    for v in fe_versions
                ],
                additional_tickets=additional_tickets,
                additional_tickets_error=additional_tickets_error,
            )
        except Exception as exc:
            last_error = str(exc)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Failed to analyze Confluence release page. {last_error}",
    )


# ── Zephyr (Test Manager) endpoints ──────────────────────────────────────────

@router.get("/zephyr", response_model=ZephyrSettingsResponse)
async def get_zephyr_settings(_user=Depends(get_current_user)):
    """Return current Zephyr project and folder selection."""
    return ZephyrSettingsResponse(
        zephyr_project_key=settings.ZEPHYR_PROJECT_KEY or "",
        zephyr_selected_folder_id=settings.ZEPHYR_SELECTED_FOLDER_ID or "",
    )


@router.patch("/zephyr", response_model=ZephyrSettingsResponse)
async def update_zephyr_settings(
    payload: dict,
    _user=Depends(require_admin),
):
    """Save Zephyr project and folder selection to .env (admin only)."""
    if "zephyr_project_key" in payload:
        project_key = payload["zephyr_project_key"]
        _write_env_key("ZEPHYR_PROJECT_KEY", project_key)
        settings.ZEPHYR_PROJECT_KEY = project_key

    if "zephyr_selected_folder_id" in payload:
        folder_id = payload["zephyr_selected_folder_id"]
        _write_env_key("ZEPHYR_SELECTED_FOLDER_ID", folder_id)
        settings.ZEPHYR_SELECTED_FOLDER_ID = folder_id

    return ZephyrSettingsResponse(
        zephyr_project_key=settings.ZEPHYR_PROJECT_KEY or "",
        zephyr_selected_folder_id=settings.ZEPHYR_SELECTED_FOLDER_ID or "",
    )


@router.get("/zephyr/cycles/{project_key}", response_model=ZephyrCyclesResponse)
async def get_zephyr_cycles(
    project_key: str,
    _user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List Zephyr test cycles (folders) for a project.
    
    For Automation User/Viewer: Uses their own token but Lead's base_url.
    For Lead/Admin: Uses their own token and base_url.
    """
    # Determine where to read configuration from
    config_source_user = _user
    assigned_lead_id = getattr(_user, 'assigned_lead_id', None)
    if _role(_user) in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    # Get base_url from appropriate source (lead for User/Viewer, self for Lead/Admin)
    config_data = _user_settings(config_source_user)
    base_url = _read_setting(config_data, "jira_mcp_base_url", "") or settings.JIRA_MCP_BASE_URL
    
    # Always use current user's own token
    user_data = _user_settings(_user)
    token = _read_setting(user_data, "jira_token", "") or settings.JIRA_TOKEN

    if not token or not base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira token or base URL not configured.",
        )

    try:
        zephyr = ZephyrService(base_url, token)
        cycles_data = await zephyr.get_cycles(project_key)
        
        # Convert raw API response to ZephyrCycle objects.
        # Zephyr Squad uses string IDs; Zephyr Scale uses numeric IDs.
        # Field names also differ between versions.
        cycles = []
        for item in cycles_data:
            if not isinstance(item, dict):
                continue
            raw_id = item.get("id", "")
            if not raw_id and raw_id != 0:
                continue
            # Prefer Zephyr Squad field names, fall back to Zephyr Scale names
            name = item.get("name") or item.get("cycleName") or "Unnamed"
            description = item.get("description") or item.get("cycleDescription")
            created = (
                item.get("createdOn") or item.get("startDate")
                or item.get("created")
            )
            updated = (
                item.get("modifiedOn") or item.get("endDate")
                or item.get("updatedOn") or item.get("updated")
            )
            cycles.append(ZephyrCycle(
                id=str(raw_id),
                name=name,
                description=description,
                created=created,
                updated=updated,
                folder=item.get("folder"),
            ))

        return ZephyrCyclesResponse(
            project_key=project_key,
            cycles=cycles,
            total=len(cycles),
        )
    except ZephyrAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"ZEPHYR_AUTH_ERROR: {str(e)}",
        )
    except ZephyrPermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"ZEPHYR_PERMISSION_ERROR: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch Zephyr cycles: {str(e)}",
        )


@router.get("/zephyr/diagnose/{project_key}")
async def diagnose_zephyr(
    project_key: str,
    _user=Depends(require_lead_or_above),
):
    """
    Diagnostic endpoint: probes all known Zephyr/Jira API variants
    and returns raw status codes + response snippets for debugging.
    """
    import base64

    token = settings.JIRA_TOKEN
    base_url = settings.JIRA_MCP_BASE_URL
    if not token or not base_url:
        raise HTTPException(status_code=400, detail="Jira token or base URL not configured.")

    normalized = base_url.rstrip("/")
    results: list[dict] = []

    # Both auth styles: Bearer and Basic (email:token base64)
    auth_headers_list = [
        {"Authorization": f"Bearer {token}", "Accept": "application/json"},
    ]
    # If token looks like email:token or contains ":", also try Basic
    if ":" in token:
        encoded = base64.b64encode(token.encode()).decode()
        auth_headers_list.append({"Authorization": f"Basic {encoded}", "Accept": "application/json"})

    endpoints_to_probe = [
        # Step 0: Resolve project ID
        ("project_lookup_v3", f"{normalized}/rest/api/3/project/{project_key}", {}),
        ("project_lookup_v2", f"{normalized}/rest/api/2/project/{project_key}", {}),
        # Zephyr Squad Server/DC (needs project ID, but try key too)
        ("zephyr_squad_by_key", f"{normalized}/rest/zephyr/1.0/cycle", {"projectKey": project_key, "versionId": "-1"}),
        # Zephyr Scale / TM4J
        ("zephyr_scale_testcycles", f"{normalized}/rest/atm/1.0/testcycle", {"project": project_key}),
        (
            "zephyr_scale_testcycles_maxResults",
            f"{normalized}/rest/atm/1.0/testcycle",
            {"project": project_key, "maxResults": "50"},
        ),
        # Zephyr Squad Cloud
        (
            "zephyr_squad_cloud",
            f"{normalized}/public/rest/api/1.0/cycles",
            {"projectKey": project_key, "maxRecords": "50"},
        ),
    ]

    async with httpx.AsyncClient(timeout=10) as client:
        for label, url, params in endpoints_to_probe:
            for auth_idx, auth_hdrs in enumerate(auth_headers_list):
                auth_label = "bearer" if auth_idx == 0 else "basic"
                try:
                    resp = await client.get(url, params=params, headers=auth_hdrs)
                    body = resp.text[:500]
                    results.append({
                        "probe": f"{label} [{auth_label}]",
                        "url": str(resp.url),
                        "status": resp.status_code,
                        "body_snippet": body,
                    })
                except Exception as exc:
                    results.append({
                        "probe": f"{label} [{auth_label}]",
                        "url": url,
                        "status": "error",
                        "body_snippet": str(exc),
                    })

    return {"project_key": project_key, "probes": results}
