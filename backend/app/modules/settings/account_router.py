"""
Settings API endpoints for user preferences, security, and account management
"""

import hashlib
import secrets
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.modules.audit.service import record_change
from app.modules.identity.models import APIToken, LoginHistory, NotificationPreference, User, UserSession
from app.modules.settings.connections import set_secret, settings_with_secrets, store_settings

router = APIRouter(tags=["Settings"])


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


def _read_setting(data: dict, key: str, default: str = "") -> str:
    value = data.get(key)
    return value if isinstance(value, str) else default


def _set_user_settings(user, data: dict) -> None:
    """Save the non-secret settings; tokens change only through set_secret."""
    store_settings(user, data)


# ── Security Settings ────────────────────────────────────────────────────────

@router.get("/settings/security/login-history", tags=["Security"])
async def get_login_history(
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's login history for audit log"""
    logins = db.query(LoginHistory).filter(
        LoginHistory.user_id == current_user.id
    ).order_by(LoginHistory.created_at.desc()).limit(limit).all()
    
    return {
        "logins": [
            {
                "id": login.id,
                "ip_address": login.ip_address,
                "user_agent": login.user_agent,
                "device_name": login.device_name,
                "success": login.success,
                "failure_reason": login.failure_reason,
                "created_at": login.created_at.isoformat(),
            }
            for login in logins
        ]
    }


@router.get("/settings/security/sessions", tags=["Security"])
async def get_user_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all active user sessions (devices)"""
    sessions = db.query(UserSession).filter(
        UserSession.user_id == current_user.id,
        UserSession.is_active.is_(True)
    ).order_by(UserSession.last_activity.desc()).all()
    
    return {
        "sessions": [
            {
                "id": session.id,
                "device_name": session.device_name,
                "device_type": session.device_type,
                "browser": session.browser,
                "os": session.os,
                "ip_address": session.ip_address,
                "is_active": session.is_active,
                "last_activity": session.last_activity.isoformat(),
                "created_at": session.created_at.isoformat(),
                "expires_at": session.expires_at.isoformat(),
            }
            for session in sessions
        ]
    }


@router.post("/settings/security/sessions/{session_id}/logout", tags=["Security"])
async def logout_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout from a specific device/session"""
    session = db.query(UserSession).filter(
        UserSession.id == session_id,
        UserSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session.is_active = False
    db.add(session)
    db.commit()
    
    return {"message": "Logged out from device successfully"}


@router.post("/settings/security/sessions/logout-all-others", tags=["Security"])
async def logout_all_other_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout from all other devices except current one"""
    # Deactivate all sessions except current
    db.query(UserSession).filter(
        UserSession.user_id == current_user.id,
        UserSession.is_active.is_(True)
    ).update({"is_active": False})
    
    db.commit()
    
    return {"message": "Logged out from all other devices"}


@router.get("/settings/security/api-tokens", tags=["Security"])
async def list_api_tokens(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all API tokens for user"""
    tokens = db.query(APIToken).filter(
        APIToken.user_id == current_user.id
    ).order_by(APIToken.created_at.desc()).all()
    
    return {
        "tokens": [
            {
                "id": token.id,
                "token_preview": token.token_preview,
                "name": token.name,
                "scopes": token.scopes,
                "is_active": token.is_active,
                "last_used": token.last_used.isoformat() if token.last_used else None,
                "created_at": token.created_at.isoformat(),
                "expires_at": token.expires_at.isoformat() if token.expires_at else None,
            }
            for token in tokens
        ]
    }


@router.post("/settings/security/api-tokens", tags=["Security"])
async def create_api_token(
    name: str,
    scopes: Optional[str] = None,
    expires_at: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new API token"""
    if not name:
        raise HTTPException(status_code=400, detail="Token name is required")
    
    # Generate random token
    token_raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token_raw.encode()).hexdigest()
    token_preview = token_raw[-4:]
    
    # Calculate expiration
    expires_datetime = None
    if expires_at:
        try:
            expires_datetime = datetime.fromisoformat(expires_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expiration date format")
    
    # Create token
    api_token = APIToken(
        user_id=current_user.id,
        token=token_hash,
        token_preview=token_preview,
        name=name,
        scopes=scopes,
        expires_at=expires_datetime
    )
    
    db.add(api_token)
    db.commit()
    db.refresh(api_token)
    
    return {
        "id": api_token.id,
        "token": token_raw,  # Only shown once on creation
        "token_preview": token_preview,
        "name": name,
        "scopes": scopes,
        "is_active": api_token.is_active,
        "created_at": api_token.created_at.isoformat(),
        "expires_at": api_token.expires_at.isoformat() if api_token.expires_at else None,
        "message": "Keep this token safe - you won't be able to see it again!"
    }


@router.delete("/settings/security/api-tokens/{token_id}", tags=["Security"])
async def delete_api_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke an API token"""
    token = db.query(APIToken).filter(
        APIToken.id == token_id,
        APIToken.user_id == current_user.id
    ).first()
    
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    
    db.delete(token)
    db.commit()
    
    return {"message": "API token revoked"}


# ── Preference Settings ──────────────────────────────────────────────────────

@router.put("/settings/preferences/theme", tags=["Preferences"])
async def update_theme(
    theme: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update theme preference"""
    if theme not in ["light", "dark", "system"]:
        raise HTTPException(status_code=400, detail="Invalid theme. Must be light, dark, or system")
    
    current_user.theme_preference = theme
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    
    return {"theme_preference": current_user.theme_preference}


@router.get("/settings/preferences/ai", tags=["Preferences"])
async def get_ai_preferences(
    current_user: User = Depends(get_current_user)
):
    """Get AI assistant preferences"""
    return {
        "preferred_model": current_user.preferred_ai_model,
        "provider": current_user.ai_model_provider,
        "temperature": float(current_user.ai_temperature)
    }


@router.put("/settings/preferences/ai", tags=["Preferences"])
async def update_ai_preferences(
    preferred_model: str,
    provider: str,
    temperature: float,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update AI assistant preferences"""
    if provider not in ["openai", "anthropic"]:
        raise HTTPException(status_code=400, detail="Invalid provider. Must be openai or anthropic")
    
    if not 0.0 <= temperature <= 1.0:
        raise HTTPException(status_code=400, detail="Temperature must be between 0.0 and 1.0")
    
    current_user.preferred_ai_model = preferred_model
    current_user.ai_model_provider = provider
    current_user.ai_temperature = str(temperature)
    
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    
    return {
        "preferred_model": current_user.preferred_ai_model,
        "provider": current_user.ai_model_provider,
        "temperature": float(current_user.ai_temperature)
    }


@router.get("/settings/preferences/notifications", tags=["Preferences"])
async def get_notification_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get notification preferences"""
    prefs = db.query(NotificationPreference).filter(
        NotificationPreference.user_id == current_user.id
    ).first()
    
    if not prefs:
        # Create default preferences
        prefs = NotificationPreference(user_id=current_user.id)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    
    return {
        "email_forum_posts": prefs.email_forum_posts,
        "email_comments": prefs.email_comments,
        "email_mentions": prefs.email_mentions,
        "email_community_updates": prefs.email_community_updates,
        "email_digest_frequency": prefs.email_digest_frequency,
        "in_app_forum_posts": prefs.in_app_forum_posts,
        "in_app_comments": prefs.in_app_comments,
        "in_app_mentions": prefs.in_app_mentions,
        "in_app_system": prefs.in_app_system,
        "push_enabled": prefs.push_enabled,
        "quiet_hours_enabled": prefs.quiet_hours_enabled,
        "quiet_hours_start": prefs.quiet_hours_start,
        "quiet_hours_end": prefs.quiet_hours_end,
    }


@router.put("/settings/preferences/notifications", tags=["Preferences"])
async def update_notification_preferences(
    preferences: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update notification preferences"""
    prefs = db.query(NotificationPreference).filter(
        NotificationPreference.user_id == current_user.id
    ).first()
    
    if not prefs:
        prefs = NotificationPreference(user_id=current_user.id)
        db.add(prefs)
    
    # Update allowed fields
    for key, value in preferences.items():
        if hasattr(prefs, key) and value is not None:
            setattr(prefs, key, value)
    
    db.add(prefs)
    db.commit()
    db.refresh(prefs)
    
    return {
        "email_forum_posts": prefs.email_forum_posts,
        "email_comments": prefs.email_comments,
        "email_mentions": prefs.email_mentions,
        "email_community_updates": prefs.email_community_updates,
        "email_digest_frequency": prefs.email_digest_frequency,
        "in_app_forum_posts": prefs.in_app_forum_posts,
        "in_app_comments": prefs.in_app_comments,
        "in_app_mentions": prefs.in_app_mentions,
        "in_app_system": prefs.in_app_system,
        "push_enabled": prefs.push_enabled,
        "quiet_hours_enabled": prefs.quiet_hours_enabled,
        "quiet_hours_start": prefs.quiet_hours_start,
        "quiet_hours_end": prefs.quiet_hours_end,
    }


@router.get("/settings/requirements-filters", response_model=RequirementsFiltersResponse)
async def get_requirements_filters(current_user: User = Depends(get_current_user)):
    """Return the current user's saved filters for the Requirements tab."""
    data = _user_settings(current_user)
    raw = data.get("requirements_filters") or {}
    epic = raw.get("epic_status_view") or {}
    auto = raw.get("automation_status_management") or {}
    return RequirementsFiltersResponse(
        epic_status_view=EpicStatusFilter(
            search=str(epic.get("search") or ""),
            status=str(epic.get("status") or ""),
            team=str(epic.get("team") or ""),
        ),
        automation_status_management=AutomationStatusFilter(
            search=str(auto.get("search") or ""),
            filter=str(auto.get("filter") or ""),
            team=str(auto.get("team") or ""),
        ),
    )


@router.put("/settings/requirements-filters", response_model=RequirementsFiltersResponse)
async def save_requirements_filters(
    payload: RequirementsFiltersPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save filter settings for the Requirements tab without overwriting other stored values."""
    data = _user_settings(current_user)
    raw = dict(data.get("requirements_filters") or {})

    if payload.epic_status_view is not None:
        raw["epic_status_view"] = payload.epic_status_view.model_dump()
    if payload.automation_status_management is not None:
        raw["automation_status_management"] = payload.automation_status_management.model_dump()

    data["requirements_filters"] = raw
    _set_user_settings(current_user, data)
    db.add(current_user)
    db.commit()
    db.refresh(current_user)

    epic = raw.get("epic_status_view") or {}
    auto = raw.get("automation_status_management") or {}
    return RequirementsFiltersResponse(
        epic_status_view=EpicStatusFilter(
            search=str(epic.get("search") or ""),
            status=str(epic.get("status") or ""),
            team=str(epic.get("team") or ""),
        ),
        automation_status_management=AutomationStatusFilter(
            search=str(auto.get("search") or ""),
            filter=str(auto.get("filter") or ""),
            team=str(auto.get("team") or ""),
        ),
    )


# ── Confluence MCP settings ───────────────────────────────────────────────────

@router.get("/settings/confluence", response_model=ConfluenceSettingsResponse)
async def get_confluence_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return current user's Confluence connection settings."""
    data = _user_settings(current_user)
    token = _read_setting(data, "confluence_token", "")
    base_url = _read_setting(data, "confluence_mcp_base_url", "")
    return ConfluenceSettingsResponse(
        confluence_token_set=bool(token),
        confluence_token_preview=("•••• " + token[-4:]) if len(token) >= 4 else ("set" if token else ""),
        confluence_mcp_base_url=base_url,
        confluence_space_key=_read_setting(data, "confluence_space_key", "") or None,
        confluence_space_name=_read_setting(data, "confluence_space_name", "") or None,
        confluence_release_container_id=_read_setting(data, "confluence_release_container_id", "") or None,
        confluence_release_container_title=_read_setting(data, "confluence_release_container_title", "") or None,
        confluence_release_container_url=_read_setting(data, "confluence_release_container_url", "") or None,
        confluence_selected_release_page_id=_read_setting(data, "confluence_selected_release_page_id", "") or None,
        confluence_selected_release_page_title=_read_setting(data, "confluence_selected_release_page_title", "")
        or None,
        confluence_selected_release_page_url=_read_setting(data, "confluence_selected_release_page_url", "") or None,
    )


@router.patch("/settings/confluence", response_model=ConfluenceSettingsResponse)
async def update_confluence_settings(
    payload: ConfluenceMCPConfig,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save Confluence token/base URL/space configuration for the current user."""
    data = _user_settings(current_user)
    if payload.confluence_token is not None:
        data["confluence_token"] = payload.confluence_token
        set_secret(current_user, "confluence", payload.confluence_token)
    if payload.confluence_mcp_base_url is not None:
        data["confluence_mcp_base_url"] = payload.confluence_mcp_base_url
    if payload.confluence_space_key is not None:
        data["confluence_space_key"] = payload.confluence_space_key
    if payload.confluence_space_name is not None:
        data["confluence_space_name"] = payload.confluence_space_name
    if payload.confluence_release_container_id is not None:
        data["confluence_release_container_id"] = payload.confluence_release_container_id
    if payload.confluence_release_container_title is not None:
        data["confluence_release_container_title"] = payload.confluence_release_container_title
    if payload.confluence_release_container_url is not None:
        data["confluence_release_container_url"] = payload.confluence_release_container_url
    if payload.confluence_selected_release_page_id is not None:
        data["confluence_selected_release_page_id"] = payload.confluence_selected_release_page_id
    if payload.confluence_selected_release_page_title is not None:
        data["confluence_selected_release_page_title"] = payload.confluence_selected_release_page_title
    if payload.confluence_selected_release_page_url is not None:
        data["confluence_selected_release_page_url"] = payload.confluence_selected_release_page_url

    _set_user_settings(current_user, data)
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    connection = [f for f in ("confluence_token", "confluence_mcp_base_url") if getattr(payload, f) is not None]
    if connection:  # choosing a space or a release page is not audited
        record_change(db, current_user, "settings.connection", "their Confluence connection", connection,
                      details={"kind": "Confluence"})
    return await get_confluence_settings(current_user=current_user, db=db)


@router.post("/settings/confluence/test", response_model=ConfluenceTestResponse)
async def test_confluence_connection(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Probe the configured Confluence base URL and personal access token."""
    data = _user_settings(current_user)
    token = _read_setting(data, "confluence_token", "")
    base_url = _read_setting(data, "confluence_mcp_base_url", "")
    if not token or not base_url:
        raise HTTPException(status_code=400, detail="Confluence token or base URL is not configured.")

    candidates = [base_url.rstrip("/")]
    if not base_url.endswith("/wiki"):
        candidates.append(base_url.rstrip("/") + "/wiki")

    last_error = ""
    for api_base in candidates:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    f"{api_base}/rest/api/user/current",
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                )
            if response.status_code == 200:
                payload = response.json() or {}
                name = (
                    payload.get("displayName") or payload.get("username") or payload.get("email") or "Confluence user"
                )
                return ConfluenceTestResponse(ok=True, user=name)
            last_error = f"{response.status_code}: {response.text[:120]}"
        except Exception as exc:
            last_error = str(exc)

    return ConfluenceTestResponse(ok=False, error=last_error or "Unable to connect to Confluence.")


@router.get("/settings/confluence/spaces", response_model=ConfluenceSpacesResponse)
async def list_confluence_spaces(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List spaces visible to the configured Confluence token."""
    data = _user_settings(current_user)
    token = _read_setting(data, "confluence_token", "")
    base_url = _read_setting(data, "confluence_mcp_base_url", "")
    if not token or not base_url:
        raise HTTPException(status_code=400, detail="Confluence token or base URL is not configured.")

    candidates = [base_url.rstrip("/")]
    if not base_url.endswith("/wiki"):
        candidates.append(base_url.rstrip("/") + "/wiki")

    last_error = ""
    for api_base in candidates:
        try:
            spaces = []
            start = 0
            async with httpx.AsyncClient(timeout=12) as client:
                for _ in range(100):
                    response = await client.get(
                        f"{api_base}/rest/api/space",
                        params={"start": start, "limit": 200},
                        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                    )
                    if response.status_code != 200:
                        last_error = f"{response.status_code}: {response.text[:120]}"
                        break

                    payload = response.json() or {}
                    results = payload.get("results", []) if isinstance(payload, dict) else []
                    spaces.extend(
                        ConfluenceSpaceItem(
                            id=str(item.get("id", "")), key=str(item.get("key", "")), name=str(item.get("name", ""))
                        )
                        for item in results
                        if item.get("key") and item.get("name")
                    )
                    if not results:
                        return ConfluenceSpacesResponse(spaces=spaces)

                    page_limit = payload.get("limit", 200) if isinstance(payload, dict) else 200
                    has_next = bool((payload.get("_links") or {}).get("next")) if isinstance(payload, dict) else False
                    if not has_next and len(results) < page_limit:
                        return ConfluenceSpacesResponse(spaces=spaces)
                    start += len(results)
                else:
                    last_error = "Confluence returned too many space pages."
        except Exception as exc:
            last_error = str(exc)

    raise HTTPException(status_code=502, detail=f"Failed to list Confluence spaces. {last_error}")
