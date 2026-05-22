"""Caption API — FastAPI application entrypoint."""

import os
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .oauth import router as oauth_router
from .routes import router
from .scheduler import start_scheduler, stop_scheduler
from .tunnel import start_cloudflared

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
settings.content_dir.mkdir(parents=True, exist_ok=True)
app.mount("/content", StaticFiles(directory=settings.content_dir), name="content")

# ── Routes ─────────────────────────────────────────────────────────────
app.include_router(router)
app.include_router(oauth_router)


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
    # The free quick-tunnel exposes the API publicly with no auth, so it
    # only starts when explicitly enabled (e.g. for Instagram publishing).
    if settings.tunnel_enabled:
        threading.Thread(target=start_cloudflared, daemon=True).start()
    else:
        print("[tunnel] disabled (set TUNNEL_ENABLED=true to enable)")
    # Scheduler is what turns a "scheduled" Post into a real publish call
    # at its scheduledDate + time. Async startup gives it the live loop.
    start_scheduler()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    stop_scheduler()
