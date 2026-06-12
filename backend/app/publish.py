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
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from .config import settings
from .net_guard import assert_safe_url, safe_get_async

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


def _local_path_for_content_url(url: str) -> Path | None:
    """If `url` points at one of our own /content/<filename> URLs, return
    the matching path on disk. Returns None for foreign URLs (e.g. user
    pasted a third-party image) or anything outside the content dir.

    Used by the publish pre-flight to detect "URL exists in the draft
    but the file is gone from disk" — surfaces a clear error instead of
    letting Meta/TikTok complain about a fetch failure 30s later.
    """
    if not url:
        return None
    marker = "/content/"
    idx = url.find(marker)
    if idx < 0:
        return None
    rel = url[idx + len(marker):]
    # Strip any query string / fragment.
    for sep in ("?", "#"):
        cut = rel.find(sep)
        if cut >= 0:
            rel = rel[:cut]
    if not rel:
        return None
    try:
        candidate = (settings.content_dir / rel).resolve()
        # Prevent path traversal — must stay under content_dir.
        candidate.relative_to(settings.content_dir.resolve())
    except (ValueError, OSError):
        return None
    return candidate


def _missing_media_for_target(t: dict[str, Any]) -> str | None:
    """Return the first content-served media URL on the target whose
    backing file is missing on disk, else None.

    Skips foreign URLs — only our own /content/ URLs are checked, since
    we can't reason about whether arbitrary third-party hosts are up.
    """
    urls: list[str] = []
    if t.get("media_url"):
        urls.append(t["media_url"])
    urls.extend(t.get("media_urls") or [])
    for url in urls:
        path = _local_path_for_content_url(url)
        if path is not None and not path.exists():
            return url
    return None


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

    Meta errors come back as {"error": {"message": "...", "code": N, "error_subcode": N,
    "error_user_title": "...", "error_user_msg": "..."}}. Surfacing the user-facing
    fields beats the generic "publish failed" string.
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
    subcode = err.get("error_subcode") or err.get("subcode")
    user_title = err.get("error_user_title")
    user_msg = err.get("error_user_msg")
    if msg and code is not None:
        parts = [f"Meta {code}: {msg}"]
        if subcode is not None:
            parts.append(f"subcode {subcode}")
        if user_title:
            parts.append(user_title)
        if user_msg:
            parts.append(user_msg)
        return " — ".join(parts)
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
                "upstream_status": resp.status_code,
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
                "upstream_status": resp.status_code,
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
    media_urls: list[str] | None = None,
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
        effective_urls = media_urls or ([media_url] if media_url else [])
        if len(effective_urls) > 1 and media_kind == "image":
            # Multi-image carousel
            attached_media = []
            for url in effective_urls:
                photo = await _post_json(
                    f"{base}/{page_id}/photos",
                    data={
                        "url": url,
                        "published": "false",
                        "access_token": page_access_token,
                    },
                )
                attached_media.append({"media_fbid": photo.get("id")})

            feed_data = {
                "message": content,
                "access_token": page_access_token,
                "published": "true",
            }
            # Pass attached_media as a JSON-encoded array of objects
            feed_data["attached_media"] = json.dumps(attached_media)

            data = await _post_json(
                f"{base}/{page_id}/feed",
                data=feed_data,
            )
            post_id = data.get("id")
        elif media_url and media_kind == "video":
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
    media_url: str | None = None,
    media_urls: list[str] | None = None,
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
        effective_urls = media_urls or ([media_url] if media_url else [])
        if len(effective_urls) > 1:
            print(f"[ig-carousel] {ig_user_id} starting carousel with {len(effective_urls)} items")
            # Step 1 — create carousel children
            children = []
            for idx, url in enumerate(effective_urls[:10]): # IG max is 10
                # Retry child creation too — Meta 100/33 can hit here when
                # the image-URL fetch races the API call.
                child = None
                for create_attempt in range(4):
                    try:
                        child = await _post_json(
                            f"{base}/{ig_user_id}/media",
                            data={
                                "image_url" if media_kind == "image" else "video_url": url,
                                "is_carousel_item": "true",
                                **({"media_type": "VIDEO"} if media_kind == "video" else {}),
                                "access_token": page_access_token,
                            },
                        )
                        break
                    except HTTPException as exc:
                        detail = str(exc.detail)
                        print(f"[ig-carousel] child {idx} create attempt {create_attempt+1} failed: {detail[:200]}")
                        if create_attempt == 3:
                            raise
                        await asyncio.sleep(3)
                if child is None or child.get("error"):
                    detail = (child or {}).get("error", {}).get("message", "IG child container creation failed")
                    raise HTTPException(status_code=502, detail=detail)
                child_id = child.get("id")
                children.append(child_id)
                print(f"[ig-carousel] child {idx} created id={child_id}")
                # Stagger to avoid 429s as Meta's crawler fetches everything at once
                await asyncio.sleep(2)

            # Polling strategy is per Meta's actual behavior, not per the
            # "always wait for FINISHED" guidance:
            #   - Image children: process synchronously. Meta marks them
            #     attachable to a CAROUSEL within seconds, and querying
            #     /{child_id} for status_code returns Meta 100/33
            #     ("Object does not exist or you don't have permission")
            #     for ~60s even though the container IS attachable. We
            #     used to poll and burn 60s of pointless retries here.
            #   - Video children: actually need polling (Meta processes
            #     them asynchronously). We keep the loop in that case.
            if media_kind == "video":
                for child_id in children:
                    last_code = None
                    for attempt in range(30):
                        try:
                            status = await _get_json(
                                f"{base}/{child_id}",
                                params={"fields": "status_code", "access_token": page_access_token},
                            )
                            last_code = status.get("status_code")
                            if last_code == "FINISHED":
                                break
                            if last_code == "ERROR":
                                raise HTTPException(502, f"IG child processing failed: {status}")
                        except HTTPException as exc:
                            if attempt == 29:
                                print(f"[ig-carousel] child {child_id} polling exhausted: {exc.detail}")
                                raise
                        await asyncio.sleep(2)
                    print(f"[ig-carousel] child {child_id} status={last_code}")
                # Stabilization beat after video children finish.
                await asyncio.sleep(4)
            else:
                # For images, give Meta a couple seconds to cache the
                # children as attachable. Skipping the per-child poll
                # saves ~60s on every failed-attempt-loop and also
                # avoids the spurious 100/33 we used to surface.
                print(f"[ig-carousel] skipping per-child poll for image carousel ({len(children)} items)")
                await asyncio.sleep(3)

            # Create carousel container — bumped from 5 to 8 attempts with
            # longer backoff since 100/33 propagation can take 20-30s.
            container = None
            last_err: str | None = None
            for attempt in range(8):
                try:
                    container = await _post_json(
                        f"{base}/{ig_user_id}/media",
                        data={
                            "caption": content,
                            "media_type": "CAROUSEL",
                            "children": ",".join(children),
                            "access_token": page_access_token,
                        },
                    )
                    print(f"[ig-carousel] parent created on attempt {attempt+1}: {container.get('id')}")
                    break
                except HTTPException as exc:
                    last_err = str(exc.detail)[:200]
                    print(f"[ig-carousel] parent create attempt {attempt+1}/8 failed: {last_err}")
                    if attempt == 7:
                        raise
                    # Backoff: 3, 4, 5, 6, 7, 8, 9s — gives Meta up to ~42s
                    # of total wait beyond the initial 4s stabilization delay.
                    await asyncio.sleep(3 + attempt)

            creation_id = container.get("id") if container else None
            if not creation_id:
                raise HTTPException(502, f"Instagram returned no creation_id for carousel. last_err={last_err}")
        else:
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
        # right away (or retry if Meta servers are slow to download).
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

        publish = None
        for attempt in range(10):
            try:
                publish = await _post_json(
                    f"{base}/{ig_user_id}/media_publish",
                    data={
                        "creation_id": creation_id,
                        "access_token": page_access_token,
                    },
                )
                break
            except HTTPException as exc:
                err_str = str(exc.detail).lower()
                if "9007" in err_str or "not ready" in err_str:
                    if attempt == 9:
                        raise
                    await asyncio.sleep(3)
                else:
                    raise


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
    photo_urls: list[str] | None = None,
    privacy_level: str = "SELF_ONLY",
    disclose_video_branded: bool = False,
    disclose_video_your_brand: bool = False,
    audit_mode: str = "inbox",
    upload_mode: str | None = None,
) -> PublishResult:
    """Publish a photo to TikTok.

    TikTok's Content Posting API for photos ONLY supports PULL_FROM_URL.
    It does not support local file upload (FILE_UPLOAD) like video does.
    The public URL (usually tunnel or public server URL) is fetched directly
    by TikTok's servers.

    Both Direct Post and Inbox (Draft) modes use the same initialization endpoint:
      POST /v2/post/publish/content/init/

    The mode is selected by sending post_mode="DIRECT_POST" or "MEDIA_UPLOAD".
    """
    effective_urls = photo_urls or ([photo_url] if photo_url else [])
    if not effective_urls:
        return PublishResult(
            target_id=open_id,
            target_label=handle_label,
            platform="tiktok",
            ok=False,
            error="tiktok_photo_requires_url",
        )

    base = "https://open.tiktokapis.com/v2/post/publish"
    effective_audit = audit_mode
    init_path = f"{base}/content/init/"  # ALWAYS the same endpoint for photo

    # Build source_info — photos ALWAYS use PULL_FROM_URL
    source_info: dict[str, Any] = {
        "source": "PULL_FROM_URL",
        "photo_cover_index": 0,
        "photo_images": effective_urls,
    }

    # Build bodies for both modes
    def _build_body(_audit: str) -> dict[str, Any]:
        if _audit == "direct":
            return {
                "post_info": {
                    "description": (content or "")[:4000],
                    "disable_comment": False,
                    "privacy_level": privacy_level,
                },
                "source_info": source_info,
                "post_mode": "DIRECT_POST",
                "media_type": "PHOTO",
            }
        else:
            return {
                "post_info": {
                    "title": (content or "")[:90],
                    "description": (content or "")[:4000],
                },
                "source_info": source_info,
                "post_mode": "MEDIA_UPLOAD",
                "media_type": "PHOTO",
            }

    init_body = _build_body(effective_audit)

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
        print(f"[tiktok-photo] POST {init_path}")
        print(f"[tiktok-photo] body={json.dumps(init_body, indent=2)}")
        init_status, init_text, init_json = await _do_init(init_path, init_body)
        print(f"[tiktok-photo] response status={init_status} body={init_text[:500]}")

        init_resp_status = init_status
        init_resp_text = init_text
        init_resp_json = init_json

        if init_resp_status >= 400:
            err_body = init_resp_json if isinstance(init_resp_json, dict) else {}
            err_obj = err_body.get("error") or {}
            err_code = err_obj.get("code") or ""
            err_msg = err_obj.get("message") or init_resp_text[:300]
            hint = ""
            cl = err_code.lower()
            if "url_ownership" in cl:
                hint = (
                    " — verify your host prefix under TikTok Developer Portal "
                    "→ URL Properties before retrying"
                )
            elif "unaudited" in cl:
                hint = (
                    " — unaudited apps can only direct-post to PRIVATE TikTok accounts. "
                    "Toggle 'Private account' ON in your TikTok app "
                    "(Settings & Privacy → Privacy) to unblock direct post. "
                    "Already retried as inbox draft."
                )
            elif "privacy_level" in cl:
                hint = (
                    " — unaudited apps must use SELF_ONLY. "
                    "Already retried as inbox draft."
                )
            elif "spam_risk" in cl:
                hint = " — rate-limited; wait a few minutes and retry."
            elif "access_token" in cl:
                hint = " — token may be expired or revoked; reconnect TikTok in Settings."
            return PublishResult(
                target_id=open_id,
                target_label=handle_label,
                platform="tiktok",
                ok=False,
                error=f"tiktok_photo_init_failed: {err_code or 'HTTP ' + str(init_resp_status)}: {err_msg}{hint}",
                raw={"response": init_resp_text[:800]},
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

        # Poll the status endpoint for terminal state.
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
            )
            if last_status in terminal_success:
                break
            if last_status in terminal_failure:
                fail_reason = last_payload.get("fail_reason") or last_status
                hint = ""
                if fail_reason == "picture_size_check_failed":
                    hint = " — TikTok requires images to be exactly 9:16, 1:1, or 4:5. Please adjust your aspect ratio in the UI."
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
            raw={"status": last_status, "data": last_payload, "effective_audit": effective_audit},
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


def _linkedin_headers(access_token: str, *, json_body: bool = True) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Linkedin-Version": settings.linkedin_api_version,
        "X-Restli-Protocol-Version": "2.0.0",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


async def _linkedin_upload_image(
    member_or_org_urn: str,
    access_token: str,
    media_url: str,
) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
        init_resp = await client.post(
            "https://api.linkedin.com/rest/images?action=initializeUpload",
            headers=_linkedin_headers(access_token),
            json={"initializeUploadRequest": {"owner": member_or_org_urn}},
        )
        if init_resp.status_code >= 400:
            raise HTTPException(
                502,
                {
                    "message": "LinkedIn image initializeUpload failed.",
                    "upstream_status": init_resp.status_code,
                },
            )
        init_data = init_resp.json()
        value = init_data.get("value") or {}
        image_urn = value.get("image")
        upload_url = value.get("uploadUrl")
        if not image_urn or not upload_url:
            raise HTTPException(502, "LinkedIn image upload did not return image/uploadUrl.")

        # SSRF guard: media_url is user/tenant-supplied (pasted into a draft
        # or returned from our own /content/ host). Validate the host resolves
        # to a public address and follow redirects only through validated hops,
        # so it can't be pointed at 169.254.169.254 or an internal service.
        try:
            source = await safe_get_async(client, media_url)
        except ValueError as exc:
            raise HTTPException(400, f"Refusing to fetch media_url: {exc}") from exc
        if source.status_code >= 400:
            raise HTTPException(502, f"LinkedIn could not fetch media_url ({source.status_code}).")
        content_type = (
            source.headers.get("content-type")
            or mimetypes.guess_type(media_url)[0]
            or "image/png"
        )
        upload_resp = await client.put(
            upload_url,
            headers={"Content-Type": content_type},
            content=source.content,
        )
        if upload_resp.status_code >= 400:
            raise HTTPException(
                502,
                {
                    "message": "LinkedIn binary image upload failed.",
                    "upstream_status": upload_resp.status_code,
                },
            )

        encoded = quote(image_urn, safe="")
        for _ in range(10):
            status_resp = await client.get(
                f"https://api.linkedin.com/rest/images/{encoded}",
                headers=_linkedin_headers(access_token, json_body=False),
            )
            if status_resp.status_code >= 400:
                break
            status = (status_resp.json().get("status") or "").upper()
            if status in {"AVAILABLE", "READY"}:
                return image_urn
            if status in {"PROCESSING", "WAITING_UPLOAD"}:
                await asyncio.sleep(1)
                continue
            break
    return image_urn


async def _linkedin_upload_video(
    member_or_org_urn: str,
    access_token: str,
    media_url: str,
) -> str:
    """Upload a video via the LinkedIn Videos API and return its URN.

    Flow per the Videos API: initializeUpload (declares owner + fileSizeBytes)
    → PUT each declared byte-range part, capturing the ETag of each →
    finalizeUpload (uploadToken + the ETags in order) → poll until processed.
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        # SSRF guard: media_url is user/tenant-supplied. Validate the host
        # resolves to a public address and only follow validated redirects.
        try:
            source = await safe_get_async(client, media_url)
        except ValueError as exc:
            raise HTTPException(400, f"Refusing to fetch media_url: {exc}") from exc
        if source.status_code >= 400:
            raise HTTPException(502, f"LinkedIn could not fetch media_url ({source.status_code}).")
        video_bytes = source.content
        file_size = len(video_bytes)
        if file_size == 0:
            raise HTTPException(502, "LinkedIn video source is empty.")

        init_resp = await client.post(
            "https://api.linkedin.com/rest/videos?action=initializeUpload",
            headers=_linkedin_headers(access_token),
            json={
                "initializeUploadRequest": {
                    "owner": member_or_org_urn,
                    "fileSizeBytes": file_size,
                    "uploadCaptions": False,
                    "uploadThumbnail": False,
                }
            },
        )
        if init_resp.status_code >= 400:
            raise HTTPException(
                502,
                {
                    "message": "LinkedIn video initializeUpload failed.",
                    "upstream_status": init_resp.status_code,
                    "body": init_resp.text[:500],
                },
            )
        value = (init_resp.json() or {}).get("value") or {}
        video_urn = value.get("video")
        instructions = value.get("uploadInstructions") or []
        upload_token = value.get("uploadToken", "")
        if not video_urn or not instructions:
            raise HTTPException(502, "LinkedIn video upload did not return video/uploadInstructions.")

        # PUT each declared byte-range part; LinkedIn returns an ETag per part
        # that must be passed back, in order, to finalizeUpload.
        uploaded_part_ids: list[str] = []
        for part in instructions:
            upload_url = part.get("uploadUrl")
            if not upload_url:
                raise HTTPException(502, "LinkedIn video part missing uploadUrl.")
            first = int(part.get("firstByte", 0))
            last = int(part.get("lastByte", file_size - 1))
            chunk = video_bytes[first : last + 1]
            put_resp = await client.put(
                upload_url,
                headers={"Content-Type": "application/octet-stream"},
                content=chunk,
            )
            if put_resp.status_code >= 400:
                raise HTTPException(
                    502,
                    {
                        "message": "LinkedIn video chunk upload failed.",
                        "upstream_status": put_resp.status_code,
                    },
                )
            etag = (put_resp.headers.get("etag") or "").strip('"')
            if etag:
                uploaded_part_ids.append(etag)

        finalize_resp = await client.post(
            "https://api.linkedin.com/rest/videos?action=finalizeUpload",
            headers=_linkedin_headers(access_token),
            json={
                "finalizeUploadRequest": {
                    "video": video_urn,
                    "uploadToken": upload_token,
                    "uploadedPartIds": uploaded_part_ids,
                }
            },
        )
        if finalize_resp.status_code >= 400:
            raise HTTPException(
                502,
                {
                    "message": "LinkedIn video finalizeUpload failed.",
                    "upstream_status": finalize_resp.status_code,
                    "body": finalize_resp.text[:500],
                },
            )

        # Videos process asynchronously and slower than images. Poll a bounded
        # number of times, but return the URN regardless — LinkedIn accepts a
        # post referencing a still-processing video and publishes it when ready.
        encoded = quote(video_urn, safe="")
        for _ in range(15):
            status_resp = await client.get(
                f"https://api.linkedin.com/rest/videos/{encoded}",
                headers=_linkedin_headers(access_token, json_body=False),
            )
            if status_resp.status_code >= 400:
                break
            status = (status_resp.json().get("status") or "").upper()
            if status == "AVAILABLE":
                return video_urn
            if status in {"PROCESSING", "WAITING_UPLOAD"}:
                await asyncio.sleep(2)
                continue
            break
    return video_urn


async def publish_linkedin(
    member_or_org_urn: str,
    access_token: str,
    *,
    label: str,
    content: str,
    media_url: str | None = None,
) -> PublishResult:
    """Publish a LinkedIn member post through the REST Posts API."""
    if not access_token:
        return PublishResult(
            target_id=member_or_org_urn,
            target_label=label,
            platform="linkedin",
            ok=False,
            error="linkedin_not_connected",
        )
    try:
        media_id = None
        media_is_video = False
        if media_url:
            ext = (media_url or "").lower().rsplit(".", 1)[-1]
            if ext in {"mp4", "mov", "webm", "m4v"}:
                media_is_video = True
                media_id = await _linkedin_upload_video(
                    member_or_org_urn,
                    access_token,
                    media_url,
                )
            else:
                media_id = await _linkedin_upload_image(
                    member_or_org_urn,
                    access_token,
                    media_url,
                )

        payload: dict[str, Any] = {
            "author": member_or_org_urn,
            "commentary": content,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }
        if media_id:
            # Per the Posts API content.media schema: videos carry a "title",
            # images carry "altText".
            media_obj: dict[str, Any] = {"id": media_id}
            if media_is_video:
                media_obj["title"] = label or "Datalia post"
            else:
                media_obj["altText"] = label or "Datalia post"
            payload["content"] = {"media": media_obj}

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.linkedin.com/rest/posts",
                headers=_linkedin_headers(access_token),
                json=payload,
            )
        if resp.status_code >= 400:
            return PublishResult(
                target_id=member_or_org_urn,
                target_label=label,
                platform="linkedin",
                ok=False,
                error=f"linkedin_publish_failed: HTTP {resp.status_code}",
                raw={"response": resp.text[:800]},
            )
        data = resp.json() if resp.text else {}
        post_id = data.get("id") or resp.headers.get("x-restli-id")
        permalink = None
        if post_id and post_id.startswith("urn:li:ugcPost:"):
            permalink = f"https://www.linkedin.com/feed/update/{post_id}/"
        return PublishResult(
            target_id=member_or_org_urn,
            target_label=label,
            platform="linkedin",
            ok=True,
            platform_post_id=post_id,
            permalink_url=permalink,
            raw=data,
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        return PublishResult(
            target_id=member_or_org_urn,
            target_label=label,
            platform="linkedin",
            ok=False,
            error=detail.get("message") or "linkedin_publish_failed",
            raw=detail,
        )
    except Exception as exc:
        return PublishResult(
            target_id=member_or_org_urn,
            target_label=label,
            platform="linkedin",
            ok=False,
            error=f"linkedin_exception: {exc}",
        )


# ── Public surface (for the FastAPI route) ──────────────────────────


async def build_targets_from_post(
    *,
    platforms: dict[str, bool],
    media_url: str | None = None,
    media_urls: list[str] | None = None,
    media_kind: str = "image",
    link: str | None = None,
    ratios: dict[str, str] | None = None,
    tiktok_options: dict[str, Any] | None = None,
    user_id: str | int | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Build a publish-ready target list from a Post's `platforms` toggle map.

    Returns ``(resolved, skipped)`` where ``skipped`` carries one entry per
    requested platform that ended up with zero usable destinations — used
    by the scheduler to surface "IG silently dropped because Meta page
    has no IG account linked" instead of pretending the publish succeeded.

    The HTTP /publish route receives explicit {platform, id} pairs the
    frontend picked. The scheduler doesn't have a frontend — it just has
    `platforms: {facebook: true, ...}` on the stored post, so it needs to
    re-discover the connected destinations itself.
    """
    # Local imports keep publish.py free of an oauth.py module-level dep.
    from .oauth import _load_tokens, _fetch_meta_pages
    from .images import crop_for_targets

    tokens = _load_tokens(int(user_id) if str(user_id or "").isdigit() else user_id)
    meta_record = tokens.get("meta") or {}
    user_meta_token = meta_record.get("access_token")
    enabled = [k for k, v in (platforms or {}).items() if v]
    if not enabled:
        return [], []

    pages = await _fetch_meta_pages(user_meta_token) if user_meta_token else []
    resolved: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    effective_urls = media_urls or ([media_url] if media_url else [])

    def _skip(platform: str, reason: str) -> None:
        skipped.append({
            "target_id": platform,
            "target_label": platform.capitalize(),
            "platform": platform,
            "ok": False,
            "platform_post_id": None,
            "permalink_url": None,
            "error": reason,
            "raw": None,
        })

    for platform in enabled:
        if platform == "facebook":
            if not user_meta_token:
                _skip(platform, "meta_not_connected")
                continue
            if not pages:
                _skip(platform, "no_facebook_pages_found")
                continue
            for page in pages:
                resolved.append({
                    "platform": "facebook",
                    "id": page["page_id"],
                    "label": page["page_name"],
                    "access_token": page["page_access_token"],
                    "media_url": media_url,
                    "media_urls": effective_urls,
                    "media_kind": "image",
                    "link": link,
                })
        elif platform == "instagram":
            if not user_meta_token:
                _skip(platform, "meta_not_connected")
                continue
            ig_targets_before = len(resolved)
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
                    "media_urls": effective_urls,
                    "media_kind": media_kind,
                })
            if len(resolved) == ig_targets_before:
                _skip(
                    platform,
                    "no_instagram_business_linked_to_page — link an IG "
                    "Business account to the Page in Meta Business Suite.",
                )
        elif platform == "tiktok":
            # Refresh TikTok token if it's expired (24h short-lived).
            # Mirrors what /publish does inline.
            from .oauth import resolve_tiktok_access_token
            token = await resolve_tiktok_access_token(
                int(user_id) if str(user_id or "").isdigit() else user_id
            )
            tokens = _load_tokens(
                int(user_id) if str(user_id or "").isdigit() else user_id
            )
            record = tokens.get("tiktok") or {}
            if not token:
                _skip(
                    platform,
                    "tiktok_not_connected — reconnect TikTok in Settings.",
                )
                continue
            raw = record.get("raw") or {}
            open_id = record.get("open_id") or raw.get("open_id")
            handle = record.get("username") or record.get("display_name")

            tk_kind = media_kind
            if tk_kind not in ("image", "video"):
                tk_kind = "image" if (media_url or "").lower().rsplit(".", 1)[-1] in {
                    "png", "jpg", "jpeg", "webp", "gif", "jfif"
                } else "video"

            tk_opts = tiktok_options or {}
            # Default to "direct" so the auto path matches the manual
            # path (TikTokOptions model default = "direct"). Previously
            # the scheduler defaulted to "inbox" so auto-fired TikTok
            # posts silently became drafts the user never tapped.
            requested_audit = tk_opts.get("audit_mode", "direct")
            granted_scope = (record.get("scope") or "").lower()
            effective_audit = requested_audit
            if requested_audit == "direct" and "video.publish" not in granted_scope:
                # Scope downgrade — mirrors routes.py logic. Without
                # video.publish granted the direct endpoint 401s; inbox
                # still works so the post lands in TikTok drafts.
                effective_audit = "inbox"

            resolved.append({
                "platform": "tiktok",
                "id": open_id or "tiktok",
                "label": f"@{handle}" if handle else (open_id or "tiktok"),
                "access_token": token,
                "media_url": media_url,
                "media_urls": effective_urls,
                "media_kind": tk_kind,
                "privacy_level": tk_opts.get("privacy_level", "SELF_ONLY"),
                "disclose_video_branded": tk_opts.get("disclose_video_branded", False),
                "disclose_video_your_brand": tk_opts.get("disclose_video_your_brand", False),
                "audit_mode": effective_audit,
                "audit_downgraded": requested_audit != effective_audit,
            })
        elif platform == "linkedin":
            record = tokens.get(platform) or {}
            token = record.get("access_token")
            if not token:
                _skip(
                    platform,
                    "linkedin_not_connected — reconnect LinkedIn in Settings.",
                )
                continue
            raw = record.get("raw") or {}
            resolved.append({
                "platform": platform,
                "id": record.get("urn") or raw.get("urn") or platform,
                "label": record.get("display_name") or "LinkedIn",
                "access_token": token,
                "media_url": media_url,
                "media_urls": effective_urls,
                "media_kind": media_kind,
            })

    for r in resolved:
        r["media_url"] = crop_for_targets(
            media_url=r.get("media_url"),
            ratios=ratios,
            platform=r["platform"],
        )
        if r.get("media_urls"):
            r["media_urls"] = [
                crop_for_targets(
                    media_url=url,
                    ratios=ratios,
                    platform=r["platform"],
                )
                for url in r["media_urls"]
            ]
    return resolved, skipped


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
        try:
            platform = t.get("platform")
            # Pre-flight: any /content/-served URL whose file is gone from
            # disk would surface as `Meta 9004` / `tiktok photo_pull_failed`
            # ~30s later. Catch it here so the user sees "Media file no
            # longer on disk — re-upload or pick from Library" instead.
            missing = _missing_media_for_target(t)
            if missing:
                return PublishResult(
                    target_id=t["id"],
                    target_label=t.get("label") or t["id"],
                    platform=platform or "unknown",
                    ok=False,
                    error=f"media_missing_on_disk: {missing.rsplit('/', 1)[-1]} — re-upload from the Media Library.",
                )
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
                    media_urls=t.get("media_urls"),
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
                    media_urls=t.get("media_urls"),
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
                        photo_urls=t.get("media_urls"),
                        privacy_level=t.get("privacy_level", "SELF_ONLY"),
                        disclose_video_branded=t.get("disclose_video_branded", False),
                        disclose_video_your_brand=t.get("disclose_video_your_brand", False),
                        audit_mode=t.get("audit_mode", "inbox"),
                        upload_mode=t.get("upload_mode"),
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
        except Exception as exc:
            import traceback
            print(f"[publish] exception in _dispatch for {t.get('platform')}/{t.get('id')}: {exc}")
            traceback.print_exc()
            return PublishResult(
                target_id=t.get("id", "?"),
                target_label=t.get("label") or t.get("id", "?"),
                platform=t.get("platform", "unknown"),
                ok=False,
                error=f"dispatch_failed: {exc}",
            )

    results = await asyncio.gather(*(_dispatch(t) for t in targets), return_exceptions=True)

    # Convert any unhandled exceptions into failed PublishResults so one
    # platform's crash never kills the response for the others.  Before
    # this fix, a single IG/TikTok error would cause the entire /publish
    # endpoint to return HTTP 500, hiding Facebook's successful result.
    safe_results: list[PublishResult] = []
    for r, t in zip(results, targets):
        if isinstance(r, BaseException):
            print(f"[publish] unhandled exception for {t.get('platform')}/{t.get('id')}: {r}")
            safe_results.append(PublishResult(
                target_id=t.get("id", "?"),
                target_label=t.get("label", "?"),
                platform=t.get("platform", "unknown"),
                ok=False,
                error=f"internal_error: {r}",
            ))
        else:
            safe_results.append(r)

    # Record each success so future calls to check_spam_guard see it.
    for r, t in zip(safe_results, targets):
        if r.ok:
            record_publish(t["id"], content, t.get("media_url"))
    elapsed_ms = int((time.time() - started) * 1000)
    return [
        {**r.to_dict(), "elapsed_ms_total": elapsed_ms} for r in safe_results
    ]

