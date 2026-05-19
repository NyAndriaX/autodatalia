"""Core business logic — content scanning, AI caption generation, file I/O."""

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

# ── Constants ──────────────────────────────────────────────────────────

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}
DESCRIPTION_EXTENSIONS = (".txt", ".md")


# ── Content helpers ────────────────────────────────────────────────────

def read_description(image_path: Path) -> str:
    """Return the text from a matching .txt/.md file, or empty string."""
    for ext in DESCRIPTION_EXTENSIONS:
        desc_path = image_path.with_suffix(ext)
        if desc_path.exists():
            return desc_path.read_text(encoding="utf-8").strip()
    return ""


def iter_content_items() -> list[dict[str, Any]]:
    """Scan the content directory and return metadata for every image found."""
    items: list[dict[str, Any]] = []
    for image_path in sorted(settings.content_dir.rglob("*")):
        if not image_path.is_file():
            continue
        if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
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
    item: dict[str, Any], *, include_image: bool
) -> dict[str, str]:
    """Call the configured AI model and return Instagram + TikTok captions."""
    if not settings.ai_api_key:
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
        "model": settings.ai_model,
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
            f"{settings.ai_api_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.ai_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://caption-api.local",
                "X-Title": "Caption API",
            },
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "AI API request failed.",
                "status_code": response.status_code,
                "response": response.text,
            },
        )

    data = response.json()
    message_content = data["choices"][0]["message"]["content"]
    if isinstance(message_content, list):
        message_content = "".join(
            part.get("text", "") for part in message_content if isinstance(part, dict)
        )

    try:
        captions = _extract_json(message_content)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not parse AI response: {exc}"
        ) from exc

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
_AI_CACHE_FILE = settings.content_dir / ".ai_cache.json"


def _load_cache() -> dict[str, list[Any]]:
    try:
        raw = json.loads(_AI_CACHE_FILE.read_text(encoding="utf-8"))
        now = time.time()
        return {k: v for k, v in raw.items() if v[0] > now}
    except Exception:
        return {}


_AI_CACHE: dict[str, list[Any]] = _load_cache()


def _save_cache() -> None:
    try:
        _AI_CACHE_FILE.write_text(
            json.dumps(_AI_CACHE), encoding="utf-8"
        )
    except Exception:
        pass  # cache is best-effort; never break a request over it


def _cache_key(*parts: Any) -> str:
    return hashlib.sha256(
        json.dumps(parts, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _cache_get(key: str) -> Any | None:
    hit = _AI_CACHE.get(key)
    if not hit:
        return None
    expires, value = hit
    if time.time() > expires:
        _AI_CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    if len(_AI_CACHE) >= _AI_CACHE_MAX:
        _AI_CACHE.clear()  # simple bound — fine for this scale
    _AI_CACHE[key] = [time.time() + _AI_CACHE_TTL, value]
    _save_cache()


# ── Token conservation: prompt compression (#9) ────────────────────────

def _compress(text: str, *, limit: int = 4000) -> str:
    """Collapse runaway whitespace and hard-cap length — fewer input tokens."""
    text = re.sub(r"[ \t]+", " ", (text or "").strip())
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:limit]


# ── Token conservation: per-client daily rate limit (#10) ──────────────

_RATE: dict[str, list[Any]] = {}  # client -> [yyyy-mm-dd, count]


def rate_guard(client_id: str) -> None:
    """Raise 429 if the client already hit AI_DAILY_LIMIT real calls today."""
    limit = settings.ai_daily_limit
    if limit <= 0:
        return
    today = time.strftime("%Y-%m-%d")
    day, count = _RATE.get(client_id, [today, 0])
    if day == today and count >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Daily AI limit reached ({limit}). Try again tomorrow.",
        )


def rate_tick(client_id: str) -> None:
    """Count one real (non-cached) AI call against the daily quota."""
    if settings.ai_daily_limit <= 0:
        return
    today = time.strftime("%Y-%m-%d")
    day, count = _RATE.get(client_id, [today, 0])
    if day != today:
        day, count = today, 0
    _RATE[client_id] = [day, count + 1]


_ZERO_USAGE = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


async def _post_chat(payload: dict[str, Any]) -> tuple[str, dict[str, int]]:
    """POST an OpenAI-compatible chat payload; return (text, usage)."""
    if not settings.ai_api_key:
        raise HTTPException(status_code=500, detail="AI_API_KEY is not configured.")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{settings.ai_api_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.ai_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://caption-api.local",
                "X-Title": "Caption API",
            },
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "AI API request failed.",
                "status_code": response.status_code,
                "response": response.text,
            },
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
    return content, usage


async def generate_post_variants(
    *,
    prompt: str,
    platforms: dict[str, bool] | None = None,
    template: str | None = None,
    n: int = 1,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Prompt-driven generation — returns ([{id,text,tone}], usage)."""
    prompt = _compress(prompt)
    active = [k for k, v in (platforms or {}).items() if v] or ["generic"]

    cache_key = _cache_key("generate", prompt, sorted(active), template, n)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached, dict(_ZERO_USAGE)

    user_prompt = (
        f"Write {n} distinct social media post variants.\n"
        f"Brief: {prompt.strip() or 'An engaging brand post.'}\n"
        f"Target platforms: {', '.join(active)}.\n"
        + (f"Brand template/style hint: {template}.\n" if template else "")
        + "Each variant must have a different angle/tone, be ready to post, "
        "and include relevant hashtags.\n"
        'Return JSON only with this shape: '
        '{"variants":[{"text":"...","tone":"..."}]}'
    )

    payload = {
        "model": settings.ai_model,
        "temperature": 0.85,
        # Bound output cost: ~110 tokens per variant + JSON overhead.
        "max_tokens": 110 * n + 80,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a senior social media copywriter. Always respond "
                    "with valid JSON only."
                ),
            },
            {"role": "user", "content": user_prompt},
        ],
    }

    raw, usage = await _post_chat(payload)
    try:
        parsed = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not parse AI response: {exc}"
        ) from exc

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
    _cache_set(cache_key, variants)
    return variants, usage


_TRANSFORM_INSTRUCTIONS = {
    "shorten": "Rewrite the post to be significantly shorter while keeping the core message and key hashtags.",
    "expand": "Expand the post with more detail, value and a clear call to action, keeping the same voice.",
    "tone-casual": "Rewrite the post in a casual, friendly, conversational tone.",
    "tone-pro": "Rewrite the post in a polished, professional, authoritative tone.",
}


async def transform_content(
    content: str, action: str
) -> tuple[str, dict[str, int]]:
    """Apply a quick AI action to existing content; returns the new text."""
    instruction = _TRANSFORM_INSTRUCTIONS.get(action)
    if instruction is None:
        # Unknown action — return unchanged rather than erroring the editor.
        return content, dict(_ZERO_USAGE)

    content = _compress(content)
    cache_key = _cache_key("transform", action, content)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached, dict(_ZERO_USAGE)

    payload = {
        # Quick actions use the cheap/fast model (LLM Router cost strategy).
        "model": settings.ai_model_fast,
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
    text, usage = await _post_chat(payload)
    text = text.strip()
    _cache_set(cache_key, text)
    return text, usage


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


async def save_upload(file: UploadFile) -> dict[str, str]:
    """Persist an uploaded file to the content dir; return its metadata."""
    settings.content_dir.mkdir(parents=True, exist_ok=True)
    safe = _safe_filename(file.filename or "upload")
    dest = _unique_path(settings.content_dir, safe)

    data = await file.read()
    dest.write_bytes(data)

    suffix = dest.suffix.lower()
    if suffix in VIDEO_EXTENSIONS or (file.content_type or "").startswith("video/"):
        kind = "video"
    else:
        kind = "image"

    return {
        "filename": dest.name,
        "relative_path": dest.relative_to(settings.content_dir).as_posix(),
        "kind": kind,
    }


# ── Search ─────────────────────────────────────────────────────────────

def search_media(query: str) -> list[dict[str, str]]:
    """Search the content directory for media matching `query`.

    Posts/templates live in Airtable (not wired yet) so only `media` hits
    are returned for now — honest partial results, no mock padding.
    """
    q = query.strip().lower()
    if not q:
        return []

    hits: list[dict[str, str]] = []
    for path in sorted(settings.content_dir.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix not in IMAGE_EXTENSIONS and suffix not in VIDEO_EXTENSIONS:
            continue
        description = read_description(path)
        if q not in path.name.lower() and q not in description.lower():
            continue
        kind = "video" if suffix in VIDEO_EXTENSIONS else "image"
        hits.append(
            {
                "id": path.relative_to(settings.content_dir).as_posix(),
                "type": "media",
                "title": path.name,
                "subtitle": f"{kind.capitalize()} · {path.stat().st_size // 1024} KB",
            }
        )
    return hits


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
