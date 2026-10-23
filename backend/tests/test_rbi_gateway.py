import asyncio
import base64
import json
import time
import urllib.error
import urllib.request
from types import SimpleNamespace
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
import pytest
from fastapi import HTTPException

from app.modules.settings.connections import get_json, set_json
from app.modules.workspace import assistant_router as ai_routes
from app.services import ai_provider_service as ai
from app.services import rbi_gateway_service as gw

GATEWAY = "https://genai.rbi.tech"


def _jwt(claims: dict) -> str:
    def part(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    return f"{part({'alg': 'RS256'})}.{part(claims)}.signature"


def _callback(pending: gw.PendingLogin, **params) -> int:
    redirect = parse_qs(urlparse(pending.login_url).query)["redirect_uri"][0]
    try:
        with urllib.request.urlopen(f"{redirect}?{urlencode(params)}", timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code


def _wait_closed(pending: gw.PendingLogin) -> None:
    for _ in range(50):
        if pending.server is None:
            return
        time.sleep(0.02)


def test_login_url_follows_the_official_client_protocol():
    pending = gw.start_login("prod")
    try:
        parsed = urlparse(pending.login_url)
        query = parse_qs(parsed.query)
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "https://login.genai.rbi.tech/auth/login"
        redirect = urlparse(query["redirect_uri"][0])
        assert redirect.scheme == "http" and redirect.hostname == "localhost" and redirect.path == "/callback"
        assert query["state"] == [pending.state] and len(pending.state) >= 24
    finally:
        pending.close()


def test_callback_with_tokens_completes_the_sign_in():
    pending = gw.start_login("sbox")
    token = _jwt({"email": "jane.doe@rbinternational.com", "scope": "RBI-GENAIAPIGW_BSN0051007-PROD-H2M_HO"})
    status = _callback(pending, state=pending.state, access_token=token, refresh_token="RT", expires_in="7200")
    assert status == 200
    assert pending.error is None and pending.env == "sbox"
    assert pending.result["access_token"] == token and pending.result["refresh_token"] == "RT"
    assert pending.result["account"] == "jane.doe@rbinternational.com"
    assert 7000 < pending.result["expires_at"] - time.time() <= 7200
    _wait_closed(pending)
    assert pending.server is None


def test_callback_with_wrong_state_is_rejected():
    pending = gw.start_login("prod")
    assert _callback(pending, state="forged", access_token="x") == 400
    assert pending.result is None and "state mismatch" in pending.error


def test_unknown_environment_is_rejected():
    with pytest.raises(gw.GatewayAuthError):
        gw.start_login("dev-secret")


def test_refresh_posts_the_refresh_token_and_keeps_it_when_not_rotated():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = parse_qs(request.content.decode())
        return httpx.Response(200, json={"access_token": _jwt({"sub": "c123"}), "expires_in": 7200})

    tokens = asyncio.run(gw.refresh_token("uat", "RT-1", httpx.MockTransport(handler)))
    assert seen["url"] == "https://login.genai-uat.rbi.tech/auth/refresh"
    assert seen["body"] == {"refresh_token": ["RT-1"]}
    assert tokens["refresh_token"] == "RT-1" and tokens["account"] == "c123"


def test_refresh_failures_tell_apart_relogin_and_outage():
    def rejected(request):
        return httpx.Response(400, json={"error": "invalid_grant"})

    with pytest.raises(gw.GatewayAuthError) as exc:
        asyncio.run(gw.refresh_token("prod", "RT", httpx.MockTransport(rejected)))
    assert exc.value.relogin

    def outage(request):
        return httpx.Response(503, text="upstream unavailable")

    with pytest.raises(gw.GatewayAuthError) as exc:
        asyncio.run(gw.refresh_token("prod", "RT", httpx.MockTransport(outage)))
    assert not exc.value.relogin and exc.value.status_code == 502


def test_gateway_models_are_the_chat_models_the_token_allows():
    def handler(request):
        if request.url.path == "/v1/models":
            assert request.headers["authorization"] == "Bearer " + "jwt"
            return httpx.Response(200, json={"data": [{"id": "claude-sonnet-4-6"}, {"id": "claude-opus-4-8"},
                                                      {"id": "text-embedding-3-large"}]})
        if request.url.path == "/public/model_hub":
            return httpx.Response(200, json=[{"model_group": "claude-sonnet-4-6", "mode": "chat"},
                                             {"model_group": "claude-opus-4-8", "mode": "chat"},
                                             {"model_group": "text-embedding-3-large", "mode": "embedding"}])
        return httpx.Response(404)

    config = ai.AIConfig("rbi_genai", "jwt", "claude-sonnet-4-6", endpoint=GATEWAY)
    models = asyncio.run(ai.list_models(config, transport=httpx.MockTransport(handler)))
    assert [m["id"] for m in models] == ["claude-sonnet-4-6", "claude-opus-4-8"]


def test_gateway_chat_uses_the_openai_compatible_api():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        chunks = [{"choices": [{"delta": {"content": "He"}}]}, {"choices": [{"delta": {"content": "llo"}}]}]
        body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())

    async def run():
        config = ai.AIConfig("rbi_genai", "jwt", "claude-sonnet-4-6", endpoint=GATEWAY)
        return [c async for c in ai.stream_chat(config, "sys", [{"role": "user", "content": "hi"}],
                                                transport=httpx.MockTransport(handler))]

    assert "".join(asyncio.run(run())) == "Hello"
    assert seen["url"] == f"{GATEWAY}/v1/chat/completions"
    assert seen["body"]["model"] == "claude-sonnet-4-6" and seen["body"]["stream"]
    assert seen["body"]["messages"][0] == {"role": "system", "content": "sys"}


@pytest.mark.parametrize("status, expected", [(401, "Sign in with your RBI account again"),
                                              (403, "Coding Agents via RBI GenAI LLM Gateway")])
def test_gateway_auth_errors_are_explained(status, expected):
    def handler(request):
        return httpx.Response(status, json={"error": {"message": "denied"}})

    config = ai.AIConfig("rbi_genai", "jwt", endpoint=GATEWAY)
    with pytest.raises(ai.AIError, match=expected):
        asyncio.run(ai.list_models(config, transport=httpx.MockTransport(handler)))


# ── Routes ───────────────────────────────────────────────────────────────────

_DB = SimpleNamespace(commit=lambda: None, refresh=lambda _user: None)


def _user(**stored):
    user = SimpleNamespace(id=7, settings_json={}, connections=[])
    stored = {"provider": "rbi_genai", "environment": "uat", "model": "claude-opus-4-8", **stored}
    set_json(user, "ai_assistant", stored)
    return user


def _ai(user) -> dict:
    return get_json(user, "ai_assistant")


def test_active_config_uses_the_environment_and_refreshes_expired_tokens(monkeypatch):
    calls = []

    async def fake_refresh(env, refresh):
        calls.append((env, refresh))
        return {"access_token": "NEW", "refresh_token": "RT2", "expires_at": time.time() + 7200, "account": "jane"}

    monkeypatch.setattr(gw, "refresh_token", fake_refresh)
    user = _user(access_token="OLD", refresh_token="RT1", expires_at=time.time() + 3600)
    config = asyncio.run(ai_routes._active_config(user, _DB))
    assert (config.api_key, config.endpoint, config.model) == ("OLD", "https://genai-uat.rbi.tech", "claude-opus-4-8")
    assert calls == []

    user = _user(access_token="OLD", refresh_token="RT1", expires_at=time.time() - 10)
    config = asyncio.run(ai_routes._active_config(user, _DB))
    assert config.api_key == "NEW" and calls == [("uat", "RT1")]
    assert _ai(user)["refresh_token"] == "RT2"


def test_expired_refresh_token_asks_to_sign_in_again(monkeypatch):
    async def expired(env, refresh):
        raise gw.GatewayAuthError("Sign in again.", relogin=True)

    monkeypatch.setattr(gw, "refresh_token", expired)
    user = _user(access_token="OLD", refresh_token="RT1", expires_at=0)
    with pytest.raises(HTTPException):
        asyncio.run(ai_routes._active_config(user, _DB))
    assert ai_routes._settings_response(user)["configured"] is False


def test_saving_only_changes_the_model_and_keeps_the_sign_in():
    user = _user(access_token="TOKEN", refresh_token="RT", expires_at=time.time() + 3600)
    request = ai_routes.AISettingsRequest(provider="rbi_genai", model="claude-sonnet-4-6")
    response = asyncio.run(ai_routes.save_ai_settings(request, user, _DB))
    assert response["configured"] and response["model"] == "claude-sonnet-4-6" and response["environment"] == "uat"
    assert _ai(user)["access_token"] == "TOKEN"
    assert "TOKEN" not in json.dumps(response)  # tokens are never sent back to the browser


def test_models_endpoint_detects_and_caches_the_connection_models(monkeypatch):
    calls = []

    async def fake_list(config):
        calls.append(config.endpoint)
        return [{"id": "claude-sonnet-4-6", "name": "claude-sonnet-4-6"}, {"id": "claude-opus-4-8", "name": "x"}]

    monkeypatch.setattr(ai, "list_models", fake_list)
    ai_routes._models_cache.clear()
    user = _user(access_token="TOKEN", refresh_token="RT", expires_at=time.time() + 3600)
    first = asyncio.run(ai_routes.list_ai_models(False, user, _DB))
    again = asyncio.run(ai_routes.list_ai_models(False, user, _DB))
    assert first["ok"] and [m["id"] for m in first["models"]] == ["claude-sonnet-4-6", "claude-opus-4-8"]
    assert again == first and calls == ["https://genai-uat.rbi.tech"]
    asyncio.run(ai_routes.list_ai_models(True, user, _DB))
    assert len(calls) == 2


def test_models_endpoint_without_a_connection():
    user = SimpleNamespace(id=8, settings_json={}, connections=[])
    response = asyncio.run(ai_routes.list_ai_models(False, user, _DB))
    assert response == {"ok": False, "message": "Connect an AI provider in Settings › AI Assistant first.",
                        "models": []}


def test_switching_model_checks_it_against_the_detected_models(monkeypatch):
    async def fake_list(config):
        return [{"id": "claude-sonnet-4-6", "name": "claude-sonnet-4-6"}, {"id": "claude-opus-4-8", "name": "x"}]

    monkeypatch.setattr(ai, "list_models", fake_list)
    ai_routes._models_cache.clear()
    user = _user(access_token="TOKEN", refresh_token="RT", expires_at=time.time() + 3600)
    request = ai_routes.ModelSwitchRequest(model="claude-sonnet-4-6")
    response = asyncio.run(ai_routes.switch_ai_model(request, user, _DB))
    assert response["model"] == "claude-sonnet-4-6" and response["configured"]
    assert _ai(user)["access_token"] == "TOKEN"
    assert user.id in ai_routes._models_cache  # the detected models stay cached for the same connection
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ai_routes.switch_ai_model(ai_routes.ModelSwitchRequest(model="gpt-unknown"), user, _DB))
    assert exc.value.status_code == 400 and _ai(user)["model"] == "claude-sonnet-4-6"
