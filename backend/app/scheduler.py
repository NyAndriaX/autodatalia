"""Background scheduler — fires due `scheduled` posts.

Runs as a single asyncio task started at FastAPI startup. Every TICK_SECONDS
it scans posts.json for posts whose `status == "scheduled"` and whose
scheduledDate + time (interpreted in the post's IANA timezone) is now in the
past, then publishes them via the same code path /publish uses.

Past-due policy (set by the user, see PR description):
  • Within MAX_BACKFILL_SECONDS → fire normally (covers brief downtime).
  • Older than that → mark the post status="error" with a clear reason.

Once a post fires, it is patched to status="published" or "error" along with
publish_results, published_at, and an error string when relevant. The status
change is what prevents the scheduler from re-firing the same post on the
next tick — there is no separate "fired" flag.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .publish import build_targets_from_post, publish_to_targets
from .services import messages_append, posts_list, posts_update
from .timezones import get_default_timezone_name

log = logging.getLogger("datalia.scheduler")

# Fallback timezone when a post's `timezone` field is missing or unparseable.
# Datalia operates from France, so Europe/Paris is the sensible default;
# override via the env if the team moves. UTC is wrong as a default here:
# users picking "09:00" almost never mean 09:00 UTC, and the old fallback
# meant scheduled posts fired 1–2 hours later than the user expected.
DEFAULT_TZ_NAME = get_default_timezone_name()

TICK_SECONDS = 30
# Brief outages (container restart, deploy) shouldn't strand a post that was
# supposed to fire two minutes ago — but a 6h-late post is almost never
# what the user wants either. One hour is the user-confirmed cutoff.
MAX_BACKFILL_SECONDS = 60 * 60

# Module-level task handle so a second start_scheduler() call is a no-op
# (prevents duplicate tickers if startup runs twice during dev reload).
_TASK: asyncio.Task | None = None
_STOP = False


def _due_at_epoch(post: dict[str, Any]) -> float | None:
    """Return the post's fire time as a UTC epoch, or None if unparseable.

    `time` defaults to "09:00" if missing — a scheduled post with no time is
    treated as "morning of that day" rather than "midnight UTC", which would
    fire a day early for most users.
    """
    date_s = post.get("scheduledDate")
    if not date_s:
        return None
    time_s = post.get("time") or "09:00"
    tz_s = post.get("timezone") or DEFAULT_TZ_NAME
    try:
        tz = ZoneInfo(tz_s)
    except ZoneInfoNotFoundError:
        # Bad zone string on the post → fall back to the configured default,
        # not UTC, for the same reason as above.
        try:
            tz = ZoneInfo(DEFAULT_TZ_NAME)
        except ZoneInfoNotFoundError:
            tz = ZoneInfo("UTC")
    try:
        y, m, d = [int(x) for x in date_s.split("-")]
        hh, mm = [int(x) for x in time_s.split(":")[:2]]
        return datetime(y, m, d, hh, mm, tzinfo=tz).timestamp()
    except (ValueError, TypeError):
        return None


def _resolve_media_url(post: dict[str, Any]) -> str | None:
    """Pick the first uploaded media's remote URL — same rule publishNowThunk uses."""
    for m in post.get("media") or []:
        if m.get("status") == "uploaded" and m.get("remoteUrl"):
            return m["remoteUrl"]
    return None


def _resolve_media_urls(post: dict[str, Any]) -> list[str]:
    """Pick all uploaded media's remote URLs."""
    urls = []
    for m in post.get("media") or []:
        if m.get("status") == "uploaded" and m.get("remoteUrl"):
            urls.append(m["remoteUrl"])
    return urls


def _resolve_media_kind(post: dict[str, Any]) -> str:
    """First uploaded video → 'video', else 'image' (IG needs this hint)."""
    for m in post.get("media") or []:
        if m.get("status") != "uploaded":
            continue
        if m.get("kind") == "video":
            return "video"
    return "image"


def _summarize_failures(results: list[dict[str, Any]]) -> str:
    parts = [
        f"{r.get('platform')}/{r.get('target_label') or r.get('target_id')}: {r.get('error')}"
        for r in results
        if not r.get("ok")
    ]
    return "; ".join(parts) if parts else ""


def _record_messages_for_results(
    post_id: str,
    results: list[dict[str, Any]],
) -> None:
    """Append one bell-feed entry per result so the user sees scheduler activity.

    Mirrors what publishNowThunk does on the manual path (one addNotification
    per result row, success rows carry the permalink). Both the manual flow
    and this scheduler now drive the same notification UI.
    """
    for r in results:
        platform = r.get("platform") or "?"
        target = r.get("target_label") or r.get("target_id") or "?"
        if r.get("ok"):
            messages_append({
                "kind": "publish",
                "post_id": post_id,
                "platform": platform,
                "target_label": target,
                "message": f"Scheduled post published to {target} ({platform}).",
                "url": r.get("permalink_url"),
            })
        else:
            messages_append({
                "kind": "publish_error",
                "post_id": post_id,
                "platform": platform,
                "target_label": target,
                "message": f"{target} ({platform}) failed: {r.get('error') or 'unknown'}",
                "url": None,
            })


async def fire_post(post: dict[str, Any]) -> dict[str, Any]:
    """Publish one scheduled post and persist the outcome.

    Re-resolves targets at fire time (chosen policy) so a post fans out to
    whatever accounts are connected *now*, not to a stale snapshot. Returns
    the updated post dict so tests can assert against it.
    """
    pid = post["id"]
    media_url = _resolve_media_url(post)
    media_urls = _resolve_media_urls(post)
    # Resolve targets AND OAuth tokens against the POST OWNER's scope. The
    # always-on scheduler must publish with the owning tenant's own social
    # tokens — never a shared/global set — so it cannot exercise the old
    # cross-tenant token sharing. A post with no user_id is a global-scope
    # post and correctly resolves the global tenant's tokens (consistent with
    # the per-user scoping in routes/oauth). `owner_scope` is threaded through
    # so token lookups and any owner-scoped writes use the same identity.
    owner_scope = post.get("user_id")
    targets, skipped = await build_targets_from_post(
        platforms=post.get("platforms") or {},
        media_url=media_url,
        media_urls=media_urls,
        media_kind=_resolve_media_kind(post),
        ratios=post.get("ratios"),
        tiktok_options=post.get("tiktok"),
        user_id=owner_scope,
    )

    if not targets and not skipped:
        updated = posts_update(pid, {
            "status": "error",
            "error": "no_connected_targets",
            "published_at": time.time(),
        })
        messages_append({
            "kind": "publish_error",
            "post_id": pid,
            "message": (
                "Scheduled post could not fire — no connected accounts for the "
                "selected platforms. Reconnect in Settings."
            ),
        })
        return updated or post

    try:
        publish_results = (
            await publish_to_targets(content=post.get("content", ""), targets=targets)
            if targets
            else []
        )
    except Exception as exc:
        log.exception("[scheduler] publish_to_targets failed for %s", pid)
        updated = posts_update(pid, {
            "status": "error",
            "error": f"publish_exception: {exc}",
            "published_at": time.time(),
        })
        messages_append({
            "kind": "publish_error",
            "post_id": pid,
            "message": f"Scheduled post crashed: {exc}",
        })
        return updated or post

    # Merge real publish results with the synthetic skip rows so the
    # response, the bell feed, and post.publish_results all reflect
    # every platform the user requested — no more silent IG/TikTok
    # drops when only Facebook posted.
    results = list(publish_results) + list(skipped)
    any_ok = any(r.get("ok") for r in results)
    _record_messages_for_results(pid, results)
    # posts_update skips None values (so empty PATCH bodies don't clobber
    # existing data), which means we only write `error` on the failure
    # branch. On success the field stays absent from the JSON — readers
    # should treat absent and explicit-None the same way.
    patch: dict[str, Any] = {
        "status": "published" if any_ok else "error",
        "publish_results": results,
        "published_at": time.time(),
    }
    if not any_ok:
        patch["error"] = _summarize_failures(results) or "all_targets_failed"
    updated = posts_update(pid, patch)
    return updated or post


async def tick(now: float | None = None) -> list[str]:
    """One scan pass. Returns the ids of posts the scheduler touched.

    `now` is injectable so tests can drive the clock without sleeping.
    """
    if now is None:
        now = time.time()
    touched: list[str] = []
    for post in posts_list(all_users=True):
        if post.get("status") != "scheduled":
            continue
        due = _due_at_epoch(post)
        if due is None:
            posts_update(post["id"], {
                "status": "error",
                "error": "unparseable_schedule",
            })
            touched.append(post["id"])
            continue
        if due > now:
            continue
        if now - due > MAX_BACKFILL_SECONDS:
            mins_late = int((now - due) // 60)
            posts_update(post["id"], {
                "status": "error",
                "error": f"missed_schedule: was due {mins_late}m ago",
            })
            touched.append(post["id"])
            continue
        await fire_post(post)
        touched.append(post["id"])
    return touched


async def _loop() -> None:
    log.info("[scheduler] running — tick every %ss", TICK_SECONDS)
    while not _STOP:
        try:
            await tick()
        except Exception:
            log.exception("[scheduler] tick failed")
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> None:
    """Kick off the background scheduler. No-op if already running."""
    global _TASK, _STOP
    if _TASK is not None and not _TASK.done():
        return
    _STOP = False
    _TASK = asyncio.create_task(_loop())


def stop_scheduler() -> None:
    """Signal the loop to stop on its next iteration."""
    global _STOP
    _STOP = True
