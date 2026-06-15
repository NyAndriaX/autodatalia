"""Automation rule worker — Phase 2 of the content automation module.

Sibling to scheduler.py. Every TICK_SECONDS:
  1. Scan automation rules whose `active == true`
  2. For each, compute the next fire epoch from its schedule
  3. If now ≥ (next_fire - validation_lead_minutes), generate a candidate
     Post (AI caption + per-slide AI images), persist it with
     `status="awaiting_validation"` + `scheduled_for=<next_fire>`, and
     submit it to Telegram for approval.

The approve handler in telegram_validation.py flips the Post status to
"scheduled" when it sees a `source_rule_id`, which lets the existing
scheduler.py pick the post up and publish at the original fire time.

Rules track `last_fire_at` to avoid generating the same fire twice.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .config import settings
from .db import (
    get_only_user_id,
    list_scoped_blob_user_ids,
    upsert_collection_document,
)
from .runtime_config import resolved_settings
from .services import (
    automation_list,
    automation_update,
    generate_post_variants,
    messages_append,
    posts_create,
    posts_list,
    posts_update,
)
from .timezones import get_default_timezone_name, resolve_zoneinfo

log = logging.getLogger("datalia.automation")

# Tick once a minute. Worker is light (one AI call per fire, no per-tick
# upstream hits unless something is actually due).
TICK_SECONDS = 60
DEFAULT_TZ_NAME = get_default_timezone_name()

_TASK: asyncio.Task | None = None
_STOP = False


# ── Schedule math ─────────────────────────────────────────────────────


def _resolve_tz(name: str | None) -> ZoneInfo:
    return resolve_zoneinfo(name)


def _parse_hhmm(s: str) -> tuple[int, int] | None:
    try:
        hh, mm = s.split(":")[:2]
        return int(hh), int(mm)
    except (ValueError, AttributeError):
        return None


def compute_next_fire_epoch(rule: dict[str, Any], now: float) -> float | None:
    """Return the next fire-time epoch (seconds since 1970), or None if
    the rule's schedule has no upcoming firing.

    Strategy: enumerate candidate (date × time) pairs for the next 35 days
    (covers monthly), keep those that match the frequency rules and are
    strictly in the future of `now`, return the minimum. The 35-day cap
    means an empty schedule (e.g. monthly with month_days=[] or weekdays
    with no days picked) returns None instead of looping forever.
    """
    schedule = rule.get("schedule") or {}
    times: list[str] = schedule.get("times") or []
    tz = _resolve_tz(schedule.get("timezone"))
    frequency = schedule.get("frequency") or "daily"
    weekdays = schedule.get("weekdays") or []
    month_days = schedule.get("month_days") or []

    if not times:
        return None

    now_dt = datetime.fromtimestamp(now, tz=tz)
    best: float | None = None
    for day_offset in range(0, 35):
        candidate_day = (now_dt + timedelta(days=day_offset)).date()
        # Filter by frequency
        if frequency == "weekdays":
            # 0=Mon … 6=Sun
            if candidate_day.weekday() not in weekdays:
                continue
        elif frequency == "weekly":
            # Pick the first listed weekday as "the" day; multiple entries
            # behave like `weekdays` mode at this resolution.
            if not weekdays or candidate_day.weekday() not in weekdays:
                continue
        elif frequency == "monthly":
            if candidate_day.day not in month_days:
                continue
        # "daily" and "custom" accept every day.
        for time_str in times:
            parsed = _parse_hhmm(time_str)
            if parsed is None:
                continue
            hh, mm = parsed
            fire_dt = datetime(
                candidate_day.year,
                candidate_day.month,
                candidate_day.day,
                hh,
                mm,
                tzinfo=tz,
            )
            fire_ts = fire_dt.timestamp()
            if fire_ts <= now:
                continue
            if best is None or fire_ts < best:
                best = fire_ts
    return best


# ── Generation ────────────────────────────────────────────────────────


def _pick_num_media(spec: dict[str, Any] | None) -> int:
    if not spec:
        return 1
    mode = spec.get("mode") or "fixed"
    if mode == "range":
        lo = max(1, int(spec.get("min") or 1))
        hi = max(lo, int(spec.get("max") or lo))
        return random.randint(lo, hi)
    return max(1, int(spec.get("count") or 1))


def _build_brief(rule: dict[str, Any], slide_idx: int | None = None) -> str:
    """Compose the natural-language brief sent to the AI from a rule's
    context fields. Optional `slide_idx` makes per-slide image prompts
    distinct so the AI doesn't produce N near-identical images.
    """
    parts = []
    if rule.get("domain"):
        parts.append(f"Topic / domain: {rule['domain']}")
    if rule.get("target_audience"):
        parts.append(f"Audience: {rule['target_audience']}")
    if rule.get("tone"):
        parts.append(f"Tone: {rule['tone']}")
    if rule.get("objective"):
        parts.append(f"Objective: {rule['objective']}")
    if rule.get("description_style"):
        parts.append(f"Description style: {rule['description_style']}")
    if rule.get("extra_brief"):
        parts.append(rule["extra_brief"])
    if slide_idx is not None:
        parts.append(
            f"Carousel slide {slide_idx + 1}: a distinct visual angle on the topic above."
        )
    return "\n".join(parts) or "An engaging brand post."


def _ratio_for_image(rule: dict[str, Any]) -> str:
    """First-platform ratio the rule wants. Falls back to 1:1."""
    ratios = rule.get("ratios") or {}
    for platform_id, on in (rule.get("platforms") or {}).items():
        if on and ratios.get(platform_id):
            return ratios[platform_id]
    return "1:1"


def _resolve_rule_user_id(rule: dict[str, Any]) -> int | None:
    """Resolve a rule's owning WORKSPACE id (kept under this name to avoid a
    wide rename; the value is a workspace id now). Tokens, AI keys and the
    generated post all scope to this workspace."""
    raw_ws = rule.get("workspace_id")
    if raw_ws not in (None, "", 0, "0"):
        try:
            normalized = int(raw_ws)
        except (TypeError, ValueError):
            normalized = None
        else:
            if normalized > 0:
                return normalized
    # Legacy fallback for a single-workspace install: infer from scoped blobs
    # (these now return ws: ids). Back-fill without bumping updated_at so the
    # write isn't treated as a real rule edit.
    owner_candidates = {
        *list_scoped_blob_user_ids("runtime_settings"),
        *list_scoped_blob_user_ids("oauth_tokens"),
    }
    only_ws = next(iter(owner_candidates)) if len(owner_candidates) == 1 else None
    if only_ws and rule.get("id"):
        rule["workspace_id"] = only_ws
        upsert_collection_document(
            "automation_rules",
            rule["id"],
            rule,
            user_id=only_ws,
            sort_ts=rule.get("updated_at"),
        )
    return only_ws


async def _generate_media_for_rule(
    rule: dict[str, Any], count: int, *, user_id: int | None = None
) -> list[dict[str, Any]]:
    """Generate `count` fresh AI images for a rule (one per slide, distinct
    prompts). Returns Post-shaped media entries already wired with
    remoteUrl so the publish path can fan them out directly.

    Text-only rules and rules where image gen fails return an empty list;
    the worker will still create the Post and submit it to Telegram, where
    the user can decide to regenerate or reject.
    """
    if rule.get("content_type") == "text":
        return []
    # Reaching into media_generation to skip the auth-wrapped HTTP route —
    # the worker is in-process, so we want the file path + filename
    # directly without the auth dance.
    from .media_generation import _generate_image_file  # type: ignore

    ratio = _ratio_for_image(rule)
    base_url = (
        os.environ.get("PUBLIC_BASE_URL")
        or os.environ.get("OAUTH_REDIRECT_BASE")
        or ""
    ).rstrip("/")

    media: list[dict[str, Any]] = []
    for slide_idx in range(count):
        slide_prompt = _build_brief(rule, slide_idx=slide_idx)
        try:
            path, provider = await _generate_image_file(
                slide_prompt, ratio, user_id=user_id
            )
        except Exception as exc:
            log.warning("[automation] image gen failed for slide %s: %s", slide_idx, exc)
            continue
        try:
            rel = path.relative_to(settings.content_dir).as_posix()
        except ValueError:
            rel = path.name
        media.append(
            {
                "id": f"gen-{int(time.time() * 1000)}-{slide_idx}",
                "kind": "image",
                "status": "uploaded",
                "filename": path.name,
                "remoteUrl": f"{base_url}/content/{rel}" if base_url else f"/content/{rel}",
                "provider": provider,
                "generated": True,
            }
        )
    return media


async def generate_candidate(rule: dict[str, Any], fire_epoch: float) -> dict[str, Any]:
    """Create one Post candidate for this rule's next fire and submit it
    to Telegram for validation. Returns the created Post dict.
    """
    rule_user_id = _resolve_rule_user_id(rule)
    cfg = resolved_settings(rule_user_id)
    # 1. Caption generation
    brief = _build_brief(rule)
    variants, _usage, _model = await generate_post_variants(
        prompt=brief,
        platforms=rule.get("platforms") or {},
        template=rule.get("description_style") or None,
        n=1,
        quality="standard",
        user_id=rule_user_id,
    )
    content = (variants[0].get("text") or "").strip() if variants else ""

    # 2. Media generation (per slide for carousels)
    desired_media = _pick_num_media(rule.get("num_media"))
    if rule.get("content_type") == "text":
        desired_media = 0
    media = (
        await _generate_media_for_rule(rule, desired_media, user_id=rule_user_id)
        if desired_media > 0
        else []
    )

    # 3. Translate fire_epoch back to date + time strings the existing
    # scheduler.tick expects, in the rule's timezone.
    tz = _resolve_tz((rule.get("schedule") or {}).get("timezone"))
    fire_dt = datetime.fromtimestamp(fire_epoch, tz=tz)
    scheduled_date = fire_dt.strftime("%Y-%m-%d")
    scheduled_time = fire_dt.strftime("%H:%M")

    # 4. Persist as a Post in awaiting_validation. The status differs from
    # the manual Telegram-validation flow ("pending") so the calendar /
    # bell view can render them distinctly.
    payload = {
        "content": content,
        "platforms": rule.get("platforms") or {},
        "status": "awaiting_validation",
        "scheduledDate": scheduled_date,
        "time": scheduled_time,
        "timezone": (rule.get("schedule") or {}).get("timezone") or DEFAULT_TZ_NAME,
        "media": media,
        "ratios": rule.get("ratios"),
        "tiktok": rule.get("tiktok"),
        "source_rule_id": rule.get("id"),
        "source_rule_name": rule.get("name"),
        "source_rule_updated_at": rule.get("updated_at"),
        "scheduled_for": fire_epoch,
        "auto_generated_at": time.time(),
        # workspace_id = owning scope; automation has no human author.
        "workspace_id": rule_user_id,
        "user_id": None,
    }
    post = posts_create(payload)

    # 5. Submit to Telegram (lazy import keeps a circular dep at bay).
    from .telegram_validation import _send_validation_card  # type: ignore

    chat_id = (rule.get("validation_chat_id") or cfg.telegram_default_chat_id or "").strip()
    if chat_id and cfg.telegram_bot_token:
        try:
            message_id = await _send_validation_card(
                post, chat_id, user_id=rule_user_id
            )
            post = {
                **post,
                "telegram_chat_id": chat_id,
                "telegram_message_id": message_id,
            }
            from .services import posts_update as _posts_update
            _posts_update(post["id"], {
                "telegram_chat_id": chat_id,
                "telegram_message_id": message_id,
            })
            messages_append({
                "kind": "automation",
                "post_id": post["id"],
                "message": (
                    f"Auto-generated post for rule '{rule.get('name')}' "
                    f"submitted to Telegram for validation."
                ),
            })
        except Exception as exc:
            log.exception("[automation] telegram submit failed for %s", post["id"])
            messages_append({
                "kind": "automation_error",
                "post_id": post["id"],
                "message": f"Auto-generated post {post['id']} created but Telegram submission failed: {exc}",
            })
    else:
        messages_append({
            "kind": "automation_error",
            "post_id": post["id"],
            "message": (
                f"Auto-generated post {post['id']} created but no Telegram chat "
                "configured — set TELEGRAM_BOT_TOKEN + a chat id on the rule or "
                "TELEGRAM_DEFAULT_CHAT_ID."
            ),
        })
    return post


# ── Regeneration (triggered by Telegram "Regenerate" button) ──────────


async def regenerate_for_post(post: dict[str, Any]) -> dict[str, Any]:
    """Rerun caption + media generation against the same rule and replace
    this post's content in place. Called from telegram_validation when the
    user picks "Regenerate" on the timeout prompt. Sends a fresh
    validation card so the chat thread shows the new candidate.
    """
    rule_id = post.get("source_rule_id")
    if not rule_id:
        raise RuntimeError("post has no source_rule_id — cannot regenerate")
    rule = next(
        (r for r in automation_list(all_users=True) if r.get("id") == rule_id),
        None,
    )
    if not rule:
        raise RuntimeError(f"rule {rule_id} no longer exists")

    rule_user_id = _resolve_rule_user_id(rule)
    cfg = resolved_settings(rule_user_id)
    brief = _build_brief(rule)
    variants, _usage, _model = await generate_post_variants(
        prompt=brief,
        platforms=rule.get("platforms") or {},
        template=rule.get("description_style") or None,
        n=1,
        quality="standard",
        user_id=rule_user_id,
    )
    content = (variants[0].get("text") or "").strip() if variants else ""

    desired_media = _pick_num_media(rule.get("num_media"))
    if rule.get("content_type") == "text":
        desired_media = 0
    media = (
        await _generate_media_for_rule(rule, desired_media, user_id=rule_user_id)
        if desired_media > 0
        else []
    )

    updated = posts_update(post["id"], {
        "content": content,
        "media": media,
        "status": "awaiting_validation",
        "error": "",
        "timeout_prompt_sent_at": None,
        "timeout_prompt_message_id": None,
        "regenerated_at": time.time(),
        "source_rule_updated_at": rule.get("updated_at"),
        "workspace_id": rule_user_id or post.get("workspace_id"),
    }) or post

    chat_id = post.get("telegram_chat_id") or (
        rule.get("validation_chat_id") or cfg.telegram_default_chat_id or ""
    )
    chat_id = str(chat_id or "").strip()
    if chat_id and cfg.telegram_bot_token:
        from .telegram_validation import _send_validation_card  # type: ignore
        new_card_id = await _send_validation_card(
            updated, chat_id, user_id=rule_user_id
        )
        posts_update(updated["id"], {
            "telegram_chat_id": chat_id,
            "telegram_message_id": new_card_id,
        })
    messages_append({
        "kind": "automation",
        "post_id": post["id"],
        "message": f"Auto-generated post {post['id']} regenerated after timeout.",
    })
    return updated


# ── Tick loop ─────────────────────────────────────────────────────────


async def _scan_timeouts(now: float) -> list[str]:
    """Send the timeout-decision prompt for any awaiting_validation post
    that hit its publish time without a verdict. Idempotent — uses
    `timeout_prompt_sent_at` as the marker so we don't spam.

    Returns post ids that received a prompt this tick.
    """
    prompted: list[str] = []
    from .telegram_validation import send_timeout_prompt  # type: ignore
    for post in posts_list(all_users=True):
        if post.get("status") != "awaiting_validation":
            continue
        if not post.get("source_rule_id"):
            continue  # only automation-sourced
        scheduled_for = post.get("scheduled_for")
        if not scheduled_for or now < float(scheduled_for):
            continue
        if post.get("timeout_prompt_sent_at"):
            continue  # already prompted
        cfg = resolved_settings(post.get("workspace_id"))
        chat_id = str(
            post.get("telegram_chat_id") or cfg.telegram_default_chat_id or ""
        ).strip()
        if not chat_id:
            continue
        try:
            msg_id = await send_timeout_prompt(
                post, chat_id, user_id=post.get("workspace_id")
            )
        except Exception as exc:
            log.exception("[automation] timeout prompt failed for %s", post.get("id"))
            posts_update(post["id"], {
                "timeout_prompt_sent_at": now,
                "timeout_prompt_error": f"{type(exc).__name__}: {exc}"[:200],
            })
            continue
        posts_update(post["id"], {
            "timeout_prompt_sent_at": now,
            "timeout_prompt_message_id": msg_id,
        })
        messages_append({
            "kind": "automation",
            "post_id": post["id"],
            "message": (
                f"Auto-generated post {post['id']} hit its publish time without "
                "validation — sent timeout prompt to Telegram."
            ),
        })
        prompted.append(post["id"])
    return prompted


def _reconcile_open_posts() -> list[str]:
    """Cancel open automation posts that no longer match their source rule."""
    touched: list[str] = []
    rules = {str(rule.get("id")): rule for rule in automation_list(all_users=True)}
    for post in posts_list(all_users=True):
        if post.get("status") not in {"awaiting_validation", "scheduled"}:
            continue
        rule_id = str(post.get("source_rule_id") or "")
        if not rule_id:
            continue
        rule = rules.get(rule_id)
        current_updated_at = float((rule or {}).get("updated_at") or 0)
        generated_from_updated_at = float(post.get("source_rule_updated_at") or 0)
        stale = (
            (not rule)
            or (not rule.get("active", True))
            or (
                current_updated_at
                and generated_from_updated_at
                and current_updated_at != generated_from_updated_at
            )
        )
        if not stale:
            continue
        posts_update(
            post["id"],
            {
                "status": "cancelled",
                "error": "rule_changed_after_generation",
                "validated_at": time.time(),
            },
        )
        messages_append(
            {
                "kind": "automation",
                "post_id": post["id"],
                "message": (
                    f"Auto-generated post {post['id']} was cancelled because "
                    "its source rule changed or no longer exists."
                ),
            }
        )
        touched.append(post["id"])
    return touched


async def tick(now: float | None = None) -> dict[str, list[str]]:
    """One scan pass.

    Returns {"fired": [...], "timeouts_prompted": [...]} so tests and the
    /automation/tick endpoint can introspect what happened on this pass.
    """
    if now is None:
        now = time.time()
    reconciled = _reconcile_open_posts()
    fired: list[str] = []
    for rule in automation_list(all_users=True):
        if not rule.get("active"):
            continue
        rule_user_id = _resolve_rule_user_id(rule)
        cfg = resolved_settings(rule_user_id)
        next_fire = compute_next_fire_epoch(rule, now)
        if next_fire is None:
            continue
        lead_sec = max(0, int(rule.get("validation_lead_minutes") or 30)) * 60
        if now < next_fire - lead_sec:
            continue
        # Don't re-generate the same fire if we already did.
        if (rule.get("last_fire_at") or 0) >= next_fire:
            continue
        # HARD GATE: refuse to even generate a candidate without a
        # Telegram destination. Without this, the post would be created
        # in awaiting_validation forever, but the user might not realise
        # the rule is silently stuck. CEO requirement: every auto post
        # must be human-approved before publishing.
        chat_id = (
            rule.get("validation_chat_id")
            or cfg.telegram_default_chat_id
            or ""
        ).strip()
        if not chat_id or not cfg.telegram_bot_token:
            messages_append({
                "kind": "automation_error",
                "post_id": None,
                "message": (
                    f"Rule '{rule.get('name')}' skipped — no Telegram "
                    "validation destination configured. Set "
                    "TELEGRAM_BOT_TOKEN + TELEGRAM_DEFAULT_CHAT_ID (or "
                    "validation_chat_id on the rule). Auto-posts cannot "
                    "fire without approval."
                ),
            })
            automation_update(rule["id"], {
                "last_fire_at": next_fire,
                "last_error": "no_telegram_destination",
            })
            continue
        try:
            await generate_candidate(rule, next_fire)
        except Exception as exc:
            log.exception("[automation] generation failed for rule %s", rule.get("id"))
            messages_append({
                "kind": "automation_error",
                "post_id": None,
                "message": (
                    f"Automation rule '{rule.get('name')}' failed during generation: "
                    f"{type(exc).__name__}: {exc}"
                )[:500],
            })
            automation_update(rule["id"], {
                "last_fire_at": next_fire,
                "last_error": f"{type(exc).__name__}: {exc}"[:300],
            })
            continue
        automation_update(rule["id"], {
            "last_fire_at": next_fire,
            "last_error": "",
        })
        fired.append(rule["id"])

    timeouts_prompted = await _scan_timeouts(now)
    return {
        "fired": fired,
        "timeouts_prompted": timeouts_prompted,
        "reconciled": reconciled,
    }


async def _loop() -> None:
    log.info("[automation] worker running — tick every %ss", TICK_SECONDS)
    while not _STOP:
        try:
            await tick()
        except Exception:
            log.exception("[automation] tick failed")
        await asyncio.sleep(TICK_SECONDS)


def start_automation_worker() -> None:
    global _TASK, _STOP
    if _TASK is not None and not _TASK.done():
        return
    _STOP = False
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    _TASK = loop.create_task(_loop())


def stop_automation_worker() -> None:
    global _STOP
    _STOP = True
