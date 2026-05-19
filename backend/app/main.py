"""Caption API — FastAPI application entrypoint."""

import threading

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes import router
from .tunnel import start_cloudflared

app = FastAPI(title="Caption API", version="1.0.0")

# ── Static files ───────────────────────────────────────────────────────
settings.content_dir.mkdir(parents=True, exist_ok=True)
app.mount("/content", StaticFiles(directory=settings.content_dir), name="content")

# ── Routes ─────────────────────────────────────────────────────────────
app.include_router(router)


# ── Lifecycle ──────────────────────────────────────────────────────────
@app.on_event("startup")
def on_startup() -> None:
    threading.Thread(target=start_cloudflared, daemon=True).start()
