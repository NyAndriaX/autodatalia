"""FastAPI route handlers."""

import os
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from . import tunnel
from .auth import require_token
from .models import (
    AutomationRule,
    AutomationRulesResponse,
    CaptionRequest,
    ContentItem,
    CostLogResponse,
    CostSummary,
    SettingsKeysResponse,
    SettingsKeysUpdateRequest,
    GenerateRequest,
    GenerateResponse,
    HashtagsRequest,
    HashtagsResponse,
    Post,
    PostCreate,
    PostUpdate,
    PostsResponse,
    PublishRequest,
    PublishResponse,
    PublishResultModel,
    SearchResponse,
    TikTokOptions,
    TransformRequest,
    TransformResponse,
    UploadResponse,
)
from .config import settings
from .images import crop_for_targets
from .oauth import _load_tokens, _fetch_meta_pages
from .publish import publish_to_targets
from .services import (
    build_image_data_uri,
    generate_captions,
    generate_hashtags,
    automation_create,
    automation_delete,
    automation_get,
    automation_list,
    automation_update,
    generate_post_variants,
    iter_content_items,
    messages_append,
    posts_create,
    posts_delete,
    posts_list,
    posts_update,
    delete_media,
    rate_guard,
    rate_tick,
    save_caption_file,
    save_upload,
    search_media,
    transform_content,
)


def _client_id(request: Request) -> str:
    """Best-effort client key for rate limiting (proxy-aware)."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

router = APIRouter()
# Auth dependency applied to spend-incurring, mutating, and business-data
# endpoints. Health and OAuth callback probes stay open.
auth_required = Depends(require_token)

_OPEN_AUTOMATION_STATUSES = {"awaiting_validation", "scheduled"}


def _rule_schedule_signature(rule: dict[str, Any]) -> dict[str, Any]:
    return {
        "active": rule.get("active", True),
        "schedule": rule.get("schedule"),
        "validation_lead_minutes": rule.get("validation_lead_minutes"),
        "validation_chat_id": rule.get("validation_chat_id"),
    }


def _rule_candidate_signature(rule: dict[str, Any]) -> dict[str, Any]:
    return {
        "content_type": rule.get("content_type"),
        "template_id": rule.get("template_id"),
        "num_media": rule.get("num_media"),
        "domain": rule.get("domain"),
        "target_audience": rule.get("target_audience"),
        "tone": rule.get("tone"),
        "objective": rule.get("objective"),
        "description_style": rule.get("description_style"),
        "extra_brief": rule.get("extra_brief"),
        "platforms": rule.get("platforms"),
        "ratios": rule.get("ratios"),
        "tiktok": rule.get("tiktok"),
        **_rule_schedule_signature(rule),
    }


def _rule_open_posts(rule_id: str) -> list[dict[str, Any]]:
    return [
        post
        for post in posts_list()
        if post.get("source_rule_id") == rule_id
        and post.get("status") in _OPEN_AUTOMATION_STATUSES
    ]


def _cancel_open_rule_posts(
    rule_id: str,
    *,
    reason: str,
    message: str,
) -> list[str]:
    touched: list[str] = []
    for post in _rule_open_posts(rule_id):
        posts_update(
            post["id"],
            {
                "status": "cancelled",
                "error": reason,
                "validated_at": None,
            },
        )
        messages_append(
            {
                "kind": "automation",
                "post_id": post["id"],
                "message": message.format(post_id=post["id"]),
            }
        )
        touched.append(post["id"])
    return touched


def _reset_rule_fire_cursor(rule_id: str) -> dict[str, Any] | None:
    return automation_update(rule_id, {"last_fire_at": 0, "last_error": ""})


# ── Utility endpoints ──────────────────────────────────────────────────

@router.get("/health")
async def health() -> dict[str, Any]:
    """Liveness + dependency check.

    Returns 200 only when both the API process AND Postgres are reachable.
    Caddy / Docker healthchecks fail when this is non-200, so a Postgres
    outage now actually surfaces as an unhealthy container instead of a
    "200 OK" lie that masks the real problem until the first /auth call.
    """
    from fastapi import HTTPException
    deps: dict[str, str] = {}
    try:
        from .db import _connect
        conn = _connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        finally:
            conn.close()
        deps["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001
        deps["postgres"] = f"down: {type(exc).__name__}"
        raise HTTPException(
            status_code=503,
            detail={"status": "degraded", "dependencies": deps},
        )
    return {"status": "ok", "dependencies": deps}


@router.get("/stats", dependencies=[auth_required])
async def get_stats() -> dict[str, Any]:
    """Aggregated content statistics for the dashboard KPI strip.

    Returns counts broken down by post status so the frontend never has
    to load the full posts list just to paint four numbers.
    """
    from .services import posts_list as _posts_list, messages_list

    all_posts = _posts_list()
    by_status: dict[str, int] = {
        "draft": 0,
        "scheduled": 0,
        "pending": 0,
        "approved": 0,
        "published": 0,
        "error": 0,
        "awaiting_validation": 0,
        "rejected": 0,
    }
    for post in all_posts:
        s = post.get("status", "draft")
        if s in by_status:
            by_status[s] += 1

    recent_messages = messages_list()[:5]

    # Media asset count
    media_count = sum(
        1
        for f in settings.content_dir.rglob("*")
        if f.is_file() and not f.name.startswith(".")
    )

    return {
        "total_posts": len(all_posts),
        "by_status": by_status,
        "media_assets": media_count,
        "recent_activity_count": len(recent_messages),
    }


@router.get("/dashboard-summary", dependencies=[auth_required])
async def dashboard_summary() -> dict[str, Any]:
    """Rich summary payload for the dashboard view.

    Combines post stats, recent activity and connection status so the
    dashboard page can prime itself with a single request on mount.
    """
    from .services import posts_list as _posts_list, messages_list
    from .oauth import _load_tokens

    all_posts = _posts_list()

    by_status: dict[str, int] = {}
    for post in all_posts:
        s = post.get("status", "draft")
        by_status[s] = by_status.get(s, 0) + 1

    recent_activity = messages_list()[:10]

    token_data = _load_tokens()
    connected_providers = [
        provider
        for provider, data in token_data.items()
        if data.get("access_token")
    ]

    media_count = sum(
        1
        for f in settings.content_dir.rglob("*")
        if f.is_file() and not f.name.startswith(".")
    )

    return {
        "posts": {
            "total": len(all_posts),
            "by_status": by_status,
        },
        "connections": {
            "connected_providers": connected_providers,
            "total_connected": len(connected_providers),
        },
        "media": {
            "total_assets": media_count,
        },
        "recent_activity": recent_activity,
    }


@router.get("/tunnel-status")
async def tunnel_status() -> dict[str, Any]:
    return {
        "tunnel_ready": tunnel.is_ready(),
        "tunnel_url": tunnel.TUNNEL_URL,
    }


@router.get("/messages", dependencies=[auth_required])
async def messages() -> dict[str, list[Any]]:
    """Activity feed (publish events, validations…).

    The scheduler appends one entry per target when a scheduled post fires
    (success + failure both surface here), so the bell menu shows real
    activity. Newest-first, capped at services.MAX_MESSAGES.
    """
    from .services import messages_list
    return {"items": messages_list()}


# ── Generation endpoints ──────────────────────────────────────────────

@router.post(
    "/generate",
    response_model=GenerateResponse,
)
async def generate(
    request: Request,
    body: GenerateRequest,
    user_id: int = Depends(require_token),
) -> GenerateResponse:
    """Prompt-driven generation for the editor's "Generate via AI" button."""
    client = _client_id(request)
    rate_guard(client)
    variants, usage, model = await generate_post_variants(
        prompt=body.prompt,
        platforms=body.platforms,
        template=body.template,
        n=body.variants,
        image_filename=body.image_filename,
        quality=body.quality,
        user_id=user_id,
    )
    if usage["total_tokens"] > 0:  # don't count free cache hits
        rate_tick(client)
    return GenerateResponse(
        variants=variants,
        usage=usage,
        model=model,
        tier=_tier_from_quality(body.quality, body.variants),
    )


def _tier_from_quality(quality: str, n: int) -> str:
    if quality == "fast":
        return "fast"
    if quality == "premium":
        return "premium"
    if quality == "standard":
        return "standard"
    return "premium" if n >= 3 else "standard"


@router.post(
    "/transform",
    response_model=TransformResponse,
)
async def transform(
    request: Request,
    body: TransformRequest,
    user_id: int = Depends(require_token),
) -> TransformResponse:
    """Quick AI actions (shorten / expand / tone) on existing content."""
    client = _client_id(request)
    rate_guard(client)
    text, usage, _model = await transform_content(
        body.content, body.action, user_id=user_id
    )
    if usage["total_tokens"] > 0:
        rate_tick(client)
    return TransformResponse(text=text, usage=usage)


@router.post(
    "/hashtags",
    response_model=HashtagsResponse,
)
async def hashtags(
    request: Request,
    body: HashtagsRequest,
    user_id: int = Depends(require_token),
) -> HashtagsResponse:
    """Suggest hashtags for a post — fast-tier (cheap) by design."""
    client = _client_id(request)
    rate_guard(client)
    tags, usage = await generate_hashtags(
        body.content, max_tags=body.max_tags, user_id=user_id
    )
    if usage["total_tokens"] > 0:
        rate_tick(client)
    from .runtime_config import resolved_settings
    current_settings = resolved_settings(user_id)
    return HashtagsResponse(
        hashtags=tags, usage=usage, model=current_settings.ai_model_fast
    )


# ── Cost dashboard ────────────────────────────────────────────────────


@router.get("/costs/summary", response_model=CostSummary, dependencies=[auth_required])
async def costs_summary(period: str = "30d") -> CostSummary:
    """Aggregate AI/media spend over the chosen window.

    Periods: ``session`` (all-time, treated equivalently for now),
    ``24h``, ``7d``, ``30d``, ``all``.
    """
    from .cost_tracking import summarize
    seconds_by_label = {
        "24h": 24 * 3600.0,
        "7d": 7 * 24 * 3600.0,
        "30d": 30 * 24 * 3600.0,
        "all": None,
        "session": None,
    }
    secs = seconds_by_label.get(period, 30 * 24 * 3600.0)
    return CostSummary(**summarize(secs))


@router.get("/costs/log", response_model=CostLogResponse, dependencies=[auth_required])
async def costs_log(limit: int = 200) -> CostLogResponse:
    from .cost_tracking import list_logs
    return CostLogResponse(entries=list_logs(limit=limit))


# ── Runtime-editable API keys ────────────────────────────────────────


@router.get("/settings/keys", response_model=SettingsKeysResponse, dependencies=[auth_required])
async def settings_keys_get(
    user_id: int = Depends(require_token),
) -> SettingsKeysResponse:
    """Snapshot of every editable key for the Settings page.

    Secrets are returned masked (``abcd••••WXYZ``); model ids and base
    URLs ship in clear. See runtime_config.EDITABLE_KEYS for the full
    allowlist.
    """
    from .runtime_config import snapshot_for_ui
    return SettingsKeysResponse(keys=snapshot_for_ui(user_id))


@router.patch(
    "/settings/keys",
    response_model=SettingsKeysResponse,
    dependencies=[auth_required],
)
async def settings_keys_patch(
    body: SettingsKeysUpdateRequest,
    user_id: int = Depends(require_token),
) -> SettingsKeysResponse:
    """Persist new values into the active runtime settings scope.

    JWT users write to their own overrides file. Open mode and the
    shared backend token keep using the global runtime_settings.json.
    """
    from .runtime_config import (
        save_overrides,
        apply_overrides_to_settings,
        snapshot_for_ui,
    )
    save_overrides(body.updates, user_id=user_id)
    if user_id <= 0:
        apply_overrides_to_settings()
    return SettingsKeysResponse(keys=snapshot_for_ui(user_id))


# ── Publishing — fan post out to real social networks ────────────────


@router.post("/publish", response_model=PublishResponse, dependencies=[auth_required])
async def publish(body: PublishRequest) -> PublishResponse:
    """Publish `content` to every selected target.

    The frontend sends a list of target ids ({platform, id}) it gathered
    from /oauth/connections. We resolve the access token server-side
    (Page tokens come from the user's Meta token, etc.) so tokens never
    leave the backend.

    Each target is dispatched in parallel; the response includes one
    result row per target with ok / platform_post_id / error.
    """
    if not body.targets:
        raise HTTPException(400, "publish requires at least one target")
    if len(body.targets) > 20:
        # Sanity ceiling — nobody legitimately fans one post to >20 places.
        raise HTTPException(400, "too_many_targets (max 20 per publish call)")
    # Diagnostic — when targets that require media reject with
    # `requires_media`, the first question is "did the frontend even send
    # a URL?". This line answers it without us needing tcpdump.
    print(
        f"[publish] media_url={'present' if body.media_url else 'MISSING'} "
        f"targets={[(t.platform, t.media_kind, 'with-media' if t.media_url else 'no-media') for t in body.targets]}"
    )
    if not (body.content or "").strip() and not body.media_url:
        # Don't let an empty post reach the platforms — Meta returns a
        # cryptic "param message is required" otherwise.
        raise HTTPException(400, "publish requires either content or media_url")

    tokens = _load_tokens()
    meta_record = tokens.get("meta") or {}
    user_meta_token = meta_record.get("access_token")

    # Cache the Pages-with-IG lookup so we don't refetch per-target.
    meta_pages: list[dict[str, Any]] | None = None

    async def _resolve_meta_pages() -> list[dict[str, Any]]:
        nonlocal meta_pages
        if meta_pages is None:
            try:
                meta_pages = (
                    await _fetch_meta_pages(user_meta_token) if user_meta_token else []
                )
            except Exception as e:
                print(f"[_resolve_meta_pages] Error fetching Meta pages: {e}")
                meta_pages = []
        return meta_pages

    resolved: list[dict[str, Any]] = []
    for t in body.targets:
        platform = t.platform
        # Per-target media override (frontend can send video for tiktok,
        # image for facebook in the same call). Falls back to body.media_url
        # when not set, so the old single-media path keeps working.
        t_media_url = t.media_url or body.media_url
        t_media_urls = t.media_urls or body.media_urls or ([t_media_url] if t_media_url else [])
        if platform in ("facebook", "instagram"):
            if not user_meta_token:
                resolved.append({
                    "platform": platform,
                    "id": t.id,
                    "label": t.label or t.id,
                    "access_token": "",
                    "media_url": t_media_url,
                    "media_urls": t_media_urls,
                    "link": body.link,
                    "media_kind": t.media_kind or "image",
                    "_unresolved_reason": "meta_not_connected",
                })
                continue
            pages = await _resolve_meta_pages()
            # FB target: id is the page id. IG target: id is the ig user id;
            # we still need its parent Page's access token to call /media.
            page = None
            if platform == "facebook":
                page = next((p for p in pages if p["page_id"] == t.id), None)
            else:  # instagram
                page = next(
                    (
                        p
                        for p in pages
                        if (p.get("instagram") or {}).get("ig_id") == t.id
                    ),
                    None,
                )
            if not page:
                resolved.append({
                    "platform": platform,
                    "id": t.id,
                    "label": t.label or t.id,
                    "access_token": "",
                    "media_url": t_media_url,
                    "media_urls": t_media_urls,
                    "link": body.link,
                    "media_kind": t.media_kind or "image",
                    "_unresolved_reason": "target_not_found_in_meta_pages",
                })
                continue
            resolved.append({
                "platform": platform,
                "id": t.id,
                "label": t.label or page["page_name"],
                "access_token": page["page_access_token"],
                "media_url": t_media_url,
                "media_urls": t_media_urls,
                "link": body.link,
                "media_kind": t.media_kind or "image",
            })
        elif platform == "tiktok":
            # Refresh the access token if it's expired (24h short-lived).
            # Without this, every publish past the first day 401s with
            # access_token_invalid until the user manually reconnects.
            from .oauth import resolve_tiktok_access_token
            token = await resolve_tiktok_access_token()
            # Re-read the record — resolve_tiktok_access_token may have
            # persisted refreshed token + scope back to the store.
            tokens = _load_tokens()
            record = tokens.get("tiktok") or {}
            if not token:
                resolved.append({
                    "platform": "tiktok",
                    "id": t.id,
                    "label": t.label or t.id,
                    "access_token": "",
                    "media_url": t_media_url,
                    "media_urls": t_media_urls,
                    "media_kind": "video",
                    "_unresolved_reason": "tiktok_not_connected",
                })
                continue
            handle = record.get("username") or record.get("display_name")
            # body.tiktok is a TikTokOptions Pydantic model (not a dict) —
            # fall back to its defaults when the frontend didn't send one.
            tk = body.tiktok or TikTokOptions()
            # TikTok supports BOTH photo and video posts (different endpoints).
            # Auto-detect from the URL extension when the frontend didn't
            # explicitly tag the target — photo files go through the
            # content/init/ endpoint, videos through video/init/.
            tk_kind = (t.media_kind or "").lower()
            if tk_kind not in ("image", "video"):
                tk_kind = "image" if (t_media_url or "").lower().rsplit(".", 1)[-1] in {
                    "png", "jpg", "jpeg", "webp", "gif", "jfif"
                } else "video"
            # Scope-aware audit_mode downgrade — direct-post (/video/init/)
            # returns HTTP 401 when the token's granted scope doesn't
            # include `video.publish`. Falling back to inbox automatically
            # means a user who hasn't yet reconnected to grant the new
            # scope still gets the video to their TikTok (as a draft they
            # confirm in-app), instead of seeing a cryptic 401.
            granted_scope = (record.get("scope") or "").lower()
            requested_audit = tk.audit_mode
            effective_audit = requested_audit
            if requested_audit == "direct" and "video.publish" not in granted_scope:
                effective_audit = "inbox"
                print(
                    "[tiktok] downgrading direct→inbox: "
                    f"token scope='{granted_scope}' lacks video.publish. "
                    "Reconnect TikTok after setting "
                    "TIKTOK_SCOPES=user.info.basic,video.upload,video.publish "
                    "to enable direct posting."
                )
            resolved.append({
                "platform": "tiktok",
                "id": t.id,
                "label": t.label or (f"@{handle}" if handle else t.id),
                "access_token": token,
                "media_url": t_media_url,
                "media_urls": t_media_urls,
                "media_kind": tk_kind,
                # Forward the compose-screen choices the publish handler
                # needs. PublishRequest carries these as a tiktok-shaped
                # sub-object (see models.py PublishRequest.tiktok).
                "privacy_level": tk.privacy_level,
                "disclose_video_branded": tk.disclose_video_branded,
                "disclose_video_your_brand": tk.disclose_video_your_brand,
                "audit_mode": effective_audit,
                "upload_mode": tk.upload_mode,
                # Stash whether we downgraded so the publish handler can
                # surface it in the response message.
                "audit_downgraded": requested_audit != effective_audit,
            })
        else:
            # LinkedIn — stub for now; still flow through so the response
            # includes one row per requested target.
            record = tokens.get(platform) or {}
            resolved.append({
                "platform": platform,
                "id": t.id,
                "label": t.label or t.id,
                "access_token": record.get("access_token", ""),
                "media_url": t_media_url,
                "media_urls": t_media_urls,
                "media_kind": t.media_kind or "image",
            })

    # Apply the user's per-platform aspect ratio choice — the cropped
    # variant is what the platform actually receives.
    for r in resolved:
        r["media_url"] = crop_for_targets(
            media_url=r.get("media_url"),
            ratios=body.ratios,
            platform=r["platform"],
        )
        if r.get("media_urls"):
            r["media_urls"] = [
                crop_for_targets(
                    media_url=url,
                    ratios=body.ratios,
                    platform=r["platform"],
                )
                for url in r["media_urls"]
            ]

    # Emit "not connected" results synthetically so the frontend gets a
    # clear per-target error without us calling the upstream API.
    publishable = [r for r in resolved if "_unresolved_reason" not in r]
    failed = [
        {
            "target_id": r["id"],
            "target_label": r["label"],
            "platform": r["platform"],
            "ok": False,
            "platform_post_id": None,
            "error": r["_unresolved_reason"],
            "raw": None,
        }
        for r in resolved
        if "_unresolved_reason" in r
    ]

    succeeded = (
        await publish_to_targets(content=body.content, targets=publishable)
        if publishable
        else []
    )

    # Preserve original target order in the response.
    by_id: dict[str, dict[str, Any]] = {}
    for row in succeeded + failed:
        by_id[(row["platform"], row["target_id"])] = row
    ordered = [
        by_id.get((t.platform, t.id), {
            "target_id": t.id,
            "target_label": t.label or t.id,
            "platform": t.platform,
            "ok": False,
            "platform_post_id": None,
            "error": "internal_resolve_miss",
        })
        for t in body.targets
    ]

    # Final log line so server-side evidence exists for every publish.
    # When the frontend reports "silent fail", grep this for the request and
    # see exactly what was returned (ok flag + error string per target).
    print(
        "[publish] results: "
        + str([
            (r["platform"], r["target_id"], r["ok"], (r.get("error") or "")[:120])
            for r in ordered
        ])
    )

    return PublishResponse(
        results=[PublishResultModel(**r) for r in ordered]
    )


# ── Media endpoints ───────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=UploadResponse,
    dependencies=[auth_required],
)
async def upload(request: Request, file: UploadFile = File(...)) -> UploadResponse:
    """Store an uploaded image/video and return its served URL.

    URL precedence (each must be publicly fetchable for Meta/IG to ingest):
      1. PUBLIC_BASE_URL  — explicit override
      2. OAUTH_REDIRECT_BASE — already configured to the ngrok host
      3. cloudflared tunnel (TUNNEL_ENABLED=true)
      4. request.base_url — last-resort localhost; Meta will reject it
    """
    meta = await save_upload(file)
    base = (
        os.environ.get("PUBLIC_BASE_URL")
        or await tunnel.wait_for_tunnel(timeout=5.0)
        or os.environ.get("OAUTH_REDIRECT_BASE")
        or str(request.base_url).rstrip("/")
    )
    base = base.rstrip("/")
    return UploadResponse(
        url=f"{base}/content/{meta['relative_path']}",
        filename=meta["filename"],
        kind=meta["kind"],
    )


@router.delete(
    "/media/{path:path}",
    dependencies=[auth_required],
)
async def delete_media_route(path: str) -> dict[str, Any]:
    """Remove a previously-uploaded media file by its content-dir-relative path."""
    try:
        removed = delete_media(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not removed:
        raise HTTPException(status_code=404, detail="Media not found.")
    return {"deleted": True, "path": path}


@router.get("/search", response_model=SearchResponse, dependencies=[auth_required])
async def search(request: Request, q: str = "") -> SearchResponse:
    """Search media in the content directory (posts/templates → Airtable TBD).

    Each media hit carries a `url` and `kind` so the frontend Media Library
    can render thumbnails AND the publish path can use the same URL Meta /
    TikTok will actually be able to fetch.

    URL precedence mirrors /upload — must be a publicly fetchable host,
    otherwise picking a Library asset for a Meta / TikTok publish would
    send `http://localhost:8000/...` and upstream would refuse it.
    """
    base = (
        os.environ.get("PUBLIC_BASE_URL")
        or os.environ.get("OAUTH_REDIRECT_BASE")
        or await tunnel.wait_for_tunnel(timeout=5.0)
        or str(request.base_url).rstrip("/")
    )
    base = base.rstrip("/")
    hits = []
    for hit in search_media(q):
        hits.append(
            {
                **hit,
                "url": f"{base}/content/{hit['id']}",
            }
        )
    return SearchResponse(results=hits)


# ── Scheduled posts (calendar persistence) ────────────────────────────

@router.get("/posts", response_model=PostsResponse, dependencies=[auth_required])
async def list_posts() -> PostsResponse:
    """Return all scheduled posts. Open so the calendar can hydrate on load."""
    return PostsResponse(posts=posts_list())


@router.post(
    "/posts",
    response_model=Post,
    dependencies=[auth_required],
)
async def create_post(body: PostCreate) -> Post:
    return Post(**posts_create(body.model_dump()))


@router.patch(
    "/posts/{post_id}",
    response_model=Post,
    dependencies=[auth_required],
)
async def patch_post(post_id: str, body: PostUpdate) -> Post:
    updated = posts_update(post_id, body.model_dump())
    if updated is None:
        raise HTTPException(status_code=404, detail="Post not found.")
    return Post(**updated)


@router.delete("/posts/{post_id}", dependencies=[auth_required])
async def delete_post(post_id: str) -> dict[str, bool]:
    if not posts_delete(post_id):
        raise HTTPException(status_code=404, detail="Post not found.")
    return {"deleted": True}


# ── Automation rules ──────────────────────────────────────────────────
# A rule is a "what + when" template the Phase 2 worker uses to autonomously
# generate Posts. Endpoints are CRUD only — no firing logic lives here.


@router.get("/automation-rules", response_model=AutomationRulesResponse, dependencies=[auth_required])
async def list_automation_rules() -> AutomationRulesResponse:
    rules = [AutomationRule(**r) for r in automation_list()]
    return AutomationRulesResponse(rules=rules)


@router.get(
    "/automation-rules/{rule_id}",
    response_model=AutomationRule,
    dependencies=[auth_required],
)
async def get_automation_rule(rule_id: str) -> AutomationRule:
    rule = automation_get(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Automation rule not found.")
    return AutomationRule(**rule)


@router.post(
    "/automation-rules",
    response_model=AutomationRule,
    dependencies=[auth_required],
)
async def create_automation_rule(body: AutomationRule) -> AutomationRule:
    # Discard any client-supplied id/timestamps — the store fills them.
    payload = body.model_dump(exclude={"id", "created_at", "updated_at"})
    return AutomationRule(**automation_create(payload))


@router.patch(
    "/automation-rules/{rule_id}",
    response_model=AutomationRule,
    dependencies=[auth_required],
)
async def patch_automation_rule(rule_id: str, body: AutomationRule) -> AutomationRule:
    # Apply the full body as a patch — automation_update treats None as "skip"
    # so callers can omit fields they don't want to overwrite by sending null.
    existing = automation_get(rule_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Automation rule not found.")
    patch = body.model_dump(exclude={"id", "created_at", "updated_at"})
    updated = automation_update(rule_id, patch)
    if updated is None:
        raise HTTPException(status_code=404, detail="Automation rule not found.")
    schedule_changed = _rule_schedule_signature(existing) != _rule_schedule_signature(updated)
    candidate_changed = _rule_candidate_signature(existing) != _rule_candidate_signature(updated)
    if not updated.get("active", True):
        _cancel_open_rule_posts(
            rule_id,
            reason="rule_deactivated",
            message=(
                "Auto-generated post {post_id} was cancelled because its rule "
                "was deactivated."
            ),
        )
        updated = _reset_rule_fire_cursor(rule_id) or updated
    else:
        if schedule_changed:
            updated = _reset_rule_fire_cursor(rule_id) or updated
        if candidate_changed:
            _cancel_open_rule_posts(
                rule_id,
                reason="rule_changed_after_generation",
                message=(
                    "Auto-generated post {post_id} was cancelled because its "
                    "rule changed after generation. A fresh validation request "
                    "will be generated for the new rule state."
                ),
            )
    return AutomationRule(**updated)


@router.delete("/automation-rules/{rule_id}", dependencies=[auth_required])
async def delete_automation_rule(rule_id: str) -> dict[str, bool]:
    _cancel_open_rule_posts(
        rule_id,
        reason="rule_deleted",
        message=(
            "Auto-generated post {post_id} was cancelled because its rule "
            "was deleted."
        ),
    )
    if not automation_delete(rule_id):
        raise HTTPException(status_code=404, detail="Automation rule not found.")
    return {"deleted": True}


# ── Content endpoints ─────────────────────────────────────────────────

@router.get("/content-items", dependencies=[auth_required])
async def list_content(request: Request) -> dict[str, Any]:
    url = await tunnel.wait_for_tunnel(timeout=15.0)
    base = url or str(request.base_url).rstrip("/")

    items = [
        {
            "filename": item["filename"],
            "relative_path": item["relative_path"],
            "description": item["description"],
            "image_url": f"{base}/content/{item['relative_path']}",
        }
        for item in iter_content_items()
    ]
    return {"count": len(items), "items": items}


@router.post("/captions/generate")
async def generate_content_captions(
    request: Request,
    body: CaptionRequest,
    user_id: int = Depends(require_token),
) -> dict[str, Any]:
    url = await tunnel.wait_for_tunnel(timeout=30.0)
    base = url or str(request.base_url).rstrip("/")

    if not url:
        print("WARNING: No tunnel URL — image_url will be internal-only.")
        print("         Use image_base64 for Instagram uploads instead.")

    items = iter_content_items()
    if body.limit is not None:
        items = items[: body.limit]

    include_image = (
        settings.ai_include_images
        if body.include_images_to_ai is None
        else body.include_images_to_ai
    )

    results: list[ContentItem] = []
    for item in items:
        captions = await generate_captions(
            item, include_image=include_image, user_id=user_id
        )

        if body.save_results:
            save_caption_file(item, captions)

        results.append(
            ContentItem(
                filename=item["filename"],
                relative_path=item["relative_path"],
                description=item["description"],
                image_url=f"{base}/content/{item['relative_path']}",
                image_base64=build_image_data_uri(item["image_path"]),
                instagram_caption=captions["instagram_caption"],
                tiktok_caption=captions["tiktok_caption"],
            )
        )

    return {
        "count": len(results),
        "items": [r.model_dump() for r in results],
    }
