"""AI Driven implementation: assistant settings, project analysis, conversations (streamed answers)
and applying the files the assistant proposes to the linked local checkout."""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.permissions import require
from app.modules.projects.checkouts import require_checkout
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite
from app.modules.projects.service import get_project_or_404
from app.modules.settings.connections import get_json, set_json
from app.modules.work.models import WorkItem
from app.modules.work.service import story_prompt
from app.services import ai_project_service as project_ai
from app.services import ai_provider_service as providers
from app.services import rbi_gateway_service as rbi_gateway

router = APIRouter(prefix="/api", tags=["AI assistant"])

_ANALYSIS_TTL_SECONDS = 120
_analysis_cache: dict[str, tuple[float, dict]] = {}
_MODELS_TTL_SECONDS = 600
_MAX_MODELS = 300
# Models detected for the saved connection, per user: (time, connection key, models).
_models_cache: dict[int, tuple[float, str, list[dict]]] = {}
MAX_MESSAGE_CHARS = 20000


# ── Settings ─────────────────────────────────────────────────────────────────

class AISettingsRequest(BaseModel):
    provider: str
    api_key: str | None = None
    model: str | None = ""  # Azure OpenAI: the deployment name
    endpoint: str | None = None  # Azure OpenAI only


class MicrosoftSignInRequest(BaseModel):
    tenant_id: str
    client_id: str
    time_zone: str | None = None


class ModelSwitchRequest(BaseModel):
    model: str = Field(max_length=120)


class RbiSignInRequest(BaseModel):
    environment: str | None = None  # prod | uat | sbox


# Pending Microsoft device-code sign-ins per user (the device code never leaves the server).
_pending_signins: dict[int, dict] = {}
# Pending RBI GenAI LLM Gateway browser sign-ins per user (each has its own localhost callback listener).
_pending_rbi_logins: dict[int, rbi_gateway.PendingLogin] = {}


def _stored_settings(user) -> dict:
    """The saved provider settings, including API keys and OAuth tokens (decrypted from user_connections)."""
    return get_json(user, "ai_assistant")


def _save_settings(db: Session, user, settings: dict | None) -> None:
    _models_cache.pop(user.id, None)
    set_json(user, "ai_assistant", settings)
    db.commit()
    db.refresh(user)


def _clean_time_zone(value: str | None) -> str:
    value = (value or "").strip()
    return value if value and len(value) <= 64 and all(c.isalnum() or c in "/_+-" for c in value) else "UTC"


async def _active_config(user, db: Session, payload: AISettingsRequest | None = None) -> providers.AIConfig:
    """The provider configuration to use (form values for a test, otherwise the saved settings).

    Microsoft 365 Copilot access tokens are refreshed automatically when they are about to expire."""
    stored = _stored_settings(user)
    provider = (payload.provider if payload else stored.get("provider")) or ""
    if provider not in providers.PROVIDERS:
        raise HTTPException(status_code=400, detail="Choose an AI provider in Settings › AI Assistant.")
    same = stored.get("provider") == provider
    if provider == "microsoft_copilot":
        if not same or not stored.get("refresh_token"):
            raise HTTPException(status_code=400, detail="Sign in with Microsoft in Settings › AI Assistant first.")
        if float(stored.get("expires_at") or 0) - 120 < time.time():
            try:
                tokens = await providers.refresh_microsoft_token(stored["tenant_id"], stored["client_id"],
                                                                 stored["refresh_token"])
            except providers.AIError as exc:
                raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
            stored = {**stored, **{k: v for k, v in tokens.items() if v}}
            _save_settings(db, user, stored)
        return providers.AIConfig(provider, stored.get("access_token") or "", providers.MICROSOFT_COPILOT_MODEL,
                                  stored.get("time_zone") or "UTC")
    if provider == "rbi_genai":
        if not same or not stored.get("access_token"):
            raise HTTPException(status_code=400,
                                detail="Sign in with your RBI account in Settings › AI Assistant first.")
        stored = await _fresh_rbi_tokens(user, db, stored)
        model = ((payload.model if payload else None) or stored.get("model") or "").strip()
        return providers.AIConfig(provider, stored["access_token"], model,
                                  endpoint=rbi_gateway.environment(stored.get("environment"))["gateway"])
    endpoint = ""
    if provider == "azure_openai":
        try:
            endpoint = providers.normalize_azure_endpoint(
                (payload.endpoint if payload else None) or (stored.get("endpoint") if same else "")
                or providers.PROVIDERS[provider]["default_endpoint"])
        except providers.AIError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    api_key = (payload.api_key or "").strip() if payload else ""
    # Never send a saved key to a different endpoint than the one it was saved for.
    if not api_key and same and (provider != "azure_openai" or endpoint == stored.get("endpoint")):
        api_key = stored.get("api_key") or ""
    model = ((payload.model if payload else stored.get("model")) or "").strip()
    if provider == "azure_openai":
        model = model or providers.PROVIDERS[provider]["default_model"]
        allowed = providers.PROVIDERS[provider].get("models") or []
        if allowed and model not in allowed:
            raise HTTPException(status_code=400, detail=f"'{model}' is not an allowed Azure OpenAI deployment. "
                                                        f"Choose one of: {', '.join(allowed)}.")
    return providers.AIConfig(provider, api_key, model, endpoint=endpoint)


async def _fresh_rbi_tokens(user, db: Session, stored: dict) -> dict:
    """Refresh the gateway access token (valid ~2 h) shortly before it expires."""
    if float(stored.get("expires_at") or 0) - 120 >= time.time():
        return stored
    try:
        tokens = await rbi_gateway.refresh_token(stored.get("environment"), stored.get("refresh_token") or "")
    except rbi_gateway.GatewayAuthError as exc:
        if exc.relogin:
            _save_settings(db, user, {**stored, "access_token": "", "refresh_token": "", "expires_at": 0})
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    stored = {**stored, **{k: v for k, v in tokens.items() if v}}
    _save_settings(db, user, stored)
    return stored


def _settings_response(user) -> dict:
    stored = _stored_settings(user)
    key = stored.get("api_key") or ""
    provider = stored.get("provider") or ""
    if provider == "microsoft_copilot":
        configured = bool(stored.get("refresh_token"))
    elif provider == "rbi_genai":
        configured = bool(stored.get("access_token"))
    else:
        configured = bool(provider and key)
    return {
        "provider": provider,
        "model": stored.get("model") or "",
        "api_key_set": bool(key),
        "api_key_preview": ("•••• " + key[-4:]) if len(key) >= 8 else ("set" if key else ""),
        "configured": configured,
        "environment": stored.get("environment") or "",
        "rbi_environments": rbi_gateway.public_environments(),
        "endpoint": stored.get("endpoint") or "",
        "tenant_id": stored.get("tenant_id") or "",
        "client_id": stored.get("client_id") or "",
        "account": stored.get("account") or "",
        "providers": providers.public_providers(),
        "graph_scopes": list(providers.MICROSOFT_GRAPH_SCOPES),
    }


@router.get("/ai/settings")
async def get_ai_settings(current_user=Depends(require("ai.use"))):
    return _settings_response(current_user)


@router.put("/ai/settings")
async def save_ai_settings(payload: AISettingsRequest, current_user=Depends(require("ai.use")),
                           db: Session = Depends(get_db)):
    if payload.provider == "microsoft_copilot":
        raise HTTPException(status_code=400, detail="Use 'Sign in with Microsoft' for Microsoft 365 Copilot.")
    if payload.provider == "rbi_genai":
        stored = _stored_settings(current_user)
        if stored.get("provider") != "rbi_genai" or not stored.get("access_token"):
            raise HTTPException(status_code=400, detail="Sign in with your RBI account first.")
        model = (payload.model or "").strip()
        if not _valid_model_name(model):
            raise HTTPException(status_code=400, detail="Choose a model.")
        _save_settings(db, current_user, {**stored, "model": model})
        return _settings_response(current_user)
    config = await _active_config(current_user, db, payload)
    if not config.api_key:
        raise HTTPException(status_code=400, detail=f"Enter the {providers.PROVIDERS[config.provider]['key_label']}.")
    if config.provider == "azure_openai" and not config.model:
        raise HTTPException(status_code=400, detail="Enter the Azure OpenAI deployment name.")
    saved = {"provider": config.provider, "api_key": config.api_key, "model": config.model}
    if config.endpoint:
        saved["endpoint"] = config.endpoint
    _save_settings(db, current_user, saved)
    return _settings_response(current_user)


@router.delete("/ai/settings")
async def delete_ai_settings(current_user=Depends(require("ai.use")), db: Session = Depends(get_db)):
    _pending_signins.pop(current_user.id, None)
    pending = _pending_rbi_logins.pop(current_user.id, None)
    if pending:
        pending.close()
    _save_settings(db, current_user, None)
    return _settings_response(current_user)


@router.post("/ai/settings/test")
async def test_ai_settings(payload: AISettingsRequest | None = None, current_user=Depends(require("ai.use")),
                           db: Session = Depends(get_db)):
    try:
        config = await _active_config(current_user, db, payload)
    except HTTPException as exc:
        return {"ok": False, "message": exc.detail, "models": []}
    try:
        models = await providers.list_models(config)
    except providers.AIError as exc:
        return {"ok": False, "message": exc.message, "models": []}
    return {"ok": True, "message": f"Connected to {providers.PROVIDERS[config.provider]['name']}.",
            "models": models[:_MAX_MODELS]}


def _connection_key(config: providers.AIConfig) -> str:
    return f"{config.provider}|{config.endpoint}"


def _valid_model_name(model: str) -> bool:
    return bool(model) and len(model) <= 120 and not any(c.isspace() for c in model)


async def _detected_models(user, config: providers.AIConfig, refresh: bool = False) -> list[dict]:
    """The models of the saved connection (cached; raises ``AIError`` when the connection does not work)."""
    key = _connection_key(config)
    cached = _models_cache.get(user.id)
    if cached and not refresh and cached[1] == key and time.time() - cached[0] < _MODELS_TTL_SECONDS:
        return cached[2]
    models = (await providers.list_models(config))[:_MAX_MODELS]
    _models_cache[user.id] = (time.time(), key, models)
    return models


@router.get("/ai/models")
async def list_ai_models(refresh: bool = False, current_user=Depends(require("ai.use")),
                         db: Session = Depends(get_db)):
    """All models the saved connection can use (detected from the provider, cached for a few minutes)."""
    if not _settings_response(current_user)["configured"]:
        return {"ok": False, "message": "Connect an AI provider in Settings › AI Assistant first.", "models": []}
    try:
        config = await _active_config(current_user, db)
        models = await _detected_models(current_user, config, refresh)
    except HTTPException as exc:
        return {"ok": False, "message": exc.detail, "models": []}
    except providers.AIError as exc:
        return {"ok": False, "message": exc.message, "models": []}
    return {"ok": True, "message": "", "models": models}


@router.put("/ai/settings/model")
async def switch_ai_model(payload: ModelSwitchRequest, current_user=Depends(require("ai.use")),
                          db: Session = Depends(get_db)):
    """Switch the saved connection to another of its models (checked with the provider first)."""
    if not _settings_response(current_user)["configured"]:
        raise HTTPException(status_code=400, detail="Connect an AI provider in Settings › AI Assistant first.")
    config = await _active_config(current_user, db)
    if config.provider == "microsoft_copilot":
        raise HTTPException(status_code=400, detail="Microsoft 365 Copilot has a single model.")
    model = payload.model.strip()
    allowed = providers.PROVIDERS[config.provider].get("models") or []
    if not _valid_model_name(model) or (allowed and model not in allowed):
        raise HTTPException(status_code=400, detail=f"'{model}' is not a model of your AI connection.")
    try:
        models = await _detected_models(current_user, config)
    except providers.AIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    if model not in {m["id"] for m in models}:
        raise HTTPException(status_code=400, detail=f"'{model}' is not available to your AI connection. "
                                                    "Detect the models again or choose another one.")
    cached = _models_cache.get(current_user.id)
    _save_settings(db, current_user, {**_stored_settings(current_user), "model": model})
    if cached:  # Same connection, so the detected models stay valid.
        _models_cache[current_user.id] = cached
    return _settings_response(current_user)


@router.post("/ai/microsoft/signin")
async def start_microsoft_signin(payload: MicrosoftSignInRequest, current_user=Depends(require("ai.use"))):
    """Start the device-code sign-in; the user enters the returned code at the verification URL."""
    try:
        tenant_id, client_id = providers.validate_microsoft_app(payload.tenant_id, payload.client_id)
        flow = await providers.start_device_code(tenant_id, client_id)
    except providers.AIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    _pending_signins[current_user.id] = {**flow, "tenant_id": tenant_id, "client_id": client_id,
                                         "time_zone": _clean_time_zone(payload.time_zone)}
    return {"user_code": flow["user_code"], "verification_uri": flow["verification_uri"], "message": flow["message"],
            "interval": flow["interval"], "expires_in": int(flow["expires_at"] - time.time())}


@router.post("/ai/microsoft/signin/poll")
async def poll_microsoft_signin(current_user=Depends(require("ai.use")), db: Session = Depends(get_db)):
    pending = _pending_signins.get(current_user.id)
    if not pending:
        return {"status": "expired", "message": "No sign-in in progress. Start again."}
    if time.time() > pending["expires_at"]:
        _pending_signins.pop(current_user.id, None)
        return {"status": "expired", "message": "The sign-in code expired. Start again."}
    try:
        result = await providers.poll_device_code(pending["tenant_id"], pending["client_id"], pending["device_code"])
    except providers.AIError as exc:
        _pending_signins.pop(current_user.id, None)
        return {"status": "error", "message": exc.message}
    if result["status"] != "done":
        if result["status"] in ("expired", "declined"):
            _pending_signins.pop(current_user.id, None)
        return {"status": result["status"], "message": result.get("message")}
    _pending_signins.pop(current_user.id, None)
    _save_settings(db, current_user, {
        "provider": "microsoft_copilot", "model": providers.MICROSOFT_COPILOT_MODEL,
        "tenant_id": pending["tenant_id"], "client_id": pending["client_id"], "time_zone": pending["time_zone"],
        "access_token": result["access_token"], "refresh_token": result["refresh_token"],
        "expires_at": result["expires_at"], "account": result["account"],
    })
    return {"status": "done", "settings": _settings_response(current_user)}


@router.post("/ai/rbi/signin")
async def start_rbi_signin(payload: RbiSignInRequest, current_user=Depends(require("ai.use"))):
    """Start the RBI account sign-in for the GenAI LLM Gateway: open ``login_url`` in the browser."""
    previous = _pending_rbi_logins.pop(current_user.id, None)
    if previous:
        previous.close()
    try:
        pending = await asyncio.to_thread(rbi_gateway.start_login, payload.environment)
    except rbi_gateway.GatewayAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not open the local sign-in callback: {exc}") from exc
    _pending_rbi_logins[current_user.id] = pending
    return {"login_url": pending.login_url, "environment": pending.env,
            "expires_in": int(pending.expires_at - time.time())}


@router.post("/ai/rbi/signin/poll")
async def poll_rbi_signin(current_user=Depends(require("ai.use")), db: Session = Depends(get_db)):
    pending = _pending_rbi_logins.get(current_user.id)
    if not pending:
        return {"status": "expired", "message": "No sign-in in progress. Start again."}
    if not pending.finished:
        return {"status": "pending"}
    _pending_rbi_logins.pop(current_user.id, None)
    if pending.error or not pending.result:
        return {"status": "error", "message": pending.error or "Sign-in failed."}
    stored = _stored_settings(current_user)
    model = stored.get("model") if stored.get("provider") == "rbi_genai" else ""
    _save_settings(db, current_user, {
        "provider": "rbi_genai", "environment": pending.env,
        "model": model or providers.PROVIDERS["rbi_genai"]["default_model"], **pending.result,
    })
    return {"status": "done", "settings": _settings_response(current_user)}


@router.post("/ai/rbi/signin/cancel")
async def cancel_rbi_signin(current_user=Depends(require("ai.use"))):
    pending = _pending_rbi_logins.pop(current_user.id, None)
    if pending:
        pending.close()
    return {"status": "cancelled"}


# ── Analysis ─────────────────────────────────────────────────────────────────

async def _analysis(repo: Path, refresh: bool = False) -> dict:
    cached = _analysis_cache.get(str(repo))
    if cached and not refresh and time.time() - cached[0] < _ANALYSIS_TTL_SECONDS:
        return cached[1]
    result = await asyncio.to_thread(project_ai.analyze, repo)
    _analysis_cache[str(repo)] = (time.time(), result)
    return result


@router.get("/projects/{project_id}/ai/analysis")
async def get_project_ai_analysis(
    project_id: int,
    refresh: bool = False,
    current_user=Depends(require("ai.use", project_from="project_id")),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    return await _analysis(require_checkout(current_user, project_id), refresh)


# ── Conversations ────────────────────────────────────────────────────────────

def _store(current_user, project_id: int) -> project_ai.ConversationStore:
    from app.core.config import settings as app_settings

    return project_ai.ConversationStore(Path(app_settings.ARTIFACTS_DIR), current_user.id, project_id)


def _call(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except project_ai.ProjectAIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


def _public_conversation(data: dict, repo: Path | None) -> dict:
    messages = []
    for message in data.get("messages") or []:
        public = {k: v for k, v in message.items() if k not in ("model_content", "changes")}
        changes = []
        for change in message.get("changes") or []:
            item = {"path": change["path"], "state": change.get("state", "proposed"), "error": change.get("error")}
            if repo is not None and not item["error"]:
                try:
                    item.update(project_ai.preview_change(repo, change["path"], change["content"]))
                except project_ai.ProjectAIError as exc:
                    item["error"] = exc.message
                except OSError as exc:
                    item["error"] = str(exc)
            changes.append(item)
        if changes:
            public["changes"] = changes
        messages.append(public)
    return {**{k: v for k, v in data.items() if k != "messages"}, "messages": messages}


def _repo_or_none(current_user, project_id: int) -> Path | None:
    try:
        return require_checkout(current_user, project_id)
    except HTTPException:
        return None


class ConversationCreate(BaseModel):
    title: str | None = None


@router.get("/projects/{project_id}/ai/conversations")
async def list_ai_conversations(project_id: int, current_user=Depends(require("ai.use", project_from="project_id")),
                                db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    return {"conversations": _store(current_user, project_id).list()}


@router.post("/projects/{project_id}/ai/conversations")
async def create_ai_conversation(
    project_id: int,
    payload: ConversationCreate = ConversationCreate(),
    current_user=Depends(require("ai.use", project_from="project_id")),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    return _store(current_user, project_id).create(payload.title)


@router.get("/projects/{project_id}/ai/conversations/{conversation_id}")
async def get_ai_conversation(
    project_id: int,
    conversation_id: str,
    current_user=Depends(require("ai.use", project_from="project_id")),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    data = _call(_store(current_user, project_id).load, conversation_id)
    repo = _repo_or_none(current_user, project_id)
    return await asyncio.to_thread(_public_conversation, data, repo)


@router.delete("/projects/{project_id}/ai/conversations/{conversation_id}")
async def delete_ai_conversation(
    project_id: int,
    conversation_id: str,
    current_user=Depends(require("ai.use", project_from="project_id")),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    _call(_store(current_user, project_id).delete, conversation_id)
    return {"deleted": True}


class ChatMessageRequest(BaseModel):
    content: str = Field(default="", max_length=MAX_MESSAGE_CHARS)
    attachments: list[str] = Field(default_factory=list, max_length=project_ai.MAX_ATTACHED_FILES)
    run_id: str | None = None
    # A work item of this project: the story (title, description, acceptance criteria) goes to the model.
    work_item_id: int | None = None


def _run_summary(db: Session, project_id: int, run_id: str) -> tuple[str, dict]:
    try:
        manual_id = int(run_id.removeprefix("manual-"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Only local runs can be attached.") from exc
    run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_id).first()
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first() if run else None
    if not run or not suite or suite.project_id != project_id:
        raise HTTPException(status_code=404, detail="Run not found in this project.")
    info = {"id": run_id, "name": run.name or run.collection, "status": run.status,
            "passed": run.passed_tests, "failed": run.failed_tests, "skipped": run.skipped_tests}
    summary = project_ai.run_failure_summary({
        **info, "collection": run.collection, "results": run.results_json or [], "logs": run.logs_json or [],
        "details": run.details_json or {},
    })
    return summary, info


def _context_files(conversation: dict, extra: list[str]) -> list[str]:
    """Files attached anywhere in the conversation plus files the assistant already applied (newest first)."""
    paths: list[str] = []
    for message in reversed(conversation.get("messages") or []):
        for change in message.get("changes") or []:
            if change.get("state") == "applied":
                paths.append(change["path"])
        paths.extend((message.get("attachments") or {}).get("files") or [])
    ordered = list(dict.fromkeys([*extra, *paths]))
    return ordered[:project_ai.MAX_ATTACHED_FILES]


@router.post("/projects/{project_id}/ai/conversations/{conversation_id}/messages")
async def send_ai_message(
    project_id: int,
    conversation_id: str,
    payload: ChatMessageRequest,
    current_user=Depends(require("ai.use", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Store the user's message and stream the assistant's answer as NDJSON events."""
    get_project_or_404(db, project_id)
    if not payload.content.strip() and not payload.run_id:
        raise HTTPException(status_code=400, detail="Write a message first.")
    if not _settings_response(current_user)["configured"]:
        raise HTTPException(status_code=400, detail="Connect an AI provider in Settings › AI Assistant first.")
    config = await _active_config(current_user, db)
    repo = require_checkout(current_user, project_id)
    store = _store(current_user, project_id)
    conversation = _call(store.load, conversation_id)

    attachments = []
    for rel in payload.attachments:
        _, normalised = _call(project_ai.resolve_project_path, repo, rel)
        if project_ai.is_sensitive(normalised):
            raise HTTPException(status_code=400, detail=f"'{normalised}' looks like a secret/key file and is never "
                                                        "sent to the AI.")
        attachments.append(normalised)
    model_content = payload.content.strip()
    run_info = None
    if payload.run_id:
        summary, run_info = _run_summary(db, project_id, payload.run_id)
        model_content = (model_content or "This test run failed. Find the cause and fix it.") + "\n\n" + summary
    story_info = None
    if payload.work_item_id is not None:
        item = db.query(WorkItem).filter(WorkItem.id == payload.work_item_id,
                                         WorkItem.project_id == project_id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Work item not found in this project.")
        model_content = f"{model_content}\n\n--- Story context ---\n{story_prompt(item)}"
        story_info = {"id": item.id, "key": item.external_key, "title": item.title}

    user_message = project_ai.new_message(
        "user", payload.content.strip() or "Analyse this run and fix the failure.", model_content=model_content,
        attachments={"files": attachments, "run": run_info, "work_item": story_info})
    conversation["messages"].append(user_message)
    if conversation.get("title") in (None, "", "New conversation"):
        conversation["title"] = (payload.content.strip() or f"Fix run {payload.run_id}")[:80]
    store.save(conversation)

    analysis = await _analysis(repo)
    system, included = await asyncio.to_thread(
        project_ai.build_system_prompt, repo, analysis, _context_files(conversation, attachments),
        providers.PROVIDERS[config.provider]["context_chars"])
    history = project_ai.history_for_model(conversation["messages"])

    async def events():
        parts: list[str] = []
        error: str | None = None
        stopped = True
        yield json.dumps({"type": "start", "user_message": user_message["id"], "context_files": included,
                          "provider": providers.PROVIDERS[config.provider]["name"],
                          "model": config.effective_model}) + "\n"
        try:
            async for chunk in providers.stream_chat(config, system, history):
                parts.append(chunk)
                yield json.dumps({"type": "delta", "text": chunk}) + "\n"
            stopped = False
        except providers.AIError as exc:
            error = exc.message
            stopped = False
        except Exception as exc:  # noqa: BLE001 - reported to the user instead of breaking the stream
            error = f"Unexpected error while talking to the AI provider: {exc}"
            stopped = False
        finally:
            text = "".join(parts)
            latest = store.load(conversation_id)
            if text or error:
                changes = []
                for change in project_ai.parse_changes(text):
                    try:
                        _, rel = project_ai.resolve_project_path(repo, change["path"])
                        changes.append({"path": rel, "content": change["content"], "state": "proposed"})
                    except project_ai.ProjectAIError as exc:
                        changes.append({"path": change["path"], "content": change["content"], "state": "invalid",
                                        "error": exc.message})
                message = project_ai.new_message(
                    "assistant", text, changes=changes, error=error, stopped=stopped and not error,
                    model=config.effective_model, provider=config.provider, context_files=included)
                latest["messages"].append(message)
                store.save(latest)
        public = _public_conversation(latest, repo)
        yield json.dumps({"type": "done", "conversation": public, "error": error}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class ChangeRequest(BaseModel):
    message_id: str
    path: str
    expected_sha: str | None = None
    # The reviewed content when only some of the proposed hunks were accepted (default: the whole proposal).
    content: str | None = Field(default=None, max_length=project_ai.MAX_CHANGE_BYTES)


def _find_change(conversation: dict, message_id: str, path: str) -> dict:
    message = next((m for m in conversation.get("messages") or [] if m.get("id") == message_id), None)
    change = next((c for c in (message or {}).get("changes") or [] if c.get("path") == path), None)
    if not change:
        raise HTTPException(status_code=404, detail="Proposed change not found.")
    return change


@router.post("/projects/{project_id}/ai/conversations/{conversation_id}/changes/apply")
async def apply_ai_change(
    project_id: int,
    conversation_id: str,
    payload: ChangeRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    repo = require_checkout(current_user, project_id)
    store = _store(current_user, project_id)
    conversation = _call(store.load, conversation_id)
    change = _find_change(conversation, payload.message_id, payload.path)
    if change.get("state") == "invalid":
        raise HTTPException(status_code=400, detail=change.get("error") or "This change cannot be applied.")
    content = change["content"] if payload.content is None else payload.content
    result = _call(project_ai.apply_change, repo, change["path"], content, payload.expected_sha)
    change.update(state="applied", applied_content=content, previous=result["previous"],
                  previous_existed=result["previous_existed"],
                  applied_sha=result["applied_sha"])
    store.save(conversation)
    _analysis_cache.pop(str(repo), None)
    return await asyncio.to_thread(_public_conversation, conversation, repo)


@router.post("/projects/{project_id}/ai/conversations/{conversation_id}/changes/undo")
async def undo_ai_change(
    project_id: int,
    conversation_id: str,
    payload: ChangeRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    get_project_or_404(db, project_id)
    repo = require_checkout(current_user, project_id)
    store = _store(current_user, project_id)
    conversation = _call(store.load, conversation_id)
    change = _find_change(conversation, payload.message_id, payload.path)
    if change.get("state") != "applied":
        raise HTTPException(status_code=400, detail="Only applied changes can be undone.")
    _call(project_ai.undo_change, repo, change["path"], change.get("previous"), bool(change.get("previous_existed")),
          change.get("applied_sha") or "")
    change.update(state="undone", previous=None, applied_sha=None)
    store.save(conversation)
    _analysis_cache.pop(str(repo), None)
    return await asyncio.to_thread(_public_conversation, conversation, repo)


@router.get("/projects/{project_id}/ai/conversations/{conversation_id}/changes/content")
async def get_ai_change_content(
    project_id: int,
    conversation_id: str,
    message_id: str,
    path: str,
    current_user=Depends(require("ai.use", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Current file content and the assistant's proposal, for the side-by-side review."""
    get_project_or_404(db, project_id)
    repo = require_checkout(current_user, project_id)
    change = _find_change(_call(_store(current_user, project_id).load, conversation_id), message_id, path)
    if change.get("state") == "invalid":
        raise HTTPException(status_code=400, detail=change.get("error") or "This change cannot be reviewed.")

    def read() -> dict:
        target, rel = project_ai.resolve_project_path(repo, change["path"])
        current = target.read_bytes() if target.is_file() else None
        preview = project_ai.preview_change(repo, rel, change["content"])
        return {"path": rel, "state": change.get("state", "proposed"), "exists": current is not None,
                "original": current.decode("utf-8", errors="replace").replace("\r\n", "\n") if current is not None
                else "", "proposed": change["content"].replace("\r\n", "\n"), "current_sha": preview["current_sha"]}

    return await asyncio.to_thread(_call, read)


@router.post("/projects/{project_id}/ai/conversations/{conversation_id}/changes/reject")
async def reject_ai_change(
    project_id: int,
    conversation_id: str,
    payload: ChangeRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Discard a proposed change (the file is not touched)."""
    get_project_or_404(db, project_id)
    store = _store(current_user, project_id)
    conversation = _call(store.load, conversation_id)
    change = _find_change(conversation, payload.message_id, payload.path)
    if change.get("state") not in (None, "proposed", "undone"):
        raise HTTPException(status_code=400, detail="Only proposed changes can be rejected.")
    change.update(state="rejected")
    store.save(conversation)
    return await asyncio.to_thread(_public_conversation, conversation, _repo_or_none(current_user, project_id))


# ── Open in IDE ──────────────────────────────────────────────────────────────

class OpenInIdeRequest(BaseModel):
    ide: str
    path: str = ""  # relative to the linked checkout; empty = the project folder


@router.get("/ide/available")
async def list_station_ides(refresh: bool = False, current_user=Depends(get_current_user)):
    """IDEs installed on the station running ATM (only detected ones are returned)."""
    from app.services import ide_service

    ides = await asyncio.to_thread(ide_service.detect_ides, refresh)
    return {"station": ide_service.station_name(), "ides": [ide.public() for ide in ides]}


@router.post("/projects/{project_id}/ide/open")
async def open_project_in_ide(
    project_id: int,
    payload: OpenInIdeRequest,
    current_user=Depends(require("code.edit", project_from="project_id")),
    db: Session = Depends(get_db),
):
    """Open the project's local copy (or a folder/file inside it) in a detected IDE."""
    from app.services import ide_service

    get_project_or_404(db, project_id)
    repo = require_checkout(current_user, project_id)
    if payload.path.strip() in ("", "."):
        target, rel = repo, "."
    else:
        target, rel = _call(project_ai.resolve_project_path, repo, payload.path)
    try:
        ide = await asyncio.to_thread(ide_service.open_in_ide, payload.ide, target)
    except ide_service.IDEError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"opened": True, "ide": ide.name, "path": rel, "absolute_path": str(target)}
