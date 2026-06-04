"""End-to-end route tests for the public Caption API surface."""

import asyncio
import httpx
import pytest

from app.config import settings
from app.auth import create_jwt_token
from app.oauth import _save_tokens
from app import telegram_validation as tg
from app import media_generation as mg
from app.publish import publish_linkedin
from app.services import automation_create, automation_get, messages_list, posts_list


def _auth_headers_for_user(user_id: int) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_jwt_token(user_id)}"}


# ── Health & basic openness ──────────────────────────────────────────

def test_health_is_open(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "dependencies": {"postgres": "ok"}}


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


def test_business_read_routes_require_auth_with_token_set(client):
    settings.backend_auth_token = "secret-day3"
    # Health and tunnel probes stay public.
    assert client.get("/health").status_code == 200
    assert client.get("/tunnel-status").status_code == 200
    # Business-data reads require auth in production token/JWT mode.
    assert client.get("/posts").status_code == 401
    assert client.get("/search?q=x").status_code == 401
    assert client.get("/dashboard-summary").status_code == 401
    assert client.get("/settings/keys").status_code == 401
    assert client.get(
        "/posts",
        headers={"Authorization": "Bearer secret-day3"},
    ).status_code == 200


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


def test_settings_keys_are_isolated_per_jwt_user(client):
    user_a = _auth_headers_for_user(7)
    user_b = _auth_headers_for_user(8)

    patch_a = client.patch(
        "/settings/keys",
        headers=user_a,
        json={
            "updates": {
                "FAL_API_KEY": "fal-user-a-secret",
                "TELEGRAM_DEFAULT_CHAT_ID": "111222333",
                "AI_MODEL_FAST": "user-a-fast-model",
            }
        },
    )
    assert patch_a.status_code == 200
    keys_a = patch_a.json()["keys"]
    assert keys_a["TELEGRAM_DEFAULT_CHAT_ID"]["value"] == "111222333"
    assert keys_a["AI_MODEL_FAST"]["value"] == "user-a-fast-model"

    get_b = client.get("/settings/keys", headers=user_b)
    assert get_b.status_code == 200
    keys_b = get_b.json()["keys"]
    assert keys_b["TELEGRAM_DEFAULT_CHAT_ID"]["value"] != "111222333"
    assert keys_b["AI_MODEL_FAST"]["value"] != "user-a-fast-model"


def test_settings_keys_user_override_falls_back_to_global_defaults(client):
    shared = client.patch(
        "/settings/keys",
        json={"updates": {"TELEGRAM_DEFAULT_CHAT_ID": "shared-chat"}},
    )
    assert shared.status_code == 200

    user_headers = _auth_headers_for_user(9)
    inherited = client.get("/settings/keys", headers=user_headers)
    assert inherited.status_code == 200
    assert inherited.json()["keys"]["TELEGRAM_DEFAULT_CHAT_ID"]["value"] == "shared-chat"

    override = client.patch(
        "/settings/keys",
        headers=user_headers,
        json={"updates": {"TELEGRAM_DEFAULT_CHAT_ID": "private-chat"}},
    )
    assert override.status_code == 200
    assert override.json()["keys"]["TELEGRAM_DEFAULT_CHAT_ID"]["value"] == "private-chat"

    shared_after = client.get("/settings/keys")
    assert shared_after.status_code == 200
    assert shared_after.json()["keys"]["TELEGRAM_DEFAULT_CHAT_ID"]["value"] == "shared-chat"


def test_registration_closes_after_first_admin(client, monkeypatch):
    monkeypatch.setattr("app.auth.count_users", lambda: 1)

    r = client.post(
        "/auth/register",
        json={"email": "new@example.com", "password": "secret123", "name": "New"},
    )

    assert r.status_code == 403
    assert "closed" in r.json()["detail"]


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


def test_transform_uses_saved_model_for_authenticated_user(client, monkeypatch):
    headers = _auth_headers_for_user(11)
    save = client.patch(
        "/settings/keys",
        headers=headers,
        json={"updates": {"AI_MODEL_FAST": "per-user-fast-model"}},
    )
    assert save.status_code == 200

    async def fake_post(self, url, **kwargs):
        assert kwargs["json"]["model"] == "per-user-fast-model"
        return _FakeChatResponse(text="user scoped rewrite", total_tokens=31)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    r = client.post(
        "/transform",
        headers=headers,
        json={"content": "Need a shorter version", "action": "shorten"},
    )
    assert r.status_code == 200
    assert r.json()["text"] == "user scoped rewrite"


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


def test_validation_submit_uses_saved_user_telegram_settings(client, monkeypatch):
    headers = _auth_headers_for_user(12)
    save = client.patch(
        "/settings/keys",
        headers=headers,
        json={
            "updates": {
                "TELEGRAM_BOT_TOKEN": "telegram-user-12-token",
                "TELEGRAM_DEFAULT_CHAT_ID": "424242",
            }
        },
    )
    assert save.status_code == 200

    async def fake_send_validation_card(post, chat_id):
        assert chat_id == "424242"
        assert post["user_id"] == "12"
        return 654

    monkeypatch.setattr(tg, "_send_validation_card", fake_send_validation_card)

    r = client.post(
        "/validation/submit",
        headers=headers,
        json={
            "content": "Need approval",
            "platforms": {"linkedin": True},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["chat_id"] == "424242"
    assert body["message_id"] == 654


def test_telegram_webhook_approve_schedules_automation_post(client, monkeypatch):
    settings.telegram_bot_token = "telegram-test"
    # Clear the webhook secret so the handler doesn't require the
    # X-Telegram-Bot-Api-Secret-Token header — this test exercises the
    # callback handling logic, not the auth path.
    settings.telegram_webhook_secret = ""
    rule = automation_create(
        {
            "id": "rule-1",
            "name": "Rule 1",
            "active": True,
            "content_type": "photo",
            "num_media": {"mode": "fixed", "count": 1, "min": 2, "max": 4},
            "domain": "test",
            "target_audience": "test",
            "tone": "",
            "objective": "informative",
            "description_style": "",
            "extra_brief": "",
            "schedule": {
                "frequency": "daily",
                "times": ["10:00"],
                "weekdays": None,
                "month_days": None,
                "timezone": "Africa/Lagos",
            },
            "validation_lead_minutes": 30,
            "validation_chat_id": "12345",
            "platforms": {"facebook": True},
            "ratios": None,
            "tiktok": None,
        }
    )
    post = tg.posts_create(
        {
            "id": "post-1",
            "content": "approve me",
            "platforms": {"facebook": True},
            "status": "pending",
            "scheduledDate": "2026-06-01",
            "source_rule_id": "rule-1",
            "source_rule_updated_at": rule["updated_at"],
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
    assert refreshed["status"] == "scheduled"


def test_patch_automation_rule_cancels_open_generated_posts_and_resets_fire_cursor(client):
    create = client.post(
        "/automation-rules",
        json={
            "name": "Morning posts",
            "active": True,
            "content_type": "photo",
            "num_media": {"mode": "fixed", "count": 1, "min": 2, "max": 4},
            "domain": "coffee",
            "target_audience": "commuters",
            "tone": "",
            "objective": "informative",
            "description_style": "",
            "extra_brief": "",
            "schedule": {
                "frequency": "daily",
                "times": ["10:00"],
                "weekdays": None,
                "month_days": None,
                "timezone": "Africa/Lagos",
            },
            "validation_lead_minutes": 30,
            "validation_chat_id": "12345",
            "platforms": {"facebook": True},
            "ratios": None,
            "tiktok": None,
        },
    )
    assert create.status_code == 200
    rule = create.json()

    tg.posts_create(
        {
            "id": "auto-post-1",
            "content": "candidate",
            "platforms": {"facebook": True},
            "status": "awaiting_validation",
            "scheduledDate": "2026-06-05",
            "time": "10:00",
            "timezone": "Africa/Lagos",
            "source_rule_id": rule["id"],
            "source_rule_name": rule["name"],
            "source_rule_updated_at": rule["updated_at"],
            "scheduled_for": 1780650000.0,
        }
    )

    rule["schedule"]["times"] = ["11:30"]
    patch = client.patch(f"/automation-rules/{rule['id']}", json=rule)
    assert patch.status_code == 200

    post = next(p for p in posts_list() if p["id"] == "auto-post-1")
    assert post["status"] == "cancelled"
    assert post["error"] == "rule_changed_after_generation"

    stored_rule = automation_get(rule["id"])
    assert stored_rule is not None
    assert stored_rule["last_fire_at"] == 0


def test_telegram_webhook_rejects_stale_automation_approval(client, monkeypatch):
    settings.telegram_bot_token = "telegram-test"
    settings.telegram_webhook_secret = ""

    create = client.post(
        "/automation-rules",
        json={
            "name": "Evening posts",
            "active": True,
            "content_type": "photo",
            "num_media": {"mode": "fixed", "count": 1, "min": 2, "max": 4},
            "domain": "travel",
            "target_audience": "families",
            "tone": "",
            "objective": "promotional",
            "description_style": "",
            "extra_brief": "",
            "schedule": {
                "frequency": "daily",
                "times": ["19:00"],
                "weekdays": None,
                "month_days": None,
                "timezone": "Africa/Lagos",
            },
            "validation_lead_minutes": 30,
            "validation_chat_id": "12345",
            "platforms": {"facebook": True},
            "ratios": None,
            "tiktok": None,
        },
    )
    assert create.status_code == 200
    rule = create.json()

    tg.posts_create(
        {
            "id": "auto-post-2",
            "content": "candidate",
            "platforms": {"facebook": True},
            "status": "awaiting_validation",
            "scheduledDate": "2026-06-05",
            "time": "19:00",
            "timezone": "Africa/Lagos",
            "source_rule_id": rule["id"],
            "source_rule_name": rule["name"],
            "source_rule_updated_at": rule["updated_at"] - 1,
            "scheduled_for": 1780682400.0,
        }
    )

    answered = {"text": None}

    async def fake_answer_callback(callback_query_id, text=""):
        assert callback_query_id == "cb_stale"
        answered["text"] = text

    monkeypatch.setattr(tg, "_answer_callback", fake_answer_callback)

    r = client.post(
        "/telegram/webhook",
        json={
            "callback_query": {
                "id": "cb_stale",
                "data": "va|a|auto-post-2",
                "message": {"chat": {"id": 123}},
            }
        },
    )
    assert r.status_code == 200

    refreshed = next(p for p in posts_list() if p["id"] == "auto-post-2")
    assert refreshed["status"] == "cancelled"
    assert refreshed["error"] == "rule_changed_after_generation"
    assert "Rule changed" in (answered["text"] or "")


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
        json={
            "prompt": "Motion teaser",
            "ratio": "9:16",
            "duration_seconds": 6,
            "async_mode": False,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "video"
    assert body["provider"] == "fallback"
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
