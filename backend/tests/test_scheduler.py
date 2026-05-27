"""Scheduler tick behaviour — what fires, what doesn't, and what gets marked failed.

These tests drive the scheduler synchronously by calling `tick(now=…)` with
an injected clock, so nothing actually sleeps. The fan-out itself is stubbed
out (`build_targets_from_post` returns a controlled list, `publish_to_targets`
is a fake) so the assertions stay focused on scheduler semantics rather than
re-testing the per-platform handlers.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app import scheduler as sched
from app.services import messages_list, posts_create, posts_list


# ── Helpers ──────────────────────────────────────────────────────────


def _epoch_in_tz(date_s: str, time_s: str, tz_s: str) -> float:
    y, m, d = [int(x) for x in date_s.split("-")]
    hh, mm = [int(x) for x in time_s.split(":")[:2]]
    return datetime(y, m, d, hh, mm, tzinfo=ZoneInfo(tz_s)).timestamp()


def _make_scheduled(client, *, date, time_s, tz="UTC", status="scheduled", **extra) -> dict:
    """POST a scheduled post via the public API and patch its status.

    The /posts endpoint defaults new posts to status="draft", so we PATCH to
    "scheduled" afterwards (PATCH is also what the frontend's thunk does once
    the user clicks Schedule). Using the real route — not posts_create — keeps
    the test honest about what the wire format produces.
    """
    payload = {
        "scheduledDate": date,
        "time": time_s,
        "timezone": tz,
        "content": "hello",
        "platforms": {"facebook": True},
        **extra,
    }
    r = client.post("/posts", json=payload)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    if status != "draft":
        r2 = client.patch(f"/posts/{pid}", json={"status": status})
        assert r2.status_code == 200, r2.text
    return r2.json() if status != "draft" else r.json()


# ── _due_at_epoch unit ──────────────────────────────────────────────


def test_due_at_epoch_interprets_timezone():
    post = {"scheduledDate": "2026-06-01", "time": "09:00", "timezone": "Europe/Paris"}
    expected = _epoch_in_tz("2026-06-01", "09:00", "Europe/Paris")
    assert sched._due_at_epoch(post) == pytest.approx(expected)


def test_due_at_epoch_defaults_time_and_tz_when_missing():
    post = {"scheduledDate": "2026-06-01"}
    # No time → 09:00, no tz → DEFAULT_TZ_NAME (Europe/Paris). UTC would be
    # 1–2 hours off for the team that actually uses this app.
    expected = _epoch_in_tz("2026-06-01", "09:00", sched.DEFAULT_TZ_NAME)
    assert sched._due_at_epoch(post) == pytest.approx(expected)


def test_due_at_epoch_returns_none_for_unparseable_date():
    assert sched._due_at_epoch({"scheduledDate": "tomorrow"}) is None
    assert sched._due_at_epoch({}) is None


def test_due_at_epoch_falls_back_to_default_for_bad_tz():
    post = {"scheduledDate": "2026-06-01", "time": "09:00", "timezone": "Pluto/Mars"}
    # Unparseable zone → fall back to DEFAULT_TZ_NAME, not UTC.
    assert sched._due_at_epoch(post) == pytest.approx(
        _epoch_in_tz("2026-06-01", "09:00", sched.DEFAULT_TZ_NAME)
    )


# ── tick() — what fires, what doesn't ────────────────────────────────


def test_tick_ignores_draft_posts(client, monkeypatch):
    """A post still in 'draft' status must never auto-publish, even if past-due."""
    _make_scheduled(client, date="2020-01-01", time_s="09:00", status="draft")

    fired = {"n": 0}

    async def fake_fire(post):
        fired["n"] += 1
        return post

    monkeypatch.setattr(sched, "fire_post", fake_fire)
    touched = asyncio.run(sched.tick(now=time.time()))
    assert touched == []
    assert fired["n"] == 0


def test_tick_skips_posts_not_yet_due(client, monkeypatch):
    """Posts dated in the future stay scheduled — no fire, no touch."""
    future_date = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")
    _make_scheduled(client, date=future_date, time_s="09:00", tz="UTC")

    monkeypatch.setattr(
        sched, "fire_post", _failing_fire("future post should not have fired")
    )
    touched = asyncio.run(sched.tick(now=time.time()))
    assert touched == []
    posts = posts_list()
    assert posts[0]["status"] == "scheduled"


def test_tick_fires_due_post(client, monkeypatch):
    """A scheduled post whose fire time is now in the past gets fire_post()'d."""
    past_epoch = time.time() - 120  # 2 minutes ago
    post = _make_scheduled(
        client,
        date="2026-06-01",  # placeholder — we'll inject `now`
        time_s="09:00",
        tz="UTC",
    )

    monkeypatch.setattr(sched, "_due_at_epoch", lambda p: past_epoch)
    fired_ids = []

    async def fake_fire(p):
        fired_ids.append(p["id"])
        return p

    monkeypatch.setattr(sched, "fire_post", fake_fire)
    touched = asyncio.run(sched.tick(now=time.time()))
    assert fired_ids == [post["id"]]
    assert touched == [post["id"]]


def test_tick_marks_long_overdue_as_missed(client, monkeypatch):
    """Post overdue by more than MAX_BACKFILL_SECONDS gets marked error, no fire."""
    very_old = time.time() - (sched.MAX_BACKFILL_SECONDS + 600)  # 10 min past cutoff
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")

    monkeypatch.setattr(sched, "_due_at_epoch", lambda p: very_old)
    monkeypatch.setattr(
        sched, "fire_post", _failing_fire("missed post should not have fired")
    )
    touched = asyncio.run(sched.tick(now=time.time()))
    assert touched == [post["id"]]

    refreshed = next(p for p in posts_list() if p["id"] == post["id"])
    assert refreshed["status"] == "error"
    assert "missed_schedule" in (refreshed.get("error") or "")


def test_tick_does_not_refire_already_published(client, monkeypatch):
    """Once status flips to published, the next tick must ignore the post."""
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")
    # Pretend it already fired successfully.
    client.patch(f"/posts/{post['id']}", json={"status": "published"})

    monkeypatch.setattr(
        sched, "fire_post", _failing_fire("already-published post must not refire")
    )
    touched = asyncio.run(sched.tick(now=time.time()))
    assert touched == []


def test_tick_marks_unparseable_schedule_as_error(client):
    """Garbage scheduledDate → flip to error so the post stops being scanned."""
    # Create normally then corrupt the date via PATCH (the model allows it).
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")
    client.patch(f"/posts/{post['id']}", json={"scheduledDate": "not-a-date"})

    touched = asyncio.run(sched.tick(now=time.time()))
    assert touched == [post["id"]]
    refreshed = next(p for p in posts_list() if p["id"] == post["id"])
    assert refreshed["status"] == "error"
    assert refreshed["error"] == "unparseable_schedule"


# ── fire_post() — outcome persistence ────────────────────────────────


def test_fire_post_writes_error_when_no_targets(client, monkeypatch):
    """No Meta connection → no targets → status flips to error with a clear reason."""
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")

    async def empty_targets(**kwargs):
        return []

    monkeypatch.setattr(sched, "build_targets_from_post", empty_targets)
    asyncio.run(sched.fire_post(post))

    refreshed = next(p for p in posts_list() if p["id"] == post["id"])
    assert refreshed["status"] == "error"
    assert refreshed["error"] == "no_connected_targets"
    assert refreshed["published_at"] is not None


def test_fire_post_marks_published_when_at_least_one_target_succeeds(client, monkeypatch):
    """Any per-target success → status=published. publish_results captures the details."""
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")

    async def one_target(**kwargs):
        return [{"platform": "facebook", "id": "pg1", "label": "Page 1",
                 "access_token": "tok", "media_url": None}]

    async def publish_ok(*, content, targets):
        return [{
            "target_id": "pg1",
            "target_label": "Page 1",
            "platform": "facebook",
            "ok": True,
            "platform_post_id": "fb_123",
            "permalink_url": "https://www.facebook.com/fb_123",
            "error": None,
        }]

    monkeypatch.setattr(sched, "build_targets_from_post", one_target)
    monkeypatch.setattr(sched, "publish_to_targets", publish_ok)
    asyncio.run(sched.fire_post(post))

    refreshed = next(p for p in posts_list() if p["id"] == post["id"])
    assert refreshed["status"] == "published"
    assert refreshed["publish_results"][0]["platform_post_id"] == "fb_123"
    # `error` is absent on the success path — posts_update skips None.
    assert refreshed.get("error") is None


def test_fire_post_writes_bell_messages_for_each_target(client, monkeypatch):
    """One bell-feed entry per result row — success carries permalink, failure carries reason."""
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")

    async def two_targets(**kwargs):
        return [
            {"platform": "facebook", "id": "pg1", "label": "Page 1", "access_token": "t"},
            {"platform": "instagram", "id": "ig1", "label": "@ig", "access_token": "t"},
        ]

    async def mixed_results(*, content, targets):
        return [
            {
                "target_id": "pg1", "target_label": "Page 1", "platform": "facebook",
                "ok": True, "platform_post_id": "fb_1",
                "permalink_url": "https://www.facebook.com/fb_1", "error": None,
            },
            {
                "target_id": "ig1", "target_label": "@ig", "platform": "instagram",
                "ok": False, "error": "instagram_requires_media",
            },
        ]

    monkeypatch.setattr(sched, "build_targets_from_post", two_targets)
    monkeypatch.setattr(sched, "publish_to_targets", mixed_results)
    asyncio.run(sched.fire_post(post))

    feed = messages_list()
    # messages_append prepends, so the IG failure was inserted last → at index 0.
    by_target = {m.get("target_label"): m for m in feed if m.get("target_label")}
    assert "Page 1" in by_target
    assert by_target["Page 1"]["kind"] == "publish"
    assert by_target["Page 1"]["url"] == "https://www.facebook.com/fb_1"
    assert "@ig" in by_target
    assert by_target["@ig"]["kind"] == "publish_error"
    assert "instagram_requires_media" in by_target["@ig"]["message"]


def test_fire_post_writes_bell_message_when_no_targets(client, monkeypatch):
    """No-targets path also surfaces in the bell so the user knows why nothing happened."""
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")

    async def empty_targets(**kwargs):
        return []

    monkeypatch.setattr(sched, "build_targets_from_post", empty_targets)
    asyncio.run(sched.fire_post(post))

    feed = messages_list()
    assert len(feed) == 1
    assert feed[0]["kind"] == "publish_error"
    assert feed[0]["post_id"] == post["id"]
    assert "no connected accounts" in feed[0]["message"].lower()


def test_messages_endpoint_returns_appended_events(client, monkeypatch):
    """GET /messages should expose what the scheduler wrote — proves the route + store are wired."""
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")

    async def one_target(**kwargs):
        return [{"platform": "facebook", "id": "pg1", "label": "Page 1", "access_token": "t"}]

    async def publish_ok(*, content, targets):
        return [{
            "target_id": "pg1", "target_label": "Page 1", "platform": "facebook",
            "ok": True, "platform_post_id": "fb_1",
            "permalink_url": "https://www.facebook.com/fb_1", "error": None,
        }]

    monkeypatch.setattr(sched, "build_targets_from_post", one_target)
    monkeypatch.setattr(sched, "publish_to_targets", publish_ok)
    asyncio.run(sched.fire_post(post))

    r = client.get("/messages")
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(m.get("url") == "https://www.facebook.com/fb_1" for m in items)


def test_fire_post_marks_error_when_all_targets_fail(client, monkeypatch):
    """Every per-target failure → status=error and the error summary is preserved."""
    post = _make_scheduled(client, date="2020-01-01", time_s="09:00")

    async def one_target(**kwargs):
        return [{"platform": "facebook", "id": "pg1", "label": "Page 1",
                 "access_token": "tok", "media_url": None}]

    async def publish_fail(*, content, targets):
        return [{
            "target_id": "pg1",
            "target_label": "Page 1",
            "platform": "facebook",
            "ok": False,
            "error": "Meta 190: token expired",
        }]

    monkeypatch.setattr(sched, "build_targets_from_post", one_target)
    monkeypatch.setattr(sched, "publish_to_targets", publish_fail)
    asyncio.run(sched.fire_post(post))

    refreshed = next(p for p in posts_list() if p["id"] == post["id"])
    assert refreshed["status"] == "error"
    assert "token expired" in (refreshed.get("error") or "")


# ── helpers ──────────────────────────────────────────────────────────


def _failing_fire(reason: str):
    """Build a fake fire_post that explodes if called — used for negative tests."""
    async def _fail(_post):  # noqa: ARG001
        raise AssertionError(reason)
    return _fail
