import asyncio
import json
import subprocess
from pathlib import Path

import httpx
import pytest

from app.services import ai_project_service as pa
from app.services import ai_provider_service as ai


def _collect(config, transport, system="sys", messages=None):
    async def run():
        return [chunk async for chunk in ai.stream_chat(config, system, messages or [{"role": "user", "content": "hi"}],
                                                        transport=transport)]
    return asyncio.run(run())


def _sse(events: list[dict], done: bool = True) -> bytes:
    body = "".join(f"data: {json.dumps(e)}\n\n" for e in events) + ("data: [DONE]\n\n" if done else "")
    return body.encode()


def test_anthropic_stream_request_and_parsing():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        events = [{"type": "message_start"}, {"type": "content_block_delta", "delta": {"text": "Hel"}},
                  {"type": "content_block_delta", "delta": {"text": "lo"}}, {"type": "message_stop"}]
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(events, done=False))

    config = ai.AIConfig("anthropic", "sk-ant-x", "claude-test")
    assert "".join(_collect(config, httpx.MockTransport(handler))) == "Hello"
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["headers"]["x-api-key"] == "sk-ant-x" and seen["headers"]["anthropic-version"]
    assert seen["body"]["system"] == "sys" and seen["body"]["model"] == "claude-test" and seen["body"]["stream"]


def test_github_stream_and_non_stream_fallback():
    def streaming(request):
        assert str(request.url) == "https://models.github.ai/inference/chat/completions"
        body = json.loads(request.content)
        assert body["messages"][0] == {"role": "system", "content": "sys"}
        assert request.headers["authorization"] == "Bearer k"
        chunks = [{"choices": [{"delta": {"content": "A"}}]}, {"choices": []},
                  {"choices": [{"delta": {"content": "B"}}]}]
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(chunks))

    config = ai.AIConfig("github", "k", "openai/gpt-4.1")
    assert _collect(config, httpx.MockTransport(streaming)) == ["A", "B"]

    def plain(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": "whole answer"}}]})

    assert _collect(config, httpx.MockTransport(plain)) == ["whole answer"]


def test_proxy_block_redirect_is_explained():
    def handler(request):
        return httpx.Response(307, headers={"location": "https://filter.example/blocked?reason=Category+denied"})

    with pytest.raises(ai.AIError, match="Claude \\(Anthropic\\) is blocked.*redirected \\(Category denied\\)"):
        _collect(ai.AIConfig("anthropic", "k", "m"), httpx.MockTransport(handler))


def test_intercepted_non_json_answer_is_explained():
    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/plain"}, content=b"OK")

    expected = "GitHub Copilot \\(GitHub Models\\) is blocked.*intercepting.*allow models.github.ai"
    with pytest.raises(ai.AIError, match=expected):
        asyncio.run(ai.list_models(ai.AIConfig("github", "t"), transport=httpx.MockTransport(handler)))


def test_anthropic_auth_error_and_model_listing():
    def handler(request):
        if request.headers.get("x-api-key") != "good":
            return httpx.Response(401, json={"error": {"message": "invalid x-api-key"}})
        return httpx.Response(200, json={"data": [{"id": "m1"}, {"id": "m2", "display_name": "Model 2"}]})

    config = ai.AIConfig("anthropic", "bad", "m1")
    with pytest.raises(ai.AIError, match="rejected the credentials"):
        asyncio.run(ai.list_models(config, transport=httpx.MockTransport(handler)))
    config.api_key = "good"
    models = asyncio.run(ai.list_models(config, transport=httpx.MockTransport(handler)))
    assert models == [{"id": "m1", "name": "m1"}, {"id": "m2", "name": "Model 2"}]


def test_github_models_filters_non_chat_and_validates_token():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path.endswith("/catalog/models"):
            return httpx.Response(200, json=[
                {"id": "openai/gpt-4.1", "name": "GPT-4.1", "supported_output_modalities": ["text"]},
                {"id": "openai/text-embedding-3", "name": "Embeddings", "supported_output_modalities": ["embeddings"]},
            ])
        return httpx.Response(200, json={"choices": [{"message": {"content": "p"}}]})

    models = asyncio.run(ai.list_models(ai.AIConfig("github", "ghp"), transport=httpx.MockTransport(handler)))
    assert [m["id"] for m in models] == ["openai/gpt-4.1"]
    assert calls == ["/catalog/models", "/inference/chat/completions"]


# ── Microsoft 365 Copilot ────────────────────────────────────────────────────

TENANT = "contoso.onmicrosoft.com"
CLIENT = "11111111-2222-3333-4444-555555555555"


def _id_token(claims: dict) -> str:
    import base64

    def part(data):
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    return f"{part({'alg': 'none'})}.{part(claims)}.sig"


def test_microsoft_app_ids_are_validated():
    with pytest.raises(ai.AIError, match="tenant"):
        ai.validate_microsoft_app("common", CLIENT)
    with pytest.raises(ai.AIError, match="client"):
        ai.validate_microsoft_app(TENANT, "not-a-guid")
    assert ai.validate_microsoft_app(f" {TENANT} ", CLIENT) == (TENANT, CLIENT)


def test_microsoft_device_code_flow():
    polls = iter([{"error": "authorization_pending"},
                  {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600,
                   "id_token": _id_token({"preferred_username": "jane@contoso.com"})}])

    def handler(request):
        form = dict(x.split("=", 1) for x in request.content.decode().split("&"))
        assert request.url.path.startswith(f"/{TENANT}/oauth2/v2.0/")
        if request.url.path.endswith("/devicecode"):
            assert "Chat.Read" in httpx.QueryParams(request.content.decode())["scope"]
            assert "offline_access" in httpx.QueryParams(request.content.decode())["scope"]
            return httpx.Response(200, json={"device_code": "DC", "user_code": "ABCD-1234", "interval": 5,
                                             "verification_uri": "https://microsoft.com/devicelogin",
                                             "expires_in": 900, "message": "Go sign in"})
        assert form["device_code"] == "DC"
        data = next(polls)
        return httpx.Response(200 if "access_token" in data else 400, json=data)

    transport = httpx.MockTransport(handler)
    flow = asyncio.run(ai.start_device_code(TENANT, CLIENT, transport))
    assert flow["user_code"] == "ABCD-1234" and flow["device_code"] == "DC"
    assert asyncio.run(ai.poll_device_code(TENANT, CLIENT, "DC", transport)) == {"status": "pending"}
    done = asyncio.run(ai.poll_device_code(TENANT, CLIENT, "DC", transport))
    assert done["status"] == "done" and done["access_token"] == "AT" and done["account"] == "jane@contoso.com"


def test_microsoft_refresh_keeps_refresh_token_and_reports_expiry():
    def ok(request):
        return httpx.Response(200, json={"access_token": "AT2", "expires_in": 3600})

    result = asyncio.run(ai.refresh_microsoft_token(TENANT, CLIENT, "RT", httpx.MockTransport(ok)))
    assert result["access_token"] == "AT2" and result["refresh_token"] == "RT"

    def expired(request):
        return httpx.Response(400, json={"error": "invalid_grant", "error_description": "AADSTS700082 expired"})

    with pytest.raises(ai.AIError, match="Sign in with Microsoft again"):
        asyncio.run(ai.refresh_microsoft_token(TENANT, CLIENT, "RT", httpx.MockTransport(expired)))


def test_microsoft_copilot_stream_sends_context_and_emits_deltas():
    seen = {}

    def snapshot(text):
        return {"id": "conv-1", "messages": [{"text": "Write a test"}, {"text": text}]}

    def handler(request):
        assert request.headers["authorization"] == "Bearer AT"
        if request.url.path == "/beta/copilot/conversations":
            return httpx.Response(201, json={"id": "conv-1"})
        assert request.url.path == "/beta/copilot/conversations/conv-1/chatOverStream"
        seen["body"] = json.loads(request.content)
        # Pretty-printed multi-line SSE data, cumulative text in each event.
        events = [json.dumps(snapshot(t), indent=2) for t in ("Hel", "Hello", "Hello world")]
        body = "".join(f"data: {e}\n\n" for e in events)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())

    config = ai.AIConfig("microsoft_copilot", "AT", ai.MICROSOFT_COPILOT_MODEL, "Europe/Bucharest")
    history = [{"role": "user", "content": "First"}, {"role": "assistant", "content": "Answer"},
               {"role": "user", "content": "Write a test"}]
    chunks = _collect(config, httpx.MockTransport(handler), system="SYSTEM", messages=history)
    assert "".join(chunks) == "Hello world" and chunks == ["Hel", "lo", " world"]
    body = seen["body"]
    assert body["message"] == {"text": "Write a test"} and body["locationHint"] == {"timeZone": "Europe/Bucharest"}
    assert body["additionalContext"][0]["text"] == "SYSTEM"
    assert "### User\nFirst" in body["additionalContext"][1]["text"]


def test_microsoft_copilot_403_explains_licence_and_consent():
    def handler(request):
        return httpx.Response(403, json={"error": {"code": "Forbidden", "message": "Access denied"}})

    with pytest.raises(ai.AIError, match="Copilot licence"):
        asyncio.run(ai.list_models(ai.AIConfig("microsoft_copilot", "AT"), transport=httpx.MockTransport(handler)))


def test_microsoft_copilot_test_connection_creates_conversation():
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(201, json={"id": "c"})

    models = asyncio.run(ai.list_models(ai.AIConfig("microsoft_copilot", "AT"), transport=httpx.MockTransport(handler)))
    assert models == [{"id": "microsoft-365-copilot", "name": "Microsoft 365 Copilot"}]
    assert calls == [("POST", "/beta/copilot/conversations")]


def test_public_providers_hide_internal_limits():
    ids = [p["id"] for p in ai.public_providers()]
    assert ids == ["github", "anthropic", "azure_openai", "rbi_genai", "microsoft_copilot"]
    assert all("context_chars" not in p for p in ai.public_providers())
    azure = next(p for p in ai.public_providers() if p["id"] == "azure_openai")
    assert azure["default_endpoint"].endswith("/openai/v1") and azure["default_model"]


AZURE = "https://rbro-sandbox-openai.openai.azure.com/openai/v1"


@pytest.mark.parametrize("value", [
    AZURE, AZURE + "/", "rbro-sandbox-openai.openai.azure.com", "https://rbro-sandbox-openai.openai.azure.com/",
    "https://rbro-sandbox-openai.openai.azure.com/openai", AZURE + "/chat/completions",
])
def test_azure_endpoint_is_normalised(value):
    assert ai.normalize_azure_endpoint(value) == AZURE


@pytest.mark.parametrize("value", ["", "http://rbro-sandbox-openai.openai.azure.com/openai/v1", "https://"])
def test_azure_endpoint_rejects_invalid(value):
    with pytest.raises(ai.AIError):
        ai.normalize_azure_endpoint(value)


def test_azure_openai_stream_matches_the_openai_sdk_request():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        chunks = [{"choices": [], "prompt_filter_results": []}, {"choices": [{"delta": {"content": "Par"}}]},
                  {"choices": [{"delta": {"content": "is"}}]}]
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(chunks))

    config = ai.AIConfig("azure_openai", "azure-key", "gpt-5.6-terra", endpoint=AZURE)
    assert "".join(_collect(config, httpx.MockTransport(handler))) == "Paris"
    assert seen["url"] == AZURE + "/chat/completions"
    assert seen["auth"] == "Bearer " + "azure-key"
    assert seen["body"]["model"] == "gpt-5.6-terra" and seen["body"]["stream"]
    assert seen["body"]["max_completion_tokens"] and "max_tokens" not in seen["body"]
    assert seen["body"]["messages"][0] == {"role": "system", "content": "sys"}


def test_azure_openai_test_connection_checks_the_deployment(monkeypatch):
    monkeypatch.setitem(ai.PROVIDERS["azure_openai"], "models", [])

    def ok(request):
        assert str(request.url) == AZURE + "/chat/completions"
        assert json.loads(request.content)["model"] == "my-deployment"
        return httpx.Response(200, json={"choices": [{"message": {"content": "pong"}}]})

    config = ai.AIConfig("azure_openai", "k", "my-deployment", endpoint=AZURE)
    models = asyncio.run(ai.list_models(config, transport=httpx.MockTransport(ok)))
    assert models == [{"id": "my-deployment", "name": "my-deployment (deployment)"}]

    def missing(request):
        return httpx.Response(404, json={"error": {"code": "DeploymentNotFound", "message": "No deployment"}})

    with pytest.raises(ai.AIError, match="deployment name"):
        asyncio.run(ai.list_models(config, transport=httpx.MockTransport(missing)))

    def denied(request):
        return httpx.Response(401, json={"error": {"code": "401", "message": "Access denied due to invalid key"}})

    with pytest.raises(ai.AIError, match="rejected the credentials"):
        asyncio.run(ai.list_models(config, transport=httpx.MockTransport(denied)))


def test_azure_openai_detects_every_allowed_deployment(monkeypatch):
    monkeypatch.setitem(ai.PROVIDERS["azure_openai"], "models", ["gpt-5", "gpt-5-mini", "o4-mini"])

    def handler(request):
        if json.loads(request.content)["model"] == "o4-mini":
            return httpx.Response(404, json={"error": {"code": "DeploymentNotFound", "message": "No deployment"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": "pong"}}]})

    config = ai.AIConfig("azure_openai", "k", "gpt-5-mini", endpoint=AZURE)
    models = asyncio.run(ai.list_models(config, transport=httpx.MockTransport(handler)))
    assert [m["id"] for m in models] == ["gpt-5-mini", "gpt-5"]


def test_anthropic_models_follow_pagination():
    pages = []

    def handler(request):
        pages.append(dict(request.url.params))
        if "after_id" not in request.url.params:
            return httpx.Response(200, json={"data": [{"id": "m1"}], "has_more": True, "last_id": "m1"})
        return httpx.Response(200, json={"data": [{"id": "m2"}], "has_more": False, "last_id": "m2"})

    models = asyncio.run(ai.list_models(ai.AIConfig("anthropic", "k"), transport=httpx.MockTransport(handler)))
    assert [m["id"] for m in models] == ["m1", "m2"]
    assert pages[1]["after_id"] == "m1"


# ── Project side ─────────────────────────────────────────────────────────────

def test_parse_changes_handles_multiple_files_and_nested_fences():
    text = """Intro
```file:tests/a.spec.js
test('a', () => {});
```
Some text
````file:docs/guide.md
# Guide
```js
code();
```
````
```file:tests/a.spec.js
test('a2', () => {});
```"""
    changes = {c["path"]: c["content"] for c in pa.parse_changes(text)}
    assert changes["tests/a.spec.js"] == "test('a2', () => {});\n"
    assert "```js\ncode();\n```" in changes["docs/guide.md"]
    stripped = pa.strip_file_blocks(text)
    assert "[proposed full content of docs/guide.md omitted]" in stripped and "code();" not in stripped


@pytest.mark.parametrize("bad", ["../x.js", "/etc/passwd", "C:/x", ".git/config", "", "a/../../b"])
def test_resolve_project_path_rejects_escapes(tmp_path, bad):
    with pytest.raises(pa.ProjectAIError):
        pa.resolve_project_path(tmp_path, bad)


def test_resolve_project_path_rejects_symlink_escape(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "link").symlink_to(outside)
    with pytest.raises(pa.ProjectAIError, match="outside"):
        pa.resolve_project_path(repo, "link/file.txt")


def test_mask_secrets_keeps_placeholders():
    text = ('password=abc\n"apiToken": "xyz",\nurl=https://u:p4ss@host/x\n<secretKey>v</secretKey>\n'
            'token: {{token}}\nname=x')
    masked = pa.mask_secrets(text)
    assert masked.split("\n") == ['password=***', '"apiToken": "***",', 'url=https://u:***@host/x',
                                  '<secretKey>***</secretKey>', 'token: {{token}}', 'name=x']


def test_sensitive_files_are_never_read(tmp_path):
    (tmp_path / ".env").write_text("SECRET=1")
    (tmp_path / "id_rsa").write_text("key")
    for name in (".env", "id_rsa"):
        with pytest.raises(pa.ProjectAIError, match="never sent"):
            pa.read_project_file(tmp_path, name)


def test_apply_preview_undo_roundtrip(tmp_path):
    (tmp_path / "a.txt").write_bytes(b"one\r\ntwo\r\n")
    preview = pa.preview_change(tmp_path, "a.txt", "one\nTWO\n")
    assert preview["status"] == "modify" and preview["added"] == 1 and preview["removed"] == 1
    with pytest.raises(pa.ProjectAIError) as conflict:
        pa.apply_change(tmp_path, "a.txt", "x\n", expected_sha="stale")
    assert conflict.value.status_code == 409
    applied = pa.apply_change(tmp_path, "a.txt", "one\nTWO\n", preview["current_sha"])
    assert (tmp_path / "a.txt").read_bytes() == b"one\r\nTWO\r\n"  # keeps CRLF
    pa.undo_change(tmp_path, "a.txt", applied["previous"], True, applied["applied_sha"])
    assert (tmp_path / "a.txt").read_bytes() == b"one\r\ntwo\r\n"

    created = pa.apply_change(tmp_path, "new/dir/b.js", "x\n", None)
    assert (tmp_path / "new/dir/b.js").is_file() and created["previous_existed"] is False
    (tmp_path / "new/dir/b.js").write_text("edited by user\n")
    with pytest.raises(pa.ProjectAIError, match="edited after"):
        pa.undo_change(tmp_path, "new/dir/b.js", None, False, created["applied_sha"])


def test_analysis_and_prompt_on_a_starter(tmp_path):
    from app.services import scaffold_service

    repo = scaffold_service.create_project(tmp_path / "pw", "playwright", "javascript", "Demo", "a", "a@b.c")
    (repo / "secrets.properties").write_text("user=me\npassword=hunter2\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    analysis = pa.analyze(repo)
    assert "Playwright" in analysis["frameworks"] and analysis["test_files"] == ["tests/web-form.spec.js"]
    assert analysis["git"]["branch"] == "main" and analysis["git"]["changed_count"] == 1
    prompt, included = pa.build_system_prompt(repo, analysis, ["secrets.properties"])
    assert "```file:" in prompt and "tests/web-form.spec.js" in included and "package.json" in included
    assert "password=***" in prompt and "hunter2" not in prompt


def test_run_failure_summary_and_history():
    run = {"name": "Run 5", "status": "failed", "passed": 1, "failed": 1, "skipped": 0,
           "details": {"command": ["npx", "playwright", "test"]},
           "results": [{"status": "failed", "class_name": "spec", "test_name": "login", "error_message": "boom",
                        "stack_trace": "at line 3"}],
           "logs": [{"type": "stdout", "data": f"line {i}"} for i in range(200)] + [{"type": "status", "status": "x"}]}
    summary = pa.run_failure_summary(run)
    assert "spec › login: boom" in summary and "line 199" in summary and "line 49" not in summary
    messages = [pa.new_message("assistant", "orphan"), pa.new_message("user", "q", model_content="q + run"),
                pa.new_message("assistant", "a\n```file:x.js\ncode\n```"), pa.new_message("user", "q2"),
                pa.new_message("assistant", "a2"), pa.new_message("user", "q3")]
    history = pa.history_for_model(messages)
    assert history[0] == {"role": "user", "content": "q + run"}
    assert "omitted" in history[1]["content"] and history[-1]["content"] == "q3"


def test_conversation_store(tmp_path):
    store = pa.ConversationStore(tmp_path, 7, 3)
    conversation = store.create("First")
    conversation["messages"].append(pa.new_message("user", "hello"))
    store.save(conversation)
    assert [c["messages"] for c in store.list()] == [1]
    assert store.load(conversation["id"])["title"] == "First"
    with pytest.raises(pa.ProjectAIError):
        store.load("../../etc")
    store.delete(conversation["id"])
    assert store.list() == []
    assert Path(tmp_path / "ai-chats" / "7" / "3").is_dir()


def test_saved_azure_key_is_only_reused_for_the_same_endpoint():
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.modules.settings.connections import set_json
    from app.modules.workspace import assistant_router as ai_routes

    user = SimpleNamespace(settings_json={}, connections=[])
    set_json(user, "ai_assistant", {"provider": "azure_openai", "api_key": "saved-key", "model": "gpt-5-mini",
                                    "endpoint": AZURE})
    same = ai_routes.AISettingsRequest(provider="azure_openai", endpoint=AZURE + "/", model="gpt-5-mini")
    config = asyncio.run(ai_routes._active_config(user, None, same))
    assert (config.api_key, config.endpoint, config.model) == ("saved-key", AZURE, "gpt-5-mini")

    other = ai_routes.AISettingsRequest(provider="azure_openai", endpoint="https://evil.example.com/openai/v1")
    config = asyncio.run(ai_routes._active_config(user, None, other))
    assert config.api_key == "" and config.model == ai.PROVIDERS["azure_openai"]["default_model"]

    with pytest.raises(HTTPException):
        asyncio.run(ai_routes._active_config(user, None, ai_routes.AISettingsRequest(
            provider="azure_openai", endpoint="http://insecure.example.com")))


def test_azure_deployment_must_be_in_the_allowed_list():
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.modules.workspace import assistant_router as ai_routes

    assert ai.PROVIDERS["azure_openai"]["models"] == [
        "gpt-4.1", "gpt-4o-mini", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.4", "gpt-5.6-terra", "o4-mini"]
    assert ai.PROVIDERS["azure_openai"]["default_model"] in ai.PROVIDERS["azure_openai"]["models"]
    user = SimpleNamespace(settings_json={}, connections=[])
    for model in ai.PROVIDERS["azure_openai"]["models"]:
        request = ai_routes.AISettingsRequest(provider="azure_openai", endpoint=AZURE, model=model, api_key="k")
        assert asyncio.run(ai_routes._active_config(user, None, request)).model == model
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ai_routes._active_config(user, None, ai_routes.AISettingsRequest(
            provider="azure_openai", endpoint=AZURE, model="gpt-4-32k", api_key="k")))
    assert exc.value.status_code == 400 and "o4-mini" in exc.value.detail


def test_change_review_apply_partial_and_reject(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.modules.workspace import assistant_router as ai_routes

    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.txt").write_text("one\ntwo\n")
    store = pa.ConversationStore(tmp_path / "artifacts", 1, 5)
    conversation = store.create("t")
    message = pa.new_message("assistant", "x", changes=[
        {"path": "a.txt", "content": "one\nTWO\nthree\n", "state": "proposed"},
        {"path": "b.txt", "content": "new\n", "state": "proposed"}])
    conversation["messages"].append(message)
    store.save(conversation)
    monkeypatch.setattr(ai_routes, "check_organization_member", lambda user: None)
    monkeypatch.setattr(ai_routes, "get_project_or_404", lambda db, pid: None)
    monkeypatch.setattr(ai_routes, "require_checkout", lambda user, pid: repo)
    monkeypatch.setattr(ai_routes, "_repo_or_none", lambda user, pid: repo)
    monkeypatch.setattr(ai_routes, "_store", lambda user, pid: store)
    user = SimpleNamespace(id=1, role="editor")
    cid, mid = conversation["id"], message["id"]

    review = asyncio.run(ai_routes.get_ai_change_content(5, cid, mid, "a.txt", user, None))
    assert (review["original"], review["proposed"], review["exists"]) == ("one\ntwo\n", "one\nTWO\nthree\n", True)

    request = ai_routes.ChangeRequest(message_id=mid, path="a.txt", expected_sha=review["current_sha"],
                                      content="one\nTWO\n")
    asyncio.run(ai_routes.apply_ai_change(5, cid, request, user, None))
    assert (repo / "a.txt").read_text() == "one\nTWO\n"  # only the accepted hunk

    asyncio.run(ai_routes.reject_ai_change(5, cid, ai_routes.ChangeRequest(message_id=mid, path="b.txt"), user, None))
    states = {c["path"]: c["state"] for c in store.load(cid)["messages"][-1]["changes"]}
    assert states == {"a.txt": "applied", "b.txt": "rejected"} and not (repo / "b.txt").exists()
    with pytest.raises(HTTPException):
        asyncio.run(ai_routes.reject_ai_change(5, cid, ai_routes.ChangeRequest(message_id=mid, path="a.txt"),
                                               user, None))
