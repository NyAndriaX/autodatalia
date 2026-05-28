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
    _JOBS_FILE.write_text(json.dumps(items, indent=2), encoding="utf-8")


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


def delete_job(job_id: str) -> bool:
    with _JOBS_LOCK:
        jobs = _read_raw()
        remaining = [j for j in jobs if j.get("id") != job_id]
        if len(remaining) == len(jobs):
            return False
        _write_raw(remaining)
        return True


# ── Provider selection ────────────────────────────────────────────────


def _pick_provider(requested: str | None) -> str:
    """Resolve the effective provider for a job.

    Auto preference (when ``requested`` is None / "auto"):
      1. fal.ai — has a no-card free tier on LTX-Video, the CEO-friendly
         default for "free but real" video generation.
      2. Replicate — billed per-second; needs ``REPLICATE_API_TOKEN``.
      3. fallback — the ffmpeg Ken Burns generator. Always available.
    User-requested overrides the auto-detection unless the requested
    provider isn't configured (e.g. ``provider="fal"`` with no FAL key)
    — in that case we fall through to whatever is configured so the user
    gets *a* video instead of a 503.
    """
    configured = {
        "fal": bool(settings.fal_api_key),
        "replicate": bool(settings.replicate_api_token),
        "fallback": True,
    }
    if requested in configured and configured[requested]:
        return requested
    # Auto / unsupported / unconfigured request — pick the first
    # configured provider in priority order.
    for p in ("fal", "replicate", "fallback"):
        if configured[p]:
            return p
    return "fallback"


def _model_for_provider(provider: str) -> str:
    if provider == "replicate":
        return settings.replicate_video_model
    if provider == "fal":
        return settings.fal_video_model
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
) -> dict[str, Any]:
    """Persist a queued job. The worker loop picks it up on the next tick.

    Returns the created Job dict — caller responds to the client with this.
    """
    chosen = _pick_provider(provider)
    job = {
        "id": f"vid-{uuid.uuid4().hex[:10]}",
        "user_id": str(user_id) if user_id is not None else None,
        "status": "queued",
        "provider": chosen,
        "model": _model_for_provider(chosen),
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
    token = settings.replicate_api_token
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
    if settings.replicate_video_version:
        create_url = "https://api.replicate.com/v1/predictions"
        body = {"version": settings.replicate_video_version, "input": inputs}
    else:
        create_url = (
            "https://api.replicate.com/v1/models/"
            + settings.replicate_video_model
            + "/predictions"
        )
        body = {"input": inputs}

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(create_url, headers=headers, json=body)
    if resp.status_code == 404 and not settings.replicate_video_version:
        raise RuntimeError(
            f"Replicate model '{settings.replicate_video_model}' has no "
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
    cost_usd = round(job["duration_seconds"] * settings.video_cost_per_second_usd, 4)

    # 4. Persist + log cost
    try:
        from .cost_tracking import record_media_job
        record_media_job(
            workflow="video",
            provider="replicate",
            model=settings.replicate_video_model,
            cost_usd=cost_usd,
            user_id=job.get("user_id"),
            metadata={
                "duration_seconds": job["duration_seconds"],
                "ratio": job["ratio"],
                "external_id": external_id,
            },
        )
    except Exception:
        pass

    return _update_job(job["id"], {
        "status": "succeeded",
        "finished_at": time.time(),
        "progress": 1.0,
        "output_url": public_url,
        "output_filename": out_path.name,
        "cost_usd": cost_usd,
    }) or job


async def _run_fal_job(job: dict[str, Any]) -> dict[str, Any]:
    """Submit a job to fal.ai's queue API, poll status, download result.

    fal.ai's LTX-Video endpoint is the recommended free starting point —
    they hand out enough credit on signup (no card) to render ~25
    seconds of LTX video. Same model the CEO asked for, real free tier.
    """
    key = settings.fal_api_key
    if not key:
        raise RuntimeError("FAL_API_KEY not configured")

    width, height = _RATIO_TO_SIZE.get(job["ratio"], (704, 1216))
    public_image_url = None
    if job.get("image_filename"):
        public_image_url = _public_url_for_local(job["image_filename"])

    # fal.ai's LTX endpoint accepts num_frames (24 fps → duration*24) and
    # an optional image_url for image-to-video.
    inputs: dict[str, Any] = {
        "prompt": job["prompt"],
        "num_frames": min(257, max(25, int(job["duration_seconds"] * 24))),
        "guidance_scale": 4.0,
        "num_inference_steps": 40,
        "aspect_ratio": _aspect_label(job["ratio"]),
    }
    if public_image_url:
        inputs["image_url"] = public_image_url

    headers = {
        "Authorization": f"Key {key}",
        "Content-Type": "application/json",
    }
    queue_url = f"https://queue.fal.run/{settings.fal_video_model}"

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

    # 2. Poll status
    status_url = f"{queue_url}/requests/{request_id}/status"
    result_url = f"{queue_url}/requests/{request_id}"
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
    # fal.ai bills per-second similar to Replicate (~$0.04/s on LTX) so
    # we can reuse the same per-second knob for cost reporting.
    cost_usd = round(job["duration_seconds"] * settings.video_cost_per_second_usd, 4)

    try:
        from .cost_tracking import record_media_job
        record_media_job(
            workflow="video",
            provider="fal",
            model=settings.fal_video_model,
            cost_usd=cost_usd,
            user_id=job.get("user_id"),
            metadata={
                "duration_seconds": job["duration_seconds"],
                "ratio": job["ratio"],
                "external_id": request_id,
            },
        )
    except Exception:
        pass

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
    """Legacy ffmpeg Ken Burns generator — generates a still then zooms.

    Used when no Replicate token is set, or the user explicitly asked
    for "fallback". Costs nothing externally.
    """
    from .media_generation import _generate_image_file, _render_motion_video, _pick_size
    _update_job(job["id"], {"started_at": time.time(), "status": "running", "progress": 0.1})
    poster, _provider = await _generate_image_file(job["prompt"], job["ratio"])
    _update_job(job["id"], {"progress": 0.5})
    width, height = _pick_size(job["ratio"], video=True)
    out_path = _generated_dir() / f"kenburns-{job['id']}.mp4"
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


async def run_job(job_id: str) -> dict[str, Any] | None:
    """Execute one job — picks the provider per the persisted record.
    Catches every exception so the worker loop keeps ticking."""
    job = get_job(job_id)
    if not job:
        return None
    if job.get("status") in ("succeeded", "failed", "cancelled"):
        return job
    try:
        if job["provider"] == "fal":
            return await _run_fal_job(job)
        if job["provider"] == "replicate":
            return await _run_replicate_job(job)
        return await _run_fallback_job(job)
    except Exception as exc:  # noqa: BLE001
        log.exception("[video] job %s failed", job_id)
        return _update_job(job_id, {
            "status": "failed",
            "finished_at": time.time(),
            "error": f"{type(exc).__name__}: {exc}"[:500],
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
        # Mark queued → running immediately so the worker tick doesn't
        # double-fire on the same job.
        _update_job(job["id"], {"status": "running", "started_at": time.time()})
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
