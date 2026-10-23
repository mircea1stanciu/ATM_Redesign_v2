"""Read and write a user's personal secrets.

Secrets live encrypted in user_connections and are never stored in users.settings_json. For code that still
reads the old settings keys, settings_with_secrets() returns settings_json with the decrypted secrets filled in.
"""
import json
from typing import Optional

from app.core.crypto import SecretUnreadable, decrypt, encrypt
from app.modules.settings.models import UserConnection

# settings_json key (as code reads it) -> connection kind
TOKEN_KEYS = {
    "github_token": "github",
    "jira_token": "jira",
    "confluence_token": "confluence",
    "zephyr_session_cookie": "zephyr_session",
}
PROJECT_TOKENS_KEY = "project_github_tokens"  # {project_id: token} -> kind github_project, ref project_id
AI_KEY = "ai_assistant"  # provider settings incl. keys/tokens -> kind ai_assistant (JSON)
SECRET_KEYS = set(TOKEN_KEYS) | {PROJECT_TOKENS_KEY, AI_KEY}


def _find(user, kind: str, ref: str = "") -> Optional[UserConnection]:
    return next((c for c in user.connections if c.kind == kind and c.ref == ref), None)


def get_secret(user, kind: str, ref: str = "") -> str:
    """The decrypted secret, or "" when there is none (or it can no longer be decrypted)."""
    connection = _find(user, kind, str(ref))
    if connection is None:
        return ""
    try:
        return decrypt(connection.secret)
    except SecretUnreadable:
        return ""


def set_secret(user, kind: str, value: Optional[str], ref: str = "") -> None:
    """Store (or with an empty value, remove) a secret. The caller commits."""
    ref = str(ref)
    connection = _find(user, kind, ref)
    if not value:
        if connection is not None:
            user.connections.remove(connection)
        return
    if connection is None:
        user.connections.append(UserConnection(kind=kind, ref=ref, secret=encrypt(value)))
    else:
        connection.secret = encrypt(value)


def get_json(user, kind: str) -> dict:
    raw = get_secret(user, kind)
    try:
        value = json.loads(raw) if raw else {}
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def set_json(user, kind: str, value: Optional[dict]) -> None:
    set_secret(user, kind, json.dumps(value) if value else None)


def settings_with_secrets(user) -> dict:
    """users.settings_json plus the user's decrypted secrets under their old settings keys."""
    data = dict(getattr(user, "settings_json", None) or {})
    for key, kind in TOKEN_KEYS.items():
        value = get_secret(user, kind)
        if value:
            data[key] = value
    project_tokens = {c.ref: get_secret(user, "github_project", c.ref) for c in user.connections
                      if c.kind == "github_project"}
    if project_tokens:
        data[PROJECT_TOKENS_KEY] = {ref: token for ref, token in project_tokens.items() if token}
    ai = get_json(user, AI_KEY)
    if ai:
        data[AI_KEY] = ai
    return data


def store_settings(user, data: dict) -> None:
    """Write users.settings_json without any secret keys. Secrets change only through set_secret/set_json."""
    user.settings_json = {key: value for key, value in data.items() if key not in SECRET_KEYS}
