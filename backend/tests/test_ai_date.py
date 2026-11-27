import json
from datetime import datetime

import httpx

from app import services
from app.config import settings


class _FixedNow:
    """Stand-in for services._today_local() pinned to a known day."""

    @staticmethod
    def value():
        return datetime(2026, 11, 27, 10, 0)


def test_date_is_appended_to_the_system_message(monkeypatch):
    monkeypatch.setattr(services, "_today_local", _FixedNow.value)
    out = services._with_current_date(
        {"messages": [{"role": "system", "content": "You write posts."}, {"role": "user", "content": "hi"}]}
    )
    system = out["messages"][0]["content"]
    assert system.startswith("You write posts.")
    assert "2026-11-27" in system and "Friday 27 November 2026" in system
    assert out["messages"][1] == {"role": "user", "content": "hi"}
    # Idempotent: applying twice doesn't duplicate the note.
    assert services._with_current_date(out)["messages"][0]["content"] == system


def test_system_message_is_added_when_missing(monkeypatch):
    monkeypatch.setattr(services, "_today_local", _FixedNow.value)
    out = services._with_current_date({"messages": [{"role": "user", "content": "hi"}]})
    assert out["messages"][0]["role"] == "system"
    assert "2026-11-27" in out["messages"][0]["content"]


def test_cache_key_changes_with_the_day(monkeypatch):
    monkeypatch.setattr(services, "_today_local", lambda: datetime(2026, 11, 27))
    today = services._cache_key("generate", "same prompt")
    monkeypatch.setattr(services, "_today_local", lambda: datetime(2026, 11, 28))
    assert services._cache_key("generate", "same prompt") != today


def test_generate_sends_todays_date_to_the_model(workspace_client, monkeypatch):
    monkeypatch.setattr(services, "_today_local", _FixedNow.value)
    sent = {}

    async def fake_post(self, url, *args, **kwargs):
        sent["json"] = kwargs.get("json")
        content = json.dumps({"variants": [{"text": "Hello", "tone": "fun"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}], "usage": {}},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    r = workspace_client.post("/generate", json={"prompt": "Launch", "platforms": {"facebook": True}})
    assert r.status_code == 200, r.text
    assert "2026-11-27" in sent["json"]["messages"][0]["content"]
