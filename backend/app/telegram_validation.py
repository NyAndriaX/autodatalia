"""Telegram-backed validation flow for draft posts."""

from __future__ import annotations

import hmac
import logging
import os
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException

from .auth import require_token
from .config import settings
from .models import (
    TelegramStatusResponse,
    ValidationSubmitRequest,
    ValidationSubmitResponse,
)
from .services import (
    _post_chat,
    automation_get,
    messages_append,
    posts_create,
    posts_list,
    posts_update,
)
from .runtime_config import resolved_settings

# fire_post lives in scheduler — re-used here so a manual Telegram
# approval publishes immediately without waiting for the scheduler tick.
import asyncio  # noqa: E402

router = APIRouter(tags=["telegram-validation"])

logger = logging.getLogger(__name__)


# Update types the webhook handler below actually processes. We register
# exactly these so Telegram doesn't waste round-trips delivering anything
# the handler ignores: `message` (free-text feedback replies) and
# `callback_query` (the approve / reject / edit / timeout inline buttons).
_WEBHOOK_ALLOWED_UPDATES = ["message", "callback_query"]


def _public_base_url() -> str:
    """Resolve the public base URL for inbound webhooks.

    Mirrors the precedence used by /upload and /search in routes.py:
    PUBLIC_BASE_URL (explicit override) wins, then OAUTH_REDIRECT_BASE
    (already pointed at the ngrok/prod host). Trailing slash stripped so
    callers can append a path directly.
    """
    base = (
        os.environ.get("PUBLIC_BASE_URL")
        or os.environ.get("OAUTH_REDIRECT_BASE")
        or ""
    ).strip()
    return base.rstrip("/")


async def register_webhook() -> None:
    """Register the shared bot's webhook with Telegram, once, at startup.

    The bot is a single shared instance configured only via env
    (TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET). This points Telegram at
    ``<public-base>/telegram/webhook`` and hands it the webhook secret as
    ``secret_token`` — Telegram then echoes it back in the
    ``X-Telegram-Bot-Api-Secret-Token`` header, which ``telegram_webhook()``
    validates on every incoming update.

    Best-effort and non-fatal: a missing token/secret/base URL is a silent
    no-op, and any network error is logged (never raised) so a flaky boot
    can't take the whole API down.
    """
    token = (settings.telegram_bot_token or "").strip()
    secret = (settings.telegram_webhook_secret or "").strip()
    base = _public_base_url()
    if not token or not secret or not base:
        # Nothing to do when the shared bot isn't fully configured — the
        # rest of the app degrades gracefully (status endpoints report
        # "not configured"), so just skip registration quietly.
        return

    url = f"{base}/telegram/webhook"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Skip the redundant setWebhook if Telegram already points at
            # this exact URL — keeps every boot cheap and avoids tripping
            # Telegram's setWebhook rate limit on rapid restarts.
            try:
                info_resp = await client.get(
                    f"https://api.telegram.org/bot{token}/getWebhookInfo"
                )
                if info_resp.status_code < 400:
                    current = (info_resp.json() or {}).get("result") or {}
                    if current.get("url") == url:
                        logger.info(
                            "Telegram webhook already registered at %s", url
                        )
                        return
            except Exception:
                # getWebhookInfo is only an optimisation — fall through to
                # an unconditional setWebhook if it fails for any reason.
                pass

            resp = await client.post(
                f"https://api.telegram.org/bot{token}/setWebhook",
                json={
                    "url": url,
                    "secret_token": secret,
                    "allowed_updates": _WEBHOOK_ALLOWED_UPDATES,
                },
            )
        if resp.status_code >= 400:
            logger.warning(
                "Telegram setWebhook failed (HTTP %s): %s",
                resp.status_code,
                resp.text[:300],
            )
            return
        data = resp.json()
        if not data.get("ok"):
            logger.warning(
                "Telegram setWebhook rejected: %s",
                data.get("description") or "unknown error",
            )
            return
        logger.info("Telegram webhook registered at %s", url)
    except Exception as exc:  # never let a network blip crash startup
        logger.warning("Telegram webhook registration error: %s", exc)


def _require_webhook_secret() -> str:
    if settings.telegram_bot_token and not settings.telegram_webhook_secret:
        raise HTTPException(
            status_code=503,
            detail="Telegram webhook secret is not configured.",
        )
    return settings.telegram_webhook_secret


def _telegram_configured(user_id: str | int | None = None) -> bool:
    return bool(resolved_settings(user_id).telegram_bot_token)


def _find_post(post_id: str) -> dict[str, Any] | None:
    for post in posts_list(all_users=True):
        if post.get("id") == post_id:
            return post
    return None


def _validation_keyboard(post_id: str) -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [
                {"text": "Approve", "callback_data": f"va|a|{post_id}"},
                {"text": "Reject", "callback_data": f"va|r|{post_id}"},
            ],
            [
                {"text": "Edit with AI", "callback_data": f"va|e|{post_id}"},
            ],
        ]
    }


def _timeout_keyboard(post_id: str) -> dict[str, Any]:
    """Buttons attached to the "post hit publish time without approval"
    follow-up. Mirrors the CEO requirement: never publish without explicit
    user action — the timeout prompt forces a decision."""
    return {
        "inline_keyboard": [
            [
                {"text": "Resend card", "callback_data": f"to|s|{post_id}"},
                {"text": "Regenerate", "callback_data": f"to|g|{post_id}"},
            ],
            [
                {"text": "Cancel", "callback_data": f"to|c|{post_id}"},
            ],
        ]
    }


def _timeout_text(post: dict[str, Any]) -> str:
    rule_name = post.get("source_rule_name") or "(unnamed rule)"
    return (
        "⏰ Validation timeout\n"
        f"Auto-generated post for rule '{rule_name}' reached its publish "
        f"time without a decision.\n"
        f"Post ID: {post.get('id')}\n\n"
        "What should I do?"
    )


async def send_timeout_prompt(
    post: dict[str, Any],
    chat_id: str,
    *,
    user_id: str | int | None = None,
) -> int:
    """Send the timeout-decision follow-up. Returns the Telegram message id
    so the worker can record it on the post (idempotency)."""
    result = await _telegram_call(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": _timeout_text(post),
            "reply_markup": _timeout_keyboard(post["id"]),
        },
        user_id=user_id,
    )
    return int(result.get("message_id") or 0)


def _validation_text(post: dict[str, Any]) -> str:
    platforms = [k for k, v in (post.get("platforms") or {}).items() if v]
    header = "Validation request"
    schedule = ""
    if post.get("scheduledDate"):
        schedule = f"\nSchedule: {post.get('scheduledDate')} {post.get('time') or ''}".rstrip()
    body = (post.get("content") or "").strip() or "(no text)"
    if len(body) > 1200:
        body = f"{body[:1197]}..."
    return (
        f"{header}\n"
        f"Post ID: {post.get('id')}\n"
        f"Platforms: {', '.join(platforms) or 'none'}"
        f"{schedule}\n\n"
        f"{body}"
    )


async def _telegram_call(
    method: str,
    payload: dict[str, Any],
    *,
    user_id: str | int | None = None,
) -> dict[str, Any]:
    cfg = resolved_settings(user_id)
    if not cfg.telegram_bot_token:
        raise HTTPException(409, "Telegram bot is not configured.")
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{cfg.telegram_bot_token}/{method}",
            json=payload,
        )
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": f"Telegram {method} failed.",
                "upstream_status": resp.status_code,
            },
        )
    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(502, data.get("description") or f"Telegram {method} failed.")
    return data.get("result") or {}


_CAPTION_LIMIT = 1024  # Telegram's hard limit for sendPhoto/sendVideo captions.


def _collect_media_for_telegram(post: dict[str, Any]) -> list[dict[str, str]]:
    """Return the post's uploaded media in a Telegram-friendly shape.

    Only items in ``status="uploaded"`` with a publicly fetchable
    ``remoteUrl`` are returned — Telegram needs to be able to GET the
    URL itself (we don't proxy bytes). Local blob: previews and items
    still uploading are skipped.
    """
    items: list[dict[str, str]] = []
    for m in post.get("media") or []:
        url = m.get("remoteUrl")
        if not url:
            continue
        # Skip local previews / failed uploads — Telegram can't reach those.
        if not (url.startswith("http://") or url.startswith("https://")):
            continue
        if m.get("status") and m["status"] != "uploaded":
            continue
        kind = "video" if (m.get("kind") == "video") else "photo"
        items.append({"type": kind, "url": url})
    return items


async def _send_validation_card(
    post: dict[str, Any],
    chat_id: str,
    *,
    user_id: str | int | None = None,
) -> int:
    """Send the validation prompt to Telegram. Picks the best transport
    based on what the post carries:

      • 0 media       → ``sendMessage`` with text + buttons
      • 1 photo/video → ``sendPhoto``/``sendVideo`` with caption + buttons
                        (or media + separate text message if the caption
                        would overflow Telegram's 1024-char cap)
      • multi-slide   → ``sendMediaGroup`` (no buttons supported on
                        groups) + follow-up ``sendMessage`` with buttons

    Returns the message id of whichever message carries the buttons —
    that's the one the approve/reject/edit callbacks reference.
    """
    text = _validation_text(post)
    keyboard = _validation_keyboard(post["id"])
    media = _collect_media_for_telegram(post)

    # No media → original text-only card.
    if not media:
        result = await _telegram_call(
            "sendMessage",
            {"chat_id": chat_id, "text": text, "reply_markup": keyboard},
            user_id=user_id,
        )
        return int(result.get("message_id") or 0)

    # Multi-slide carousel: sendMediaGroup doesn't accept inline_keyboard
    # on the group itself, so the buttons ride on a follow-up message.
    if len(media) > 1:
        group = [
            {"type": item["type"], "media": item["url"]}
            for item in media[:10]  # Telegram caps groups at 10 items
        ]
        try:
            await _telegram_call(
                "sendMediaGroup",
                {"chat_id": chat_id, "media": group},
                user_id=user_id,
            )
        except HTTPException:
            # If the group send fails (e.g. one URL unreachable), fall
            # through to text-only so the validation still happens.
            pass
        result = await _telegram_call(
            "sendMessage",
            {"chat_id": chat_id, "text": text, "reply_markup": keyboard},
            user_id=user_id,
        )
        return int(result.get("message_id") or 0)

    # Single media item: photo or video, caption + buttons inline when
    # the text fits, otherwise media first then a captioned button card.
    item = media[0]
    method = "sendVideo" if item["type"] == "video" else "sendPhoto"
    media_field = "video" if item["type"] == "video" else "photo"

    if len(text) <= _CAPTION_LIMIT:
        result = await _telegram_call(
            method,
            {
                "chat_id": chat_id,
                media_field: item["url"],
                "caption": text,
                "reply_markup": keyboard,
            },
            user_id=user_id,
        )
        return int(result.get("message_id") or 0)

    # Caption too long — send the media bare, then the text card with
    # the buttons. The buttons message is the one we track.
    try:
        await _telegram_call(
            method,
            {"chat_id": chat_id, media_field: item["url"]},
            user_id=user_id,
        )
    except HTTPException:
        pass
    result = await _telegram_call(
        "sendMessage",
        {"chat_id": chat_id, "text": text, "reply_markup": keyboard},
        user_id=user_id,
    )
    return int(result.get("message_id") or 0)


async def _answer_callback(
    callback_query_id: str,
    text: str = "",
    *,
    user_id: str | int | None = None,
) -> None:
    await _telegram_call(
        "answerCallbackQuery",
        {
            "callback_query_id": callback_query_id,
            **({"text": text} if text else {}),
        },
        user_id=user_id,
    )


async def _publish_manual(post: dict[str, Any], chat_id: str, fire_post) -> None:
    """Publish an approved manual post and report the result to the
    same Telegram chat that approved it. Runs as a background task —
    exceptions are caught and reported so a failed publish becomes a
    user-visible Telegram message, not a silently swallowed error."""
    try:
        result = await fire_post(post)
        published_status = (result or {}).get("status")
        if published_status == "published":
            results = (result or {}).get("publish_results") or []
            links = [
                f"{r.get('target_label') or r.get('platform')}: {r.get('permalink_url') or '(no link)'}"
                for r in results
                if r.get("ok")
            ]
            failures = [
                f"{r.get('target_label') or r.get('platform')}: {r.get('error') or 'unknown'}"
                for r in results
                if not r.get("ok")
            ]
            lines = [f"✅ Post {post['id']} published."]
            if links:
                lines.append("Links:\n" + "\n".join(links))
            if failures:
                lines.append("⚠ Some targets failed:\n" + "\n".join(failures))
            text = "\n\n".join(lines)
        else:
            text = (
                f"⚠ Post {post['id']} did not publish — "
                f"status={published_status}, error="
                f"{(result or {}).get('error') or 'unknown'}"
            )
    except Exception as exc:
        posts_update(
            post["id"],
            {"status": "error", "error": f"manual_approve_publish: {exc}"[:300]},
        )
        text = f"⚠ Publishing post {post['id']} crashed: {exc}"
    post_user_id = post.get("user_id")
    if chat_id and _telegram_configured(post_user_id):
        try:
            await _telegram_call(
                "sendMessage",
                {"chat_id": chat_id, "text": text},
                user_id=post_user_id,
            )
        except Exception:
            pass  # never re-raise from the background task


async def _regenerate_from_feedback(
    original: str,
    feedback: str,
    *,
    user_id: str | int | None = None,
) -> str:
    cfg = resolved_settings(user_id)
    if not cfg.ai_api_key:
        return original
    payload = {
        "model": cfg.ai_model,
        "temperature": 0.7,
        "max_tokens": 700,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You revise social media posts based on reviewer feedback. "
                    "Return only the rewritten post text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Original post:\n{original or '(empty)'}\n\n"
                    f"Reviewer feedback:\n{feedback}\n\n"
                    "Rewrite the post so it addresses the feedback while staying ready to publish."
                ),
            },
        ],
    }
    try:
        text, _usage = await _post_chat(payload, user_id=user_id)
    except HTTPException:
        return original
    text = (text or "").strip()
    return text or original


def _pending_post_payload(
    body: ValidationSubmitRequest,
    *,
    user_id: str | int | None = None,
) -> dict[str, Any]:
    return {
        "id": body.post_id,
        "content": body.content.strip(),
        "platforms": body.platforms or {},
        "status": "pending",
        "scheduledDate": body.scheduledDate or time.strftime("%Y-%m-%d"),
        "time": body.time,
        "timezone": body.timezone,
        "media": body.media or [],
        "ratios": body.ratios,
        "tiktok": body.tiktok,
        "validation_requested_at": time.time(),
        "user_id": str(user_id) if user_id not in (None, "", 0) else None,
    }


@router.get("/telegram/status", response_model=TelegramStatusResponse)
async def telegram_status(
    user_id: int = Depends(require_token),
) -> TelegramStatusResponse:
    cfg = resolved_settings(user_id)
    return TelegramStatusResponse(
        configured=bool(cfg.telegram_bot_token),
        default_chat_configured=bool(cfg.telegram_default_chat_id),
        webhook_secret_configured=bool(settings.telegram_webhook_secret),
    )


@router.post("/telegram/test")
async def telegram_test_message(
    chat_id: str | None = None,
    user_id: int = Depends(require_token),
) -> dict[str, Any]:
    """Send a one-shot test message to confirm the bot can reach a chat."""
    cfg = resolved_settings(user_id)
    if not cfg.telegram_bot_token:
        raise HTTPException(409, "Telegram bot is not configured (TELEGRAM_BOT_TOKEN missing).")
    target = (chat_id or cfg.telegram_default_chat_id or "").strip()
    if not target:
        raise HTTPException(
            409,
            "No chat id provided and no TELEGRAM_DEFAULT_CHAT_ID configured.",
        )
    result = await _telegram_call(
        "sendMessage",
        {
            "chat_id": target,
            "text": (
                "✅ Datalia bot test message.\n"
                "If you see this, the backend can reach this chat. "
                "You can now wire it as the validation_chat_id on automation rules."
            ),
        },
        user_id=user_id,
    )
    return {
        "ok": True,
        "chat_id": target,
        "message_id": result.get("message_id"),
    }


@router.post(
    "/validation/submit",
    response_model=ValidationSubmitResponse,
    dependencies=[Depends(require_token)],
)
async def submit_for_validation(
    body: ValidationSubmitRequest,
    user_id: int = Depends(require_token),
) -> ValidationSubmitResponse:
    cfg = resolved_settings(user_id)
    _require_webhook_secret()
    if not cfg.telegram_bot_token:
        raise HTTPException(409, "Telegram bot is not configured.")
    chat_id = (body.chat_id or cfg.telegram_default_chat_id).strip()
    if not chat_id:
        raise HTTPException(409, "No Telegram chat ID provided or configured.")

    existing = _find_post(body.post_id) if body.post_id else None
    payload = _pending_post_payload(body, user_id=user_id)
    if existing:
        post = posts_update(existing["id"], payload) or existing
    else:
        post = posts_create(payload)

    message_id = await _send_validation_card(post, chat_id, user_id=user_id)
    post = posts_update(
        post["id"],
        {
            "telegram_chat_id": chat_id,
            "telegram_message_id": message_id,
            "telegram_feedback_prompt_message_id": 0,
        },
    ) or post

    messages_append(
        {
            "kind": "validation",
            "post_id": post["id"],
            "message": f"Submitted post {post['id']} for Telegram validation.",
        }
    )
    return ValidationSubmitResponse(
        post_id=post["id"],
        status=post.get("status") or "pending",
        telegram_sent=True,
        chat_id=chat_id,
        message_id=message_id,
    )


@router.post("/telegram/webhook")
async def telegram_webhook(
    update: dict[str, Any],
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, bool]:
    expected = _require_webhook_secret()
    # Never process a webhook without a configured secret. _require_webhook_secret
    # only 503s when a bot token is set; if the bot is unconfigured `expected`
    # is "" and a caller sending an empty/no token would otherwise slip past a
    # plain `!=` check. Reject outright so the webhook can't be driven anonymously.
    if not expected:
        raise HTTPException(401, "Telegram webhook secret is not configured.")
    # Constant-time comparison to avoid leaking the secret via timing (matches
    # the bearer-token check in auth.py). compare_digest needs a real string.
    presented = x_telegram_bot_api_secret_token or ""
    if not hmac.compare_digest(presented, expected):
        raise HTTPException(401, "Invalid Telegram webhook secret.")

    callback = update.get("callback_query") or {}
    if callback:
        callback_id = str(callback.get("id") or "")
        data = str(callback.get("data") or "")
        message = callback.get("message") or {}
        chat_id = str((message.get("chat") or {}).get("id") or "")
        parts = data.split("|", 2)
        if len(parts) == 3 and parts[0] == "va":
            action, post_id = parts[1], parts[2]
            post = _find_post(post_id)
            if not post:
                await _answer_callback(callback_id, "Post no longer exists.")
                return {"ok": True}
            post_user_id = post.get("user_id")
            if action == "a":
                # Two paths:
                #   Automation-sourced (has source_rule_id + scheduled_for
                #   epoch) → status="scheduled" so the existing scheduler
                #   tick fires it at the original target time.
                #   Manual posts → publish IMMEDIATELY. Previously these
                #   went to status="approved" which the scheduler ignores,
                #   so manual approvals silently never published.
                is_automation = bool(post.get("source_rule_id"))
                if is_automation:
                    rule = automation_get(str(post.get("source_rule_id") or ""))
                    current_updated_at = float((rule or {}).get("updated_at") or 0)
                    generated_from_updated_at = float(
                        post.get("source_rule_updated_at") or 0
                    )
                    if (not rule) or (not rule.get("active", True)) or (
                        current_updated_at and generated_from_updated_at
                        and current_updated_at != generated_from_updated_at
                    ):
                        posts_update(
                            post_id,
                            {
                                "status": "cancelled",
                                "error": "rule_changed_after_generation",
                                "validated_at": time.time(),
                            },
                        )
                        messages_append(
                            {
                                "kind": "automation",
                                "post_id": post_id,
                                "message": (
                                    f"Auto-generated post {post_id} could not be "
                                    "approved because its rule changed after "
                                    "generation."
                                ),
                            }
                        )
                        await _answer_callback(
                            callback_id,
                            "Rule changed. Wait for a fresh validation card.",
                            user_id=post_user_id,
                        )
                        return {"ok": True}
                    posts_update(
                        post_id,
                        {
                            "status": "scheduled",
                            "validated_at": time.time(),
                        },
                    )
                    messages_append(
                        {
                            "kind": "validation",
                            "post_id": post_id,
                            "message": (
                                f"Auto-generated post {post_id} approved in "
                                "Telegram — scheduled to fire at its target time."
                            ),
                        }
                    )
                    await _answer_callback(
                        callback_id, "Approved — scheduled.", user_id=post_user_id
                    )
                else:
                    posts_update(
                        post_id,
                        {
                            "status": "publishing",
                            "validated_at": time.time(),
                        },
                    )
                    messages_append(
                        {
                            "kind": "validation",
                            "post_id": post_id,
                            "message": (
                                f"Post {post_id} approved in Telegram — "
                                "publishing now."
                            ),
                        }
                    )
                    await _answer_callback(
                        callback_id, "Approved — publishing.", user_id=post_user_id
                    )
                    # Fire in the background so the webhook returns fast
                    # (Telegram expects a webhook response within ~15s,
                    # and a publish call can take 30s+ for video). The
                    # scheduler's fire_post handles all the persistence
                    # bookkeeping + bell notifications on completion.
                    from .scheduler import fire_post  # lazy: avoid circular import
                    asyncio.create_task(_publish_manual(post, chat_id, fire_post))
            elif action == "r":
                # Automation-sourced rejections land as `rejected` (terminal,
                # the worker won't regenerate for this fire). Manual-flow
                # rejections drop back to `draft` so the user can edit and
                # resubmit.
                next_status = (
                    "rejected" if post.get("source_rule_id") else "draft"
                )
                posts_update(
                    post_id,
                    {
                        "status": next_status,
                        "error": "validation_rejected",
                        "validated_at": time.time(),
                    },
                )
                messages_append(
                    {
                        "kind": "validation",
                        "post_id": post_id,
                        "message": f"Post {post_id} rejected in Telegram.",
                    }
                )
                await _answer_callback(
                    callback_id, "Rejected.", user_id=post_user_id
                )
            elif action == "e":
                prompt_msg = await _telegram_call(
                    "sendMessage",
                    {
                        "chat_id": chat_id,
                        "text": "Reply to this message with the changes you want. Datalia will rewrite the post and send it back for approval.",
                        "reply_markup": {"force_reply": True, "input_field_placeholder": "What should change?"},
                    },
                    user_id=post_user_id,
                )
                posts_update(
                    post_id,
                    {
                        "telegram_chat_id": chat_id,
                        "telegram_feedback_prompt_message_id": int(prompt_msg.get("message_id") or 0),
                    },
                )
                await _answer_callback(
                    callback_id,
                    "Send your edits as a reply.",
                    user_id=post_user_id,
                )
        elif len(parts) == 3 and parts[0] == "to":
            # Timeout-prompt callbacks. Only valid for automation-sourced
            # posts still in awaiting_validation — defensive checks so
            # stale buttons (post deleted, already published) fail soft.
            action, post_id = parts[1], parts[2]
            post = _find_post(post_id)
            if not post:
                await _answer_callback(callback_id, "Post no longer exists.")
                return {"ok": True}
            post_user_id = post.get("user_id")
            if post.get("status") != "awaiting_validation":
                await _answer_callback(
                    callback_id,
                    f"Already {post.get('status')} — no action taken.",
                    user_id=post_user_id,
                )
                return {"ok": True}
            if action == "s":
                # Resend the original validation card. Useful if the team
                # missed it and wants another chance to approve. Clears
                # the timeout marker so the worker can send a new prompt
                # if it still doesn't get an answer.
                new_card_id = await _send_validation_card(
                    post, chat_id, user_id=post_user_id
                )
                posts_update(post_id, {
                    "telegram_chat_id": chat_id,
                    "telegram_message_id": new_card_id,
                    "timeout_prompt_sent_at": None,
                    "timeout_prompt_message_id": None,
                })
                messages_append({
                    "kind": "automation",
                    "post_id": post_id,
                    "message": f"Validation card for {post_id} resent after timeout.",
                })
                await _answer_callback(
                    callback_id, "Card resent.", user_id=post_user_id
                )
            elif action == "g":
                # Trigger a fresh AI generation, replacing the candidate's
                # caption and media. The new card is sent in-line so the
                # user stays in one chat thread. Lazy-import the worker to
                # avoid a circular dep at module load.
                from .automation_worker import regenerate_for_post  # type: ignore
                try:
                    await regenerate_for_post(post)
                    await _answer_callback(
                        callback_id, "Regenerating…", user_id=post_user_id
                    )
                except Exception as exc:
                    await _answer_callback(
                        callback_id,
                        f"Regen failed: {exc}",
                        user_id=post_user_id,
                    )
            elif action == "c":
                posts_update(post_id, {
                    "status": "cancelled",
                    "error": "validation_timeout_cancelled",
                    "validated_at": time.time(),
                })
                messages_append({
                    "kind": "validation",
                    "post_id": post_id,
                    "message": f"Auto-generated post {post_id} cancelled at timeout.",
                })
                await _answer_callback(
                    callback_id, "Cancelled.", user_id=post_user_id
                )
        return {"ok": True}

    message = update.get("message") or {}
    text = (message.get("text") or "").strip()
    chat_id = str((message.get("chat") or {}).get("id") or "")
    reply_to = (message.get("reply_to_message") or {}).get("message_id")
    if text and reply_to:
        target = next(
            (
                post
                for post in posts_list(all_users=True)
                if int(post.get("telegram_feedback_prompt_message_id") or 0) == int(reply_to)
                and str(post.get("telegram_chat_id") or "") == chat_id
            ),
            None,
        )
        if target:
            rewritten = await _regenerate_from_feedback(
                target.get("content", ""),
                text,
                user_id=target.get("user_id"),
            )
            updated = posts_update(
                target["id"],
                {
                    "content": rewritten,
                    "status": (
                        "awaiting_validation"
                        if target.get("source_rule_id")
                        else "pending"
                    ),
                    "error": "",
                    "validation_feedback": text,
                    "telegram_feedback_prompt_message_id": 0,
                },
            ) or target
            new_message_id = await _send_validation_card(
                updated,
                chat_id,
                user_id=updated.get("user_id"),
            )
            posts_update(
                updated["id"],
                {
                    "telegram_message_id": new_message_id,
                },
            )
            messages_append(
                {
                    "kind": "validation",
                    "post_id": updated["id"],
                    "message": f"Post {updated['id']} was revised from Telegram feedback and resubmitted.",
                }
            )
    return {"ok": True}
