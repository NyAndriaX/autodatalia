"""Core business logic — content scanning, AI caption generation, file I/O."""

import asyncio
import base64
import hashlib
import json
import mimetypes
import re
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, UploadFile

from .config import settings
from .db import (
    delete_collection_document,
    get_collection_document,
    list_collection_documents,
    load_scoped_blob,
    save_scoped_blob,
    upsert_collection_document,
)
from .runtime_config import resolved_settings

# Optional dependency — falls back to "no transcode" if the package failed
# to install (e.g. the bundled ffmpeg binary couldn't be unpacked). Upload
# still works in that case; the video just goes out as-uploaded.
try:
    from imageio_ffmpeg import get_ffmpeg_exe as _get_ffmpeg_exe
except Exception:  # pragma: no cover — environmental
    _get_ffmpeg_exe = None  # type: ignore[assignment]

# ── Atomic file write helper ───────────────────────────────────────────
# Every JSON store in the codebase (posts.json, automation_rules.json,
# messages.json, cost_logs.json, video_jobs.json, .ai_cache.json) is the
# source of truth for some flow — a crash during write would corrupt
# the calendar, scheduler or cost dashboard. Going through this helper
# guarantees a half-written file never reaches the persisted path: we
# write to a sibling .tmp, fsync, then os.replace() which is atomic on
# POSIX and on NTFS via MoveFileEx().


def atomic_write_text(path, content: str, *, encoding: str = "utf-8") -> None:
    """Write ``content`` to ``path`` atomically.

    Same signature as ``Path.write_text`` so the callsites can swap
    ``path.write_text(x)`` for ``atomic_write_text(path, x)`` with no
    other change. Creates the parent dir if missing.
    """
    import os as _os
    from pathlib import Path as _Path
    path = _Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding=encoding) as f:
        f.write(content)
        f.flush()
        try:
            _os.fsync(f.fileno())
        except OSError:
            # Some filesystems (e.g. tmpfs on certain dev setups) don't
            # support fsync; the rename is still atomic enough for our
            # crash window since the kernel page cache holds the bytes.
            pass
    _os.replace(tmp, path)


# ── Constants ──────────────────────────────────────────────────────────

# .jfif is what Microsoft Edge / older Windows tools name a regular JPEG.
# The byte content is identical to .jpg, so include it as an image extension
# — otherwise uploaded files vanish from /search after the page reloads.
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}
DESCRIPTION_EXTENSIONS = (".txt", ".md")
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/gif",
    "image/jpeg",
    "image/jfif",
    "image/png",
    "image/webp",
}
ALLOWED_VIDEO_CONTENT_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-m4v",
}


def _extract_upstream_error(response: httpx.Response) -> str:
    """Best-effort extraction of a concise upstream provider error string."""
    try:
        payload = response.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            text = (
                error.get("message")
                or error.get("detail")
                or error.get("type")
                or ""
            )
            if text:
                return str(text).strip()[:240]
        for key in ("message", "detail", "error"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:240]
    text = (response.text or "").strip()
    return text[:240] if text else ""


def _upstream_error_detail(
    message: str,
    upstream_status: int,
    upstream_error: str = "",
) -> dict[str, Any]:
    detail = {
        "message": message,
        "upstream_status": upstream_status,
    }
    if upstream_error:
        detail["upstream_error"] = upstream_error
    return detail


def _upload_kind_for(file: UploadFile, suffix: str) -> str:
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if suffix in IMAGE_EXTENSIONS or content_type in ALLOWED_IMAGE_CONTENT_TYPES:
        return "image"
    if suffix in VIDEO_EXTENSIONS or content_type in ALLOWED_VIDEO_CONTENT_TYPES:
        return "video"
    raise HTTPException(
        status_code=415,
        detail=(
            f"Unsupported upload type: {content_type or suffix or 'unknown'}. "
            "Allowed: PNG, JPG, GIF, WebP, MP4, MOV."
        ),
    )


# ── Content helpers ────────────────────────────────────────────────────

def read_description(image_path: Path) -> str:
    """Return the text from a matching .txt/.md file, or empty string."""
    for ext in DESCRIPTION_EXTENSIONS:
        desc_path = image_path.with_suffix(ext)
        if desc_path.exists():
            return desc_path.read_text(encoding="utf-8").strip()
    return ""


def _media_root(workspace_id: int | str | None = None) -> Path:
    """Resolve the media directory for a workspace.

    Media is isolated per workspace under ``content_dir/ws/{id}`` so members of
    one workspace never see another's uploads. A missing/non-positive id falls
    back to ``content_dir`` itself (the bounded global scope). The returned path
    is always inside ``content_dir`` and is served by the public /content mount
    as ``/content/ws/{id}/<file>``.
    """
    root = settings.content_dir
    if workspace_id in (None, "", 0, "0"):
        return root
    try:
        wid = int(workspace_id)
    except (TypeError, ValueError):
        return root
    return root / "ws" / str(wid) if wid > 0 else root


def _resolve_uploaded_image_path(
    image_filename: str | None,
    *,
    workspace_id: int | str | None = None,
) -> Path | None:
    """Resolve an uploaded image inside the caller's workspace media tree.

    Older code only checked ``content_dir/<filename>``, which broke once media
    moved under ``content_dir/ws/{workspace_id}/...``. The frontend still sends
    just the filename, so we resolve it against the workspace root first and
    then fall back to a bounded recursive search inside that root. A final
    legacy fallback keeps pre-workspace flat files working during migration.
    """
    if not image_filename:
        return None
    safe_image_name = _safe_filename(image_filename)
    if not safe_image_name:
        return None

    media_root = _media_root(workspace_id)
    direct = media_root / safe_image_name
    candidates: list[Path] = [direct]

    legacy = settings.content_dir / safe_image_name
    if legacy != direct:
        candidates.append(legacy)

    for candidate in candidates:
        if (
            candidate.exists()
            and candidate.is_file()
            and candidate.suffix.lower() in IMAGE_EXTENSIONS
        ):
            return candidate

    if media_root.exists():
        for candidate in media_root.rglob(safe_image_name):
            if (
                candidate.is_file()
                and candidate.suffix.lower() in IMAGE_EXTENSIONS
            ):
                return candidate
    return None


def iter_content_items(*, workspace_id: int | str | None = None) -> list[dict[str, Any]]:
    """Scan a workspace's content directory and return metadata for every image.

    Skips pipeline derivatives so caption generation doesn't redo the same
    image once per crop variant (4 calls for one upload would be billed
    individually otherwise).
    """
    items: list[dict[str, Any]] = []
    media_root = _media_root(workspace_id)
    if not media_root.exists():
        return items
    for image_path in sorted(media_root.rglob("*")):
        if not image_path.is_file():
            continue
        if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if _is_derivative_filename(image_path.name):
            continue
        items.append(
            {
                "filename": image_path.name,
                "relative_path": image_path.relative_to(
                    settings.content_dir
                ).as_posix(),
                "description": read_description(image_path),
                "image_path": image_path,
            }
        )
    return items


def build_image_data_uri(image_path: Path) -> str:
    """Return a ``data:<mime>;base64,...`` URI for the given image file."""
    mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(image_path.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{encoded}"


# ── AI caption generation ─────────────────────────────────────────────

def _extract_json(raw: str) -> dict[str, Any]:
    """Pull the first JSON object out of a potentially messy AI response."""
    stripped = raw.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return json.loads(stripped)
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("AI response did not contain a JSON object.")
    return json.loads(stripped[start : end + 1])


async def generate_captions(
    item: dict[str, Any], *, include_image: bool, user_id: str | int | None = None
) -> dict[str, str]:
    """Call the configured AI model and return Instagram + TikTok captions."""
    cfg = resolved_settings(user_id)
    if not cfg.ai_api_key:
        raise HTTPException(status_code=500, detail="AI_API_KEY is not configured.")

    prompt = (
        "Create one Instagram caption and one TikTok caption for this image.\n"
        "Use the description as the main context.\n"
        "Keep captions concise, natural, and ready to post.\n"
        'Return JSON only with this shape: '
        '{"instagram_caption":"...","tiktok_caption":"..."}\n'
        f"Filename: {item['filename']}\n"
        f"Description: {item['description'] or 'No description provided.'}"
    )

    user_content: Any = prompt
    if include_image:
        user_content = [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {
                    "url": build_image_data_uri(item["image_path"]),
                },
            },
        ]

    payload = {
        "model": cfg.ai_model,
        "temperature": 0.7,
        # Two short captions — no need for a large completion budget.
        "max_tokens": 320,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You write short social media captions for brands and "
                    "creators. Always respond with valid JSON only."
                ),
            },
            {"role": "user", "content": user_content},
        ],
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{cfg.ai_api_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {cfg.ai_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://caption-api.local",
                "X-Title": "Caption API",
            },
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=_upstream_error_detail(
                "AI API request failed.",
                response.status_code,
                _extract_upstream_error(response),
            ),
        )

    data = response.json()
    message_content = data["choices"][0]["message"]["content"]
    if isinstance(message_content, list):
        message_content = "".join(
            part.get("text", "") for part in message_content if isinstance(part, dict)
        )

    # Log this call in the cost dashboard — captions are a STANDARD-tier
    # workflow (creative + per-platform), distinct from /generate so the
    # dashboard can show per-feature spend.
    try:
        from .cost_tracking import record_call
        usage = data.get("usage") or {}
        record_call(
            workflow="captions",
            tier="standard",
            model=cfg.ai_model,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            user_id=user_id,
        )
    except Exception:
        pass

    try:
        captions = _extract_json(message_content)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Could not parse AI response.") from exc

    return {
        "instagram_caption": captions.get("instagram_caption", "").strip(),
        "tiktok_caption": captions.get("tiktok_caption", "").strip(),
    }


# ── Token conservation: persistent TTL cache ───────────────────────────
# Identical AI requests (same prompt/options) return the cached response
# instead of re-billing the model. Persisted to disk so a container
# restart does not re-bill previously-answered prompts.

_AI_CACHE_TTL = 24 * 3600.0  # seconds
_AI_CACHE_MAX = 512


def _normalize_cache_user_id(user_id: str | int | None) -> int | None:
    """Map a caller id to a positive tenant id, or None for the global scope.

    Mirrors db._scope_key: a real user (>0) gets its own cache scope; the
    shared/global tenant (None/0/<=0) uses the bounded 'global' scope.
    """
    if user_id in (None, "", 0, "0"):
        return None
    try:
        normalized = int(user_id)
    except (TypeError, ValueError):
        return None
    return normalized if normalized > 0 else None


def _load_cache(user_id: str | int | None = None) -> dict[str, list[Any]]:
    """Load the persisted, per-tenant AI cache, dropping expired entries."""
    scope_uid = _normalize_cache_user_id(user_id)
    try:
        raw = load_scoped_blob("ai_cache", user_id=scope_uid, default={}) or {}
        now = time.time()
        if not isinstance(raw, dict):
            return {}
        return {k: v for k, v in raw.items() if isinstance(v, list) and v and v[0] > now}
    except Exception:
        return {}


# In-memory cache, partitioned by tenant scope so one tenant's generated
# content can NEVER be served to another. Key: scope ("global" or "user:<id>")
# → {cache_key: [expires_at, value]}. The global slice is primed at import;
# per-user slices are lazily loaded from the user's own persisted blob.
_AI_CACHE: dict[str, list[Any]] = _load_cache()  # global slice (back-compat name)
_AI_CACHE_BY_SCOPE: dict[str, dict[str, list[Any]]] = {"global": _AI_CACHE}


def _cache_scope_name(user_id: str | int | None) -> str:
    scope_uid = _normalize_cache_user_id(user_id)
    return "global" if scope_uid is None else f"user:{scope_uid}"


def _cache_scope(user_id: str | int | None) -> dict[str, list[Any]]:
    scope = _cache_scope_name(user_id)
    bucket = _AI_CACHE_BY_SCOPE.get(scope)
    if bucket is None:
        bucket = _load_cache(user_id)
        _AI_CACHE_BY_SCOPE[scope] = bucket
    return bucket


def _save_cache(user_id: str | int | None = None) -> None:
    try:
        save_scoped_blob(
            "ai_cache",
            _cache_scope(user_id),
            user_id=_normalize_cache_user_id(user_id),
        )
    except Exception:
        pass  # cache is best-effort; never break a request over it


def _cache_key(*parts: Any) -> str:
    return hashlib.sha256(
        json.dumps(parts, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _cache_get(key: str, *, user_id: str | int | None = None) -> Any | None:
    bucket = _cache_scope(user_id)
    hit = bucket.get(key)
    if not hit:
        return None
    expires, value = hit
    if time.time() > expires:
        bucket.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any, *, user_id: str | int | None = None) -> None:
    bucket = _cache_scope(user_id)
    if len(bucket) >= _AI_CACHE_MAX:
        bucket.clear()  # simple bound — fine for this scale
    bucket[key] = [time.time() + _AI_CACHE_TTL, value]
    _save_cache(user_id)


# ── Token conservation: prompt compression (#9) ────────────────────────

def _compress(text: str, *, limit: int = 4000) -> str:
    """Collapse runaway whitespace and hard-cap length — fewer input tokens."""
    text = re.sub(r"[ \t]+", " ", (text or "").strip())
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:limit]


# ── Token conservation: per-tenant daily rate limit (#10) ──────────────
# The quota is keyed by the AUTHENTICATED TENANT, not the raw client IP.
# IP-keying let one tenant behind a shared NAT/proxy exhaust another tenant's
# allowance (and, conversely, let a single tenant dodge the cap by rotating
# IPs). We fall back to the IP only for the shared/global scope (open mode /
# server-to-server) where there is no per-user identity to key on.

_RATE: dict[str, list[Any]] = {}  # rate_key -> [yyyy-mm-dd, count]


def rate_key_for(user_id: str | int | None, client_id: str) -> str:
    """Build the daily-quota key.

    Authenticated tenants (user_id > 0) are keyed by ``user:<id>`` so the limit
    follows the account regardless of source IP. The global/shared scope keeps
    using the (IP-based) ``client_id`` since it has no per-user identity.
    """
    normalized = _normalize_cache_user_id(user_id)
    if normalized is not None:
        return f"user:{normalized}"
    return f"ip:{client_id}"


def rate_guard(rate_key: str) -> None:
    """Raise 429 if this key already hit AI_DAILY_LIMIT real calls today.

    ``rate_key`` should come from ``rate_key_for(user_id, client_ip)`` so the
    quota is per authenticated tenant. A bare IP is only correct for the
    shared/global scope.
    """
    limit = settings.ai_daily_limit
    if limit <= 0:
        return
    today = time.strftime("%Y-%m-%d")
    day, count = _RATE.get(rate_key, [today, 0])
    if day == today and count >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Daily AI limit reached ({limit}). Try again tomorrow.",
        )


def rate_tick(rate_key: str) -> None:
    """Count one real (non-cached) AI call against the daily quota."""
    if settings.ai_daily_limit <= 0:
        return
    today = time.strftime("%Y-%m-%d")
    day, count = _RATE.get(rate_key, [today, 0])
    if day != today:
        day, count = today, 0
    _RATE[rate_key] = [day, count + 1]


_ZERO_USAGE = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

# ── LLM tier → model resolver ──────────────────────────────────────────
# Centralised so every callsite picks a tier (fast/standard/premium) and
# the actual model id is one config swap away. This is the wiring the
# CEO checklist (#4 "tiered LLM routing") expects: every call labels its
# tier, and the cost dashboard rolls up spend per tier.

def model_for_tier(tier: str, user_id: str | int | None = None) -> str:
    cfg = resolved_settings(user_id)
    if tier == "fast":
        return cfg.ai_model_fast
    if tier == "premium":
        return cfg.ai_model_premium
    return cfg.ai_model


def _with_google_thinking_disabled(payload: dict[str, Any], base_url: str) -> dict[str, Any]:
    """Turn off "thinking" for Gemini *flash* models on Google's endpoint.

    On Google's OpenAI-compatible API, reasoning tokens count against
    ``max_tokens``. Our callers size ``max_tokens`` for the visible answer
    only (e.g. 600 for one post variant), so a thinking model such as
    gemini-3.5-flash burns the budget reasoning and returns truncated JSON
    (finish_reason="length") -> "Could not parse AI response". Copywriting
    doesn't need reasoning, so flash models get ``reasoning_effort="none"``.
    Pro models can't disable thinking (they'd 400) and OpenRouter has its
    own semantics, so both are left untouched, as is an explicit caller value.
    "lite" models don't think by default and reject "none" with a 400.
    """
    model = str(payload.get("model") or "").lower()
    if (
        "generativelanguage.googleapis.com" in (base_url or "")
        and "flash" in model
        and "lite" not in model
        and "image" not in model
        and "reasoning_effort" not in payload
    ):
        return {**payload, "reasoning_effort": "none"}
    return payload


async def _post_chat(
    payload: dict[str, Any],
    *,
    workflow: str = "generate",
    tier: str = "standard",
    user_id: str | int | None = None,
    log_cost: bool = True,
) -> tuple[str, dict[str, int]]:
    """POST an OpenAI-compatible chat payload; return (text, usage).

    Every successful call lands a row in the cost log via cost_tracking
    so the dashboard can show per-workflow spend. Skip with log_cost=False
    when the caller is going to log a different shape (e.g. media gen).
    """
    cfg = resolved_settings(user_id)
    if not cfg.ai_api_key:
        raise HTTPException(status_code=500, detail="AI_API_KEY is not configured.")

    sent = _with_google_thinking_disabled(payload, cfg.ai_api_base_url)
    headers = {
        "Authorization": f"Bearer {cfg.ai_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://caption-api.local",
        "X-Title": "Caption API",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{cfg.ai_api_base_url}/chat/completions", headers=headers, json=sent
        )
        if response.status_code == 400 and sent is not payload:
            # A model we didn't anticipate rejects the injected
            # reasoning_effort: retry exactly as the caller asked.
            response = await client.post(
                f"{cfg.ai_api_base_url}/chat/completions", headers=headers, json=payload
            )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=_upstream_error_detail(
                "AI API request failed.",
                response.status_code,
                _extract_upstream_error(response),
            ),
        )

    data = response.json()
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    usage = data.get("usage") or {}
    usage = {
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
        "total_tokens": usage.get("total_tokens", 0),
    }
    if log_cost:
        try:
            from .cost_tracking import record_call
            record_call(
                workflow=workflow,
                tier=tier,
                model=payload.get("model") or model_for_tier(tier, user_id),
                prompt_tokens=usage["prompt_tokens"],
                completion_tokens=usage["completion_tokens"],
                user_id=user_id,
            )
        except Exception:
            pass  # cost logging is best-effort — never break a real call
    return content, usage


def record_cache_hit(
    *,
    workflow: str,
    tier: str,
    model: str,
    estimated_prompt_tokens: int = 0,
    estimated_completion_tokens: int = 0,
    user_id: str | int | None = None,
) -> None:
    """Persist a zero-cost cache-hit log entry so the dashboard can show
    real "tokens saved" stats. Safe to call from any path that returns a
    memoized response without hitting the model.
    """
    try:
        from .cost_tracking import record_call
        record_call(
            workflow=workflow,
            tier=tier,
            model=model,
            prompt_tokens=estimated_prompt_tokens,
            completion_tokens=estimated_completion_tokens,
            user_id=user_id,
            cached=True,
        )
    except Exception:
        pass


def _image_hash(image_path: Path) -> str:
    """SHA-256 of the image bytes. Stable across renames, sensitive to edits."""
    h = hashlib.sha256()
    with image_path.open("rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


async def _describe_image(
    image_path: Path, *, user_id: str | int | None = None
) -> str:
    """Return a short cached text description of the image.

    The vision model is hit at most once per unique file (key = content
    hash, persisted in the AI cache). Every later /generate call that
    references the same image reuses this text — the image bytes never
    go to the model again until the file actually changes.
    """
    cfg = resolved_settings(user_id)
    if not cfg.ai_api_key:
        return ""
    key = _cache_key(
        "describe",
        _image_hash(image_path),
        cfg.ai_api_base_url,
        cfg.ai_model_fast,
    )
    cached = _cache_get(key, user_id=user_id)
    if isinstance(cached, str) and cached:
        record_cache_hit(
            workflow="image_description",
            tier="fast",
            model=cfg.ai_model_fast,
            user_id=user_id,
        )
        return cached

    payload = {
        # Factual image-description is a perfect SIMPLE-tier job — accuracy
        # over creativity, no need to pay the standard model's premium.
        "model": cfg.ai_model_fast,
        "temperature": 0.2,
        "max_tokens": 140,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Describe images factually for a copywriter: subject, "
                    "setting, mood, dominant colors, any visible text or "
                    "branding. 2-3 short sentences, no preamble."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this image."},
                    {
                        "type": "image_url",
                        "image_url": {"url": build_image_data_uri(image_path)},
                    },
                ],
            },
        ],
    }
    try:
        text, _usage = await _post_chat(
            payload, workflow="image_description", tier="fast", user_id=user_id
        )
    except HTTPException as e:
        print(f"[debug] _describe_image AI error: {e.detail}")
        return ""
    text = text.strip()
    if text:
        _cache_set(key, text, user_id=user_id)
    return text


# ── Fast-tier dedicated helpers ────────────────────────────────────────
# Hashtags, post summaries and reformulations are SIMPLE-tier jobs:
# accuracy/repeatability matter, not creativity. Routing them through
# the cheap model cuts spend by ~10x on heavy days.


async def generate_hashtags(
    content: str, *, user_id: str | int | None = None, max_tags: int = 8
) -> tuple[list[str], dict[str, int]]:
    """Suggest hashtags for a post. Fast tier."""
    cfg = resolved_settings(user_id)
    content = _compress(content, limit=2000)
    if not content.strip():
        return [], dict(_ZERO_USAGE)
    cache_key = _cache_key("hashtags", content, max_tags, cfg.ai_model_fast)
    cached = _cache_get(cache_key, user_id=user_id)
    if cached is not None:
        record_cache_hit(
            workflow="hashtags",
            tier="fast",
            model=cfg.ai_model_fast,
            user_id=user_id,
        )
        return cached, dict(_ZERO_USAGE)
    payload = {
        "model": cfg.ai_model_fast,
        "temperature": 0.4,
        "max_tokens": 100,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Suggest concise, on-topic social hashtags. Return ONE "
                    "line, space-separated, each tag starting with #."
                ),
            },
            {"role": "user", "content": f"Up to {max_tags} hashtags for:\n\n{content}"},
        ],
    }
    text, usage = await _post_chat(
        payload, workflow="hashtags", tier="fast", user_id=user_id
    )
    tags = [t.strip() for t in text.split() if t.startswith("#")][:max_tags]
    _cache_set(cache_key, tags, user_id=user_id)
    return tags, usage


async def summarize_post(
    content: str, *, user_id: str | int | None = None, target_chars: int = 240
) -> tuple[str, dict[str, int]]:
    """One-paragraph summary of a longer post. Fast tier."""
    cfg = resolved_settings(user_id)
    content = _compress(content, limit=4000)
    if not content.strip():
        return "", dict(_ZERO_USAGE)
    cache_key = _cache_key("summary", content, target_chars, cfg.ai_model_fast)
    cached = _cache_get(cache_key, user_id=user_id)
    if cached is not None:
        record_cache_hit(
            workflow="summary",
            tier="fast",
            model=cfg.ai_model_fast,
            user_id=user_id,
        )
        return cached, dict(_ZERO_USAGE)
    payload = {
        "model": cfg.ai_model_fast,
        "temperature": 0.3,
        "max_tokens": 200,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You summarise marketing copy. Return ONE short paragraph, "
                    "no preamble, no bullet points."
                ),
            },
            {
                "role": "user",
                "content": f"Summarise in ~{target_chars} characters:\n\n{content}",
            },
        ],
    }
    text, usage = await _post_chat(
        payload, workflow="summary", tier="fast", user_id=user_id
    )
    text = text.strip()
    _cache_set(cache_key, text, user_id=user_id)
    return text, usage


async def generate_post_variants(
    *,
    prompt: str,
    platforms: dict[str, bool] | None = None,
    template: str | None = None,
    tone: str | None = None,
    n: int = 1,
    image_filename: str | None = None,
    quality: str = "auto",
    user_id: str | int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int], str]:
    """Prompt-driven generation — returns ([{id,text,tone}], usage, model).

    `quality` controls tier selection:
      - "auto"     : standard tier, escalates to premium when n >= 3
                     (more variants = harder differentiation problem)
      - "fast"     : forces fast tier — cheapest, single-variant only
      - "standard" : forces standard tier
      - "premium"  : forces premium tier (use sparingly — most expensive)
    """
    prompt = _compress(prompt)
    active = [k for k, v in (platforms or {}).items() if v] or ["generic"]

    # Resolve the optional uploaded image. We accept just the filename so the
    # frontend never has to re-upload bytes — the file is already in our
    # content dir. Anything outside the content dir is silently ignored.
    image_path = _resolve_uploaded_image_path(
        image_filename,
        workspace_id=user_id,
    )

    # Convert the image (if any) to a short cached description so the vision
    # model is hit at most once per file. Repeat generations on the same
    # image — even with different prompts — use the text only, saving the
    # ~250-1000 image tokens per call.
    image_description = ""
    image_fingerprint: str | None = None
    if image_path:
        image_fingerprint = _image_hash(image_path)
        image_description = await _describe_image(image_path, user_id=user_id)

    # Tier selection — drives the model choice + dashboard label.
    if quality == "fast":
        tier = "fast"
    elif quality == "premium":
        tier = "premium"
    elif quality == "standard":
        tier = "standard"
    else:  # auto
        tier = "premium" if n >= 3 else "standard"
    chosen_model = model_for_tier(tier, user_id)

    tone = _compress(tone or "", limit=200)

    cache_key = _cache_key(
        "generate", prompt, sorted(active), template, tone, n,
        image_fingerprint, image_description, tier, chosen_model,
    )
    cached = _cache_get(cache_key, user_id=user_id)
    if cached is not None:
        record_cache_hit(
            workflow="post_variants",
            tier=tier,
            model=chosen_model,
            user_id=user_id,
        )
        return cached, dict(_ZERO_USAGE), chosen_model

    user_prompt = (
        f"Write {n} distinct social media post variants.\n"
        f"Brief: {prompt.strip() or 'An engaging brand post.'}\n"
        f"Target platforms: {', '.join(active)}.\n"
        + (f"Brand template/style hint: {template}.\n" if template else "")
        + (f"Preferred tone/voice: {tone}.\n" if tone else "")
        + (
            f"Image (already analyzed): {image_description}\n"
            "Use it as the main subject.\n"
            if image_description
            else ""
        )
        + "Each variant must have a different angle/tone, be ready to post, "
        "and include relevant hashtags.\n"
        'Return JSON only with this shape: '
        '{"variants":[{"text":"...","tone":"..."}]}'
    )

    user_content = user_prompt

    payload = {
        "model": chosen_model,
        "temperature": 0.85,
        # Bound output cost: ample token room to prevent truncation on Google free tier
        "max_tokens": 400 * n + 200,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a senior social media copywriter. Always respond "
                    "with valid JSON only."
                ),
            },
            {"role": "user", "content": user_content},
        ],
    }

    raw, usage = await _post_chat(
        payload, workflow="post_variants", tier=tier, user_id=user_id
    )
    try:
        parsed = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Could not parse AI response.") from exc

    variants: list[dict[str, Any]] = []
    for idx, item in enumerate(parsed.get("variants", []), start=1):
        text = (item.get("text") or "").strip()
        if not text:
            continue
        variants.append(
            {"id": idx, "text": text, "tone": (item.get("tone") or "").strip()}
        )

    if not variants:
        raise HTTPException(
            status_code=502, detail="AI returned no usable variants."
        )
    _cache_set(cache_key, variants, user_id=user_id)
    return variants, usage, chosen_model


_TRANSFORM_INSTRUCTIONS = {
    "shorten": "Rewrite the post to be significantly shorter while keeping the core message and key hashtags.",
    "expand": "Expand the post with more detail, value and a clear call to action, keeping the same voice.",
    "tone-casual": "Rewrite the post in a casual, friendly, conversational tone.",
    "tone-pro": "Rewrite the post in a polished, professional, authoritative tone.",
}

TRANSFORM_ACTIONS = tuple(_TRANSFORM_INSTRUCTIONS.keys())


async def transform_content(
    content: str, action: str, *, user_id: str | int | None = None
) -> tuple[str, dict[str, int], str]:
    """Apply a quick AI action to existing content; returns (text, usage, model)."""
    cfg = resolved_settings(user_id)
    instruction = _TRANSFORM_INSTRUCTIONS.get(action)
    if instruction is None:
        # Explicit 422 with the allowed values — better than a silent pass.
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Unknown action.",
                "allowed_actions": list(TRANSFORM_ACTIONS),
            },
        )

    content = _compress(content)
    cache_key = _cache_key("transform", action, content, cfg.ai_model_fast)
    cached = _cache_get(cache_key, user_id=user_id)
    if cached is not None:
        record_cache_hit(
            workflow="transform",
            tier="fast",
            model=cfg.ai_model_fast,
            user_id=user_id,
        )
        return cached, dict(_ZERO_USAGE), cfg.ai_model_fast

    payload = {
        # Quick actions use the cheap/fast model (LLM Router cost strategy).
        "model": cfg.ai_model_fast,
        # Lower temperature → more deterministic → more cache hits.
        "temperature": 0.4,
        # "expand" needs headroom; others stay tight. Bounded either way.
        "max_tokens": min(900, max(160, len(content) // 2 + 120)),
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a social media copy editor. Return ONLY the "
                    "rewritten post text — no preamble, no quotes, no JSON."
                ),
            },
            {"role": "user", "content": f"{instruction}\n\n---\n{content}"},
        ],
    }
    text, usage = await _post_chat(
        payload, workflow="transform", tier="fast", user_id=user_id
    )
    text = text.strip()
    _cache_set(cache_key, text, user_id=user_id)
    return text, usage, cfg.ai_model_fast


# ── Media upload ───────────────────────────────────────────────────────

def _safe_filename(name: str) -> str:
    """Strip any path and unsafe characters from a client-supplied name."""
    base = Path(name or "upload").name
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._") or "upload"
    return base[:120]


def _unique_path(directory: Path, filename: str) -> Path:
    """Return a non-colliding path inside `directory` for `filename`."""
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem, suffix = candidate.stem, candidate.suffix
    i = 1
    while True:
        alt = directory / f"{stem}_{i}{suffix}"
        if not alt.exists():
            return alt
        i += 1


def delete_media(
    relative_path: str, *, workspace_id: int | str | None = None
) -> bool:
    """Delete a media file by its content-dir-relative path.

    Returns True if removed, False if not found. Raises ValueError if the path
    escapes the workspace's media directory — the guard is pinned to
    ``_media_root(workspace_id)`` so a workspace can only delete its OWN media
    (a crafted ``ws/<other>/...`` path resolves outside the caller's root and
    is rejected), as well as blocking classic ``../`` traversal.
    """
    if not relative_path:
        raise ValueError("Empty path.")
    content_root = settings.content_dir.resolve()
    media_root = _media_root(workspace_id).resolve()
    # The public id/relative_path is content-dir-relative (e.g. "ws/3/a.jpg");
    # resolve it from the content root, then require it to live under the
    # caller's own media root.
    target = (content_root / relative_path).resolve()
    try:
        target.relative_to(media_root)
    except ValueError as exc:
        raise ValueError("Path escapes the workspace media directory.") from exc
    if not target.is_file():
        return False
    target.unlink()
    # Drop the optional sidecar description too (.txt/.md beside the file)
    # and any AI/Publish derivative images (_converted, _cropped).
    for p in target.parent.glob(f"{target.stem}*"):
        if p.is_file():
            p.unlink()
    return True


async def _probe_video_codec(src: Path, exe: str) -> dict[str, str | None]:
    """Quick ffmpeg probe — returns {video, audio, pix_fmt} codecs.

    Uses ffmpeg's `-t 0.1 -f null -` to read just the headers (no decode);
    typically returns in ~50-200ms even for huge files. Lets us avoid a
    pointless re-encode when the file is already H.264 + AAC in MP4 —
    the case for most snaptik / Instagram-Reels-download / native-share
    inputs.
    """
    cmd = [exe, "-hide_banner", "-i", str(src), "-t", "0.1", "-f", "null", "-"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
    except Exception:
        return {"video": None, "audio": None, "pix_fmt": None}
    text = (stderr or b"").decode("utf-8", errors="replace")
    video_codec = None
    audio_codec = None
    pix_fmt = None
    for line in text.split("\n"):
        if "Video:" in line and video_codec is None:
            m = re.search(r"Video:\s+([a-z0-9_]+)", line)
            if m:
                video_codec = m.group(1).lower()
            # pix_fmt sits later on the same line: "Video: h264 (...), yuv420p(...)"
            m2 = re.search(r",\s*(yuv\w+)", line)
            if m2:
                pix_fmt = m2.group(1).lower()
        if "Audio:" in line and audio_codec is None:
            m = re.search(r"Audio:\s+([a-z0-9_]+)", line)
            if m:
                audio_codec = m.group(1).lower()
    return {"video": video_codec, "audio": audio_codec, "pix_fmt": pix_fmt}


async def _normalize_video_for_publishing(src: Path) -> Path:
    """Transcode a video to a universal H.264 + AAC MP4 — but SKIP the
    re-encode entirely when the source is already compatible.

    Every social platform we publish to accepts H.264 + AAC in an MP4
    container (TikTok requires it; FB/IG accept it). Inputs from snaptik /
    phone exports / screen recorders sometimes ship with HEVC, VP9, or
    AV1 — TikTok rejects those at processing time with the cryptic
    `file_format_check_failed`. So we probe first; only re-encode when
    the source actually needs it.

    Fast-path (no re-encode): MP4 container + H.264 video + AAC audio +
    yuv420p pixel format. Probe is ~100ms, so this is essentially free
    for the common case.

    Transcode path settings (when needed):
      - libx264 with `ultrafast` preset + CRF 23 → ~5× realtime on a
        modern CPU; the snaptik / phone-export sources we re-encode are
        already low-bitrate so the visual cost is negligible
      - yuv420p pixel format → matches every consumer player; some
        phone cameras shoot yuv444 which TikTok also refuses
      - even dimensions via `scale=trunc(iw/2)*2:trunc(ih/2)*2` →
        libx264 requires even width/height
      - +faststart → moov atom at the front so the platform can start
        streaming before the full file arrives
      - 44.1 kHz / 128 kbps AAC → TikTok rejects 48 kHz mono in some cases

    Returns the path to the normalised file. On any failure (ffmpeg not
    available, decode error, output empty) the original file is returned
    untouched so the upload still goes through — better to attempt a
    publish that might fail than to lose the upload entirely.
    """
    if _get_ffmpeg_exe is None:
        return src
    try:
        exe = _get_ffmpeg_exe()
    except Exception:
        return src

    # Fast path: if the source is already H.264 + AAC + yuv420p in an MP4
    # container, skip transcoding. Saves ~90s for a 3-minute snaptik clip.
    probe = await _probe_video_codec(src, exe)
    if (
        src.suffix.lower() == ".mp4"
        and probe["video"] == "h264"
        and probe["audio"] in {"aac", None}  # silent videos have no audio stream
        and probe["pix_fmt"] in {"yuv420p", None}
    ):
        print(f"[transcode] {src.name}: already compatible, skipping re-encode")
        return src

    print(
        f"[transcode] {src.name}: probe v={probe['video']} a={probe['audio']} "
        f"pix={probe['pix_fmt']} ext={src.suffix} — re-encoding"
    )

    # Output always lands at <stem>.mp4 — even if input was .mov / .webm.
    # If the source already has that name, transcode to a sibling and swap.
    out = src.with_name(f"{src.stem}__norm.mp4")
    cmd = [
        exe,
        "-y",
        "-i", str(src),
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-movflags", "+faststart",
        # Cap to TikTok's hard max (10 min). Anything longer would be
        # cut off by TikTok anyway — better to be explicit.
        "-t", "600",
        str(out),
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            tail = (stderr or b"")[-400:].decode("utf-8", errors="replace")
            print(f"[transcode] ffmpeg exit {proc.returncode}: {tail}")
            try:
                if out.exists():
                    out.unlink()
            except OSError:
                pass
            return src
        if not out.exists() or out.stat().st_size == 0:
            return src
    except Exception as exc:
        print(f"[transcode] subprocess failed: {exc}")
        return src

    # Swap files: replace original with normalised, normalise filename to
    # .mp4 so the URL Meta/TikTok eventually see has a sane extension.
    final = src.with_suffix(".mp4")
    try:
        src.unlink()
    except OSError:
        pass
    try:
        out.rename(final)
    except OSError:
        # Cross-volume rename can fail on some Windows setups; fall back
        # to copy + delete.
        final.write_bytes(out.read_bytes())
        try:
            out.unlink()
        except OSError:
            pass
    return final


async def save_upload(
    file: UploadFile, *, workspace_id: int | str | None = None
) -> dict[str, str]:
    """Persist an uploaded file to the workspace's content dir; return metadata.

    For videos, also normalise the codec to H.264 + AAC MP4 so the publish
    path doesn't trip over TikTok's `file_format_check_failed` later.
    Transcoding is synchronous — the user already sees an "Uploading…"
    spinner, and we'd rather the upload take 5-30s extra than return a
    file that fails at publish time.
    """
    media_root = _media_root(workspace_id)
    media_root.mkdir(parents=True, exist_ok=True)
    safe = _safe_filename(file.filename or "upload")
    dest = _unique_path(media_root, safe)
    suffix = dest.suffix.lower()
    kind = _upload_kind_for(file, suffix)

    total = 0
    try:
        with dest.open("wb") as fh:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Upload exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                    )
                fh.write(chunk)
    except Exception:
        try:
            if dest.exists():
                dest.unlink()
        except OSError:
            pass
        raise

    if total <= 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if kind == "video":
        dest = await _normalize_video_for_publishing(dest)

    return {
        "filename": dest.name,
        "relative_path": dest.relative_to(settings.content_dir).as_posix(),
        "kind": kind,
    }


# ── Search ─────────────────────────────────────────────────────────────

# Derivatives the publish/crop/transcode pipeline writes next to the
# original. These are cache artefacts — the Library should never show
# them as standalone tiles, otherwise one upload looks like 3-4 separate
# assets to the user.
#   _r<W>x<H>_cropped : per-platform aspect-ratio crop (images.py:103)
#   _converted        : image-format normalisation, e.g. HEIC→JPG (images.py:208)
#   __norm            : video transcode for publishing (services.py:907)
_DERIVATIVE_PATTERN = re.compile(
    r"(_r\d+x\d+_cropped|_converted|__norm)+$",
    re.IGNORECASE,
)


def _is_derivative_filename(name: str) -> bool:
    """True if this looks like a derivative file produced by the publish
    pipeline (not an asset the user uploaded directly)."""
    stem = name.rsplit(".", 1)[0]
    return bool(_DERIVATIVE_PATTERN.search(stem))


def search_media(
    query: str, limit: int = 50, *, workspace_id: int | str | None = None
) -> list[dict[str, str]]:
    """Search a workspace's content directory for media matching `query`.

    Empty query returns up to `limit` items (acts as a listing endpoint for
    the Media Library). Posts/templates live in Airtable (not wired yet) so
    only `media` hits are returned for now — honest partial results, no
    mock padding.

    Pipeline derivatives (``_converted``, ``_rNxN_cropped``, ``__norm``)
    are hidden — they're caches keyed off the original and would otherwise
    surface as duplicate tiles in the Library.
    """
    q = query.strip().lower()
    hits: list[dict[str, str]] = []
    media_root = _media_root(workspace_id)
    if not media_root.exists():
        return hits
    for path in sorted(media_root.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix not in IMAGE_EXTENSIONS and suffix not in VIDEO_EXTENSIONS:
            continue
        if _is_derivative_filename(path.name):
            continue
        description = read_description(path)
        if q and q not in path.name.lower() and q not in description.lower():
            continue
        kind = "video" if suffix in VIDEO_EXTENSIONS else "image"
        hits.append(
            {
                "id": path.relative_to(settings.content_dir).as_posix(),
                "type": "media",
                "kind": kind,
                "title": path.name,
                "subtitle": f"{kind.capitalize()} · {path.stat().st_size // 1024} KB",
            }
        )
        if len(hits) >= limit:
            break
    return hits


# ── Scheduled posts: JSON-file persistence ─────────────────────────────
# Single-file store keeps deployment simple. Locking is a single in-process
# threading.Lock — fine for one uvicorn worker; swap to SQLite if we scale
# horizontally.

import threading as _threading
import uuid as _uuid

_POSTS_FILE = settings.content_dir / "posts.json"
_POSTS_LOCK = _threading.Lock()


def _posts_read_raw() -> list[dict[str, Any]]:
    try:
        data = json.loads(_POSTS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []  # corrupt → start fresh; never crash the process


def _posts_write_raw(posts: list[dict[str, Any]]) -> None:
    _POSTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_text(_POSTS_FILE, json.dumps(posts, indent=2))


def posts_list(
    user_id: str | int | None = None,
    *,
    all_users: bool = False,
) -> list[dict[str, Any]]:
    """Return persisted scheduled posts, filtered to one user by default."""
    with _POSTS_LOCK:
        return list_collection_documents(
            "posts",
            user_id=user_id,
            all_scopes=all_users,
            newest_first=False,
        )


def posts_create(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist a new post and return it (auto-fills id if missing)."""
    with _POSTS_LOCK:
        post = dict(payload)
        if not post.get("id"):
            post["id"] = f"srv-{_uuid.uuid4().hex[:10]}"
        post.setdefault("content", "")
        post.setdefault("platforms", {})
        post.setdefault("status", "draft")
        post.setdefault("media", [])
        upsert_collection_document(
            "posts",
            post["id"],
            post,
            user_id=post.get("workspace_id"),
            sort_ts=post.get("published_at") or post.get("scheduled_for"),
        )
        return post


def posts_get(
    post_id: str,
    *,
    user_id: str | int | None = None,
    scoped: bool = False,
) -> dict[str, Any] | None:
    """Fetch a single post.

    SECURITY: request handlers MUST pass ``scoped=True`` together with the
    caller's ``user_id`` so a tenant can never read another tenant's post.
    The default (``scoped=False``) is an all-scopes lookup, preserved for
    trusted internal callers (scheduler, automation worker, telegram approval)
    that legitimately act across every tenant. Never call this with the
    default from a user-request path.
    """
    with _POSTS_LOCK:
        return get_collection_document(
            "posts", post_id, user_id=user_id, all_scopes=not scoped
        )


def posts_update(
    post_id: str,
    patch: dict[str, Any],
    *,
    user_id: str | int | None = None,
    scoped: bool = False,
) -> dict[str, Any] | None:
    """Apply a partial update (None values are ignored). Returns the post or None.

    SECURITY: when ``scoped=True`` the post is read bounded to the caller's
    ``user_id`` first, so a tenant cannot mutate a post outside its own scope
    (the lookup misses → returns None → caller surfaces 404). The default
    (all-scopes) is reserved for trusted internal callers (scheduler /
    automation worker / telegram) which act on every tenant's posts.
    """
    with _POSTS_LOCK:
        post = get_collection_document(
            "posts", post_id, user_id=user_id, all_scopes=not scoped
        )
        if post is None:
            return None
        for key, value in patch.items():
            if value is None:
                continue
            post[key] = value
        upsert_collection_document(
            "posts",
            post_id,
            post,
            user_id=post.get("workspace_id"),
            sort_ts=post.get("published_at") or post.get("scheduled_for"),
        )
        return post


def posts_delete(
    post_id: str,
    *,
    user_id: str | int | None = None,
    scoped: bool = False,
) -> bool:
    """Remove the post by id. Returns True if anything was removed.

    SECURITY: pass ``scoped=True`` + the caller's ``user_id`` from request
    handlers so a caller can only delete a post in its own scope. The default
    all-scopes path is reserved for trusted internal callers.
    """
    with _POSTS_LOCK:
        post = get_collection_document(
            "posts", post_id, user_id=user_id, all_scopes=not scoped
        )
        if post is None:
            return False
        return delete_collection_document(
            "posts",
            post_id,
            user_id=post.get("workspace_id"),
        )


# ── Automation rules CRUD ──────────────────────────────────────────────
# Same JSON-file pattern as posts, separate file so a corrupt one doesn't
# brick the other. Phase 2 will add a worker that reads this file.

_AUTOMATION_FILE = settings.content_dir / "automation_rules.json"
_AUTOMATION_LOCK = _threading.Lock()


def _automation_read_raw() -> list[dict[str, Any]]:
    try:
        data = json.loads(_AUTOMATION_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []


def _automation_write_raw(rules: list[dict[str, Any]]) -> None:
    _AUTOMATION_FILE.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_text(_AUTOMATION_FILE, json.dumps(rules, indent=2))


def automation_list(
    user_id: str | int | None = None,
    *,
    all_users: bool = False,
) -> list[dict[str, Any]]:
    with _AUTOMATION_LOCK:
        return list_collection_documents(
            "automation_rules",
            user_id=user_id,
            all_scopes=all_users,
            newest_first=False,
        )


def automation_get(
    rule_id: str,
    *,
    user_id: str | int | None = None,
    scoped: bool = False,
) -> dict[str, Any] | None:
    """Fetch one automation rule.

    SECURITY: request handlers MUST pass ``scoped=True`` + the caller's
    ``user_id`` so a tenant can only see its own rules. The default all-scopes
    lookup is reserved for trusted internal callers (automation worker,
    telegram approval) that legitimately act across tenants.
    """
    with _AUTOMATION_LOCK:
        return get_collection_document(
            "automation_rules", rule_id, user_id=user_id, all_scopes=not scoped
        )


def automation_create(payload: dict[str, Any]) -> dict[str, Any]:
    with _AUTOMATION_LOCK:
        rule = dict(payload)
        if not rule.get("id"):
            rule["id"] = f"ar_{_uuid.uuid4().hex[:10]}"
        now = time.time()
        rule.setdefault("created_at", now)
        rule["updated_at"] = now
        rule.setdefault("active", True)
        upsert_collection_document(
            "automation_rules",
            rule["id"],
            rule,
            user_id=rule.get("workspace_id"),
            sort_ts=rule["updated_at"],
        )
        return rule


def automation_update(
    rule_id: str,
    patch: dict[str, Any],
    *,
    user_id: str | int | None = None,
    scoped: bool = False,
) -> dict[str, Any] | None:
    """Apply a partial update to a rule.

    SECURITY: request handlers pass ``scoped=True`` + the caller's
    ``user_id`` so a tenant cannot mutate another tenant's rule (the
    scope-bounded lookup misses → returns None → 404). Default all-scopes
    is reserved for trusted internal callers.
    """
    with _AUTOMATION_LOCK:
        rule = get_collection_document(
            "automation_rules", rule_id, user_id=user_id, all_scopes=not scoped
        )
        if rule is None:
            return None
        previous_updated_at = rule.get("updated_at")
        for key, value in patch.items():
            if value is None:
                continue
            rule[key] = value
        operational_only = all(
            key in {"last_fire_at", "last_error"} for key, value in patch.items() if value is not None
        )
        rule["updated_at"] = previous_updated_at if operational_only else time.time()
        upsert_collection_document(
            "automation_rules",
            rule_id,
            rule,
            user_id=rule.get("workspace_id"),
            sort_ts=rule["updated_at"],
        )
        return rule


def automation_delete(
    rule_id: str,
    *,
    user_id: str | int | None = None,
    scoped: bool = False,
) -> bool:
    """Delete a rule by id.

    SECURITY: pass ``scoped=True`` + the caller's ``user_id`` from request
    handlers so a tenant can only delete its own rule. Default all-scopes is
    reserved for trusted internal callers.
    """
    with _AUTOMATION_LOCK:
        rule = get_collection_document(
            "automation_rules", rule_id, user_id=user_id, all_scopes=not scoped
        )
        if rule is None:
            return False
        return delete_collection_document(
            "automation_rules",
            rule_id,
            user_id=rule.get("workspace_id"),
        )


# ── Messages / activity feed ───────────────────────────────────────────
# Single JSON file, newest-first, capped at MAX_MESSAGES. The bell menu
# polls /messages to surface scheduler-driven publish events (matches the
# manual /publish flow where editor thunks dispatch addNotification).

_MESSAGES_FILE = settings.content_dir / "messages.json"
_MESSAGES_LOCK = _threading.Lock()
MAX_MESSAGES = 200


def _messages_read_raw() -> list[dict[str, Any]]:
    try:
        data = json.loads(_MESSAGES_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []  # corrupt → start fresh; never crash the process


def _messages_write_raw(items: list[dict[str, Any]]) -> None:
    _MESSAGES_FILE.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_text(_MESSAGES_FILE, json.dumps(items, indent=2))


def messages_list(
    user_id: str | int | None = None,
    *,
    all_users: bool = False,
) -> list[dict[str, Any]]:
    """Return every persisted message, newest first."""
    with _MESSAGES_LOCK:
        return list_collection_documents(
            "messages",
            user_id=user_id,
            all_scopes=all_users,
            newest_first=True,
            limit=MAX_MESSAGES if not all_users else None,
        )


def messages_append(message: dict[str, Any]) -> dict[str, Any]:
    """Prepend one message and trim the log to MAX_MESSAGES.

    Fills in `id` and `timestamp` if the caller omitted them. The bell
    treats absent `id` as a fresh unread item, so we always issue one.
    """
    with _MESSAGES_LOCK:
        record = dict(message)
        record.setdefault("id", f"msg-{_uuid.uuid4().hex[:12]}")
        record.setdefault("timestamp", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        record.setdefault("read", False)
        # Messages (activity feed) are workspace-scoped. Resolve the owning
        # workspace from the related post when not supplied; user_id stays the
        # author for display.
        if not record.get("workspace_id") and record.get("post_id"):
            post = get_collection_document("posts", str(record["post_id"]), all_scopes=True)
            if post and post.get("workspace_id"):
                record["workspace_id"] = post.get("workspace_id")
        upsert_collection_document(
            "messages",
            record["id"],
            record,
            user_id=record.get("workspace_id"),
            sort_ts=time.time(),
        )
        return record


# ── File output ────────────────────────────────────────────────────────

def save_caption_file(item: dict[str, Any], captions: dict[str, str]) -> None:
    """Write generated captions to a .captions.json sidecar file."""
    out = item["image_path"].with_suffix(".captions.json")
    out.write_text(
        json.dumps(
            {
                "filename": item["filename"],
                "description": item["description"],
                **captions,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
