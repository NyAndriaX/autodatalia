"""Caption API — FastAPI application entrypoint."""

import os
import threading
import mimetypes

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from pillow_heif import register_avif_opener, register_heif_opener
register_avif_opener()
register_heif_opener()

from .config import settings
from .legal import router as legal_router
from .media_generation import router as media_generation_router
from .oauth import router as oauth_router
from .routes import router
from .scheduler import start_scheduler, stop_scheduler
from .telegram_validation import router as telegram_validation_router

app = FastAPI(title="Caption API", version="1.0.0")

# ── CORS ───────────────────────────────────────────────────────────────
# Lets the dashboard call the backend directly (the Next.js rewrite proxy
# at /api/backend still works too). Origins come from CORS_ALLOW_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files ───────────────────────────────────────────────────────
# Register .jfif as image/jpeg — Python's mimetypes module doesn't know
# about JFIF, so StaticFiles would serve it as application/octet-stream.
# Meta and TikTok reject non-image content types, causing carousel failures.
import mimetypes
mimetypes.add_type("image/jpeg", ".jfif")

settings.content_dir.mkdir(parents=True, exist_ok=True)
app.mount("/content", StaticFiles(directory=settings.content_dir), name="content")

from .auth import router as auth_router

# ── Routes ─────────────────────────────────────────────────────────────
app.include_router(router)
app.include_router(auth_router)
app.include_router(oauth_router)
app.include_router(telegram_validation_router)
app.include_router(media_generation_router)
# Privacy + Terms pages — TikTok / LinkedIn / Meta dev portals all
# require publicly-reachable URLs. Served at /privacy and /terms so
# they're stable regardless of which deployment target is in front.
app.include_router(legal_router)


# ── TikTok domain verification ────────────────────────────────────────
# TikTok asks for a tiktok<token>.txt file at the domain root to prove
# we own it. Token comes from TIKTOK_DOMAIN_VERIFY in the env.
@app.get("/tiktok{token}.txt", response_class=PlainTextResponse)
async def tiktok_root_verify(token: str) -> str:
    expected = os.environ.get("TIKTOK_DOMAIN_VERIFY", "").strip()
    if not expected or token != expected:
        raise HTTPException(404)
    return f"tiktok-developers-site-verification={token}"


# ── Lifecycle ──────────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup() -> None:
    # Schema bootstrap — runs the CREATE TABLE IF NOT EXISTS up front
    # with retry/backoff so a Postgres still booting in the next
    # container doesn't crash the API.
    from .db import init_db
    init_db()
    # Pull any UI-edited API keys / models from runtime_settings.json
    # into the live settings object so the running process picks them
    # up without a container rebuild.
    from .runtime_config import apply_overrides_to_settings
    apply_overrides_to_settings()
    # The free ngrok tunnel exposes the API publicly with no auth, so it
    # only starts when explicitly enabled (e.g. for Instagram publishing).
    if settings.tunnel_enabled:
        from .tunnel import start_ngrok
        threading.Thread(target=start_ngrok, daemon=True).start()
    else:
        print("[tunnel] disabled (set TUNNEL_ENABLED=true to enable)")
    # Scheduler is what turns a "scheduled" Post into a real publish call
    # at its scheduledDate + time. Async startup gives it the live loop.
    from .scheduler import start_scheduler
    start_scheduler()
    # Automation worker = Phase 2 of the automation module. Scans rules,
    # generates candidates ahead of their fire time, submits to Telegram.
    # Approve-handler downstream flips them to status="scheduled" so the
    # scheduler above picks them up like any other scheduled post.
    from .automation_worker import start_automation_worker
    start_automation_worker()
    # Video jobs worker — picks up queued LTX / fallback video jobs and
    # polls Replicate until done. Cheap to keep running (5s tick, no-op
    # when the queue is empty).
    from .video_jobs import start_video_worker
    start_video_worker()

@app.on_event("shutdown")
async def on_shutdown() -> None:
    stop_scheduler()
    from .automation_worker import stop_automation_worker
    stop_automation_worker()
    from .video_jobs import stop_video_worker
    stop_video_worker()
