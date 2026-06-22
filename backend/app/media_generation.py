"""Backend-generated media assets for the editor and scheduler flows."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image, ImageDraw, ImageFont

from .auth import require_token
from .authz import require_permission
from .config import settings
from .net_guard import assert_safe_url, safe_get_async
from .models import (
    GeneratedMediaResponse,
    ImageGenerationRequest,
    VideoGenerationRequest,
    VideoJob,
    VideoJobsResponse,
    VideoModel,
    VideoModelsResponse,
)
from .runtime_config import resolved_settings
from .services import _media_root
from .workspaces import get_active_workspace_id

try:
    from imageio_ffmpeg import get_ffmpeg_exe as _get_ffmpeg_exe
except Exception:  # pragma: no cover - environmental
    _get_ffmpeg_exe = None  # type: ignore[assignment]

log = logging.getLogger("datalia.media_generation")

router = APIRouter(tags=["media-generation"])

_RATIO_TO_IMAGE_SIZE = {
    "1:1": (1024, 1024),
    "4:5": (1024, 1280),
    "9:16": (1080, 1920),
    "16:9": (1280, 720),
}


def _generated_dir(workspace_id: int | str | None = None) -> Path:
    # Per-workspace: generated media lands in the workspace's content dir
    # (content/ws/{id}/generated) so it shows up in THAT workspace's Library and
    # stays isolated from other tenants — exactly like uploads. None = global.
    path = _media_root(workspace_id) / "generated"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _workspace_scope(user_id: int) -> int | None:
    if not user_id or int(user_id) <= 0:
        return None
    return get_active_workspace_id(int(user_id))


def _safe_stub(prompt: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", (prompt or "").strip().lower())
    cleaned = cleaned.strip("-") or "generated"
    return cleaned[:48]


def _pick_size(ratio: str, *, video: bool = False) -> tuple[int, int]:
    if ratio in _RATIO_TO_IMAGE_SIZE:
        return _RATIO_TO_IMAGE_SIZE[ratio]
    return (1080, 1920) if video else (1024, 1024)


def _render_fallback_poster(prompt: str, width: int, height: int) -> bytes:
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    bg = tuple(int(digest[i : i + 2], 16) for i in (0, 2, 4))
    accent = tuple(int(digest[i : i + 2], 16) for i in (6, 8, 10))
    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)
    font_title = ImageFont.load_default()
    font_body = ImageFont.load_default()

    margin = max(40, width // 14)
    top = max(48, height // 12)
    line_y = top
    draw.rounded_rectangle(
        [margin, top, width - margin, top + 8],
        radius=4,
        fill=accent,
    )
    line_y += 48

    title = "AI draft visual"
    draw.text((margin, line_y), title, fill=(255, 255, 255), font=font_title)
    line_y += 40

    wrapped: list[str] = []
    words = prompt.split()
    current = []
    max_chars = 26 if width < 1100 else 34
    for word in words:
        candidate = " ".join(current + [word]).strip()
        if len(candidate) > max_chars and current:
            wrapped.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        wrapped.append(" ".join(current))
    wrapped = wrapped[:10] or ["No prompt provided."]

    for line in wrapped:
        draw.text((margin, line_y), line, fill=(245, 247, 250), font=font_body)
        line_y += 24

    footer = "Fallback renderer active"
    footer_box_h = 44
    draw.rounded_rectangle(
        [margin, height - margin - footer_box_h, width - margin, height - margin],
        radius=12,
        outline=(255, 255, 255),
        width=2,
    )
    draw.text(
        (margin + 18, height - margin - 28),
        footer,
        fill=(255, 255, 255),
        font=font_body,
    )

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def _call_image_api(
    prompt: str, width: int, height: int, *, user_id: str | int | None = None
) -> tuple[bytes, str]:
    """Generate one image. Dispatches between two API shapes:

      1. **Chat-completions** — for Gemini image models (Nano Banana =
         ``google/gemini-2.5-flash-image-preview``). These speak the
         OpenAI ChatCompletions REST contract and return the image
         either as an entry in ``choices[0].message.images`` (OpenRouter)
         or as an ``inline_data`` part on the message (Google native).
      2. **Images-generations** — the classic ``/images/generations``
         endpoint used by DALL·E, FLUX-via-Together, fal.ai, etc.

    The selector is the model id: anything matching ``gemini*image``
    takes path (1); everything else takes path (2).
    """
    cfg = resolved_settings(user_id)
    if not cfg.ai_image_model:
        return _render_fallback_poster(prompt, width, height), "fallback-poster"
    if not cfg.ai_image_api_key:
        raise HTTPException(500, "AI_IMAGE_API_KEY is not configured.")

    if _is_gemini_image_model(cfg.ai_image_model):
        return await _call_gemini_image_api(prompt, width, height, user_id=user_id)

    payload = {
        "model": cfg.ai_image_model,
        "prompt": prompt,
        "size": f"{width}x{height}",
        "n": 1,
    }
    # Defense in depth: ai_image_api_base_url is a per-tenant override.
    # runtime_config validates it at write time, but a value that predates
    # that guard could still be on disk — re-check before we attach our API
    # key and POST to it.
    try:
        assert_safe_url(f"{cfg.ai_image_api_base_url}/images/generations")
    except ValueError as exc:
        raise HTTPException(400, f"Image API base URL is not allowed: {exc}") from exc
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            f"{cfg.ai_image_api_base_url}/images/generations",
            headers={
                "Authorization": f"Bearer {cfg.ai_image_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if resp.status_code >= 400:
        print(f"[Classic Image API Error] Status={resp.status_code} Response={resp.text[:1000]}", flush=True)
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Image generation request failed.",
                "upstream_status": resp.status_code,
            },
        )
    data = resp.json()
    first = (data.get("data") or [{}])[0] or {}
    if first.get("b64_json"):
        _log_image_cost(prompt, user_id)
        return base64.b64decode(first["b64_json"]), cfg.ai_image_model
    if first.get("url"):
        # The asset URL is returned by the image provider; fetch it through the
        # SSRF guard (validates host + each redirect hop) before downloading.
        async with httpx.AsyncClient(timeout=120.0) as client:
            image_resp = await safe_get_async(client, first["url"])
        if image_resp.status_code >= 400:
            raise HTTPException(502, "Generated image URL could not be fetched.")
        _log_image_cost(prompt, user_id)
        return image_resp.content, cfg.ai_image_model
    raise HTTPException(502, "Image generation returned no asset.")


def _is_gemini_image_model(model: str) -> bool:
    m = (model or "").lower()
    return "gemini" in m and "image" in m


async def _call_gemini_image_api(
    prompt: str, width: int, height: int, *, user_id: str | int | None = None
) -> tuple[bytes, str]:
    """Image generation via Gemini's chat-completions shape (Nano Banana).

    Works against OpenRouter (``google/gemini-2.5-flash-image-preview``)
    and Google AI Studio's OpenAI-compatible endpoint
    (``generativelanguage.googleapis.com/v1beta/openai``). The size hint
    is encoded into the prompt because Gemini doesn't accept a ``size``
    parameter the way DALL·E does — the model is good at honouring an
    aspect-ratio cue in plain English.
    """
    cfg = resolved_settings(user_id)
    aspect_hint = f"Generate a single {width}x{height} image. {prompt}"
    payload = {
        "model": cfg.ai_image_model,
        # OpenRouter routes image-output models when modalities is set.
        # Native Google API ignores it harmlessly.
        "modalities": ["image", "text"],
        # Cap output tokens so OpenRouter's pre-flight credit check
        # doesn't reserve the model's full context window (~30k for
        # Gemini 2.5 Flash Image). Keep this comfortably below the
        # typical "fresh but low-balance" allowance so image gen still
        # runs instead of immediately tripping the fallback poster path.
        "max_tokens": 1800,
        "messages": [{"role": "user", "content": aspect_hint}],
    }
    # Defense in depth: re-validate the per-tenant image base URL before we
    # attach the API key and POST (mirrors runtime_config's write-time check).
    try:
        assert_safe_url(f"{cfg.ai_image_api_base_url}/chat/completions")
    except ValueError as exc:
        raise HTTPException(400, f"Image API base URL is not allowed: {exc}") from exc
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            f"{cfg.ai_image_api_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {cfg.ai_image_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://caption-api.local",
                "X-Title": "Datalia Image Gen",
            },
            json=payload,
        )
    if resp.status_code >= 400:
        print(f"[Gemini Image API Error] Status={resp.status_code} Response={resp.text[:1000]}", flush=True)
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Gemini image generation request failed.",
                "upstream_status": resp.status_code,
            },
        )
    data = resp.json()
    img_bytes = await _extract_gemini_image(data)
    if img_bytes is None:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Gemini returned no image asset.",
            },
        )
    _log_image_cost(prompt, user_id)
    return img_bytes, cfg.ai_image_model


async def _extract_gemini_image(data: dict) -> bytes | None:
    """Pull the first image payload out of a Gemini chat-completions
    response. Tries every shape the providers use in 2026:

      * OpenRouter image-output: ``choices[0].message.images[0].image_url.url``
        as a ``data:image/...;base64,...`` URL.
      * OpenAI multimodal echo: same path but ``content`` is an array
        with an ``image_url`` part.
      * Google AI Studio direct: ``candidates[0].content.parts[]`` has
        an ``inline_data`` part with ``mime_type`` + base64 ``data``.

    A remote ``http(s)://`` URL (rare but legal) is fetched and returned
    as bytes. Returns None when no image is found.
    """
    # 1. OpenRouter / OpenAI chat shape
    for choice in data.get("choices") or []:
        msg = choice.get("message") or {}
        for entry in msg.get("images") or []:
            url = (entry.get("image_url") or {}).get("url") or entry.get("url")
            if url:
                blob = await _bytes_from_image_url(url)
                if blob is not None:
                    return blob
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    url = (part.get("image_url") or {}).get("url")
                    if url:
                        blob = await _bytes_from_image_url(url)
                        if blob is not None:
                            return blob

    # 2. Google AI Studio native shape (candidates / inline_data)
    for cand in data.get("candidates") or []:
        parts = (cand.get("content") or {}).get("parts") or []
        for part in parts:
            inline = part.get("inline_data") or part.get("inlineData") or {}
            payload = inline.get("data") if isinstance(inline, dict) else None
            if payload:
                try:
                    return base64.b64decode(payload)
                except Exception:
                    continue
    return None


async def _bytes_from_image_url(url: str) -> bytes | None:
    if not url:
        return None
    if url.startswith("data:"):
        try:
            _, b64 = url.split(",", 1)
            return base64.b64decode(b64)
        except (ValueError, base64.binascii.Error):
            return None
    if url.startswith("http://") or url.startswith("https://"):
        # URL comes from the AI provider's response; guard against it pointing
        # at an internal address (validates host + every redirect hop).
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await safe_get_async(client, url)
        except ValueError:
            return None
        if r.status_code < 400:
            return r.content
    return None


def _log_image_cost(prompt: str, user_id: str | int | None) -> None:
    """Stick a row in the cost dashboard for one image generation.

    Image providers price per image (not per token), so we log a flat
    dollar amount. The value here ($0.04) reflects typical SDXL/DALL-E 3
    pricing; override via env in cost_tracking if your provider differs.
    """
    try:
        from .cost_tracking import record_media_job
        model = resolved_settings(user_id).ai_image_model or "fallback-poster"
        # Best-effort provider tag — used in the cost dashboard's
        # "by_model" breakdown. Cost per image varies wildly by provider
        # (Nano Banana is ~$0.03, DALL·E 3 ~$0.04, FLUX-schnell free).
        if _is_gemini_image_model(model):
            provider = "gemini"
            cost_usd = 0.03
        elif "dall-e" in model.lower():
            provider = "openai"
            cost_usd = 0.04
        elif "flux" in model.lower() and "schnell" in model.lower():
            provider = "together"
            cost_usd = 0.0  # FLUX-schnell free tier
        else:
            provider = "openrouter"
            cost_usd = 0.04
        record_media_job(
            workflow="image",
            provider=provider,
            model=model,
            cost_usd=cost_usd,
            user_id=user_id,
            metadata={"prompt_hash": hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]},
        )
    except Exception as exc:
        log.warning("[cost] record_media_job failed: %s", exc)


def _write_bytes(
    prompt: str, suffix: str, payload: bytes, *, workspace_id: int | str | None = None
) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    digest = hashlib.sha256(payload).hexdigest()[:10]
    name = f"{stamp}-{_safe_stub(prompt)}-{digest}{suffix}"
    path = _generated_dir(workspace_id) / name
    path.write_bytes(payload)
    return path


async def _refine_image_prompt(prompt: str, user_id: str | int | None = None) -> str:
    """Uses the fast model to convert social media captions / text into clean,
    visual-focused image generation prompts. Removes emojis, hashtags, and social copy,
    and ensures the generated image will be text-free.
    """
    cfg = resolved_settings(user_id)
    cleaned = prompt.strip()
    if not cleaned:
        return cleaned

    # If the prompt is a brief visual description, don't need to run it through LLM
    if len(cleaned) < 40 and not any(x in cleaned for x in ["#", "@", "http"]):
        return cleaned

    if not cfg.ai_api_key or not cfg.ai_model_fast:
        return cleaned

    payload = {
        "model": cfg.ai_model_fast,
        "temperature": 0.3,
        "max_tokens": 150,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an expert AI image prompt engineer. Convert the following social media post or caption "
                    "into a clean, concise, highly-detailed visual description for a text-to-image generator.\n"
                    "CRITICAL RULES:\n"
                    "1. Focus ONLY on describing the physical scene, subject, setting, colors, and lighting.\n"
                    "2. The description must be completely text-free. Do NOT include any words, letters, logos, labels, captions, or typography.\n"
                    "3. Remove all emojis, hashtags, links, and direct calls to action.\n"
                    "4. Keep the output under 100 words. Return ONLY the refined visual prompt without any intro or outro."
                ),
            },
            {"role": "user", "content": cleaned},
        ],
    }

    try:
        # Defense in depth: ai_api_base_url is a per-tenant override. Re-validate
        # the resolved URL before attaching the API key and calling out, in case
        # a value predates runtime_config's write-time SSRF check.
        assert_safe_url(f"{cfg.ai_api_base_url}/chat/completions")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{cfg.ai_api_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {cfg.ai_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://caption-api.local",
                    "X-Title": "Caption API - Image Prompt Refiner",
                },
                json=payload,
            )
        if response.status_code == 200:
            data = response.json()
            choices = data.get("choices") or []
            if choices:
                refined = choices[0].get("message", {}).get("content", "").strip()
                if refined:
                    return refined
    except Exception as exc:
        logging.getLogger("datalia.media").warning("[media] Failed to refine image prompt: %s", exc)

    return cleaned


async def _generate_image_file(
    prompt: str, ratio: str, *, user_id: str | int | None = None
) -> tuple[Path, str]:
    width, height = _pick_size(ratio)
    refined = await _refine_image_prompt(prompt, user_id=user_id)
    # Append clear, strong negative instructions to guarantee text-free generation across all models
    final_prompt = f"{refined}. High-quality professional image, clean background, completely text-free with absolutely no words, letters, captions, logos, or typography."

    try:
        payload, provider = await _call_image_api(
            final_prompt, width, height, user_id=user_id
        )
    except HTTPException as exc:
        log.warning(
            "[media] image generation failed for prompt '%s'; falling back to local poster: %s",
            prompt[:80],
            exc.detail,
        )
        payload = _render_fallback_poster(prompt, width, height)
        provider = "fallback-poster"
    out = _write_bytes(prompt, ".png", payload, workspace_id=user_id)
    return out, provider


async def _render_motion_video(source: Path, dest: Path, width: int, height: int, duration_seconds: int) -> None:
    if _get_ffmpeg_exe is None:
        raise HTTPException(503, "ffmpeg is not available for video generation.")
    try:
        exe = _get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - environmental
        raise HTTPException(503, "ffmpeg is not available for video generation.") from exc

    frames = max(duration_seconds * 30, 30)
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},"
        f"zoompan=z='min(zoom+0.0015,1.12)':"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s={width}x{height}:fps=30,"
        "format=yuv420p"
    )
    cmd = [
        exe,
        "-y",
        "-loop",
        "1",
        "-i",
        str(source),
        "-vf",
        vf,
        "-t",
        str(duration_seconds),
        "-r",
        "30",
        "-pix_fmt",
        "yuv420p",
        str(dest),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        tail = (stderr or b"")[-400:].decode("utf-8", errors="replace")
        raise HTTPException(502, f"Video generation failed: {tail or 'ffmpeg error'}")


def _response_for(request: Request, path: Path, *, kind: str, provider: str, prompt: str) -> GeneratedMediaResponse:
    rel = path.relative_to(settings.content_dir).as_posix()
    base = (
        os.environ.get("PUBLIC_BASE_URL")
        or os.environ.get("OAUTH_REDIRECT_BASE")
        or str(request.base_url).rstrip("/")
    )
    return GeneratedMediaResponse(
        url=f"{base}/content/{rel}",
        filename=path.name,
        kind=kind,
        provider=provider,
        prompt=prompt,
    )


@router.post(
    "/media/generate/image",
    response_model=GeneratedMediaResponse,
    dependencies=[Depends(require_permission("media.generate"))],
)
async def generate_image(
    request: Request,
    body: ImageGenerationRequest,
    user_id: int = Depends(require_token),
) -> GeneratedMediaResponse:
    workspace_id = _workspace_scope(user_id)
    path, provider = await _generate_image_file(
        body.prompt, body.ratio, user_id=workspace_id
    )
    return _response_for(request, path, kind="image", provider=provider, prompt=body.prompt)


@router.post(
    "/media/generate/video",
    dependencies=[Depends(require_permission("media.generate"))],
)
async def generate_video(
    request: Request,
    body: VideoGenerationRequest,
    user_id: int = Depends(require_token),
):
    """Kick off a video generation job.

    With ``async_mode=true`` (default) this returns the queued ``VideoJob``
    immediately and the client polls ``GET /video-jobs/{id}`` until
    ``status == "succeeded"``. Set ``async_mode=false`` to keep the
    legacy synchronous behaviour — useful for in-process callers (the
    automation worker) but not safe behind public HTTPS proxies that
    enforce ~60s timeouts.
    """
    from .video_jobs import create_job, run_job
    workspace_id = _workspace_scope(user_id)
    if body.async_mode:
        job = create_job(
            prompt=body.prompt,
            ratio=body.ratio,
            duration_seconds=body.duration_seconds,
            image_filename=body.image_filename,
            provider=body.provider,
            user_id=workspace_id,
            model_id=body.model_id or body.fal_model,
            fal_model=body.fal_model,
            quality=body.quality,
            mode=body.mode,
        )
        return VideoJob(**job)

    # Synchronous fallback path — used by the automation worker. Runs
    # the same code as the async worker but blocks the caller.
    job = create_job(
        prompt=body.prompt,
        ratio=body.ratio,
        duration_seconds=body.duration_seconds,
        image_filename=body.image_filename,
        provider=body.provider,
        user_id=workspace_id,
        model_id=body.model_id or body.fal_model,
        fal_model=body.fal_model,
        quality=body.quality,
        mode=body.mode,
    )
    finished = await run_job(job["id"])
    if not finished or finished.get("status") != "succeeded":
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Video generation failed.",
                "error": (finished or {}).get("error") or "unknown",
            },
        )
    return GeneratedMediaResponse(
        url=finished["output_url"],
        filename=finished["output_filename"],
        kind="video",
        provider=finished["provider"],
        prompt=body.prompt,
    )


# ── Video jobs queue ──────────────────────────────────────────────────


@router.get("/video-models", response_model=VideoModelsResponse)
async def video_models_list() -> VideoModelsResponse:
    """Catalogue of video models the backend knows about.

    The frontend uses this to populate the model picker on the AI Video
    page, hide controls a model can't support (e.g. audio for LTX),
    and surface per-model pricing.
    """
    from .video_jobs import list_video_models
    from .config import settings as _settings
    models = list_video_models()
    default_model = _settings.fal_video_model
    if default_model not in {model["id"] for model in models}:
        default_model = _settings.ai_video_model or models[0]["id"]
    return VideoModelsResponse(
        models=[VideoModel(**m) for m in models],
        default=default_model,
    )


@router.get("/video-jobs", response_model=VideoJobsResponse)
async def video_jobs_list(
    user_id: int = Depends(require_token),
) -> VideoJobsResponse:
    from .video_jobs import list_jobs
    workspace_id = _workspace_scope(user_id)
    return VideoJobsResponse(
        jobs=[VideoJob(**j) for j in list_jobs(user_id=workspace_id)]
    )


@router.get("/video-jobs/{job_id}", response_model=VideoJob)
async def video_jobs_get(
    job_id: str,
    user_id: int = Depends(require_token),
) -> VideoJob:
    from .video_jobs import get_job
    workspace_id = _workspace_scope(user_id)
    job = get_job(job_id, user_id=workspace_id)
    if not job:
        raise HTTPException(404, "Video job not found.")
    return VideoJob(**job)


@router.delete("/video-jobs/{job_id}")
async def video_jobs_delete(
    job_id: str,
    user_id: int = Depends(require_token),
) -> dict[str, Any]:
    from .video_jobs import delete_job, get_job
    workspace_id = _workspace_scope(user_id)
    job = get_job(job_id, user_id=workspace_id)
    if not job or not delete_job(job_id):
        raise HTTPException(404, "Video job not found.")
    return {"deleted": True}
