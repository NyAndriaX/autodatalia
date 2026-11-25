import json

import httpx

from app.config import settings
from app.services import _with_google_thinking_disabled

GOOGLE = "https://generativelanguage.googleapis.com/v1beta/openai"
OPENROUTER = "https://openrouter.ai/api/v1"


def test_google_flash_gets_thinking_disabled():
    out = _with_google_thinking_disabled({"model": "gemini-3.5-flash"}, GOOGLE)
    assert out["reasoning_effort"] == "none"


def test_pro_openrouter_image_and_explicit_value_untouched():
    assert "reasoning_effort" not in _with_google_thinking_disabled({"model": "gemini-pro-latest"}, GOOGLE)
    assert "reasoning_effort" not in _with_google_thinking_disabled({"model": "google/gemini-2.5-flash"}, OPENROUTER)
    assert "reasoning_effort" not in _with_google_thinking_disabled({"model": "gemini-3.1-flash-image"}, GOOGLE)
    # "lite" models reject reasoning_effort="none" with a 400.
    assert "reasoning_effort" not in _with_google_thinking_disabled({"model": "gemini-3.5-flash-lite"}, GOOGLE)
    explicit = {"model": "gemini-3.5-flash", "reasoning_effort": "low"}
    assert _with_google_thinking_disabled(explicit, GOOGLE)["reasoning_effort"] == "low"


def test_generate_sends_reasoning_effort_none_to_google(workspace_client, monkeypatch):
    monkeypatch.setattr(settings, "ai_api_base_url", GOOGLE)
    monkeypatch.setattr(settings, "ai_model", "gemini-3.5-flash")
    monkeypatch.setattr(settings, "ai_model_premium", "gemini-3.5-flash")
    sent = {}

    async def fake_post(self, url, *args, **kwargs):
        sent["url"] = url
        sent["json"] = kwargs.get("json")
        body = {
            "choices": [{"message": {"content": json.dumps({"variants": [{"text": "Hello", "tone": "fun"}]})}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    r = workspace_client.post("/generate", json={"prompt": "Launch", "platforms": {"facebook": True}})
    assert r.status_code == 200, r.text
    assert sent["url"].startswith(GOOGLE)
    assert sent["json"]["reasoning_effort"] == "none"


def test_post_chat_retries_without_injected_option_on_400(workspace_client, monkeypatch):
    monkeypatch.setattr(settings, "ai_api_base_url", GOOGLE)
    monkeypatch.setattr(settings, "ai_model", "gemini-9-flash")
    monkeypatch.setattr(settings, "ai_model_premium", "gemini-9-flash")
    bodies = []

    async def fake_post(self, url, *args, **kwargs):
        body = kwargs.get("json")
        bodies.append(body)
        req = httpx.Request("POST", url)
        if "reasoning_effort" in body:
            return httpx.Response(400, json={"error": {"message": "invalid argument"}}, request=req)
        content = json.dumps({"variants": [{"text": "Hello", "tone": "fun"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}], "usage": {}}, request=req)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    r = workspace_client.post("/generate", json={"prompt": "Launch", "platforms": {"facebook": True}})
    assert r.status_code == 200, r.text
    assert [("reasoning_effort" in b) for b in bodies] == [True, False]
