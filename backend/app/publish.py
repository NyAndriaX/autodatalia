"""Per-platform publishing — turns a Datalia scheduled post into a real
post on the target social network.

Currently implements:
  • Facebook Page: text + optional image/link, single-call POST to /feed
  • Instagram Business: 2-step (create container, then publish)

LinkedIn and TikTok publish handlers will land here when their OAuth
flows are exercised end-to-end. The shape stays the same: each handler
takes (target_id, access_token, content, media_urls) and returns a
PublishResult with the platform's post id.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import os
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

from .config import settings

# ── Spam guards ─────────────────────────────────────────────────────
# Two cheap in-memory checks so a runaway button-press doesn't flood
# the user's social accounts and risk a platform-side ban.
#   COOLDOWN_SECONDS         — minimum gap between posts to the SAME target
#   DUPLICATE_WINDOW_SECONDS — refuse the same content+media to the same
#                              target within this window
# These survive only as long as the process — a restart resets them. That's
# acceptable: the goal is to catch accidental floods, not enforce policy.
COOLDOWN_SECONDS = 5
DUPLICATE_WINDOW_SECONDS = 5 * 60

# target_id -> [(content_hash, timestamp), ...]
_RECENT_POSTS: dict[str, list[tuple[str, float]]] = {}


def _content_hash(content: str, media_url: str | None) -> str:
    h = hashlib.sha256()
    h.update((content or "").encode("utf-8"))
    if media_url:
        h.update(b"\x00")
        h.update(media_url.encode("utf-8"))
    return h.hexdigest()[:16]


def check_spam_guard(target_id: str, content: str, media_url: str | None) -> str | None:
    """Return an error string if the publish should be blocked, else None."""
    now = time.time()
    key = _content_hash(content, media_url)
    history = _RECENT_POSTS.setdefault(target_id, [])
    history[:] = [(h, t) for h, t in history if now - t < DUPLICATE_WINDOW_SECONDS]
    if history and now - history[-1][1] < COOLDOWN_SECONDS:
        wait = COOLDOWN_SECONDS - int(now - history[-1][1])
        return f"cooldown_active: wait {wait}s before posting to this target again"
    if any(h == key for h, _ in history):
        return "duplicate_post: identical content posted to this target in the last 5 minutes"
    return None


def record_publish(target_id: str, content: str, media_url: str | None) -> None:
    """Remember a successful publish so the next call to check_spam_guard
    can refuse fast repeats / duplicates."""
    key = _content_hash(content, media_url)
    _RECENT_POSTS.setdefault(target_id, []).append((key, time.time()))


def _meta_error_message(resp_text: str) -> str | None:
    """Extract Meta's human-readable error message from an upstream response.

    Meta errors come back as {"error": {"message": "...", "code": N, ...}}.
    Surfacing this in the notification beats the generic "publish failed"
    string when debugging permission / token / URL-fetch issues.
    """
    try:
        body = json.loads(resp_text)
    except (ValueError, TypeError):
        return None
    err = body.get("error") if isinstance(body, dict) else None
    if not isinstance(err, dict):
        return None
    msg = err.get("message")
    code = err.get("code")
    if msg and code is not None:
        return f"Meta {code}: {msg}"
    return msg

# ── Result type ─────────────────────────────────────────────────────


@dataclass
class PublishResult:
    """One row in the response when /publish fans out across targets."""

    target_id: str          # Page ID, IG account ID, etc.
    target_label: str       # human-readable ("Datalia FB Page", "@datalia_official")
    platform: str           # "facebook" | "instagram" | "tiktok" | "linkedin"
    ok: bool
    platform_post_id: str | None = None
    permalink_url: str | None = None  # direct link to the live post
    error: str | None = None
    raw: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ── HTTP helper ─────────────────────────────────────────────────────


async def _post_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """POST → JSON, raises HTTPException on non-2xx with provider body."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, params=params, data=data)
    if resp.status_code >= 400:
        upstream = _meta_error_message(resp.text) or f"upstream HTTP {resp.status_code}"
        raise HTTPException(
            status_code=502,
            detail={
                "message": upstream,
                "url": url,
                "status_code": resp.status_code,
                "response": resp.text[:800],
            },
        )
    try:
        return resp.json()
    except ValueError:
        return {"raw": resp.text}


async def _get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, params=params)
    if resp.status_code >= 400:
        upstream = _meta_error_message(resp.text) or f"upstream HTTP {resp.status_code}"
        raise HTTPException(
            status_code=502,
            detail={
                "message": upstream,
                "url": url,
                "status_code": resp.status_code,
                "response": resp.text[:800],
            },
        )
    return resp.json()


# ── Facebook Page ───────────────────────────────────────────────────


async def publish_facebook_page(
    page_id: str,
    page_access_token: str,
    *,
    page_label: str,
    content: str,
    media_url: str | None = None,
    link: str | None = None,
    media_kind: str = "image",
) -> PublishResult:
    """Publish a post to a Facebook Page.

    Three branches:
      - Text-only / link share → POST /{page_id}/feed
      - Image (public URL)     → POST /{page_id}/photos
      - Video (public URL)     → POST /{page_id}/videos

    Facebook accepts a caption alongside both photos and videos, so we
    don't need a separate /feed call to attach text. Multi-image carousels
    are a separate, more complex flow (create unpublished photos, then
    reference them in a /feed call). Not built yet — single-asset covers
    95% of use.

    Both /photos and /videos accept a public `file_url` (image) or
    `file_url` (video) without any URL-prefix verification — unlike
    TikTok's PULL_FROM_URL which requires the prefix to be pre-verified.
    """
    base = "https://graph.facebook.com/v21.0"
    try:
        if media_url and media_kind == "video":
            # /videos accepts `file_url` for URL ingest. Returns {id} —
            # the post-id needed to build a permalink isn't surfaced
            # the same way as /photos, so we fetch it separately.
            data = await _post_json(
                f"{base}/{page_id}/videos",
                data={
                    "file_url": media_url,
                    "description": content,
                    "access_token": page_access_token,
                    "published": "true",
                },
            )
            post_id = data.get("post_id") or data.get("id")
        elif media_url:
            data = await _post_json(
                f"{base}/{page_id}/photos",
                data={
                    "url": media_url,
                    "caption": content,
                    "access_token": page_access_token,
                    "published": "true",
                },
            )
            # /photos returns {id, post_id} — post_id is the feed entry
            post_id = data.get("post_id") or data.get("id")
        else:
            data = await _post_json(
                f"{base}/{page_id}/feed",
                data={
                    "message": content,
                    **({"link": link} if link else {}),
                    "access_token": page_access_token,
                    "published": "true",
                },
            )
            post_id = data.get("id")

        # The post_id Meta returns is `{pageId}_{storyId}` — that path is
        # publicly resolvable via facebook.com and redirects to the post.
        permalink = f"https://www.facebook.com/{post_id}" if post_id else None
        return PublishResult(
            target_id=page_id,
            target_label=page_label,
            platform="facebook",
            ok=True,
            platform_post_id=post_id,
            permalink_url=permalink,
            raw=data,
        )
    except HTTPException as exc:
        err = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        return PublishResult(
            target_id=page_id,
            target_label=page_label,
            platform="facebook",
            ok=False,
            error=err.get("message") or "publish_failed",
            raw=err,
        )


# ── Instagram Business ──────────────────────────────────────────────


async def publish_instagram(
    ig_user_id: str,
    page_access_token: str,
    *,
    ig_label: str,
    content: str,
    media_url: str,
    media_kind: str = "image",
) -> PublishResult:
    """Publish to an Instagram Business account via the Graph API.

    Two-step process:
      1. POST /{ig_user_id}/media → create a media container (returns id)
      2. POST /{ig_user_id}/media_publish → publish the container

    Notes:
      - media_url MUST be publicly fetchable by Meta's servers. Our
        tunnel.py exists specifically to expose local content/ over HTTPS
        for this reason.
      - For video, IG processes asynchronously; we poll the container's
        `status_code` field until FINISHED before publishing.
      - REELS use `media_type=REELS` and have the same shape as VIDEO.
    """
    base = "https://graph.facebook.com/v21.0"

    try:
        # Step 1 — create container
        container_params: dict[str, Any] = {
            "caption": content,
            "access_token": page_access_token,
        }
        if media_kind == "video":
            # Prefer REELS over legacy VIDEO — REELS allows up to 15min
            # and is the only path Meta still actively develops. Legacy
            # VIDEO returns `Meta 100: Invalid parameter` for clips that
            # exceed 60s; REELS goes up to 15min so the same upload that
            # would fail as a feed video posts cleanly as a reel.
            container_params["media_type"] = "REELS"
            container_params["video_url"] = media_url
            # Also surface in feed (default is reels-tab-only). Without
            # this flag the post is technically published but invisible
            # in the regular profile timeline.
            container_params["share_to_feed"] = "true"
        else:
            container_params["image_url"] = media_url

        container = await _post_json(
            f"{base}/{ig_user_id}/media",
            data=container_params,
        )
        creation_id = container.get("id")
        if not creation_id:
            raise HTTPException(
                502, "Instagram returned no creation_id from /media."
            )

        # Step 2 — for video, wait for processing; for image we can publish
        # right away.
        if media_kind == "video":
            for _ in range(30):  # up to ~60s
                status = await _get_json(
                    f"{base}/{creation_id}",
                    params={"fields": "status_code", "access_token": page_access_token},
                )
                code = status.get("status_code")
                if code == "FINISHED":
                    break
                if code == "ERROR":
                    raise HTTPException(
                        502, f"Instagram video processing failed: {status}"
                    )
                await asyncio.sleep(2)

        publish = await _post_json(
            f"{base}/{ig_user_id}/media_publish",
            data={
                "creation_id": creation_id,
                "access_token": page_access_token,
            },
        )

        media_id = publish.get("id")
        # IG doesn't return the permalink with the publish response — one
        # extra GET is cheap and gives the user a click-through link.
        permalink: str | None = None
        if media_id:
            try:
                meta = await _get_json(
                    f"{base}/{media_id}",
                    params={"fields": "permalink", "access_token": page_access_token},
                )
                permalink = meta.get("permalink")
            except HTTPException:
                permalink = None
        return PublishResult(
            target_id=ig_user_id,
            target_label=ig_label,
            platform="instagram",
            ok=True,
            platform_post_id=media_id,
            permalink_url=permalink,
            raw={"container": container, "publish": publish},
        )
    except HTTPException as exc:
        err = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        return PublishResult(
            target_id=ig_user_id,
            target_label=ig_label,
            platform="instagram",
            ok=False,
            error=err.get("message") or "publish_failed",
            raw=err,
        )


# ── TikTok stub ─────────────────────────────────────────────────────


def _resolve_media_to_disk_path(media_url: str | None) -> Path | None:
    """Map a public media URL (the one we'd hand to TikTok via
    PULL_FROM_URL) back to its local file path so we can read the bytes
    for the FILE_UPLOAD flow.

    The /upload endpoint stores everything flat in `settings.content_dir`
    and serves it under <base>/content/<filename>. So the trailing path
    segment after /content/ is the on-disk filename. Returns None when
    the URL doesn't map to a local file (e.g. someone passed an external
    URL) — caller falls back to PULL_FROM_URL or fails cleanly.
    """
    if not media_url:
        return None
    marker = "/content/"
    idx = media_url.find(marker)
    if idx < 0:
        return None
    rel = media_url[idx + len(marker):]
    # Defence in depth: never let "../" escape content_dir.
    candidate = (settings.content_dir / rel).resolve()
    try:
        candidate.relative_to(settings.content_dir.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


async def publish_tiktok_photo(
    open_id: str,
    access_token: str,
    *,
    handle_label: str,
    content: str,
    photo_url: str,
    privacy_level: str = "SELF_ONLY",
    disclose_video_branded: bool = False,
    disclose_video_your_brand: bool = False,
    audit_mode: str = "inbox",
) -> PublishResult:
    """Publish a photo to TikTok via /v2/post/publish/content/init/.

    TikTok's photo flow ONLY supports PULL_FROM_URL (no FILE_UPLOAD), so
    the photo_url's prefix must be pre-verified under "URL Properties"
    in the TikTok Developer Portal. If verification is pending the init
    call comes back with `url_ownership_unverified` — we surface that
    verbatim so the user knows what to fix.

    `post_mode`:
      - "MEDIA_UPLOAD"  → draft / inbox. The user opens TikTok and taps
                          Publish manually. Works with the sandbox
                          `video.upload` scope.
      - "DIRECT_POST"   → posts directly. Requires post-audit
                          `video.publish` scope.
    """
    base = "https://open.tiktokapis.com/v2/post/publish"
    init_path = f"{base}/content/init/"
    post_mode = "DIRECT_POST" if audit_mode == "direct" else "MEDIA_UPLOAD"

    body = {
        "post_info": {
            "title": (content or "")[:90],
            "description": (content or "")[:2200],
            "disable_comment": False,
            "privacy_level": privacy_level,
            "auto_add_music": True,
            "brand_content_toggle": bool(disclose_video_branded),
            "brand_organic_toggle": bool(disclose_video_your_brand),
        },
        "source_info": {
            "source": "PULL_FROM_URL",
            "photo_cover_index": 0,
            "photo_images": [photo_url],
        },
        "post_mode": post_mode,
        "media_type": "PHOTO",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            init_resp = await client.post(
                init_path,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                },
                json=body,
            )
        if init_resp.status_code >= 400:
            # Try to surface TikTok's structured error.
            try:
                err = init_resp.json().get("error") or {}
                code = err.get("code") or ""
                msg = err.get("message") or init_resp.text[:200]
            except ValueError:
                code = ""
                msg = init_resp.text[:200]
            hint = ""
            if "url_ownership" in code or "url_ownership" in msg.lower():
                hint = (
                    " — verify the host prefix under TikTok Developer Portal "
                    "→ URL Properties before retrying"
                )
            return PublishResult(
                target_id=open_id,
                target_label=handle_label,
                platform="tiktok",
                ok=False,
                error=f"tiktok_photo_init_failed: {code or 'HTTP ' + str(init_resp.status_code)}: {msg}{hint}",
                raw={"response": init_resp.text[:800]},
            )
        init_data = init_resp.json().get("data") or {}
        publish_id = init_data.get("publish_id")
        if not publish_id:
            return PublishResult(
                target_id=open_id,
                target_label=handle_label,
                platform="tiktok",
                ok=False,
                error="tiktok_init_returned_no_publish_id",
                raw=init_resp.json(),
            )

        # Poll the status endpoint for terminal state, just like video.
        terminal_success = {"SEND_TO_USER_INBOX", "PUBLISH_COMPLETE"}
        terminal_failure = {"FAILED"}
        status_url = f"{base}/status/fetch/"
        permalink: str | None = None
        last_status: str | None = None
        last_payload: dict[str, Any] | None = None
        for _ in range(30):
            async with httpx.AsyncClient(timeout=30.0) as client:
                status_resp = await client.post(
                    status_url,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json; charset=UTF-8",
                    },
                    json={"publish_id": publish_id},
                )
            if status_resp.status_code >= 400:
                return PublishResult(
                    target_id=open_id,
                    target_label=handle_label,
                    platform="tiktok",
                    ok=False,
                    error=f"tiktok_status_failed: HTTP {status_resp.status_code}",
                    raw={"response": status_resp.text[:800]},
                )
            last_payload = status_resp.json().get("data") or {}
            last_status = last_payload.get("status")
            permalink = last_payload.get("publicaly_available_post_id") or last_payload.get(
                "publicly_available_post_id"
            )
            if last_status in terminal_success:
                break
            if last_status in terminal_failure:
                return PublishResult(
                    target_id=open_id,
                    target_label=handle_label,
                    platform="tiktok",
                    ok=False,
                    error=f"tiktok_publish_failed: {last_payload.get('fail_reason') or last_status}",
                    raw=last_payload,
                )
            await asyncio.sleep(2)

        permalink_url = (
            f"https://www.tiktok.com/@{handle_label.lstrip('@')}/video/{permalink}"
            if permalink
            else None
        )
        return PublishResult(
            target_id=open_id,
            target_label=handle_label,
            platform="tiktok",
            ok=True,
            platform_post_id=permalink or publish_id,
            permalink_url=permalink_url,
            raw={"status": last_status, "data": last_payload},
        )
    except Exception as exc:
        return PublishResult(
            target_id=open_id,
            target_label=handle_label,
            platform="tiktok",
            ok=False,
            error=f"tiktok_exception: {exc}",
        )


async def publish_tiktok(
    open_id: str,
    access_token: str,
    *,
    handle_label: str,
    content: str,
    video_url: str,
    privacy_level: str = "SELF_ONLY",
    disclose_video_branded: bool = False,
    disclose_video_your_brand: bool = False,
    audit_mode: str = "inbox",
    upload_mode: str | None = None,
) -> PublishResult:
    """Publish a video to TikTok via the Content Posting API.

    `audit_mode` picks the endpoint family:
      - "inbox"  → /v2/post/publish/inbox/video/init/  (sandbox / pre-audit;
                  video lands in the user's TikTok inbox, they tap Publish
                  manually in-app)
      - "direct" → /v2/post/publish/video/init/  (post-audit direct-post;
                  requires `video.publish` scope)

    `upload_mode` picks how the video bytes get to TikTok:
      - "pull"  → PULL_FROM_URL: we hand TikTok the public URL; TikTok's
                  servers fetch it. Requires the URL prefix to be
                  pre-verified in TikTok's URL Properties.
      - "file"  → FILE_UPLOAD: we PUT the bytes directly to the
                  upload_url TikTok returns from /init/. No URL
                  verification needed. Same flow Buffer / Hootsuite use.

    When `upload_mode` is None (default), reads TIKTOK_UPLOAD_MODE from
    the env; if that's unset, defaults to "file" because the unverified-
    prefix failure ("invalid domain") is what blocks every new install.

    `privacy_level`: PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS |
    FOLLOWER_OF_CREATOR | SELF_ONLY. Sandbox forces SELF_ONLY regardless;
    once audited the full set is honoured.
    """
    if not video_url:
        return PublishResult(
            target_id=open_id,
            target_label=handle_label,
            platform="tiktok",
            ok=False,
            error="tiktok_requires_video",
        )

    # Resolve the upload mode. FILE_UPLOAD is the safer default — it
    # works regardless of URL-prefix verification status.
    mode = (upload_mode or os.environ.get("TIKTOK_UPLOAD_MODE") or "file").lower()
    if mode not in ("pull", "file"):
        mode = "file"

    base = "https://open.tiktokapis.com/v2/post/publish"
    # Effective audit_mode can be downgraded mid-flow (see auto-retry block
    # below) so we use a local var instead of mutating the parameter.
    effective_audit = audit_mode
    init_path = f"{base}/inbox/video/init/" if effective_audit == "inbox" else f"{base}/video/init/"

    # Inbox endpoint rejects `post_info` entirely — it only accepts
    # source_info. Direct endpoint needs the full post_info. Build the
    # right shape for each.
    def _build_post_info(_privacy: str) -> dict[str, Any]:
        return {
            "title": content[:2200] if content else "",
            "privacy_level": _privacy,
            "disable_duet": False,
            "disable_comment": False,
            "disable_stitch": False,
            "video_cover_timestamp_ms": 1000,
            # Two branded-content flags TikTok specifically requires the UI
            # to surface separately; we forward whatever the editor sent.
            "brand_content_toggle": bool(disclose_video_branded),
            "brand_organic_toggle": bool(disclose_video_your_brand),
        }

    post_info = _build_post_info(privacy_level)

    # Build the source_info block based on upload mode.
    if mode == "pull":
        source_info = {"source": "PULL_FROM_URL", "video_url": video_url}
        local_path: Path | None = None
        video_size = 0
    else:
        local_path = _resolve_media_to_disk_path(video_url)
        if local_path is None:
            return PublishResult(
                target_id=open_id,
                target_label=handle_label,
                platform="tiktok",
                ok=False,
                error="tiktok_file_upload_needs_local_media",
                raw={"video_url": video_url},
            )
        video_size = local_path.stat().st_size
        # TikTok chunked-upload knobs. Single-chunk for anything under 64 MB
        # keeps the code simple — almost every short-form TikTok video fits.
        # Larger files would need a chunked loop; not relevant at our scale.
        chunk_size = video_size
        total_chunk_count = 1
        source_info = {
            "source": "FILE_UPLOAD",
            "video_size": video_size,
            "chunk_size": chunk_size,
            "total_chunk_count": total_chunk_count,
        }

    init_body: dict[str, Any] = (
        # Direct endpoint expects post_info + source_info; inbox endpoint
        # ONLY accepts source_info (TikTok throws "invalid params" if you
        # send post_info to the inbox URL).
        {"post_info": post_info, "source_info": source_info}
        if effective_audit == "direct"
        else {"source_info": source_info}
    )

    async def _do_init(path: str, body: dict[str, Any]) -> tuple[int, str, dict[str, Any]]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                path,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                },
                json=body,
            )
        try:
            j = r.json()
        except ValueError:
            j = {}
        return r.status_code, r.text, j

    try:
        init_status, init_text, init_json = await _do_init(init_path, init_body)

        # Auto-retry as inbox when direct post hits the unaudited-client
        # account-privacy wall. Sandbox/unaudited apps can only direct-post
        # to TikTok accounts that have "Private account" turned on inside
        # the TikTok mobile app — post-level SELF_ONLY isn't enough. Rather
        # than failing the publish, we fall back to the inbox draft flow
        # so the video still reaches TikTok (user confirms in-app).
        if init_status == 403 and effective_audit == "direct":
            err_code_lower = ((init_json.get("error") or {}).get("code") or "").lower()
            if (
                "unaudited" in err_code_lower
                or "privacy_level" in err_code_lower
            ):
                print(
                    f"[tiktok] direct→inbox auto-retry: {err_code_lower}. "
                    "Tip: turn ON Private account in TikTok app to unblock direct post in sandbox."
                )
                effective_audit = "inbox"
                init_path = f"{base}/inbox/video/init/"
                init_body = {"source_info": source_info}
                init_status, init_text, init_json = await _do_init(init_path, init_body)

        # Use the renamed locals from here on.
        init_resp_status = init_status
        init_resp_text = init_text
        init_resp_json = init_json

        if init_resp_status >= 400:
            # Unpack TikTok's structured error so the bell shows the
            # actual cause, not just "HTTP 403". TikTok returns
            # {"error": {"code": "...", "message": "...", "log_id": "..."}}
            # — the code is the only thing that maps to a fix:
            #   url_ownership_unverified       → verify URL prefix in portal
            #   spam_risk_user_banned          → account flagged, wait it out
            #   spam_risk_too_many_posts       → daily quota hit
            #   privacy_level_option_mismatch  → privacy_level not allowed
            #                                    for unaudited apps (must be
            #                                    SELF_ONLY in sandbox)
            #   unaudited_client_can_only_post_to_private_accounts → same
            #   access_token_invalid           → token expired/revoked
            err_body = init_resp_json if isinstance(init_resp_json, dict) else {}
            err_obj = err_body.get("error") or {}
            err_code = err_obj.get("code") or ""
            err_msg = err_obj.get("message") or init_resp_text[:300]
            hint = ""
            cl = err_code.lower()
            if "url_ownership" in cl:
                hint = " — verify your ngrok host under TikTok Developer Portal → URL Properties"
            elif "unaudited" in cl:
                hint = (
                    " — unaudited apps can only direct-post to PRIVATE TikTok accounts. "
                    "Toggle 'Private account' ON in your TikTok app "
                    "(Settings & Privacy → Privacy) to unblock direct post. "
                    "Already retried as inbox draft."
                )
            elif "privacy_level" in cl:
                hint = " — sandbox / unaudited apps must use privacy_level=SELF_ONLY"
            elif "spam_risk" in cl:
                hint = " — TikTok has rate-limited this account; wait before retrying"
            elif "access_token" in cl:
                hint = " — reconnect TikTok in Settings (token expired or revoked)"
            print(
                f"[tiktok] init {init_resp_status} code={err_code or '?'} "
                f"msg={err_msg[:200] if err_msg else init_resp_text[:200]}"
            )
            return PublishResult(
                target_id=open_id,
                target_label=handle_label,
                platform="tiktok",
                ok=False,
                error=(
                    f"tiktok_init_failed: {err_code or 'HTTP ' + str(init_resp_status)}"
                    f"{': ' + err_msg if err_msg else ''}{hint}"
                ),
                raw={"response": init_resp_text[:800], "error": err_obj if err_body else None},
            )
        init_data = init_resp_json.get("data") or {}
        publish_id = init_data.get("publish_id")
        if not publish_id:
            return PublishResult(
                target_id=open_id,
                target_label=handle_label,
                platform="tiktok",
                ok=False,
                error="tiktok_init_returned_no_publish_id",
                raw=init_resp_json,
            )

        # FILE_UPLOAD bytes step. Init returned an `upload_url`; we PUT the
        # whole file there with the Content-Range header TikTok requires.
        # Single-chunk path only — for >64 MB videos this would be a loop
        # over chunk_size slices, but our editor caps at well under that.
        if mode == "file" and local_path is not None:
            upload_url = init_data.get("upload_url")
            if not upload_url:
                return PublishResult(
                    target_id=open_id,
                    target_label=handle_label,
                    platform="tiktok",
                    ok=False,
                    error="tiktok_init_returned_no_upload_url",
                    raw=init_data,
                )
            video_bytes = local_path.read_bytes()
            content_type = (
                mimetypes.guess_type(local_path.name)[0] or "video/mp4"
            )
            async with httpx.AsyncClient(timeout=300.0) as client:
                put_resp = await client.put(
                    upload_url,
                    headers={
                        "Content-Type": content_type,
                        "Content-Length": str(len(video_bytes)),
                        # Required by TikTok: byte range for this chunk.
                        # bytes <start>-<end>/<total>; we send one chunk
                        # that covers the whole file.
                        "Content-Range": f"bytes 0-{len(video_bytes) - 1}/{len(video_bytes)}",
                    },
                    content=video_bytes,
                )
            # TikTok returns 201 Created (or 200) on a complete upload,
            # 308 Resume Incomplete on partial / chunked uploads. Anything
            # 4xx/5xx is a hard failure for our single-chunk flow.
            if put_resp.status_code >= 400:
                return PublishResult(
                    target_id=open_id,
                    target_label=handle_label,
                    platform="tiktok",
                    ok=False,
                    error=f"tiktok_upload_failed: HTTP {put_resp.status_code}",
                    raw={"response": put_resp.text[:800]},
                )

        # Poll the status endpoint until the upload is done or fails.
        # Inbox mode finishes at "SEND_TO_USER_INBOX" (user has to tap),
        # direct mode at "PUBLISH_COMPLETE" (a permalink_url is returned).
        terminal_success = {"SEND_TO_USER_INBOX", "PUBLISH_COMPLETE"}
        terminal_failure = {"FAILED"}

        status_url = f"{base}/status/fetch/"
        permalink: str | None = None
        last_status: str | None = None
        last_payload: dict[str, Any] | None = None
        for _ in range(30):  # ~60s budget at 2s poll
            async with httpx.AsyncClient(timeout=30.0) as client:
                status_resp = await client.post(
                    status_url,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json; charset=UTF-8",
                    },
                    json={"publish_id": publish_id},
                )
            if status_resp.status_code >= 400:
                return PublishResult(
                    target_id=open_id,
                    target_label=handle_label,
                    platform="tiktok",
                    ok=False,
                    error=f"tiktok_status_failed: HTTP {status_resp.status_code}",
                    raw={"response": status_resp.text[:800]},
                )
            last_payload = status_resp.json().get("data") or {}
            last_status = last_payload.get("status")
            permalink = last_payload.get("publicaly_available_post_id") or last_payload.get(
                "publicly_available_post_id"
            )  # TikTok docs use both spellings across versions
            if last_status in terminal_success:
                break
            if last_status in terminal_failure:
                fail_reason = last_payload.get("fail_reason") or last_status
                # file_format_check_failed on a video upload usually means
                # codec/container mismatch (TikTok wants H.264 + AAC in MP4).
                # snaptik / re-encoded downloads sometimes ship with HEVC or
                # AV1; the audit reviewer also rejects out-of-range
                # resolutions (min 540x960) and durations (3-60s for inbox).
                hint = ""
                if "file_format" in str(fail_reason).lower():
                    hint = (
                        " — TikTok needs H.264/AAC MP4, ≥540×960, 3-60s. "
                        "Re-encode with ffmpeg if a downloader stripped the codec."
                    )
                return PublishResult(
                    target_id=open_id,
                    target_label=handle_label,
                    platform="tiktok",
                    ok=False,
                    error=f"tiktok_publish_failed: {fail_reason}{hint}",
                    raw=last_payload,
                )
            await asyncio.sleep(2)

        permalink_url = (
            f"https://www.tiktok.com/@{handle_label.lstrip('@')}/video/{permalink}"
            if permalink
            else None
        )
        return PublishResult(
            target_id=open_id,
            target_label=handle_label,
            platform="tiktok",
            ok=True,
            platform_post_id=permalink or publish_id,
            permalink_url=permalink_url,
            raw={"status": last_status, "data": last_payload},
        )
    except Exception as exc:
        return PublishResult(
            target_id=open_id,
            target_label=handle_label,
            platform="tiktok",
            ok=False,
            error=f"tiktok_exception: {exc}",
        )


# ── LinkedIn stub ───────────────────────────────────────────────────


async def publish_linkedin(
    member_or_org_urn: str,
    access_token: str,
    *,
    label: str,
    content: str,
    media_url: str | None = None,
) -> PublishResult:
    """LinkedIn UGC posts — stub until LinkedIn creds land.

    Personal post path (no review needed):
      POST /v2/ugcPosts
        author = "urn:li:person:{id}"
        lifecycleState = "PUBLISHED"
        specificContent."com.linkedin.ugc.ShareContent" with shareCommentary + media

    Organization (Page) post requires Community Management API approval;
    same endpoint, different author URN ("urn:li:organization:{id}").
    """
    return PublishResult(
        target_id=member_or_org_urn,
        target_label=label,
        platform="linkedin",
        ok=False,
        error="linkedin_publish_not_implemented",
    )


# ── Public surface (for the FastAPI route) ──────────────────────────


async def build_targets_from_post(
    *,
    platforms: dict[str, bool],
    media_url: str | None,
    media_kind: str = "image",
    link: str | None = None,
    ratios: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Build a publish-ready target list from a Post's `platforms` toggle map.

    The HTTP /publish route receives explicit {platform, id} pairs the
    frontend picked. The scheduler doesn't have a frontend — it just has
    `platforms: {facebook: true, ...}` on the stored post, so it needs to
    re-discover the connected destinations itself. Mirrors the resolution
    /publish does inline, but starts one step earlier (toggles → targets)
    and returns fully token-resolved rows ready for publish_to_targets.

    Platforms that aren't connected are skipped silently — the caller
    surfaces "no targets" on the post when the list ends up empty.
    """
    # Local imports keep publish.py free of an oauth.py module-level dep.
    from .oauth import _load_tokens, _fetch_meta_pages
    from .images import crop_for_targets

    tokens = _load_tokens()
    meta_record = tokens.get("meta") or {}
    user_meta_token = meta_record.get("access_token")
    enabled = [k for k, v in (platforms or {}).items() if v]
    if not enabled:
        return []

    pages = await _fetch_meta_pages(user_meta_token) if user_meta_token else []
    resolved: list[dict[str, Any]] = []

    for platform in enabled:
        if platform == "facebook":
            for page in pages:
                resolved.append({
                    "platform": "facebook",
                    "id": page["page_id"],
                    "label": page["page_name"],
                    "access_token": page["page_access_token"],
                    "media_url": media_url,
                    "media_kind": "image",
                    "link": link,
                })
        elif platform == "instagram":
            for page in pages:
                ig = page.get("instagram") or {}
                if not ig.get("ig_id"):
                    continue
                resolved.append({
                    "platform": "instagram",
                    "id": ig["ig_id"],
                    "label": f"@{ig['username']}" if ig.get("username") else ig["ig_id"],
                    "access_token": page["page_access_token"],
                    "media_url": media_url,
                    "media_kind": media_kind,
                })
        elif platform == "tiktok":
            record = tokens.get("tiktok") or {}
            token = record.get("access_token")
            if not token:
                continue
            raw = record.get("raw") or {}
            open_id = record.get("open_id") or raw.get("open_id")
            handle = record.get("username") or record.get("display_name")
            resolved.append({
                "platform": "tiktok",
                "id": open_id or "tiktok",
                "label": f"@{handle}" if handle else (open_id or "tiktok"),
                "access_token": token,
                "media_url": media_url,
                "media_kind": "video",  # TikTok is video-only
            })
        elif platform == "linkedin":
            record = tokens.get(platform) or {}
            token = record.get("access_token")
            if not token:
                continue
            raw = record.get("raw") or {}
            resolved.append({
                "platform": platform,
                "id": raw.get("urn") or platform,
                "label": platform,
                "access_token": token,
                "media_url": media_url,
                "media_kind": media_kind,
            })

    for r in resolved:
        r["media_url"] = crop_for_targets(
            media_url=r.get("media_url"),
            ratios=ratios,
            platform=r["platform"],
        )
    return resolved


async def publish_to_targets(
    *,
    content: str,
    targets: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fan out one post across N targets in parallel.

    `targets` shape (each item describes one destination + how to reach it):
      {
        "platform": "facebook" | "instagram" | "tiktok" | "linkedin",
        "id": "<page_id | ig_id | open_id | urn>",
        "label": "<human readable>",
        "access_token": "<token to use>",
        "media_url": <optional public URL>,
        "media_kind": "image" | "video",   # IG only
      }

    Returns a list of PublishResult dicts in the same order.
    """
    started = time.time()

    async def _dispatch(t: dict[str, Any]) -> PublishResult:
        platform = t.get("platform")
        # Spam guard: cooldown + duplicate-content check per target. Runs
        # before any upstream call so a flood never reaches the platform.
        guard = check_spam_guard(t["id"], content, t.get("media_url"))
        if guard:
            return PublishResult(
                target_id=t["id"],
                target_label=t.get("label") or t["id"],
                platform=platform or "unknown",
                ok=False,
                error=guard,
            )
        if platform == "facebook":
            # Auto-detect image vs video from URL extension if the caller
            # didn't set media_kind. Without this the default routes to
            # /photos for video URLs and Meta replies with `324: Missing
            # or invalid image file`.
            fb_kind = (t.get("media_kind") or "").lower()
            if fb_kind not in ("image", "video"):
                ext = (t.get("media_url") or "").lower().rsplit(".", 1)[-1]
                fb_kind = "video" if ext in {"mp4", "mov", "webm", "m4v"} else "image"
            return await publish_facebook_page(
                t["id"], t["access_token"],
                page_label=t.get("label") or t["id"],
                content=content,
                media_url=t.get("media_url"),
                link=t.get("link"),
                media_kind=fb_kind,
            )
        if platform == "instagram":
            media = t.get("media_url")
            if not media:
                return PublishResult(
                    target_id=t["id"],
                    target_label=t.get("label") or t["id"],
                    platform="instagram",
                    ok=False,
                    error="instagram_requires_media",
                )
            return await publish_instagram(
                t["id"], t["access_token"],
                ig_label=t.get("label") or t["id"],
                content=content,
                media_url=media,
                media_kind=t.get("media_kind", "image"),
            )
        if platform == "tiktok":
            # Route image vs video to the correct TikTok endpoint —
            # /video/init/ rejects non-video bytes with
            # `file_format_check_failed` during processing.
            if t.get("media_kind") == "image":
                return await publish_tiktok_photo(
                    t["id"], t["access_token"],
                    handle_label=t.get("label") or t["id"],
                    content=content,
                    photo_url=t.get("media_url") or "",
                    privacy_level=t.get("privacy_level", "SELF_ONLY"),
                    disclose_video_branded=t.get("disclose_video_branded", False),
                    disclose_video_your_brand=t.get("disclose_video_your_brand", False),
                    audit_mode=t.get("audit_mode", "inbox"),
                )
            return await publish_tiktok(
                t["id"], t["access_token"],
                handle_label=t.get("label") or t["id"],
                content=content,
                video_url=t.get("media_url") or "",
                privacy_level=t.get("privacy_level", "SELF_ONLY"),
                disclose_video_branded=t.get("disclose_video_branded", False),
                disclose_video_your_brand=t.get("disclose_video_your_brand", False),
                audit_mode=t.get("audit_mode", "inbox"),
            )
        if platform == "linkedin":
            return await publish_linkedin(
                t["id"], t["access_token"],
                label=t.get("label") or t["id"],
                content=content,
                media_url=t.get("media_url"),
            )
        return PublishResult(
            target_id=t.get("id", "?"),
            target_label=t.get("label", "?"),
            platform=platform or "unknown",
            ok=False,
            error=f"unknown_platform:{platform}",
        )

    results = await asyncio.gather(*(_dispatch(t) for t in targets), return_exceptions=False)
    # Record each success so future calls to check_spam_guard see it.
    for r, t in zip(results, targets):
        if r.ok:
            record_publish(t["id"], content, t.get("media_url"))
    elapsed_ms = int((time.time() - started) * 1000)
    return [
        {**r.to_dict(), "elapsed_ms_total": elapsed_ms} for r in results
    ]
