"""Jira and Confluence REST clients for the Work area.

Credentials follow the rules of Settings › Connections: the base URL (and the default Jira project / Confluence space)
comes from the user's lead for everyone below lead, or from the user's own settings; the token is always the user's.
"""
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from app.core.permissions import LEAD_ROLES
from app.modules.identity.models import User
from app.modules.settings.connections import settings_with_secrets

TIMEOUT_SECONDS = 15
# Tests replace this with httpx.MockTransport so no request leaves the process.
HTTP_TRANSPORT: Optional[httpx.AsyncBaseTransport] = None


class IntegrationError(Exception):
    """A Jira/Confluence problem to show where it happened, in plain words."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class Connection:
    base_url: str
    token: str
    settings: dict


def _config_source(db: Session, user: User) -> User:
    if user.role not in LEAD_ROLES and user.assigned_lead_id:
        lead = db.query(User).filter(User.id == user.assigned_lead_id).first()
        if lead:
            return lead
    return user


def _connection(db: Session, user: User, kind: str) -> Connection:
    config = settings_with_secrets(_config_source(db, user))
    base_url = str(config.get(f"{kind}_mcp_base_url") or "").strip().rstrip("/")
    token = str(settings_with_secrets(user).get(f"{kind}_token") or "")
    name = kind.capitalize()
    if not base_url or not token:
        raise IntegrationError(400, f"{name} is not connected for your account. Add your {name} token "
                                    f"(and, for leads, the base URL) in Settings › Connections.")
    return Connection(base_url=base_url, token=token, settings=config)


def jira_connection(db: Session, user: User) -> Connection:
    return _connection(db, user, "jira")


def confluence_connection(db: Session, user: User) -> Connection:
    return _connection(db, user, "confluence")


def jira_project_key(project: Any, connection: Connection) -> str:
    """The project's Jira project, or the team's default from Settings until a lead sets one on the project."""
    key = (getattr(project, "jira_project_key", None) or connection.settings.get("jira_project_key") or "").strip()
    if not key:
        raise IntegrationError(400, "This project has no Jira project yet. A lead sets it in Admin › Projects.")
    return key


def confluence_space_key(project: Any, connection: Connection) -> str:
    key = (getattr(project, "confluence_space_key", None) or connection.settings.get("confluence_space_key") or "")
    if not key.strip():
        raise IntegrationError(400, "This project has no Confluence space yet. A lead sets it in Admin › Projects.")
    return key.strip()


def _error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text[:300]
    if isinstance(data, dict):
        messages = list(data.get("errorMessages") or [])
        messages += [f"{field}: {text}" for field, text in (data.get("errors") or {}).items()]
        if data.get("message"):
            messages.append(str(data["message"]))
        if messages:
            return "; ".join(messages)
    return response.text[:300]


class _Client:
    name = ""

    def __init__(self, connection: Connection):
        self.connection = connection

    def _bases(self) -> list[str]:
        raise NotImplementedError

    async def request(self, method: str, path: str, *, params: Optional[dict] = None,
                      json: Optional[dict] = None, files: Optional[dict] = None,
                      headers: Optional[dict] = None) -> Any:
        """Call the REST API, trying each API base in turn when one answers 404 (Cloud vs Server/DC).
        ``files`` sends a multipart upload (Confluence attachments)."""
        headers = {"Authorization": f"Bearer {self.connection.token}", "Accept": "application/json",
                   **(headers or {})}
        last: Optional[httpx.Response] = None
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=HTTP_TRANSPORT) as client:
            for base in self._bases():
                try:
                    response = await client.request(method, f"{base}{path}", params=params, json=json,
                                                    files=files, headers=headers)
                except httpx.RequestError as exc:
                    raise IntegrationError(502, f"Could not reach {self.name} at {self.connection.base_url}: "
                                                f"{exc.__class__.__name__}.") from exc
                if response.status_code == 404:
                    last = response
                    continue
                if response.status_code == 401:
                    raise IntegrationError(400, f"{self.name} refused your token. Update it in Settings › "
                                                "Connections.")
                if response.status_code == 403:
                    raise IntegrationError(400, f"Your {self.name} account may not do this: "
                                                f"{_error_detail(response)}")
                if response.status_code >= 400:
                    raise IntegrationError(502, f"{self.name} answered {response.status_code}: "
                                                f"{_error_detail(response)}")
                return response.json() if response.content else None
        raise IntegrationError(404, f"Not found in {self.name}: {_error_detail(last) if last is not None else path}")


class JiraClient(_Client):
    name = "Jira"

    def _bases(self) -> list[str]:
        # API v2 works on Cloud and Server/DC and takes plain text comments.
        return [f"{self.connection.base_url}/rest/api/2", f"{self.connection.base_url}/rest/api/3"]


class JiraAgileClient(_Client):
    """Jira Software's Agile API (boards and sprints); servers without Jira Software answer 404."""
    name = "Jira"

    def _bases(self) -> list[str]:
        return [f"{self.connection.base_url}/rest/agile/1.0"]


class ConfluenceClient(_Client):
    name = "Confluence"

    def _bases(self) -> list[str]:
        base = self.connection.base_url
        bases = [f"{base}/rest/api"]
        if not base.endswith("/wiki"):
            bases.append(f"{base}/wiki/rest/api")
        return bases
