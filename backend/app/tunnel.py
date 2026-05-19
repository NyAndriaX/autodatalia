"""Cloudflared tunnel management.

Starts a free Cloudflare Quick Tunnel in the background so images
can be served via a public URL (required by the Instagram Graph API).
"""

import asyncio
import re
import subprocess
import threading

TUNNEL_URL: str | None = None
_tunnel_ready = threading.Event()


def start_cloudflared() -> None:
    """Launch cloudflared and capture the generated tunnel URL."""
    global TUNNEL_URL
    print("[tunnel] Starting cloudflared...")
    try:
        process = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", "http://127.0.0.1:8000"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        for line in iter(process.stdout.readline, ""):
            print(f"[tunnel] {line.strip()}")
            if "trycloudflare.com" in line:
                match = re.search(
                    r"(https://[a-zA-Z0-9-]+\.trycloudflare\.com)", line
                )
                if match:
                    TUNNEL_URL = match.group(1)
                    _tunnel_ready.set()
                    print(f"[tunnel] *** Public URL: {TUNNEL_URL} ***")
    except Exception as exc:
        print(f"[tunnel] Failed to start: {exc}")
        _tunnel_ready.set()  # unblock waiters even on failure


async def wait_for_tunnel(timeout: float = 30.0) -> str | None:
    """Block (async) until the tunnel is ready or *timeout* seconds elapse."""
    if TUNNEL_URL:
        return TUNNEL_URL
    try:
        loop = asyncio.get_event_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, _tunnel_ready.wait, timeout),
            timeout=timeout + 1,
        )
    except asyncio.TimeoutError:
        print("[tunnel] Wait timed out — falling back to internal URL.")
    return TUNNEL_URL


def is_ready() -> bool:
    """Return True if the tunnel thread has finished initialising."""
    return _tunnel_ready.is_set()
