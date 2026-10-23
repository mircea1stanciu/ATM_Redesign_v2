"""Sign-in to the RBI GenAI LLM Gateway with the user's RBI account (H2M flow).

Same protocol as the gateway team's official clients (``rbi-sl-token`` / ``rbi_auth.py``,
https://code.rbi.tech/raiffeisen/rbi-genai-llm-gw, ADR 002):

1. ATM opens a temporary callback listener on ``http://localhost:<random port>/callback``.
2. The browser goes to ``<login service>/auth/login?redirect_uri=…&state=…``; the login service
   signs the user in with Ping Federate (the private key never leaves it) and redirects back to
   the callback with ``access_token``, ``refresh_token`` and ``expires_in``.
3. Access tokens live about 2 hours; ``POST <login service>/auth/refresh`` renews them.

The callback must reach the machine running the ATM backend, so this works when ATM runs on the
user's own station (like the rest of ATM's local features).
"""
from __future__ import annotations

import base64
import http.server
import json
import secrets
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

ENVIRONMENTS = {
    "prod": {"name": "PROD", "gateway": "https://genai.rbi.tech", "login": "https://login.genai.rbi.tech"},
    "uat": {"name": "UAT", "gateway": "https://genai-uat.rbi.tech", "login": "https://login.genai-uat.rbi.tech"},
    "sbox": {"name": "SBOX", "gateway": "https://genai-sbox.rbi.tech", "login": "https://login.genai-sbox.rbi.tech"},
}
DEFAULT_ENVIRONMENT = "prod"
LOGIN_TIMEOUT_SECONDS = 300
REFRESH_TIMEOUT_SECONDS = 30
DOCS_URL = "https://code.rbi.tech/raiffeisen/rbi-genai-llm-gw"


class GatewayAuthError(Exception):
    def __init__(self, message: str, status_code: int = 400, relogin: bool = False):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.relogin = relogin


def environment(env: str | None) -> dict:
    key = (env or DEFAULT_ENVIRONMENT).lower()
    if key not in ENVIRONMENTS:
        raise GatewayAuthError(f"Unknown gateway environment '{env}'. Use one of: {', '.join(ENVIRONMENTS)}.")
    return {"id": key, **ENVIRONMENTS[key]}


def account_from_token(token: str | None) -> str:
    """User name from the JWT claims, for display only (the gateway validates the token)."""
    if not token or token.count(".") != 2:
        return ""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, json.JSONDecodeError):
        return ""
    for key in ("email", "mail", "preferred_username", "upn", "name", "username", "sub"):
        value = claims.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


# ── Browser sign-in ──────────────────────────────────────────────────────────

_PAGE = ("<!doctype html><html><head><meta charset='utf-8'><title>ATM · RBI GenAI LLM Gateway</title></head>"
         "<body style='font-family:system-ui,sans-serif;padding:3em;text-align:center;color:#1f2937'>"
         "<h2>{title}</h2><p>{text}</p></body></html>")


@dataclass
class PendingLogin:
    state: str
    env: str
    login_url: str
    expires_at: float
    result: dict | None = None
    error: str | None = None
    server: http.server.ThreadingHTTPServer | None = field(default=None, repr=False)

    @property
    def finished(self) -> bool:
        return self.result is not None or self.error is not None

    def close(self) -> None:
        server, self.server = self.server, None
        if server is not None:
            threading.Thread(target=_shutdown, args=(server,), daemon=True).start()


def _shutdown(server: http.server.ThreadingHTTPServer) -> None:
    server.shutdown()
    server.server_close()


def start_login(env: str | None) -> PendingLogin:
    """Open the localhost callback listener and return the login URL to open in the browser."""
    target = environment(env)
    state = secrets.token_urlsafe(24)
    pending = PendingLogin(state, target["id"], "", time.time() + LOGIN_TIMEOUT_SECONDS)

    class CallbackHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 (http.server API)
            parsed = urlparse(self.path)
            if parsed.path != "/callback":
                self._respond(404, "Not found", "")
                return
            if pending.finished:
                self._respond(409, "Already handled", "You can close this tab.")
                return
            params = parse_qs(parsed.query)
            if params.get("state", [None])[0] != state:
                pending.error = "The sign-in response did not match this request (state mismatch). Start again."
                self._respond(400, "Sign-in failed", "Go back to ATM and start the sign-in again.")
            elif params.get("error"):
                description = params.get("error_description", params["error"])[0]
                pending.error = f"Sign-in was refused: {description}"
                self._respond(400, "Sign-in failed", "Go back to ATM for details.")
            elif not params.get("access_token", [""])[0]:
                pending.error = "The login service returned no access token."
                self._respond(400, "Sign-in failed", "Go back to ATM for details.")
            else:
                access_token = params["access_token"][0]
                pending.result = {
                    "access_token": access_token,
                    "refresh_token": params.get("refresh_token", [""])[0],
                    "expires_at": time.time() + int(params.get("expires_in", ["7200"])[0] or 7200),
                    "account": account_from_token(access_token),
                }
                self._respond(200, "Signed in to the RBI GenAI LLM Gateway",
                              "You can close this tab and go back to ATM.")
            pending.close()

        def _respond(self, code: int, title: str, text: str) -> None:
            body = _PAGE.format(title=title, text=text).encode()
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args) -> None:
            pass  # the callback URL carries tokens: never log it

    server = http.server.ThreadingHTTPServer(("localhost", 0), CallbackHandler)
    pending.server = server
    port = server.server_address[1]
    pending.login_url = f"{target['login']}/auth/login?" + urlencode({
        "redirect_uri": f"http://localhost:{port}/callback", "state": state})
    threading.Thread(target=server.serve_forever, name="rbi-gateway-login", daemon=True).start()

    def expire() -> None:
        if not pending.finished:
            pending.error = (f"The sign-in was not completed within {LOGIN_TIMEOUT_SECONDS // 60} minutes. "
                             "Close any 'Page Expired' tab and start again.")
        pending.close()

    timer = threading.Timer(LOGIN_TIMEOUT_SECONDS, expire)
    timer.daemon = True
    timer.start()
    return pending


# ── Token refresh ────────────────────────────────────────────────────────────

async def refresh_token(env: str | None, refresh: str, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """New access token from the refresh token. ``relogin`` is set when the user must sign in again."""
    if not refresh:
        raise GatewayAuthError("Your gateway sign-in expired. Sign in with your RBI account again.", relogin=True)
    target = environment(env)
    try:
        if transport is not None:
            client = httpx.AsyncClient(transport=transport, timeout=REFRESH_TIMEOUT_SECONDS)
        else:
            from app.services.ai_provider_service import _ssl_context

            client = httpx.AsyncClient(verify=_ssl_context(), timeout=REFRESH_TIMEOUT_SECONDS)
        async with client:
            response = await client.post(f"{target['login']}/auth/refresh", data={"refresh_token": refresh})
    except httpx.HTTPError as exc:
        raise GatewayAuthError(f"Could not reach the gateway login service ({target['login']}): {exc}", 502) from exc
    body = response.text
    if response.status_code >= 500 and "invalid_grant" not in body and "invalid_token" not in body:
        raise GatewayAuthError(f"The gateway login service failed ({response.status_code}). Try again later.", 502)
    if response.status_code >= 300:
        raise GatewayAuthError("Your gateway sign-in expired (refresh tokens typically last until the next day). "
                               "Sign in with your RBI account again.", relogin=True)
    try:
        data = response.json()
        access_token = data["access_token"]
    except (ValueError, KeyError) as exc:
        raise GatewayAuthError("The gateway login service returned an unexpected answer.", 502) from exc
    return {
        "access_token": access_token,
        "refresh_token": data.get("refresh_token") or refresh,
        "expires_at": time.time() + int(data.get("expires_in") or 7200),
        "account": account_from_token(access_token),
    }


def public_environments() -> list[dict]:
    return [{"id": key, **value} for key, value in ENVIRONMENTS.items()]
