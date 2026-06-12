"""Public URL helper for local and production media callbacks.

This module no longer starts a bundled tunnel provider. If a public URL is
needed, configure it explicitly via PUBLIC_BASE_URL or OAUTH_REDIRECT_BASE.
The legacy function names stay in place so the rest of the app does not need
to change.
"""

from __future__ import annotations

import asyncio
import os
import threading


TUNNEL_URL: str | None = None
_tunnel_ready = threading.Event()
_tunnel_started = False


def _configured_public_url() -> str | None:
    for name in ("PUBLIC_BASE_URL", "OAUTH_REDIRECT_BASE"):
        value = (os.environ.get(name) or "").strip().rstrip("/")
        if value:
            return value
    return None


def start_tunnel() -> None:
    """Publish the explicitly-configured public URL to the app runtime.

    When TUNNEL_ENABLED=true we now just expose the explicitly-configured
    public URL if one exists; we do not spawn a tunnel client inside the
    backend container anymore.
    """
    global TUNNEL_URL, _tunnel_started
    _tunnel_started = True
    TUNNEL_URL = _configured_public_url()
    if TUNNEL_URL:
        print(f"[tunnel] using configured public URL: {TUNNEL_URL}")
    else:
        print(
            "[tunnel] TUNNEL_ENABLED=true but no bundled tunnel provider is configured. "
            "Set PUBLIC_BASE_URL or OAUTH_REDIRECT_BASE explicitly."
        )
    _tunnel_ready.set()


async def wait_for_tunnel(timeout: float = 30.0) -> str | None:
    """Return the configured public URL when available.

    Production deployments with a real domain do not need any local tunnel
    process, so an explicit PUBLIC_BASE_URL/OAUTH_REDIRECT_BASE wins
    immediately even when TUNNEL_ENABLED=false.
    """
    configured = _configured_public_url()
    if configured:
        return configured
    if TUNNEL_URL:
        return TUNNEL_URL
    if not _tunnel_started:
        return None
    try:
        loop = asyncio.get_event_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, _tunnel_ready.wait, timeout),
            timeout=timeout + 1,
        )
    except asyncio.TimeoutError:
        print("[tunnel] wait timed out; falling back to internal URL.")
    return TUNNEL_URL


def is_ready() -> bool:
    """Return True if the helper finished initialising."""
    return _tunnel_ready.is_set()
