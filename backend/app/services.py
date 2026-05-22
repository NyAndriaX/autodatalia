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

# Optional dependency — falls back to "no transcode" if the package failed
# to install (e.g. the bundled ffmpeg binary couldn't be unpacked). Upload
# still works in that case; the video just goes out as-uploaded.
try:
    from imageio_ffmpeg import get_ffmpeg_exe as _get_ffmpeg_exe
except Exception:  # pragma: no cover — environmental
    _get_ffmpeg_exe = None  # type: ignore[assignment]

# ── Constants ──────────────────────────────────────────────────────────

# .jfif is what Microsoft Edge / older Windows tools name a regular JPEG.
# The byte content is identical to .jpg, so include it as an image extension
# — otherwise uploaded files vanish from /search after the page reloads.
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif"}
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


def _image_hash(image_path: Path) -> str:
    """SHA-256 of the image bytes. Stable across renames, sensitive to edits."""
    h = hashlib.sha256()
    with image_path.open("rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


async def _describe_image(image_path: Path) -> str:
    """Return a short cached text description of the image.

    The vision model is hit at most once per unique file (key = content
    hash, persisted in the AI cache). Every later /generate call that
    references the same image reuses this text — the image bytes never
    go to the model again until the file actually changes.
    """
    if not settings.ai_api_key:
        return ""
    key = _cache_key("describe", _image_hash(image_path))
    cached = _cache_get(key)
    if isinstance(cached, str) and cached:
        return cached

    payload = {
        # Factual image-description is a perfect SIMPLE-tier job — accuracy
        # over creativity, no need to pay the standard model's premium.
        "model": settings.ai_model_fast,
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
        text, _usage = await _post_chat(payload)
    except HTTPException:
        return ""
    text = text.strip()
    if text:
        _cache_set(key, text)
    return text


async def generate_post_variants(
    *,
    prompt: str,
    platforms: dict[str, bool] | None = None,
    template: str | None = None,
    n: int = 1,
    image_filename: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Prompt-driven generation — returns ([{id,text,tone}], usage)."""
    prompt = _compress(prompt)
    active = [k for k, v in (platforms or {}).items() if v] or ["generic"]

    # Resolve the optional uploaded image. We accept just the filename so the
    # frontend never has to re-upload bytes — the file is already in our
    # content dir. Anything outside the content dir is silently ignored.
    image_path = None
    if image_filename:
        safe_image_name = _safe_filename(image_filename)
        candidate = settings.content_dir / safe_image_name
        if (
            candidate.exists()
            and candidate.is_file()
            and candidate.suffix.lower() in IMAGE_EXTENSIONS
        ):
            image_path = candidate

    # Convert the image (if any) to a short cached description so the vision
    # model is hit at most once per file. Repeat generations on the same
    # image — even with different prompts — use the text only, saving the
    # ~250-1000 image tokens per call.
    image_description = ""
    image_fingerprint: str | None = None
    if image_path:
        image_fingerprint = _image_hash(image_path)
        image_description = await _describe_image(image_path)

    cache_key = _cache_key(
        "generate", prompt, sorted(active), template, n, image_fingerprint,
    )
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached, dict(_ZERO_USAGE)

    user_prompt = (
        f"Write {n} distinct social media post variants.\n"
        f"Brief: {prompt.strip() or 'An engaging brand post.'}\n"
        f"Target platforms: {', '.join(active)}.\n"
        + (f"Brand template/style hint: {template}.\n" if template else "")
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
            {"role": "user", "content": user_content},
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

TRANSFORM_ACTIONS = tuple(_TRANSFORM_INSTRUCTIONS.keys())


async def transform_content(
    content: str, action: str
) -> tuple[str, dict[str, int]]:
    """Apply a quick AI action to existing content; returns the new text."""
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


def delete_media(relative_path: str) -> bool:
    """Delete a previously-uploaded media file by its content-dir-relative path.

    Returns True if removed, False if not found. Raises ValueError if the
    path tries to escape the content directory (defense in depth — we never
    want a `../etc/passwd` deletion).
    """
    if not relative_path:
        raise ValueError("Empty path.")
    root = settings.content_dir.resolve()
    target = (root / relative_path).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("Path escapes content directory.") from exc
    if not target.is_file():
        return False
    target.unlink()
    # Drop the optional sidecar description too (.txt/.md beside the file).
    for ext in DESCRIPTION_EXTENSIONS:
        sidecar = target.with_suffix(ext)
        if sidecar.is_file():
            sidecar.unlink()
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


async def save_upload(file: UploadFile) -> dict[str, str]:
    """Persist an uploaded file to the content dir; return its metadata.

    For videos, also normalise the codec to H.264 + AAC MP4 so the publish
    path doesn't trip over TikTok's `file_format_check_failed` later.
    Transcoding is synchronous — the user already sees an "Uploading…"
    spinner, and we'd rather the upload take 5-30s extra than return a
    file that fails at publish time.
    """
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

    if kind == "video":
        dest = await _normalize_video_for_publishing(dest)

    return {
        "filename": dest.name,
        "relative_path": dest.relative_to(settings.content_dir).as_posix(),
        "kind": kind,
    }


# ── Search ─────────────────────────────────────────────────────────────

def search_media(query: str, limit: int = 50) -> list[dict[str, str]]:
    """Search the content directory for media matching `query`.

    Empty query returns up to `limit` items (acts as a listing endpoint for
    the Media Library). Posts/templates live in Airtable (not wired yet) so
    only `media` hits are returned for now — honest partial results, no
    mock padding.
    """
    q = query.strip().lower()
    hits: list[dict[str, str]] = []
    for path in sorted(settings.content_dir.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix not in IMAGE_EXTENSIONS and suffix not in VIDEO_EXTENSIONS:
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
    _POSTS_FILE.write_text(json.dumps(posts, indent=2), encoding="utf-8")


def posts_list() -> list[dict[str, Any]]:
    """Return every persisted scheduled post."""
    with _POSTS_LOCK:
        return list(_posts_read_raw())


def posts_create(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist a new post and return it (auto-fills id if missing)."""
    with _POSTS_LOCK:
        posts = _posts_read_raw()
        post = dict(payload)
        if not post.get("id"):
            post["id"] = f"srv-{_uuid.uuid4().hex[:10]}"
        post.setdefault("content", "")
        post.setdefault("platforms", {})
        post.setdefault("status", "draft")
        post.setdefault("media", [])
        posts.append(post)
        _posts_write_raw(posts)
        return post


def posts_update(post_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    """Apply a partial update (None values are ignored). Returns the post or None."""
    with _POSTS_LOCK:
        posts = _posts_read_raw()
        for post in posts:
            if post.get("id") == post_id:
                for key, value in patch.items():
                    if value is None:
                        continue
                    post[key] = value
                _posts_write_raw(posts)
                return post
    return None


def posts_delete(post_id: str) -> bool:
    """Remove the post by id. Returns True if anything was removed."""
    with _POSTS_LOCK:
        posts = _posts_read_raw()
        remaining = [p for p in posts if p.get("id") != post_id]
        if len(remaining) == len(posts):
            return False
        _posts_write_raw(remaining)
        return True


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
    _MESSAGES_FILE.write_text(json.dumps(items, indent=2), encoding="utf-8")


def messages_list() -> list[dict[str, Any]]:
    """Return every persisted message, newest first."""
    with _MESSAGES_LOCK:
        return list(_messages_read_raw())


def messages_append(message: dict[str, Any]) -> dict[str, Any]:
    """Prepend one message and trim the log to MAX_MESSAGES.

    Fills in `id` and `timestamp` if the caller omitted them. The bell
    treats absent `id` as a fresh unread item, so we always issue one.
    """
    with _MESSAGES_LOCK:
        items = _messages_read_raw()
        record = dict(message)
        record.setdefault("id", f"msg-{_uuid.uuid4().hex[:12]}")
        record.setdefault("timestamp", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        record.setdefault("read", False)
        items.insert(0, record)
        del items[MAX_MESSAGES:]
        _messages_write_raw(items)
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
