"""Chat clients for the AI assistant: Anthropic Claude, GitHub Copilot (GitHub Models), Azure OpenAI
(the OpenAI-compatible ``/openai/v1`` API of an Azure OpenAI resource), the RBI GenAI LLM Gateway
(OpenAI-compatible ``/v1`` API, RBI account sign-in, see ``rbi_gateway_service``) and Microsoft 365
Copilot (Microsoft Graph Copilot Chat API).

All providers expose the same operations:
* ``list_models`` – used by "Test connection" to validate the credentials and fill the model picker;
* ``stream_chat`` – an async generator yielding text chunks of the assistant's answer.

Claude and GitHub use API keys. Microsoft 365 Copilot has no API keys: the user signs in with their
work account through the OAuth device-code flow (:func:`start_device_code` / :func:`poll_device_code`)
and the delegated token is refreshed with :func:`refresh_microsoft_token`.

Requests trust the station's certificate store (corporate TLS inspection), and responses that come
from a web filter/proxy instead of the AI service are reported as such.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import ssl
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import cast
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import settings

ANTHROPIC_BASE_URL = "https://api.anthropic.com"
ANTHROPIC_VERSION = "2023-06-01"
GITHUB_MODELS_BASE_URL = "https://models.github.ai"
GRAPH_BASE_URL = "https://graph.microsoft.com/beta"
MICROSOFT_LOGIN_URL = "https://login.microsoftonline.com"
MICROSOFT_COPILOT_MODEL = "microsoft-365-copilot"
# Delegated permissions the Microsoft 365 Copilot Chat API requires (all of them).
MICROSOFT_GRAPH_SCOPES = (
    "Sites.Read.All", "Mail.Read", "People.Read.All", "OnlineMeetingTranscript.Read.All", "Chat.Read",
    "ChannelMessage.Read.All", "ExternalItem.Read.All",
)
CONNECT_TIMEOUT = 20.0
READ_TIMEOUT = 300.0
MAX_OUTPUT_TOKENS = 16000
MAX_MODEL_PAGES = 10
_GUID = re.compile(r"^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
_TENANT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{1,99}$")

PROVIDERS = {
    "github": {
        "name": "GitHub Copilot",
        "auth": "api_key",
        "key_label": "GitHub personal access token (github.com)",
        "key_hint": "A fine-grained token with Account permissions › Models: Read-only (starts with github_pat_).",
        "default_model": "openai/gpt-4.1",
        "context_chars": 160000,
    },
    "anthropic": {
        "name": "Claude (Anthropic)",
        "auth": "api_key",
        "key_label": "Anthropic API key",
        "key_hint": "Created in the Claude Console › API keys (starts with sk-ant-).",
        "default_model": "claude-sonnet-4-5",
        "context_chars": 160000,
    },
    "azure_openai": {
        "name": "Azure OpenAI",
        "auth": "api_key",
        "key_label": "Azure OpenAI API key",
        "key_hint": "KEY 1 or KEY 2 from the Azure OpenAI resource › Keys and Endpoint.",
        # The deployment name is sent as the model, like OpenAI(base_url=endpoint).chat.completions.create(model=...).
        "default_model": settings.AZURE_OPENAI_DEPLOYMENT,
        "default_endpoint": settings.AZURE_OPENAI_ENDPOINT,
        # Only these deployments can be chosen (empty list = any name).
        "models": list(settings.AZURE_OPENAI_DEPLOYMENTS),
        "context_chars": 160000,
    },
    "rbi_genai": {
        "name": "RBI GenAI LLM Gateway",
        "auth": "rbi_login",
        "key_label": "",
        "key_hint": "No API key: sign in with your RBI account. Needs the IDM permission 'Coding Agents via RBI "
                    "GenAI LLM Gateway [your unit]'.",
        "default_model": settings.RBI_GENAI_DEFAULT_MODEL,
        "default_environment": settings.RBI_GENAI_DEFAULT_ENVIRONMENT,
        "context_chars": 160000,
    },
    "microsoft_copilot": {
        "name": "Microsoft 365 Copilot",
        "auth": "device_code",
        "key_label": "",
        "key_hint": "No API key: sign in with your work account. Needs a Microsoft 365 Copilot licence and an "
                    "Entra app registration from IT.",
        "default_model": MICROSOFT_COPILOT_MODEL,
        # Copilot is a chat product with smaller prompts than raw model APIs.
        "context_chars": 40000,
    },
}


class AIError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class AIConfig:
    provider: str
    api_key: str  # API key, or the Microsoft Graph access token for Microsoft 365 Copilot
    model: str = ""
    time_zone: str = "UTC"
    endpoint: str = ""  # Azure OpenAI: base URL ending in /openai/v1; RBI gateway: e.g. https://genai.rbi.tech

    @property
    def effective_model(self) -> str:
        return self.model or str(PROVIDERS.get(self.provider, {}).get("default_model", ""))


def normalize_azure_endpoint(value: str) -> str:
    """``https://<resource>.openai.azure.com/openai/v1`` from what users paste (resource URL, base URL, or the
    full chat completions URL)."""
    value = (value or "").strip()
    if not value:
        raise AIError("Enter the Azure OpenAI endpoint.", 400)
    if "://" not in value:
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise AIError("The Azure OpenAI endpoint must be an https:// URL, e.g. "
                      "https://<resource>.openai.azure.com/openai/v1", 400)
    path = parsed.path.rstrip("/")
    for suffix in ("/chat/completions", "/responses", "/models"):
        if path.endswith(suffix):
            path = path[: -len(suffix)]
    if path in ("", "/openai"):
        path = "/openai/v1"
    return f"https://{parsed.netloc}{path}"


def _ssl_context() -> ssl.SSLContext:
    from app.services.scaffold_service import station_ca_bundle

    context = ssl.create_default_context()
    bundle = station_ca_bundle()
    if bundle:
        try:
            context.load_verify_locations(cafile=bundle)
        except (OSError, ssl.SSLError):
            pass
    return context


def _client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    timeout = httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT)
    if transport is not None:
        return httpx.AsyncClient(timeout=timeout, transport=transport, follow_redirects=False)
    return httpx.AsyncClient(timeout=timeout, verify=_ssl_context(), follow_redirects=False)


_SERVICE_NAMES = {
    "api.anthropic.com": "Claude (Anthropic)",
    "models.github.ai": "GitHub Copilot (GitHub Models)",
    "graph.microsoft.com": "Microsoft 365 Copilot",
    "login.microsoftonline.com": "Microsoft sign-in",
    "genai.rbi.tech": "RBI GenAI LLM Gateway",
    "genai-uat.rbi.tech": "RBI GenAI LLM Gateway (UAT)",
    "genai-sbox.rbi.tech": "RBI GenAI LLM Gateway (SBOX)",
}


def _blocked_message(response: httpx.Response) -> str | None:
    """Detect responses served by a web filter / proxy instead of the AI service."""
    host = urlparse(str(response.request.url)).netloc
    service = _SERVICE_NAMES.get(host, host)
    advice = (f"This is your network, not your credentials: ask IT to allow {host} for this station, or use a "
              "provider your network allows (on networks that block GitHub and Anthropic AI services, "
              "Microsoft 365 Copilot usually still works).")
    if response.is_redirect:
        location = response.headers.get("location", "")
        reason = (parse_qs(urlparse(location).query).get("reason") or [""])[0]
        detail = f" ({reason})" if reason else ""
        return (f"{service} is blocked by your company's web filter: the request to {host} was redirected{detail}. "
                f"{advice}")
    content_type = response.headers.get("content-type", "")
    if response.status_code < 400 and "json" not in content_type and "event-stream" not in content_type:
        return (f"{service} is blocked by your company's web filter: {host} answered with a placeholder page "
                f"('{content_type or 'no content type'}') instead of the API, so the proxy is intercepting it. "
                f"{advice}")
    return None


def _error_from_response(response: httpx.Response, body: bytes, provider: str = "") -> AIError:
    blocked = _blocked_message(response)
    if blocked:
        return AIError(blocked, 502)
    text = body.decode("utf-8", errors="replace")
    message = text[:300]
    try:
        data = json.loads(text)
        error = data.get("error") if isinstance(data, dict) else None
        if isinstance(error, dict):
            message = error.get("message") or error.get("code") or message
        elif isinstance(error, str):
            message = data.get("error_description") or error
        elif isinstance(data, dict) and data.get("message"):
            message = data["message"]
    except ValueError:
        pass
    if provider == "microsoft_copilot" and response.status_code == 403:
        return AIError("Microsoft Graph refused the Copilot Chat API (403). Check that you have a Microsoft 365 "
                       "Copilot licence and that IT granted admin consent for all required permissions: "
                       f"{', '.join(MICROSOFT_GRAPH_SCOPES)}. Details: {message}", 400)
    if provider == "rbi_genai" and response.status_code == 401:
        return AIError(f"The RBI GenAI LLM Gateway rejected your sign-in (401): {message}. Sign in with your RBI "
                       "account again in Settings › AI Assistant.", 400)
    if provider == "rbi_genai" and response.status_code == 403:
        return AIError(f"The RBI GenAI LLM Gateway refused access (403): {message}. Check that the IDM permission "
                       "'Coding Agents via RBI GenAI LLM Gateway [your unit]' is approved for this environment and "
                       "that the model is one it allows (the Claude models).", 400)
    if response.status_code in (401, 403):
        hint = " Sign in with Microsoft again." if provider == "microsoft_copilot" else ""
        return AIError(f"The AI provider rejected the credentials ({response.status_code}): {message}.{hint}", 400)
    if response.status_code == 404:
        what = "the endpoint and deployment name" if provider == "azure_openai" else "the model name"
        return AIError(f"Not found ({response.status_code}): {message}. Check {what}.", 400)
    if response.status_code == 429:
        return AIError(f"Rate limited or out of quota: {message}", 429)
    return AIError(f"AI provider error ({response.status_code}): {message}", 502)


def _headers(config: AIConfig) -> dict:
    if not config.api_key:
        if config.provider == "microsoft_copilot":
            raise AIError("Sign in with Microsoft in Settings › AI Assistant first.", 400)
        if config.provider == "rbi_genai":
            raise AIError("Sign in with your RBI account in Settings › AI Assistant first.", 400)
        raise AIError("No API key is configured for the AI assistant.", 400)
    if config.provider == "anthropic":
        return {"x-api-key": config.api_key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
    headers = {"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"}
    if config.provider == "github":
        headers["Accept"] = "application/vnd.github+json"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    return headers


def _check(response: httpx.Response, provider: str) -> None:
    if response.status_code >= 300 or _blocked_message(response):
        raise _error_from_response(response, response.content, provider)


# ── Model listing / connection test ──────────────────────────────────────────

async def list_models(config: AIConfig, transport: httpx.AsyncBaseTransport | None = None) -> list[dict]:
    """Validate the configuration and return the models the account can use."""
    if config.provider not in PROVIDERS:
        raise AIError(f"Unknown AI provider '{config.provider}'.", 400)
    async with _client(transport) as client:
        try:
            if config.provider == "microsoft_copilot":
                # Creating an (empty) conversation proves the licence, consent and token are all in place.
                _check(await client.post(f"{GRAPH_BASE_URL}/copilot/conversations", headers=_headers(config),
                                         json={}), config.provider)
                return [{"id": MICROSOFT_COPILOT_MODEL, "name": "Microsoft 365 Copilot"}]
            if config.provider == "azure_openai":
                return await _azure_models(client, config)
            if config.provider == "rbi_genai":
                return await _rbi_models(client, config)
            if config.provider == "anthropic":
                items = await _anthropic_models(client, config)
            else:
                response = await client.get(f"{GITHUB_MODELS_BASE_URL}/catalog/models", headers=_headers(config))
                _check(response, config.provider)
                items = response.json()
                # The public catalog does not check the token, so validate it with a 1-token completion.
                _check(await client.post(f"{GITHUB_MODELS_BASE_URL}/inference/chat/completions",
                                         headers=_headers(config), json={
                                             "model": config.effective_model, "max_tokens": 1,
                                             "messages": [{"role": "user", "content": "ping"}]}), config.provider)
        except httpx.HTTPError as exc:
            raise AIError(f"Could not reach the AI provider: {exc}") from exc
    models = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id") or item.get("name")
        if not model_id:
            continue
        if config.provider == "github" and "text" not in (item.get("supported_output_modalities") or ["text"]):
            continue  # embeddings and image models can't chat
        models.append({"id": model_id, "name": item.get("display_name") or item.get("name") or model_id})
    return models


async def _anthropic_models(client: httpx.AsyncClient, config: AIConfig) -> list:
    """Every model of the account: ``/v1/models`` is paginated (20 per page by default)."""
    items: list = []
    params: dict = {"limit": 1000}
    for _ in range(MAX_MODEL_PAGES):
        response = await client.get(f"{ANTHROPIC_BASE_URL}/v1/models", headers=_headers(config), params=params)
        _check(response, config.provider)
        data = response.json()
        items.extend(data.get("data") or [])
        if not data.get("has_more") or not data.get("last_id"):
            break
        params = {"limit": 1000, "after_id": data["last_id"]}
    return items


async def _azure_models(client: httpx.AsyncClient, config: AIConfig) -> list[dict]:
    """Deployments can't be listed with an API key, so every allowed deployment (or the configured one when
    any name is allowed) is checked with a tiny request; the ones that answer are the usable models."""
    selected = _azure_deployment(config)
    allowed = [str(m) for m in cast(list, PROVIDERS["azure_openai"].get("models") or [])]
    candidates = list(dict.fromkeys([selected, *allowed]))

    async def probe(deployment: str) -> AIError | None:
        try:
            _check(await client.post(f"{_azure_base(config)}/chat/completions", headers=_headers(config), json={
                "model": deployment, "max_completion_tokens": 64,
                "messages": [{"role": "user", "content": "ping"}]}), config.provider)
        except AIError as exc:
            return exc
        return None

    results = await asyncio.gather(*(probe(d) for d in candidates))
    errors = {d: results[i] for i, d in enumerate(candidates)}
    available = [d for d in candidates if errors[d] is None]
    if not available:
        raise errors[selected] or AIError("No Azure OpenAI deployment answered.")
    return [{"id": d, "name": f"{d} (deployment)"} for d in available]


# ── Chat ─────────────────────────────────────────────────────────────────────

def _sse_events(lines: list[str]):
    """Parse buffered SSE lines into JSON payloads (tolerates pretty-printed multi-line data)."""
    data: list[str] = []
    for line in lines:
        if line == "":
            if data:
                yield "\n".join(data)
                data = []
            continue
        if line.startswith(":"):
            continue
        data.append(line[5:].lstrip() if line.startswith("data:") else line)
    if data:
        yield "\n".join(data)


async def stream_chat(config: AIConfig, system: str, messages: list[dict],
                      transport: httpx.AsyncBaseTransport | None = None) -> AsyncIterator[str]:
    """Yield the assistant's answer as it is generated."""
    if config.provider not in PROVIDERS:
        raise AIError(f"Unknown AI provider '{config.provider}'.", 400)
    if not config.effective_model:
        raise AIError("Choose a model in Settings › AI Assistant.", 400)
    if config.provider == "microsoft_copilot":
        async for chunk in _stream_microsoft(config, system, messages, transport):
            yield chunk
        return
    anthropic = config.provider == "anthropic"
    if anthropic:
        url = f"{ANTHROPIC_BASE_URL}/v1/messages"
        payload = {"model": config.effective_model, "max_tokens": MAX_OUTPUT_TOKENS, "system": system,
                   "messages": [{"role": m["role"], "content": m["content"]} for m in messages], "stream": True}
    else:
        chat = [{"role": "system", "content": system},
                *({"role": m["role"], "content": m["content"]} for m in messages)]
        if config.provider == "rbi_genai":
            url = f"{_rbi_base(config)}/v1/chat/completions"
            payload = {"model": config.effective_model, "stream": True, "max_tokens": MAX_OUTPUT_TOKENS,
                       "messages": chat}
        elif config.provider == "azure_openai":
            # Newer (reasoning) deployments only accept max_completion_tokens.
            url = f"{_azure_base(config)}/chat/completions"
            payload = {"model": _azure_deployment(config), "stream": True,
                       "max_completion_tokens": MAX_OUTPUT_TOKENS, "messages": chat}
        else:
            url = f"{GITHUB_MODELS_BASE_URL}/inference/chat/completions"
            payload = {"model": config.effective_model, "stream": True, "max_tokens": MAX_OUTPUT_TOKENS,
                       "messages": chat}
    async with _client(transport) as client:
        try:
            async with client.stream("POST", url, headers=_headers(config), json=payload) as response:
                if response.status_code >= 300 or _blocked_message(response):
                    raise _error_from_response(response, await response.aread(), config.provider)
                if "event-stream" not in response.headers.get("content-type", ""):
                    yield _text_from_json(json.loads(await response.aread()), anthropic)
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except ValueError:
                        continue
                    text = _delta_text(event, anthropic)
                    if text:
                        yield text
        except httpx.HTTPError as exc:
            raise AIError(f"Connection to {urlparse(url).netloc} failed: {exc}") from exc


def _rbi_base(config: AIConfig) -> str:
    if not config.endpoint.startswith("https://"):
        raise AIError("The RBI GenAI LLM Gateway environment is not configured. Sign in again.", 400)
    return config.endpoint.rstrip("/")


async def _rbi_models(client: httpx.AsyncClient, config: AIConfig) -> list[dict]:
    """Chat models this sign-in may use: ``/v1/models`` checks the token and lists what it allows."""
    base = _rbi_base(config)
    response = await client.get(f"{base}/v1/models", headers=_headers(config))
    _check(response, config.provider)
    allowed = [item.get("id") for item in response.json().get("data") or [] if isinstance(item, dict)]
    modes: dict[str, str] = {}
    try:  # The public model hub tells chat models from embedding / OCR / decision models.
        hub = await client.get(f"{base}/public/model_hub")
        if hub.status_code == 200 and isinstance(hub.json(), list):
            modes = {str(m.get("model_group")): str(m.get("mode") or "") for m in hub.json() if isinstance(m, dict)}
    except (httpx.HTTPError, ValueError):
        pass
    return [{"id": model, "name": model} for model in allowed
            if isinstance(model, str) and model and modes.get(model, "chat") == "chat"]


def _azure_base(config: AIConfig) -> str:
    return normalize_azure_endpoint(config.endpoint)


def _azure_deployment(config: AIConfig) -> str:
    if not config.model.strip():
        raise AIError("Enter the Azure OpenAI deployment name.", 400)
    return config.model.strip()


def _delta_text(event: dict, anthropic: bool) -> str:
    if anthropic:
        if event.get("type") == "error":
            raise AIError(f"AI provider error: {(event.get('error') or {}).get('message') or event}")
        if event.get("type") == "content_block_delta":
            return (event.get("delta") or {}).get("text") or ""
        return ""
    if event.get("error"):
        error = event["error"]
        raise AIError(f"AI provider error: {error.get('message') if isinstance(error, dict) else error}")
    choices = event.get("choices") or []
    if not choices:
        return ""
    return ((choices[0].get("delta") or {}).get("content")) or ""


def _text_from_json(data: dict, anthropic: bool) -> str:
    if anthropic:
        return "".join(block.get("text", "") for block in data.get("content") or [] if block.get("type") == "text")
    choices = data.get("choices") or []
    return (choices[0].get("message") or {}).get("content") or "" if choices else ""


def _copilot_reply(conversation: dict, prompt: str) -> str:
    """The answer in a Copilot conversation snapshot (the last message that isn't the echoed prompt)."""
    messages = [m for m in conversation.get("messages") or [] if isinstance(m, dict)]
    for message in reversed(messages):
        text = message.get("text") or ""
        if text and text.strip() != prompt.strip():
            return text
    return ""


def _history_text(messages: list[dict]) -> str:
    lines = []
    for message in messages:
        speaker = "User" if message["role"] == "user" else "Assistant"
        lines.append(f"### {speaker}\n{message['content']}")
    return "\n\n".join(lines)


async def _stream_microsoft(config: AIConfig, system: str, messages: list[dict],
                            transport: httpx.AsyncBaseTransport | None) -> AsyncIterator[str]:
    """Microsoft 365 Copilot keeps conversations server-side and has no system prompt, so each turn starts a
    fresh Copilot conversation and passes the instructions, project context and earlier turns as
    additionalContext."""
    if not messages or messages[-1]["role"] != "user":
        raise AIError("Nothing to send to Microsoft 365 Copilot.", 400)
    prompt = messages[-1]["content"]
    context = [{"description": "Instructions and project context for this assistant", "text": system}]
    if len(messages) > 1:
        context.append({"description": "Earlier messages in this conversation", "text": _history_text(messages[:-1])})
    body = {"message": {"text": prompt}, "additionalContext": context,
            "locationHint": {"timeZone": config.time_zone or "UTC"}}
    async with _client(transport) as client:
        try:
            created = await client.post(f"{GRAPH_BASE_URL}/copilot/conversations", headers=_headers(config), json={})
            _check(created, config.provider)
            conversation_id = created.json().get("id")
            url = f"{GRAPH_BASE_URL}/copilot/conversations/{conversation_id}/chatOverStream"
            async with client.stream("POST", url, headers=_headers(config), json=body) as response:
                if response.status_code >= 300 or _blocked_message(response):
                    raise _error_from_response(response, await response.aread(), config.provider)
                if "event-stream" not in response.headers.get("content-type", ""):
                    yield _copilot_reply(json.loads(await response.aread()), prompt)
                    return
                sent = ""
                lines: list[str] = []
                async for line in response.aiter_lines():
                    lines.append(line)
                    if line != "":
                        continue
                    for data in _sse_events(lines):
                        try:
                            snapshot = json.loads(data)
                        except ValueError:
                            continue
                        text = _copilot_reply(snapshot, prompt)
                        # Each event carries the whole answer so far; emit only what is new.
                        if text.startswith(sent) and len(text) > len(sent):
                            yield text[len(sent):]
                            sent = text
                    lines = []
                for data in _sse_events(lines):
                    try:
                        text = _copilot_reply(json.loads(data), prompt)
                    except ValueError:
                        continue
                    if text.startswith(sent) and len(text) > len(sent):
                        yield text[len(sent):]
                        sent = text
        except httpx.HTTPError as exc:
            raise AIError(f"Connection to Microsoft Graph failed: {exc}") from exc


# ── Microsoft sign-in (OAuth device code flow) ───────────────────────────────

def validate_microsoft_app(tenant_id: str, client_id: str) -> tuple[str, str]:
    tenant_id, client_id = (tenant_id or "").strip(), (client_id or "").strip()
    if not _TENANT.match(tenant_id) or tenant_id.lower() in ("common", "consumers"):
        raise AIError("Enter the Directory (tenant) ID from the app registration (a GUID or your domain).", 400)
    if not _GUID.match(client_id):
        raise AIError("Enter the Application (client) ID from the app registration (a GUID).", 400)
    return tenant_id, client_id


def _scope() -> str:
    graph = " ".join(f"https://graph.microsoft.com/{scope}" for scope in MICROSOFT_GRAPH_SCOPES)
    return f"openid profile offline_access {graph}"


async def _login_post(tenant_id: str, path: str, form: dict,
                      transport: httpx.AsyncBaseTransport | None) -> tuple[int, dict]:
    url = f"{MICROSOFT_LOGIN_URL}/{tenant_id}/oauth2/v2.0/{path}"
    async with _client(transport) as client:
        try:
            response = await client.post(url, data=form)
        except httpx.HTTPError as exc:
            raise AIError(f"Could not reach Microsoft sign-in: {exc}") from exc
    blocked = _blocked_message(response)
    if blocked:
        raise AIError(blocked)
    try:
        return response.status_code, response.json()
    except ValueError as exc:
        raise AIError(f"Unexpected answer from Microsoft sign-in ({response.status_code}).") from exc


async def start_device_code(tenant_id: str, client_id: str,
                            transport: httpx.AsyncBaseTransport | None = None) -> dict:
    tenant_id, client_id = validate_microsoft_app(tenant_id, client_id)
    status, data = await _login_post(tenant_id, "devicecode", {"client_id": client_id, "scope": _scope()}, transport)
    if status != 200 or "device_code" not in data:
        raise AIError(f"Microsoft sign-in could not start: {data.get('error_description') or data.get('error')}", 400)
    return {
        "device_code": data["device_code"],
        "user_code": data["user_code"],
        "verification_uri": data.get("verification_uri") or "https://microsoft.com/devicelogin",
        "message": data.get("message") or "",
        "interval": int(data.get("interval") or 5),
        "expires_at": time.time() + int(data.get("expires_in") or 900),
    }


def _account_from_id_token(id_token: str | None) -> str | None:
    if not id_token or id_token.count(".") != 2:
        return None
    try:
        payload = id_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    return claims.get("preferred_username") or claims.get("upn") or claims.get("name")


def _token_result(data: dict) -> dict:
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or "",
        "expires_at": time.time() + int(data.get("expires_in") or 3600),
        "account": _account_from_id_token(data.get("id_token")),
    }


async def poll_device_code(tenant_id: str, client_id: str, device_code: str,
                           transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """``{"status": "pending" | "slow_down" | "done" | "expired" | "declined", ...tokens when done}``."""
    status, data = await _login_post(tenant_id, "token", {
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "client_id": client_id,
        "device_code": device_code,
    }, transport)
    if status == 200 and data.get("access_token"):
        return {"status": "done", **_token_result(data)}
    error = data.get("error")
    if error in ("authorization_pending", "slow_down"):
        return {"status": "pending" if error == "authorization_pending" else "slow_down"}
    if error == "expired_token":
        return {"status": "expired", "message": "The sign-in code expired. Start again."}
    if error in ("authorization_declined", "access_denied"):
        return {"status": "declined", "message": "Sign-in was declined."}
    raise AIError(f"Microsoft sign-in failed: {data.get('error_description') or error}", 400)


async def refresh_microsoft_token(tenant_id: str, client_id: str, refresh_token: str,
                                  transport: httpx.AsyncBaseTransport | None = None) -> dict:
    status, data = await _login_post(tenant_id, "token", {
        "grant_type": "refresh_token", "client_id": client_id, "refresh_token": refresh_token, "scope": _scope(),
    }, transport)
    if status != 200 or not data.get("access_token"):
        raise AIError("Your Microsoft sign-in expired. Sign in with Microsoft again in Settings › AI Assistant. "
                      f"({data.get('error_description') or data.get('error')})", 400)
    result = _token_result(data)
    if not result["refresh_token"]:
        result["refresh_token"] = refresh_token
    return result


def public_providers() -> list[dict]:
    return [{"id": key, **{k: v for k, v in value.items() if k != "context_chars"}} for key, value in PROVIDERS.items()]
