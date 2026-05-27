"""End-to-end route tests for the public Caption API surface."""

import asyncio
import httpx
import pytest

from app.config import settings
from app.oauth import _save_tokens
from app import telegram_validation as tg
from app import media_generation as mg
from app.publish import publish_linkedin
from app.services import messages_list, posts_list


# ── Health & basic openness ──────────────────────────────────────────

def test_health_is_open(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_tunnel_status_is_open_and_reports_disabled(client):
    r = client.get("/tunnel-status")
    assert r.status_code == 200
    assert r.json()["tunnel_ready"] is False


# ── /transform action validation ─────────────────────────────────────

def test_transform_unknown_action_returns_422(client):
    r = client.post("/transform", json={"content": "x", "action": "professional"})
    assert r.status_code == 422
    body = r.json()
    assert body["detail"]["message"] == "Unknown action."
    assert "shorten" in body["detail"]["allowed_actions"]
    assert "expand" in body["detail"]["allowed_actions"]


# ── /search behaviour ────────────────────────────────────────────────

def test_search_empty_dir_returns_empty_array(client):
    r = client.get("/search?q=anything")
    assert r.status_code == 200
    assert r.json() == {"results": []}


def test_search_empty_query_returns_listing(client):
    # Drop a fake image into the content dir so the listing has something.
    fake = settings.content_dir / "hello.png"
    fake.write_bytes(b"fake png bytes")
    try:
        r = client.get("/search?q=")
        assert r.status_code == 200
        titles = [h["title"] for h in r.json()["results"]]
        assert "hello.png" in titles
    finally:
        fake.unlink(missing_ok=True)


# ── /posts CRUD ──────────────────────────────────────────────────────

def test_posts_crud_lifecycle(client):
    # Initial state.
    assert client.get("/posts").json() == {"posts": []}

    # Create.
    r = client.post(
        "/posts",
        json={
            "scheduledDate": "2026-06-01",
            "content": "hello",
            "platforms": {"facebook": True},
        },
    )
    assert r.status_code == 200
    post = r.json()
    pid = post["id"]
    assert post["content"] == "hello"
    assert post["status"] == "draft"  # default
    assert post["platforms"]["facebook"] is True

    # List sees the new post.
    listed = client.get("/posts").json()["posts"]
    assert len(listed) == 1
    assert listed[0]["id"] == pid

    # Partial update — other fields are preserved.
    r = client.patch(f"/posts/{pid}", json={"status": "approved", "time": "10:00"})
    assert r.status_code == 200
    updated = r.json()
    assert updated["status"] == "approved"
    assert updated["time"] == "10:00"
    assert updated["content"] == "hello"  # untouched
    assert updated["scheduledDate"] == "2026-06-01"  # untouched

    # PATCH with all-None values should not destroy existing data.
    r = client.patch(f"/posts/{pid}", json={})
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

    # Delete.
    assert client.delete(f"/posts/{pid}").status_code == 200
    # Second delete → 404.
    assert client.delete(f"/posts/{pid}").status_code == 404
    # PATCH on missing → 404.
    assert client.patch(f"/posts/{pid}", json={"status": "x"}).status_code == 404


def test_posts_create_with_explicit_id(client):
    r = client.post(
        "/posts",
        json={"id": "cal-frontend-123", "scheduledDate": "2026-06-02"},
    )
    assert r.status_code == 200
    assert r.json()["id"] == "cal-frontend-123"


def test_posts_persist_across_requests(client):
    client.post("/posts", json={"scheduledDate": "2026-06-01", "content": "A"})
    client.post("/posts", json={"scheduledDate": "2026-06-02", "content": "B"})
    listed = client.get("/posts").json()["posts"]
    contents = sorted(p["content"] for p in listed)
    assert contents == ["A", "B"]


# ── Auth gate ────────────────────────────────────────────────────────

def test_auth_open_mode_allows_everything(client):
    # No BACKEND_AUTH_TOKEN configured → mutating routes are reachable.
    r = client.post("/posts", json={"scheduledDate": "2026-06-01"})
    assert r.status_code == 200


def test_auth_required_when_token_set(client):
    settings.backend_auth_token = "secret-day3"

    # No token → 401.
    r = client.post("/posts", json={"scheduledDate": "2026-06-01"})
    assert r.status_code == 401

    # Wrong token → 401.
    r = client.post(
        "/posts",
        json={"scheduledDate": "2026-06-01"},
        headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 401

    # Correct token → 200.
    r = client.post(
        "/posts",
        json={"scheduledDate": "2026-06-01"},
        headers={"Authorization": "Bearer secret-day3"},
    )
    assert r.status_code == 200


def test_auth_open_routes_stay_open_with_token_set(client):
    settings.backend_auth_token = "secret-day3"
    # /health, /posts (GET), /search, /tunnel-status stay public.
    assert client.get("/health").status_code == 200
    assert client.get("/posts").status_code == 200
    assert client.get("/search?q=x").status_code == 200
    assert client.get("/tunnel-status").status_code == 200


def test_auth_query_token_fallback(client):
    """Form uploads can authenticate via ?token= when headers are awkward."""
    settings.backend_auth_token = "qtok"

    r = client.post("/posts", json={"scheduledDate": "2026-06-01"})
    assert r.status_code == 401

    r = client.post(
        "/posts?token=qtok",
        json={"scheduledDate": "2026-06-01"},
    )
    assert r.status_code == 200


# ── /transform cache (token conservation proof) ──────────────────────


class _FakeChatResponse:
    """Mock httpx response — mirrors OpenAI-compatible chat shape."""

    status_code = 200

    def __init__(self, text="rewritten text", total_tokens=42):
        self._text = text
        self._tokens = total_tokens

    def json(self):
        return {
            "choices": [{"message": {"content": self._text}}],
            "usage": {
                "prompt_tokens": 20,
                "completion_tokens": self._tokens - 20,
                "total_tokens": self._tokens,
            },
        }


def test_transform_cache_returns_zero_tokens_on_repeat(client, monkeypatch):
    call_count = {"n": 0}

    async def fake_post(self, url, **kwargs):
        call_count["n"] += 1
        return _FakeChatResponse(text="short post", total_tokens=98)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    body = {"content": "a long-ish original post that we want to shorten", "action": "shorten"}
    r1 = client.post("/transform", json=body)
    assert r1.status_code == 200
    assert r1.json()["usage"]["total_tokens"] == 98
    assert r1.json()["text"] == "short post"
    assert call_count["n"] == 1

    # Identical second call: cached, no upstream call, zero usage.
    r2 = client.post("/transform", json=body)
    assert r2.status_code == 200
    assert r2.json()["usage"]["total_tokens"] == 0
    assert r2.json()["text"] == "short post"
    assert call_count["n"] == 1  # the AI was NOT called a second time


def test_generate_returns_cached_variants(client, monkeypatch):
    payload_text = '{"variants":[{"text":"variant one","tone":"casual"}]}'
    call_count = {"n": 0}

    async def fake_post(self, url, **kwargs):
        call_count["n"] += 1
        return _FakeChatResponse(text=payload_text, total_tokens=120)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    body = {"prompt": "test prompt for caching", "platforms": {"facebook": True}, "variants": 1}
    r1 = client.post("/generate", json=body)
    assert r1.status_code == 200
    assert r1.json()["usage"]["total_tokens"] == 120
    assert r1.json()["variants"][0]["text"] == "variant one"

    r2 = client.post("/generate", json=body)
    assert r2.status_code == 200
    assert r2.json()["usage"]["total_tokens"] == 0  # cache hit
    assert call_count["n"] == 1


def test_validation_submit_creates_pending_post_and_message(client, monkeypatch):
    settings.telegram_bot_token = "telegram-test"
    settings.telegram_default_chat_id = "12345"

    async def fake_send_validation_card(post, chat_id):
        assert chat_id == "12345"
        assert post["status"] == "pending"
        return 321

    monkeypatch.setattr(tg, "_send_validation_card", fake_send_validation_card)

    r = client.post(
        "/validation/submit",
        json={
            "content": "Need approval",
            "platforms": {"linkedin": True},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pending"
    assert body["message_id"] == 321
    posts = posts_list()
    assert len(posts) == 1
    assert posts[0]["status"] == "pending"
    feed = messages_list()
    assert any("Telegram validation" in m["message"] or "Submitted post" in m["message"] for m in feed)


def test_telegram_webhook_approve_updates_post(client, monkeypatch):
    settings.telegram_bot_token = "telegram-test"
    # Clear the webhook secret so the handler doesn't require the
    # X-Telegram-Bot-Api-Secret-Token header — this test exercises the
    # callback handling logic, not the auth path.
    settings.telegram_webhook_secret = ""
    post = tg.posts_create(
        {
            "id": "post-1",
            "content": "approve me",
            "platforms": {"facebook": True},
            "status": "pending",
            "scheduledDate": "2026-06-01",
        }
    )

    async def fake_answer_callback(callback_query_id, text=""):
        assert callback_query_id == "cb_1"

    monkeypatch.setattr(tg, "_answer_callback", fake_answer_callback)

    r = client.post(
        "/telegram/webhook",
        json={
            "callback_query": {
                "id": "cb_1",
                "data": "va|a|post-1",
                "message": {"chat": {"id": 123}},
            }
        },
    )
    assert r.status_code == 200
    refreshed = next(p for p in posts_list() if p["id"] == post["id"])
    assert refreshed["status"] == "approved"


def test_media_generate_image_uses_fallback_and_persists_asset(client):
    settings.ai_image_model = ""
    r = client.post(
        "/media/generate/image",
        json={"prompt": "Blue launch poster", "ratio": "1:1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "image"
    assert body["provider"] == "fallback-poster"
    assert (settings.content_dir / "generated" / body["filename"]).exists()


def test_media_generate_video_persists_motion_asset(client, monkeypatch):
    async def fake_render_motion_video(source, dest, width, height, duration_seconds):
        dest.write_bytes(b"fake-mp4")

    monkeypatch.setattr(mg, "_render_motion_video", fake_render_motion_video)
    settings.ai_image_model = ""
    r = client.post(
        "/media/generate/video",
        json={"prompt": "Motion teaser", "ratio": "9:16", "duration_seconds": 6},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "video"
    assert body["provider"] == "fallback-poster+motion"
    assert (settings.content_dir / "generated" / body["filename"]).exists()


def test_oauth_connections_surfaces_linkedin_target(client):
    _save_tokens(
        {
            "linkedin": {
                "access_token": "lk",
                "urn": "urn:li:person:abc123",
                "display_name": "Alice LinkedIn",
                "avatar_url": "https://example.com/alice.jpg",
                "raw": {"urn": "urn:li:person:abc123"},
            }
        }
    )
    r = client.get("/oauth/connections")
    assert r.status_code == 200
    targets = r.json()["providers"]["linkedin"]["targets"]
    assert targets[0]["id"] == "urn:li:person:abc123"
    assert targets[0]["kind"] == "linkedin_member"


def test_publish_linkedin_text_success(monkeypatch):
    class _Resp:
        status_code = 201
        text = '{"id":"urn:li:share:1"}'

        def json(self):
            return {"id": "urn:li:share:1"}

    async def fake_post(self, url, **kwargs):
        assert url == "https://api.linkedin.com/rest/posts"
        return _Resp()

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    result = asyncio.run(
        publish_linkedin(
            "urn:li:person:abc123",
            "token",
            label="Alice LinkedIn",
            content="Hello LinkedIn",
        )
    )
    assert result.ok is True
    assert result.platform_post_id == "urn:li:share:1"
