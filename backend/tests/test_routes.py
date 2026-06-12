"""End-to-end route tests for the public Caption API surface."""

import asyncio
import httpx
import pytest
from fastapi import HTTPException

from app.config import settings
from app.auth import create_jwt_token
from app.db import create_user, get_user_by_id
from app.oauth import _save_tokens
from app import telegram_validation as tg
from app import media_generation as mg
from app.publish import publish_linkedin
from app.services import (
    automation_create,
    automation_get,
    automation_update,
    messages_list,
    posts_list,
)
from app.video_jobs import create_job


def _auth_headers_for_user(user_id: int) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_jwt_token(user_id)}"}


_TG_SECRET = "telegram-secret"


# ── Health & basic openness ──────────────────────────────────────────

def test_health_is_open(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "dependencies": {"mariadb": "ok"}}


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
    settings.allow_open_auth = True

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


def test_auth_closed_when_open_mode_disabled(client):
    settings.backend_auth_token = ""
    settings.allow_open_auth = False

    r = client.post("/posts", json={"scheduledDate": "2026-06-01"})
    assert r.status_code == 401


def test_auth_login_sets_cookie_and_me_uses_it(client):
    settings.allow_open_auth = False

    reg = client.post(
        "/auth/register",
        json={"email": "owner@example.com", "password": "secret123", "name": "Owner"},
    )
    assert reg.status_code == 200
    assert "datalia_session=" in reg.headers.get("set-cookie", "")

    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "owner@example.com"
    assert me.json()["role"] == "admin"


def test_auth_logout_clears_cookie(client):
    settings.allow_open_auth = False
    client.post(
        "/auth/register",
        json={"email": "owner@example.com", "password": "secret123", "name": "Owner"},
    )

    out = client.post("/auth/logout")
    assert out.status_code == 204

    me = client.get("/auth/me")
    assert me.status_code == 401


def test_auth_login_rate_limits_repeated_failures(client):
    settings.allow_open_auth = False
    client.post(
        "/auth/register",
        json={"email": "owner@example.com", "password": "secret123", "name": "Owner"},
    )

    original_attempts = settings.auth_rate_limit_attempts
    original_window = settings.auth_rate_limit_window_seconds
    settings.auth_rate_limit_attempts = 2
    settings.auth_rate_limit_window_seconds = 60
    try:
        first = client.post(
            "/auth/login",
            json={"email": "owner@example.com", "password": "wrong"},
        )
        second = client.post(
            "/auth/login",
            json={"email": "owner@example.com", "password": "wrong"},
        )
        third = client.post(
            "/auth/login",
            json={"email": "owner@example.com", "password": "wrong"},
        )

        assert first.status_code == 401
        assert second.status_code == 401
        assert third.status_code == 429
    finally:
        settings.auth_rate_limit_attempts = original_attempts
        settings.auth_rate_limit_window_seconds = original_window


def test_second_created_user_defaults_to_member_role(monkeypatch):
    counts = iter([0, 1])
    monkeypatch.setattr("app.db.count_users", lambda: next(counts))

    first_id = create_user("admin-role@example.com", password_hash=None, full_name="Admin")
    second_id = create_user("member-role@example.com", password_hash=None, full_name="Member")

    first = get_user_by_id(first_id)
    second = get_user_by_id(second_id)

    assert first is not None and first["role"] == "admin"
    assert second is not None and second["role"] == "member"


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


def test_auth_query_token_is_rejected(client):
    """A JWT/shared token in the ?token= query string must NOT authenticate.

    Query strings leak into access logs, browser history and Referer headers,
    so the query-param token path was removed. Only the Authorization header
    and the session cookie are accepted.
    """
    settings.backend_auth_token = "qtok"
    settings.allow_open_auth = True

    # No credentials at all → 401.
    r = client.post("/posts", json={"scheduledDate": "2026-06-01"})
    assert r.status_code == 401

    # Correct shared token but only in the query string → still 401.
    r = client.post(
        "/posts?token=qtok",
        json={"scheduledDate": "2026-06-01"},
    )
    assert r.status_code == 401

    # The same token in the Authorization header works.
    r = client.post(
        "/posts",
        json={"scheduledDate": "2026-06-01"},
        headers={"Authorization": "Bearer qtok"},
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


def test_create_automation_rule_assigns_authenticated_user(client):
    headers = _auth_headers_for_user(12)

    r = client.post("/automation-rules", headers=headers, json={"name": "Owned rule"})

    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Owned rule"
    assert body["user_id"] == "12"


# ── Multi-tenant isolation ───────────────────────────────────────────
# A real authenticated JWT user (user_id > 0) is a tenant that can only
# see/modify its own scope. These tests pin that a tenant can never read or
# mutate another tenant's records, and that the shared/global scope is its
# own bounded tenant (not "owns everything").


def test_posts_are_isolated_between_tenants(client):
    alice = _auth_headers_for_user(101)
    bob = _auth_headers_for_user(202)

    created = client.post(
        "/posts",
        headers=alice,
        json={"scheduledDate": "2026-06-01", "content": "alice-secret"},
    )
    assert created.status_code == 200
    pid = created.json()["id"]

    # Bob's list never sees Alice's post.
    bob_list = client.get("/posts", headers=bob).json()["posts"]
    assert all(p["id"] != pid for p in bob_list)

    # Alice's list does.
    alice_list = client.get("/posts", headers=alice).json()["posts"]
    assert any(p["id"] == pid for p in alice_list)


def test_tenant_cannot_patch_or_delete_other_tenants_post(client):
    alice = _auth_headers_for_user(101)
    bob = _auth_headers_for_user(202)

    pid = client.post(
        "/posts",
        headers=alice,
        json={"scheduledDate": "2026-06-01", "content": "alice-only"},
    ).json()["id"]

    # Bob cannot patch Alice's post → 404 (not found in his scope).
    patched = client.patch(
        f"/posts/{pid}", headers=bob, json={"content": "hacked"}
    )
    assert patched.status_code == 404

    # Bob cannot delete Alice's post either.
    deleted = client.delete(f"/posts/{pid}", headers=bob)
    assert deleted.status_code == 404

    # Alice's post is untouched.
    alice_list = client.get("/posts", headers=alice).json()["posts"]
    mine = next(p for p in alice_list if p["id"] == pid)
    assert mine["content"] == "alice-only"

    # Alice herself can patch + delete it.
    assert client.patch(
        f"/posts/{pid}", headers=alice, json={"content": "edited"}
    ).status_code == 200
    assert client.delete(f"/posts/{pid}", headers=alice).status_code == 200


def test_global_scope_does_not_see_user_posts(client):
    """The shared/global scope is its OWN tenant — it must not read user rows."""
    alice = _auth_headers_for_user(101)
    client.post(
        "/posts",
        headers=alice,
        json={"scheduledDate": "2026-06-01", "content": "alice-private"},
    )

    # Open-mode request (no JWT) resolves to the global scope and must only
    # see global-scoped rows — never Alice's.
    global_list = client.get("/posts").json()["posts"]
    assert all(p.get("content") != "alice-private" for p in global_list)


def test_tenant_cannot_read_patch_or_delete_other_tenants_rule(client):
    alice = _auth_headers_for_user(101)
    bob = _auth_headers_for_user(202)

    rule = client.post(
        "/automation-rules", headers=alice, json={"name": "Alice rule"}
    ).json()
    rid = rule["id"]

    # Bob can't GET it.
    assert client.get(f"/automation-rules/{rid}", headers=bob).status_code == 404
    # Bob can't PATCH it.
    assert client.patch(
        f"/automation-rules/{rid}", headers=bob, json={"name": "stolen"}
    ).status_code == 404
    # Bob can't DELETE it.
    assert client.delete(f"/automation-rules/{rid}", headers=bob).status_code == 404
    # Bob's list doesn't include it.
    bob_rules = client.get("/automation-rules", headers=bob).json()["rules"]
    assert all(r["id"] != rid for r in bob_rules)

    # Alice retains full access.
    assert client.get(f"/automation-rules/{rid}", headers=alice).status_code == 200


def test_me_does_not_mint_synthetic_admin_for_shared_token(client):
    """The shared-token / global scope is non-interactive — /me must 401,
    never return a hardcoded 'Global Admin'."""
    settings.backend_auth_token = "shared-tok"
    settings.allow_open_auth = True

    me = client.get("/auth/me", headers={"Authorization": "Bearer shared-tok"})
    assert me.status_code == 401


def test_oauth_start_requires_real_user_for_social_providers(client):
    """Per-user social tokens cannot be started from the shared/global scope."""
    settings.backend_auth_token = ""
    settings.allow_open_auth = True

    import os

    os.environ["TIKTOK_CLIENT_KEY"] = "ck"
    os.environ["TIKTOK_CLIENT_SECRET"] = "cs"
    try:
        # Open mode → user_id 0 → social provider start refused.
        anon = client.get("/oauth/tiktok/start")
        assert anon.status_code == 401

        # A real authenticated user can start it.
        authed = client.get(
            "/oauth/tiktok/start", headers=_auth_headers_for_user(55)
        )
        assert authed.status_code == 200
        assert "authorize_url" in authed.json()
    finally:
        os.environ.pop("TIKTOK_CLIENT_KEY", None)
        os.environ.pop("TIKTOK_CLIENT_SECRET", None)


def test_oauth_start_stamps_real_user_in_pending_state(client):
    """The pending-state row records the authenticated user so the callback
    can refuse connections not tied to a real account."""
    import os

    from app.oauth import _load_tokens

    os.environ["TIKTOK_CLIENT_KEY"] = "ck"
    os.environ["TIKTOK_CLIENT_SECRET"] = "cs"
    try:
        r = client.get("/oauth/tiktok/start", headers=_auth_headers_for_user(77))
        assert r.status_code == 200
        pending = _load_tokens(None).get("_pending_state") or {}
        assert pending, "expected a pending-state entry"
        assert all(v.get("user_id") == 77 for v in pending.values())
    finally:
        os.environ.pop("TIKTOK_CLIENT_KEY", None)
        os.environ.pop("TIKTOK_CLIENT_SECRET", None)


def test_long_password_rejected_to_avoid_bcrypt_truncation(client):
    """Passwords longer than bcrypt's 72-byte limit are rejected so two
    passwords sharing the first 72 bytes can't become interchangeable."""
    settings.allow_open_auth = False

    overlong = "A" * 80
    r = client.post(
        "/auth/register",
        json={"email": "long@example.com", "password": overlong, "name": "Long"},
    )
    assert r.status_code == 422


def test_automation_rules_api_exposes_last_error_and_last_fire_at(client):
    rule = automation_create(
        {
            "name": "Broken rule",
            "last_fire_at": 1234567890.0,
            "last_error": "boom",
        }
    )

    r = client.get("/automation-rules")

    assert r.status_code == 200
    listed = next(item for item in r.json()["rules"] if item["id"] == rule["id"])
    assert listed["last_fire_at"] == 1234567890.0
    assert listed["last_error"] == "boom"


def test_video_models_catalogue_includes_veo_3_1_lite(client):
    r = client.get("/video-models")
    assert r.status_code == 200

    models = {model["id"]: model for model in r.json()["models"]}
    lite = models["fal-ai/veo3.1/lite"]

    assert lite["label"] == "Veo 3.1 Lite (Google Practical)"
    assert lite["cost_per_second_usd"] == 0.05
    assert lite["provider"] == "fal"
    assert lite["features"]["image_to_video"] is True
    assert lite["features"]["audio"] is True
    assert "text_to_video" in lite["endpoints"]
    assert "image_to_video" in lite["endpoints"]


def test_video_models_catalogue_includes_openrouter_entries(client):
    r = client.get("/video-models")
    assert r.status_code == 200

    models = {model["id"]: model for model in r.json()["models"]}
    veo = models["google/veo-3.1-lite"]

    assert veo["provider"] == "openrouter"
    assert veo["features"]["image_to_video"] is True
    assert veo["features"]["supported_aspect_ratios"] == ["16:9", "9:16"]


def test_create_job_infers_openrouter_provider_from_model_id(monkeypatch):
    monkeypatch.setattr(settings, "ai_api_base_url", "https://openrouter.ai/api/v1")
    monkeypatch.setattr(settings, "ai_api_key", "openrouter-key")
    job = create_job(
        prompt="Launch teaser",
        ratio="9:16",
        duration_seconds=6,
        model_id="google/veo-3.1-lite",
    )

    assert job["provider"] == "openrouter"
    assert job["model"] == "google/veo-3.1-lite"
    assert job["model_id"] == "google/veo-3.1-lite"


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
    settings.telegram_webhook_secret = _TG_SECRET

    async def fake_send_validation_card(post, chat_id, *, user_id=None):
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
    settings.telegram_webhook_secret = _TG_SECRET
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

    async def fake_send_validation_card(post, chat_id, *, user_id=None):
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


def test_validation_submit_requires_webhook_secret_when_telegram_enabled(client):
    settings.telegram_bot_token = "telegram-test"
    settings.telegram_default_chat_id = "12345"
    settings.telegram_webhook_secret = ""

    r = client.post(
        "/validation/submit",
        json={
            "content": "Need approval",
            "platforms": {"linkedin": True},
        },
    )
    assert r.status_code == 503
    assert "webhook secret" in r.json()["detail"].lower()


def test_telegram_webhook_approve_schedules_automation_post(client, monkeypatch):
    settings.telegram_bot_token = "telegram-test"
    settings.telegram_webhook_secret = _TG_SECRET
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

    async def fake_answer_callback(callback_query_id, text="", *, user_id=None):
        assert callback_query_id == "cb_1"

    monkeypatch.setattr(tg, "_answer_callback", fake_answer_callback)

    r = client.post(
        "/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": _TG_SECRET},
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


def test_telegram_webhook_requires_secret_when_bot_enabled(client):
    settings.telegram_bot_token = "telegram-test"
    settings.telegram_webhook_secret = ""

    r = client.post("/telegram/webhook", json={})
    assert r.status_code == 503
    assert "webhook secret" in r.json()["detail"].lower()


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
    settings.telegram_webhook_secret = _TG_SECRET

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

    async def fake_answer_callback(callback_query_id, text="", *, user_id=None):
        assert callback_query_id == "cb_stale"
        answered["text"] = text

    monkeypatch.setattr(tg, "_answer_callback", fake_answer_callback)

    r = client.post(
        "/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": _TG_SECRET},
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


def test_automation_worker_bookkeeping_does_not_stale_rule_revision(client, monkeypatch):
    create = client.post(
        "/automation-rules",
        json={
            "name": "Stable automation rule",
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
    original_updated_at = rule["updated_at"]

    refreshed = automation_update(
        rule["id"],
        {"last_fire_at": 1780682400.0, "last_error": ""},
    )

    assert refreshed is not None
    assert refreshed["updated_at"] == original_updated_at


def test_telegram_feedback_resubmit_keeps_automation_post_awaiting_validation(
    client, monkeypatch
):
    settings.telegram_bot_token = "telegram-test"
    settings.telegram_webhook_secret = _TG_SECRET

    post = tg.posts_create(
        {
            "id": "auto-feedback-1",
            "content": "original automation draft",
            "platforms": {"facebook": True},
            "status": "awaiting_validation",
            "scheduledDate": "2026-06-05",
            "time": "19:00",
            "timezone": "Africa/Lagos",
            "source_rule_id": "rule-feedback-1",
            "telegram_chat_id": "12345",
            "telegram_feedback_prompt_message_id": 777,
        }
    )

    async def fake_regenerate_from_feedback(original, feedback, *, user_id=None):
        assert original == "original automation draft"
        assert feedback == "Make it punchier"
        return "rewritten automation draft"

    async def fake_send_validation_card(updated, chat_id, *, user_id=None):
        assert updated["id"] == post["id"]
        assert updated["status"] == "awaiting_validation"
        assert chat_id == "12345"
        return 888

    monkeypatch.setattr(tg, "_regenerate_from_feedback", fake_regenerate_from_feedback)
    monkeypatch.setattr(tg, "_send_validation_card", fake_send_validation_card)

    r = client.post(
        "/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": _TG_SECRET},
        json={
            "message": {
                "text": "Make it punchier",
                "chat": {"id": 12345},
                "reply_to_message": {"message_id": 777},
            }
        },
    )
    assert r.status_code == 200

    refreshed = next(p for p in posts_list() if p["id"] == post["id"])
    assert refreshed["content"] == "rewritten automation draft"
    assert refreshed["status"] == "awaiting_validation"
    assert refreshed["telegram_message_id"] == 888


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


def test_generate_image_file_falls_back_when_provider_errors(monkeypatch):
    async def fake_call_image_api(prompt, width, height, *, user_id=None):
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Image generation request failed.",
                "status_code": 402,
                "response": "credits exhausted",
            },
        )

    monkeypatch.setattr(mg, "_call_image_api", fake_call_image_api)

    path, provider = asyncio.run(
        mg._generate_image_file("Fallback this poster", "1:1")
    )

    assert provider == "fallback-poster"
    assert path.exists()
    assert path.suffix == ".png"


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
        headers = {}

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


def test_publish_linkedin_uses_x_restli_id_header(monkeypatch):
    class _Resp:
        status_code = 201
        text = ""
        headers = {"x-restli-id": "urn:li:ugcPost:123"}

        def json(self):
            return {}

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
    assert result.platform_post_id == "urn:li:ugcPost:123"
    assert result.permalink_url == "https://www.linkedin.com/feed/update/urn:li:ugcPost:123/"
