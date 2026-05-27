"""Backend-generated media assets for the editor and scheduler flows."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import os
import re
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image, ImageDraw, ImageFont

from .auth import require_token
from .config import settings
from .models import (
    GeneratedMediaResponse,
    ImageGenerationRequest,
    VideoGenerationRequest,
)

try:
    from imageio_ffmpeg import get_ffmpeg_exe as _get_ffmpeg_exe
except Exception:  # pragma: no cover - environmental
    _get_ffmpeg_exe = None  # type: ignore[assignment]

router = APIRouter(tags=["media-generation"])

_RATIO_TO_IMAGE_SIZE = {
    "1:1": (1024, 1024),
    "4:5": (1024, 1280),
    "9:16": (1080, 1920),
    "16:9": (1280, 720),
}


def _generated_dir() -> Path:
    path = settings.content_dir / "generated"
    path.mkdir(parents=True, exist_ok=True)
    return path


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


async def _call_image_api(prompt: str, width: int, height: int) -> tuple[bytes, str]:
    if not settings.ai_image_model:
        return _render_fallback_poster(prompt, width, height), "fallback-poster"
    if not settings.ai_image_api_key:
        raise HTTPException(500, "AI_IMAGE_API_KEY is not configured.")

    payload = {
        "model": settings.ai_image_model,
        "prompt": prompt,
        "size": f"{width}x{height}",
        "n": 1,
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            f"{settings.ai_image_api_base_url}/images/generations",
            headers={
                "Authorization": f"Bearer {settings.ai_image_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Image generation request failed.",
                "status_code": resp.status_code,
                "response": resp.text[:800],
            },
        )
    data = resp.json()
    first = (data.get("data") or [{}])[0] or {}
    if first.get("b64_json"):
        return base64.b64decode(first["b64_json"]), settings.ai_image_model
    if first.get("url"):
        async with httpx.AsyncClient(timeout=120.0) as client:
            image_resp = await client.get(first["url"])
        if image_resp.status_code >= 400:
            raise HTTPException(502, "Generated image URL could not be fetched.")
        return image_resp.content, settings.ai_image_model
    raise HTTPException(502, "Image generation returned no asset.")


def _write_bytes(prompt: str, suffix: str, payload: bytes) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    digest = hashlib.sha256(payload).hexdigest()[:10]
    name = f"{stamp}-{_safe_stub(prompt)}-{digest}{suffix}"
    path = _generated_dir() / name
    path.write_bytes(payload)
    return path


async def _generate_image_file(prompt: str, ratio: str) -> tuple[Path, str]:
    width, height = _pick_size(ratio)
    payload, provider = await _call_image_api(prompt, width, height)
    out = _write_bytes(prompt, ".png", payload)
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


@router.post("/media/generate/image", response_model=GeneratedMediaResponse, dependencies=[Depends(require_token)])
async def generate_image(request: Request, body: ImageGenerationRequest) -> GeneratedMediaResponse:
    path, provider = await _generate_image_file(body.prompt, body.ratio)
    return _response_for(request, path, kind="image", provider=provider, prompt=body.prompt)


@router.post("/media/generate/video", response_model=GeneratedMediaResponse, dependencies=[Depends(require_token)])
async def generate_video(request: Request, body: VideoGenerationRequest) -> GeneratedMediaResponse:
    width, height = _pick_size(body.ratio, video=True)
    poster, provider = await _generate_image_file(body.prompt, body.ratio)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    out = _generated_dir() / f"{stamp}-{_safe_stub(body.prompt)}-motion.mp4"
    await _render_motion_video(poster, out, width, height, body.duration_seconds)
    return _response_for(
        request,
        out,
        kind="video",
        provider=f"{provider}+motion",
        prompt=body.prompt,
    )
