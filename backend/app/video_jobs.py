"""LTX video generation jobs — async queue + Replicate integration.

Real video generation takes 30–120 seconds; we can't keep an HTTP
connection open for that long without timing out behind Caddy/Cloudflare.
So /media/generate/video creates a Job row immediately and returns the
job id. A background worker polls Replicate for completion and updates
the row. The frontend polls /video-jobs/{id} until status == succeeded.

Providers, in priority order:
  1. **replicate** — when REPLICATE_API_TOKEN is set. Runs LTX-Video
     (lightricks/ltx-video) by default — Lightricks' open-source 13B
     text-to-video model, also good at image-to-video when an image
     filename is supplied as a reference.
  2. **fallback** — ffmpeg Ken Burns zoom on a generated still image.
     Always available, useful for dev / when Replicate isn't budgeted.

Cost accounting: each successful Replicate run lands a row in the cost
log (workflow="video", tier="media") priced as
``duration_seconds * VIDEO_COST_PER_SECOND_USD``. The fallback path
records zero cost (only CPU time, no external bill).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

from .config import settings
from .runtime_config import resolved_settings

log = logging.getLogger("datalia.video_jobs")

_JOBS_FILE = settings.content_dir / "video_jobs.json"
_JOBS_LOCK = threading.Lock()
MAX_JOBS = 500

_RATIO_TO_SIZE = {
    "1:1": (768, 768),
    "4:5": (768, 960),
    "9:16": (704, 1216),
    "16:9": (1216, 704),
}


# ── Job store ─────────────────────────────────────────────────────────


def _read_raw() -> list[dict[str, Any]]:
    try:
        data = json.loads(_JOBS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []


def _write_raw(items: list[dict[str, Any]]) -> None:
    _JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
    from .services import atomic_write_text
    atomic_write_text(_JOBS_FILE, json.dumps(items, indent=2))


def list_jobs() -> list[dict[str, Any]]:
    with _JOBS_LOCK:
        return list(_read_raw())


def get_job(job_id: str) -> dict[str, Any] | None:
    with _JOBS_LOCK:
        for job in _read_raw():
            if job.get("id") == job_id:
                return dict(job)
    return None


def _save_job(job: dict[str, Any]) -> None:
    with _JOBS_LOCK:
        jobs = _read_raw()
        for i, existing in enumerate(jobs):
            if existing.get("id") == job["id"]:
                jobs[i] = job
                break
        else:
            jobs.insert(0, job)
            del jobs[MAX_JOBS:]
        _write_raw(jobs)


def _update_job(job_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    with _JOBS_LOCK:
        jobs = _read_raw()
        for job in jobs:
            if job.get("id") == job_id:
                for k, v in patch.items():
                    job[k] = v
                _write_raw(jobs)
                return dict(job)
    return None


def _claim_job(job_id: str, *, expected_status: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    """Atomic compare-and-set: apply ``patch`` only if the job's current
    status equals ``expected_status``. Returns the updated job dict on
    success, or ``None`` if the job is missing or the status didn't
    match (i.e. someone else already claimed it).
    """
    with _JOBS_LOCK:
        jobs = _read_raw()
        for job in jobs:
            if job.get("id") == job_id:
                if job.get("status") != expected_status:
                    return None
                for k, v in patch.items():
                    job[k] = v
                _write_raw(jobs)
                return dict(job)
    return None


def delete_job(job_id: str) -> bool:
    with _JOBS_LOCK:
        jobs = _read_raw()
        remaining = [j for j in jobs if j.get("id") != job_id]
        if len(remaining) == len(jobs):
            return False
        _write_raw(remaining)
        return True


# ── Provider selection ────────────────────────────────────────────────


def _pick_provider(requested: str | None, *, user_id: str | int | None = None) -> str:
    """Resolve the effective provider for a job.

    Datalia is wired to **fal.ai as the sole real provider** — same LTX
    model the CEO asked for, $0.02 per video flat. Replicate code paths
    stay in the codebase for the historical / fallback option but are
    not auto-selected. Order on auto:
      1. fal.ai (if FAL_API_KEY is set)
      2. fallback (ffmpeg Ken Burns — always works, no external bill)

    User-requested overrides honour the explicit choice when configured;
    Replicate must be requested by id to be reached.
    """
    cfg = resolved_settings(user_id)
    configured = {
        "ltx": bool(cfg.ltx_api_key),
        "fal": bool(cfg.fal_api_key),
        # Kept for explicit opt-in: a caller can still pass
        # provider="replicate" if they want the version-pinned route.
        "replicate": bool(
            cfg.replicate_api_token
            # Replicate community models (which LTX-Video is) 404 on the
            # bare /v1/models/{owner}/{name}/predictions URL - you must
            # pin a version hash for /v1/predictions to work. Only treat
            # replicate as "configured" once that hash is set.
            and bool(cfg.replicate_video_version)
        ),
        "fallback": True,
    }
    if requested in configured and configured[requested]:
        return requested
    # Auto / unsupported / unconfigured request — fal.ai first (team has
    # a topped-up balance there), then LTX official (100 free credits),
    # then the ffmpeg Ken Burns fallback.
    for p in ("fal", "ltx", "fallback"):
        if configured[p]:
            return p
    return "fallback"


def _model_for_provider(provider: str, *, user_id: str | int | None = None) -> str:
    cfg = resolved_settings(user_id)
    if provider == "ltx":
        return cfg.ltx_video_model
    if provider == "replicate":
        return cfg.replicate_video_model
    if provider == "fal":
        return cfg.fal_video_model
    return "ken-burns-ffmpeg"


# ── Job creation + run ────────────────────────────────────────────────


def create_job(
    *,
    prompt: str,
    ratio: str,
    duration_seconds: int,
    image_filename: str | None = None,
    provider: str | None = None,
    user_id: str | int | None = None,
    fal_model: str | None = None,
    quality: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    """Persist a queued job. The worker loop picks it up on the next tick.

    Optional params:
      * ``fal_model`` — pin a specific fal model id from FAL_MODEL_SPECS
        (overrides ``settings.fal_video_model``). Only meaningful when the
        provider resolves to ``fal``.
      * ``quality`` — hint passed to the model's ``build_inputs`` callable
        (currently used by Kling/Hailuo to pick standard vs master / pro).
      * ``mode`` — ``text``/``image``/``ugc``. Recorded for analytics; the
        runner already decides text-to-video vs image-to-video based on
        whether ``image_filename`` is set, but ``mode`` lets the UI flag
        a UGC prompt template for the spec to amend.

    Returns the created Job dict — caller responds to the client with this.
    """
    cfg = resolved_settings(user_id)
    chosen = _pick_provider(provider, user_id=user_id)
    # Resolve the effective model label shown on the job record. For
    # the fal provider this prefers the per-job override; for others it
    # falls back to the provider's configured default.
    effective_model = (
        fal_model or cfg.fal_video_model
        if chosen == "fal"
        else _model_for_provider(chosen, user_id=user_id)
    )
    job = {
        "id": f"vid-{uuid.uuid4().hex[:10]}",
        "user_id": str(user_id) if user_id is not None else None,
        "status": "queued",
        "provider": chosen,
        "model": effective_model,
        "fal_model": fal_model if chosen == "fal" else None,
        "quality": quality,
        "mode": mode,
        "prompt": prompt,
        "ratio": ratio,
        "duration_seconds": int(duration_seconds),
        "image_filename": image_filename,
        "created_at": time.time(),
        "started_at": None,
        "finished_at": None,
        "progress": 0.0,
        "output_url": None,
        "output_filename": None,
        "error": None,
        "cost_usd": None,
        "external_id": None,
    }
    _save_job(job)
    return job


async def _run_replicate_job(job: dict[str, Any]) -> dict[str, Any]:
    """Submit a job to Replicate, poll until done, persist the result.

    Replicate exposes two creation endpoints:
      1. ``POST /v1/models/{owner}/{name}/predictions`` — only works for
         models flagged as "official" by Replicate. Most community
         uploads (including ``lightricks/ltx-video``) return 404 here.
      2. ``POST /v1/predictions`` — works for any model when given a
         ``version`` hash. We use this whenever ``REPLICATE_VIDEO_VERSION``
         is set, and fall back to (1) otherwise.
    """
    cfg = resolved_settings(job.get("user_id"))
    token = cfg.replicate_api_token
    if not token:
        raise RuntimeError("REPLICATE_API_TOKEN not configured")

    width, height = _RATIO_TO_SIZE.get(job["ratio"], (704, 1216))
    # Build the input payload. LTX accepts a free-form prompt + optional
    # first-frame image. We resolve the reference image filename to a
    # public URL the Replicate worker can fetch.
    public_image_url = None
    if job.get("image_filename"):
        public_image_url = _public_url_for_local(job["image_filename"])

    inputs: dict[str, Any] = {
        "prompt": job["prompt"],
        "width": width,
        "height": height,
        "num_frames": min(257, max(25, int(job["duration_seconds"] * 24))),
        "fps": 24,
        # Stable defaults — bump cfg_scale to ~7 for more prompt-aligned
        # output, lower (3-4) for more creative interpretations.
        "guidance_scale": 4.0,
        "num_inference_steps": 40,
    }
    if public_image_url:
        inputs["image"] = public_image_url

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # 1. Create the prediction — version-based endpoint when we have
    # one (works for community models), model-based otherwise.
    if cfg.replicate_video_version:
        create_url = "https://api.replicate.com/v1/predictions"
        body = {"version": cfg.replicate_video_version, "input": inputs}
    else:
        create_url = (
            "https://api.replicate.com/v1/models/"
            + cfg.replicate_video_model
            + "/predictions"
        )
        body = {"input": inputs}

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(create_url, headers=headers, json=body)
    if resp.status_code == 404 and not cfg.replicate_video_version:
        raise RuntimeError(
            f"Replicate model '{cfg.replicate_video_model}' has no "
            "official endpoint. Set REPLICATE_VIDEO_VERSION to a version "
            "hash from the model page, or switch to FAL_API_KEY for the "
            "free LTX path."
        )
    if resp.status_code >= 400:
        raise RuntimeError(
            f"Replicate create failed ({resp.status_code}): {resp.text[:400]}"
        )
    prediction = resp.json()
    external_id = prediction.get("id")
    _update_job(job["id"], {
        "started_at": time.time(),
        "status": "running",
        "external_id": external_id,
    })

    # 2. Poll until done
    poll_url = (
        prediction.get("urls", {}).get("get")
        or f"https://api.replicate.com/v1/predictions/{external_id}"
    )
    deadline = time.time() + 10 * 60  # 10 minute hard cap
    final = prediction
    while time.time() < deadline:
        await asyncio.sleep(3)
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(poll_url, headers=headers)
        if r.status_code >= 400:
            raise RuntimeError(f"Replicate poll failed: {r.text[:400]}")
        final = r.json()
        status = final.get("status")
        # Replicate logs include the model's per-step output; progress
        # signal is approximate (counts step lines). Good enough for a
        # progress bar.
        _update_job(job["id"], {"progress": _estimate_progress(final)})
        if status in ("succeeded", "failed", "canceled"):
            break

    status = final.get("status")
    if status != "succeeded":
        error = final.get("error") or status or "unknown"
        raise RuntimeError(f"Replicate prediction {status}: {error}")

    output = final.get("output")
    if isinstance(output, list):
        output = output[-1] if output else None
    if not isinstance(output, str):
        raise RuntimeError("Replicate returned no output URL")

    # 3. Download the result into content/generated/
    out_path = _generated_dir() / f"ltx-{job['id']}.mp4"
    async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
        d = await client.get(output)
    if d.status_code >= 400:
        raise RuntimeError(f"Failed to download Replicate output: {d.status_code}")
    out_path.write_bytes(d.content)

    public_url = _public_url_for_local(out_path.name, subdir="generated")
    cost_usd = round(job["duration_seconds"] * cfg.video_cost_per_second_usd, 4)

    # 4. Persist + log cost
    try:
        from .cost_tracking import record_media_job
        record_media_job(
            workflow="video",
            provider="replicate",
            model=cfg.replicate_video_model,
            cost_usd=cost_usd,
            user_id=job.get("user_id"),
            metadata={
                "duration_seconds": job["duration_seconds"],
                "ratio": job["ratio"],
                "external_id": external_id,
            },
        )
    except Exception as exc:
        log.warning("[cost] record_media_job failed: %s", exc)

    return _update_job(job["id"], {
        "status": "succeeded",
        "finished_at": time.time(),
        "progress": 1.0,
        "output_url": public_url,
        "output_filename": out_path.name,
        "cost_usd": cost_usd,
    }) or job


# LTX-2 ratio → resolution string. The API expects a literal "WxH"
# label per docs.ltx.video. Keep the values inside LTX-2's supported
# resolutions (up to 4K, 20s max).
_LTX_RESOLUTION = {
    "1:1": "1024x1024",
    "4:5": "1080x1350",
    "9:16": "1080x1920",
    "16:9": "1920x1080",
}


async def _run_ltx_job(job: dict[str, Any]) -> dict[str, Any]:
    """Submit a job to Lightricks' official LTX-2 API (docs.ltx.video).

    Uses the **synchronous** endpoint — POST returns the MP4 bytes
    directly in the response body. Simpler than fal/Replicate's
    queue-based pattern, no polling needed. The trade-off is a long
    HTTP connection; LTX-2 typically completes in 30-90s for an 8s
    clip, well under our 5min ``httpx`` timeout.

    The API picks ``text-to-video`` vs ``image-to-video`` based on
    whether the job carries an image_filename — we resolve that to a
    public URL Lightricks can fetch.
    """
    cfg = resolved_settings(job.get("user_id"))
    key = cfg.ltx_api_key
    if not key:
        raise RuntimeError("LTX_API_KEY not configured")

    image_url = None
    if job.get("image_filename"):
        image_url = _public_url_for_local(job["image_filename"])

    resolution = _LTX_RESOLUTION.get(job["ratio"], "1080x1920")
    duration = max(3, min(20, int(job["duration_seconds"])))

    body: dict[str, Any] = {
        "prompt": job["prompt"],
        "model": cfg.ltx_video_model,
        "duration": duration,
        "resolution": resolution,
    }
    endpoint = "text-to-video"
    if image_url:
        body["image_uri"] = image_url
        endpoint = "image-to-video"

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    url = f"{cfg.ltx_api_base_url}/{endpoint}"

    _update_job(job["id"], {
        "started_at": time.time(),
        "status": "running",
        "progress": 0.1,
    })

    # Sync call — LTX-2 sends back the MP4 directly. 6-minute hard
    # timeout covers worst-case 20s clips at 4K; bump only if you see
    # legitimate timeouts in production.
    async with httpx.AsyncClient(timeout=360.0) as client:
        resp = await client.post(url, headers=headers, json=body)
    if resp.status_code >= 400:
        # LTX returns JSON error bodies on failure (sync endpoint
        # switches Content-Type when it's an error rather than success).
        raise RuntimeError(
            f"LTX-2 request failed ({resp.status_code}): {resp.text[:400]}"
        )
    if not resp.content:
        raise RuntimeError("LTX-2 returned empty body")

    # Persist the MP4 bytes. Lightricks sets x-request-id we stash as
    # the external id so it shows up in the job inspector.
    external_id = resp.headers.get("x-request-id")
    out_path = _generated_dir() / f"ltx2-{job['id']}.mp4"
    out_path.write_bytes(resp.content)

    public_url = _public_url_for_local(out_path.name, subdir="generated")
    cost_usd = round(duration * cfg.video_cost_per_second_usd, 4)

    try:
        from .cost_tracking import record_media_job
        record_media_job(
            workflow="video",
            provider="ltx",
            model=cfg.ltx_video_model,
            cost_usd=cost_usd,
            user_id=job.get("user_id"),
            metadata={
                "duration_seconds": duration,
                "ratio": job["ratio"],
                "resolution": resolution,
                "endpoint": endpoint,
                "external_id": external_id,
            },
        )
    except Exception as exc:
        log.warning("[cost] record_media_job failed: %s", exc)

    return _update_job(job["id"], {
        "status": "succeeded",
        "finished_at": time.time(),
        "progress": 1.0,
        "output_url": public_url,
        "output_filename": out_path.name,
        "cost_usd": cost_usd,
        "external_id": external_id,
    }) or job


# ── fal.ai model registry ──────────────────────────────────────────────
# Each entry knows three things:
#   1. The text-to-video + image-to-video endpoint paths on fal.run.
#   2. A `build_inputs(prompt, ratio, duration_seconds, image_url,
#      quality)` callable that returns the per-model request body —
#      Kling expects ``duration="5"`` (string), LTX expects num_frames,
#      Veo3 has its own knobs, etc.
#   3. Per-second cost so the cost dashboard is honest.
#   4. A `features` dict the frontend reads via /video-models so the
#      UI hides controls a given model doesn't support (e.g. no
#      audio for LTX).
#
# Adding a new fal model is two steps: drop a spec here, optionally
# add an i18n key in messages/*.json. The UI picks it up automatically
# via the /video-models endpoint.


def _kling_duration(seconds: int) -> str:
    """Kling models accept duration as the literal string "5" or "10"."""
    return "10" if seconds >= 8 else "5"


def _kling_inputs(*, prompt, ratio, duration_seconds, image_url, quality):
    inputs = {
        "prompt": prompt,
        "duration": _kling_duration(duration_seconds),
        "aspect_ratio": _aspect_label(ratio),
        "negative_prompt": "blur, distort, low quality, deformed, ugly, "
                           "extra limbs, watermark, text overlay",
    }
    if image_url:
        inputs["image_url"] = image_url
    return inputs


def _ltx_inputs(*, prompt, ratio, duration_seconds, image_url, quality):
    inputs = {
        "prompt": prompt,
        "num_frames": min(257, max(25, int(duration_seconds * 24))),
        "guidance_scale": 4.0,
        "num_inference_steps": 40,
        "aspect_ratio": _aspect_label(ratio),
    }
    if image_url:
        inputs["image_url"] = image_url
    return inputs


def _veo_common_inputs(*, prompt, ratio, duration_seconds, image_url, quality):
    # Map aspect ratio to '16:9' or '9:16'
    aspect = _aspect_label(ratio)
    if aspect not in ("16:9", "9:16"):
        aspect = "16:9" if ratio == "16:9" else "9:16"

    # Map duration to nearest '4s', '6s', or '8s'
    if duration_seconds <= 5:
        dur = "4s"
    elif duration_seconds <= 7:
        dur = "6s"
    else:
        dur = "8s"

    inputs = {
        "prompt": prompt,
        "duration": dur,
        "aspect_ratio": aspect,
        "resolution": "1080p",
        "generate_audio": False,
        "negative_prompt": "blurry, low quality, distorted, deformed, ugly, watermark, text overlay, bad eyes, extra limbs",
    }
    if image_url:
        inputs["image_url"] = image_url
    return inputs


def _hunyuan_inputs(*, prompt, ratio, duration_seconds, image_url, quality):
    # Map aspect ratio to '16:9' or '9:16'
    aspect = _aspect_label(ratio)
    if aspect not in ("16:9", "9:16"):
        aspect = "16:9" if ratio == "16:9" else "9:16"

    inputs = {
        "prompt": prompt,
        "aspect_ratio": aspect,
        "num_frames": min(121, max(25, int(duration_seconds * 24))),
        "enable_prompt_expansion": True,
    }
    if image_url:
        inputs["image_url"] = image_url
    return inputs


def _hailuo_inputs(*, prompt, ratio, duration_seconds, image_url, quality):
    inputs = {
        "prompt": prompt,
        "duration": min(10, max(6, duration_seconds)),
        "prompt_optimizer": True,
    }
    if image_url:
        inputs["first_frame_image"] = image_url
    return inputs




FAL_MODEL_SPECS: dict[str, dict[str, Any]] = {
    # Kling 2.1 Standard — strong photoreal quality at ~$0.15/s. The
    # CEO-recommended default for "looks like an ad, not a demo".
    "fal-ai/kling-video/v2.1/standard/text-to-video": {
        "label": "Kling 2.1 Standard",
        "endpoints": {
            "text_to_video": "fal-ai/kling-video/v2.1/standard/text-to-video",
            "image_to_video": "fal-ai/kling-video/v2.1/standard/image-to-video",
        },
        "build_inputs": _kling_inputs,
        "cost_per_second_usd": 0.15,
        "features": {
            "image_to_video": True,
            "audio": False,
            "max_duration_seconds": 10,
            "supports_ugc": True,
        },
    },
    "fal-ai/kling-video/v2.1/master/text-to-video": {
        "label": "Kling 2.1 Master (flagship)",
        "endpoints": {
            "text_to_video": "fal-ai/kling-video/v2.1/master/text-to-video",
            "image_to_video": "fal-ai/kling-video/v2.1/master/image-to-video",
        },
        "build_inputs": _kling_inputs,
        "cost_per_second_usd": 0.28,
        "features": {
            "image_to_video": True,
            "audio": False,
            "max_duration_seconds": 10,
            "supports_ugc": True,
        },
    },
    # Veo 3.1 Fast — Google's latest flagship speed/cost tier. Extremely fast & cinematic ($0.10/s).
    "fal-ai/veo3.1/fast": {
        "label": "Veo 3.1 Fast (Google Flagship)",
        "endpoints": {
            "text_to_video": "fal-ai/veo3.1/fast",
            "image_to_video": "fal-ai/veo3.1/fast/image-to-video",
        },
        "build_inputs": _veo_common_inputs,
        "cost_per_second_usd": 0.10,
        "features": {
            "image_to_video": True,
            "audio": True,
            "max_duration_seconds": 8,
            "supports_ugc": False,
        },
    },
    # Veo 3.1 Standard — Google's flagship high-quality tier ($0.20/s).
    "fal-ai/veo3.1": {
        "label": "Veo 3.1 Standard (Google Flagship)",
        "endpoints": {
            "text_to_video": "fal-ai/veo3.1",
            "image_to_video": "fal-ai/veo3.1/image-to-video",
        },
        "build_inputs": _veo_common_inputs,
        "cost_per_second_usd": 0.20,
        "features": {
            "image_to_video": True,
            "audio": True,
            "max_duration_seconds": 8,
            "supports_ugc": False,
        },
    },
    # Hunyuan Video 1.5 — outstanding state-of-the-art open-source model ($0.075/s).
    "fal-ai/hunyuan-video-v1.5/text-to-video": {
        "label": "Hunyuan Video 1.5 Standard",
        "endpoints": {
            "text_to_video": "fal-ai/hunyuan-video-v1.5/text-to-video",
            "image_to_video": "fal-ai/hunyuan-video-v1.5/image-to-video",
        },
        "build_inputs": _hunyuan_inputs,
        "cost_per_second_usd": 0.075,
        "features": {
            "image_to_video": True,
            "audio": False,
            "max_duration_seconds": 10,
            "supports_ugc": True,
        },
    },
    # Veo 3 Standard — Legacy Veo 3 model ($0.50/s).
    "fal-ai/veo3": {
        "label": "Veo 3 Standard",
        "endpoints": {
            "text_to_video": "fal-ai/veo3",
            "image_to_video": "fal-ai/veo3/image-to-video",
        },
        "build_inputs": _veo_common_inputs,
        "cost_per_second_usd": 0.50,
        "features": {
            "image_to_video": True,
            "audio": True,
            "max_duration_seconds": 8,
            "supports_ugc": False,
        },
    },
    # MiniMax Hailuo 02 — great alternative for image-to-video.
    "fal-ai/minimax/hailuo-02/standard/text-to-video": {
        "label": "MiniMax Hailuo 02 Standard",
        "endpoints": {
            "text_to_video": "fal-ai/minimax/hailuo-02/standard/text-to-video",
            "image_to_video": "fal-ai/minimax/hailuo-02/standard/image-to-video",
        },
        "build_inputs": _hailuo_inputs,
        "cost_per_second_usd": 0.10,
        "features": {
            "image_to_video": True,
            "audio": False,
            "max_duration_seconds": 10,
            "supports_ugc": True,
        },
    },
    # Original LTX-Video on fal — cheap but the "scary frames" issue we
    # had earlier. Kept as a fallback choice + for backwards compat.
    "fal-ai/ltx-video": {
        "label": "LTX-Video (legacy, low cost)",
        "endpoints": {
            "text_to_video": "fal-ai/ltx-video",
            "image_to_video": "fal-ai/ltx-video",
        },
        "build_inputs": _ltx_inputs,
        "cost_per_second_usd": 0.04,
        "features": {
            "image_to_video": True,
            "audio": False,
            "max_duration_seconds": 15,
            "supports_ugc": False,
        },
    },
}


def list_fal_models() -> list[dict[str, Any]]:
    """Public catalogue exposed via /video-models. Strips the callable
    so the response is JSON-serializable."""
    return [
        {
            "id": model_id,
            "label": spec["label"],
            "features": spec["features"],
            "cost_per_second_usd": spec["cost_per_second_usd"],
            "endpoints": list(spec["endpoints"].keys()),
        }
        for model_id, spec in FAL_MODEL_SPECS.items()
    ]


async def _expand_video_prompt(
    prompt: str,
    *,
    user_id: str | int | None = None,
) -> str:
    """Use standard LLM to expand a short video prompt into a rich cinematic description."""
    # If the prompt is already highly detailed and long (e.g. > 45 words), keep it as is.
    if len(prompt.split()) > 45:
        return prompt

    system_prompt = (
        "You are an expert cinematic director and AI video prompt engineer. "
        "Your task is to expand the user's short video description into a detailed, "
        "highly visual director-level prompt optimized for Google Veo 3.1. "
        "Focus on: camera shot type/angle, movement, lighting (e.g. golden hour, dramatic shadows), "
        "textures, style (e.g. cinematic, 35mm film), and specific actions. "
        "Keep it to exactly 2-3 sentences. "
        "Do NOT include any preamble, introductory text, or quotes. Output ONLY the expanded prompt."
    )

    cfg = resolved_settings(user_id)
    payload = {
        "model": cfg.ai_model_fast,
        "temperature": 0.7,
        "max_tokens": 150,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Expand this video prompt: {prompt}"},
        ],
    }

    try:
        from .services import _post_chat
        expanded, _ = await _post_chat(
            payload,
            workflow="video_prompt_expansion",
            tier="fast",
            user_id=user_id,
            log_cost=True,
        )
        expanded = expanded.strip().strip('"').strip("'")
        if expanded:
            log.info("Expanded video prompt from '%s' to '%s'", prompt, expanded)
            return expanded
    except Exception as exc:
        log.warning("Failed to expand video prompt: %s", exc)

    return prompt


async def _run_fal_job(job: dict[str, Any]) -> dict[str, Any]:
    """Submit a job to fal.ai's queue API, poll status, download result.

    fal.ai's LTX-Video endpoint is the recommended free starting point —
    they hand out enough credit on signup (no card) to render ~25
    seconds of LTX video. Same model the CEO asked for, real free tier.
    """
    cfg = resolved_settings(job.get("user_id"))
    key = cfg.fal_api_key
    if not key:
        raise RuntimeError("FAL_API_KEY not configured")

    public_image_url = None
    if job.get("image_filename"):
        public_image_url = _public_url_for_local(job["image_filename"])

    # The job carries either an explicit model override (job["fal_model"])
    # or falls back to settings.fal_video_model. Pick the spec from the
    # registry so the right body shape + endpoint get used per model.
    requested_model = job.get("fal_model") or cfg.fal_video_model
    spec = FAL_MODEL_SPECS.get(requested_model) or FAL_MODEL_SPECS["fal-ai/ltx-video"]
    # Image-to-video endpoint when a reference image is supplied AND the
    # model supports it; otherwise text-to-video.
    supports_image = bool(
        spec["endpoints"].get("image_to_video")
        and spec.get("features", {}).get("image_to_video")
    )
    endpoint = spec["endpoints"].get(
        "image_to_video" if public_image_url and supports_image else "text_to_video"
    )
    if not (public_image_url and supports_image):
        # Don't pass a reference image to text-only endpoints; the shared
        # build_inputs callables would otherwise attach image_url and the
        # provider will either ignore it or 400.
        public_image_url = None
    if not endpoint:
        raise RuntimeError(
            f"fal model '{requested_model}' has no usable endpoint configured"
        )

    # For Veo models, automatically expand short prompts into detailed cinematic director-style descriptions
    prompt_to_use = job["prompt"]
    if "veo3" in requested_model:
        prompt_to_use = await _expand_video_prompt(
            job["prompt"],
            user_id=job.get("user_id"),
        )
        if prompt_to_use != job["prompt"]:
            # Update the job prompt so the user can see it in the UI and dashboard!
            _update_job(job["id"], {"prompt": prompt_to_use})

    inputs = spec["build_inputs"](
        prompt=prompt_to_use,
        ratio=job["ratio"],
        duration_seconds=int(job["duration_seconds"]),
        image_url=public_image_url,
        quality=job.get("quality") or "standard",
    )

    headers = {
        "Authorization": f"Key {key}",
        "Content-Type": "application/json",
    }
    queue_url = f"https://queue.fal.run/{endpoint}"

    # 1. Submit
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(queue_url, headers=headers, json=inputs)
    if resp.status_code >= 400:
        raise RuntimeError(
            f"fal.ai submit failed ({resp.status_code}): {resp.text[:400]}"
        )
    submission = resp.json()
    request_id = submission.get("request_id")
    if not request_id:
        raise RuntimeError(f"fal.ai returned no request_id: {submission}")
    _update_job(job["id"], {
        "started_at": time.time(),
        "status": "running",
        "external_id": request_id,
    })

    # 2. Poll status. fal returns canonical status_url / response_url in
    # the submission — use them. Building them by string concat breaks on
    # apps with sub-endpoints (e.g. fal-ai/kling-video/.../text-to-video),
    # because the status route lives on the parent app id, not the
    # sub-endpoint. Extract the app root for the fallback URLs.
    _ep_parts = endpoint.split("/")
    _app_root = "/".join(_ep_parts[:2]) if len(_ep_parts) > 2 else endpoint
    _app_root_url = f"https://queue.fal.run/{_app_root}"
    status_url = submission.get("status_url") or f"{_app_root_url}/requests/{request_id}/status"
    result_url = submission.get("response_url") or f"{_app_root_url}/requests/{request_id}"
    deadline = time.time() + 10 * 60
    while time.time() < deadline:
        await asyncio.sleep(3)
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(status_url, headers=headers)
        if r.status_code >= 400:
            raise RuntimeError(f"fal.ai poll failed: {r.text[:400]}")
        body = r.json()
        status = (body.get("status") or "").upper()
        # Status values: IN_QUEUE / IN_PROGRESS / COMPLETED / FAILED
        progress = body.get("progress")
        if isinstance(progress, (int, float)):
            _update_job(job["id"], {"progress": float(progress) / 100.0})
        elif status == "IN_QUEUE":
            _update_job(job["id"], {"progress": 0.05})
        elif status == "IN_PROGRESS":
            _update_job(job["id"], {"progress": 0.5})
        if status in ("COMPLETED", "FAILED"):
            break

    # 3. Fetch the result
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(result_url, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"fal.ai result fetch failed: {r.text[:400]}")
    result = r.json()
    video_url = (
        (result.get("video") or {}).get("url")
        or result.get("video_url")
        or (result.get("output") or {}).get("video")
    )
    if not video_url:
        raise RuntimeError(f"fal.ai returned no video URL: {str(result)[:400]}")

    # 4. Download into content/generated/
    out_path = _generated_dir() / f"falltx-{job['id']}.mp4"
    async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
        d = await client.get(video_url)
    if d.status_code >= 400:
        raise RuntimeError(f"Failed to download fal.ai output: {d.status_code}")
    out_path.write_bytes(d.content)

    public_url = _public_url_for_local(out_path.name, subdir="generated")
    # Use the per-model rate from the spec — Kling, Veo and LTX cost
    # very different amounts per second of output. Falls back to the
    # global VIDEO_COST_PER_SECOND_USD when the model isn't in the
    # registry (e.g. user pasted a custom fal model id via env).
    per_sec = spec.get("cost_per_second_usd") or cfg.video_cost_per_second_usd
    cost_usd = round(job["duration_seconds"] * per_sec, 4)

    try:
        from .cost_tracking import record_media_job
        record_media_job(
            workflow="video",
            provider="fal",
            model=requested_model,
            cost_usd=cost_usd,
            user_id=job.get("user_id"),
            metadata={
                "duration_seconds": job["duration_seconds"],
                "ratio": job["ratio"],
                "external_id": request_id,
            },
        )
    except Exception as exc:
        log.warning("[cost] record_media_job failed: %s", exc)

    return _update_job(job["id"], {
        "status": "succeeded",
        "finished_at": time.time(),
        "progress": 1.0,
        "output_url": public_url,
        "output_filename": out_path.name,
        "cost_usd": cost_usd,
    }) or job


def _aspect_label(ratio: str) -> str:
    """Map our internal ratio string to fal.ai's aspect_ratio enum."""
    mapping = {
        "1:1": "1:1",
        "4:5": "4:5",
        "9:16": "9:16",
        "16:9": "16:9",
    }
    return mapping.get(ratio, "9:16")


async def _run_fallback_job(job: dict[str, Any]) -> dict[str, Any]:
    """Always-on ffmpeg Ken Burns generator — generates a still then zooms.

    Used when no external provider is configured, when the user
    explicitly asked for "fallback", and (most importantly) as the
    rescue path when fal / Replicate / LTX raise at runtime.

    For the rescue path to mean anything, this MUST work without any
    external API. So when the AI image provider is set but returns an
    error (e.g. OpenRouter deprecated the model id, the key is bad),
    we catch and substitute the bundled Pillow placeholder poster.
    Cost stays zero either way.
    """
    from .media_generation import (
        _generate_image_file,
        _render_fallback_poster,
        _render_motion_video,
        _pick_size,
        _write_bytes,
        _generated_dir as _gen_dir,
    )
    _update_job(job["id"], {"started_at": time.time(), "status": "running", "progress": 0.1})
    width, height = _pick_size(job["ratio"], video=True)
    try:
        poster, _provider = await _generate_image_file(job["prompt"], job["ratio"])
    except Exception as exc:
        # Don't take the whole job down just because the image API
        # broke — Pillow can always render a placeholder.
        log.warning(
            "[video] AI image gen failed in fallback (%s) — substituting placeholder",
            exc,
        )
        payload = _render_fallback_poster(job["prompt"], width, height)
        poster = _write_bytes(job["prompt"], ".png", payload)
    _update_job(job["id"], {"progress": 0.5})
    out_path = _gen_dir() / f"kenburns-{job['id']}.mp4"
    await _render_motion_video(
        poster, out_path, width, height, job["duration_seconds"]
    )
    public_url = _public_url_for_local(out_path.name, subdir="generated")
    return _update_job(job["id"], {
        "status": "succeeded",
        "finished_at": time.time(),
        "progress": 1.0,
        "output_url": public_url,
        "output_filename": out_path.name,
        "cost_usd": 0.0,
    }) or job


def _estimate_progress(prediction: dict[str, Any]) -> float:
    status = prediction.get("status")
    if status == "succeeded":
        return 1.0
    if status in ("failed", "canceled"):
        return 0.0
    if status == "starting":
        return 0.05
    logs = prediction.get("logs") or ""
    # Replicate emits ~one log line per inference step on LTX. Caps to 0.95
    # so the UI doesn't flip to 100% prematurely.
    step_lines = sum(1 for line in logs.split("\n") if "%" in line or "step" in line.lower())
    return min(0.95, 0.1 + step_lines * 0.02)


def _generated_dir() -> Path:
    path = settings.content_dir / "generated"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _public_url_for_local(filename: str, *, subdir: str = "generated") -> str:
    """Resolve a content-relative filename to a public URL Replicate /
    the frontend can hit. Mirrors the precedence used by /upload."""
    base = (
        os.environ.get("PUBLIC_BASE_URL")
        or os.environ.get("OAUTH_REDIRECT_BASE")
        or ""
    ).rstrip("/")
    rel = f"{subdir}/{filename}" if subdir else filename
    if not base:
        return f"/content/{rel}"
    return f"{base}/content/{rel}"


_PROVIDER_RUNNERS = {
    "fal": "_run_fal_job",
    "replicate": "_run_replicate_job",
    "fallback": "_run_fallback_job",
}


async def _dispatch_provider(provider: str, job: dict[str, Any]) -> dict[str, Any]:
    """Call the right runner. Kept tiny on purpose so the auto-fallback
    loop in ``run_job`` can iterate over provider candidates cleanly."""
    if provider == "ltx":
        return await _run_ltx_job(job)
    if provider == "fal":
        return await _run_fal_job(job)
    if provider == "replicate":
        return await _run_replicate_job(job)
    return await _run_fallback_job(job)


async def run_job(job_id: str) -> dict[str, Any] | None:
    """Execute one job, with auto-fallback to ffmpeg when the configured
    external provider raises.

    Why auto-fallback: if fal.ai is out of credit (HTTP 403 "User is
    locked") or Replicate hits a quota wall, we'd rather hand the user
    *a* video — the Ken Burns placeholder — than a hard failure. The
    job record carries ``attempts`` so the UI can show "fal failed →
    served by fallback" and the team can decide whether to top up.

    Only the external paths (fal / replicate) auto-fall through. A
    user who explicitly requested ``provider="fallback"`` gets it
    directly — no point trying anything else.
    """
    job = get_job(job_id)
    if not job:
        return None
    if job.get("status") in ("succeeded", "failed", "cancelled"):
        return job
    if job.get("status") == "running":
        # Another caller (sync media_generation path or a previous worker
        # tick) already claimed this job. Returning early here prevents
        # double-submission to the provider, which would otherwise bill
        # twice for the same prediction.
        return job
    # Atomic queued → running claim. If another caller flipped the
    # status between get_job and here (e.g. the worker tick fired while
    # the sync /media/generate/video path was about to await run_job),
    # the CAS returns None and we bail without re-executing the job.
    claimed = _claim_job(
        job_id,
        expected_status="queued",
        patch={"status": "running", "started_at": job.get("started_at") or time.time()},
    )
    if claimed is None:
        return get_job(job_id)
    job = claimed

    primary = job["provider"]
    # Build the candidate chain — primary first, then fallback if the
    # primary is an external provider that might fail at runtime.
    candidates = [primary]
    if primary in ("ltx", "fal", "replicate"):
        candidates.append("fallback")

    attempts: list[dict[str, Any]] = list(job.get("attempts") or [])
    last_error: str | None = None
    for idx, provider in enumerate(candidates):
        is_last = idx == len(candidates) - 1
        try:
            result = await _dispatch_provider(provider, job)
            attempts.append({"provider": provider, "ok": True})
            # Stamp the attempts log + (if we fell back) the effective
            # provider so the UI shows what actually rendered the video.
            # Without overwriting `provider`, a Ken Burns mp4 would still
            # be labelled "fal" with a cost row pretending we paid for it.
            patch = {
                "attempts": attempts,
                "fallback_used": provider != primary,
            }
            if provider != primary:
                patch["provider"] = provider
            return _update_job(job_id, patch) or result
        except Exception as exc:  # noqa: BLE001
            log.exception(
                "[video] job %s attempt %s (provider=%s) failed",
                job_id,
                idx + 1,
                provider,
            )
            err_str = f"{type(exc).__name__}: {exc}"[:300]
            attempts.append({"provider": provider, "ok": False, "error": err_str})
            last_error = err_str
            # Re-read job in case the runner persisted partial state
            # (e.g. started_at) before raising; mark as running for the
            # next attempt so the UI keeps showing progress.
            if not is_last:
                _update_job(job_id, {
                    "attempts": attempts,
                    "status": "running",
                    "progress": 0.0,
                    "error": None,
                })
                continue

    # Every candidate failed — record the last error and mark failed.
    return _update_job(job_id, {
        "status": "failed",
        "finished_at": time.time(),
        "error": last_error or "all providers failed",
        "attempts": attempts,
    })


# ── Worker loop ───────────────────────────────────────────────────────

_TASK: asyncio.Task | None = None
_STOP = False
TICK_SECONDS = 5


async def _tick_once() -> None:
    """Pick up to N queued jobs and start them — fan-out keeps a single
    slow Replicate call from blocking the queue."""
    queued = [j for j in list_jobs() if j.get("status") == "queued"]
    if not queued:
        return
    # Cap concurrency so we don't slam the provider when the queue spikes.
    in_flight = sum(1 for j in list_jobs() if j.get("status") == "running")
    capacity = max(0, 3 - in_flight)
    for job in queued[:capacity]:
        # run_job performs an atomic queued → running CAS at entry, so
        # the worker tick can't double-fire on the same job and a
        # concurrent sync caller (media_generation) can't race us.
        asyncio.create_task(run_job(job["id"]))


async def _loop() -> None:
    log.info("[video] worker running — tick every %ss", TICK_SECONDS)
    while not _STOP:
        try:
            await _tick_once()
        except Exception:
            log.exception("[video] worker tick failed")
        await asyncio.sleep(TICK_SECONDS)


def start_video_worker() -> None:
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


def stop_video_worker() -> None:
    global _STOP
    _STOP = True
