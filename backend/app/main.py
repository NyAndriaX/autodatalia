"""Caption API — FastAPI application entrypoint."""

import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes import router
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


# ── Lifecycle ──────────────────────────────────────────────────────────
@app.on_event("startup")
def on_startup() -> None:
    threading.Thread(target=start_cloudflared, daemon=True).start()
