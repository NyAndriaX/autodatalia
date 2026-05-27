"""Ngrok tunnel management.

Starts a free ngrok tunnel in the background so images
can be served via a public URL (required by the Instagram Graph API).
"""

import asyncio
import re
import subprocess
import threading
import httpx
import time
import os

TUNNEL_URL: str | None = None
_tunnel_ready = threading.Event()
_tunnel_started = False  # set True only when start_ngrok() is launched


def start_ngrok() -> None:
    """Launch ngrok and capture the generated tunnel URL."""
    global TUNNEL_URL, _tunnel_started
    _tunnel_started = True
    print("[tunnel] Starting ngrok...")
    try:
        domain_arg = []
        domain = os.environ.get("NGROK_DOMAIN")
        if domain:
            domain_arg = ["--domain", domain]
            
        process = subprocess.Popen(
            ["ngrok", "http", "8000"] + domain_arg,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        
        # Poll the local ngrok API to get the public URL
        for _ in range(10):
            time.sleep(1)
            try:
                r = httpx.get("http://127.0.0.1:4040/api/tunnels", timeout=2.0)
                if r.status_code == 200:
                    tunnels = r.json().get("tunnels", [])
                    for t in tunnels:
                        if t.get("public_url", "").startswith("https://"):
                            TUNNEL_URL = t["public_url"]
                            _tunnel_ready.set()
                            print(f"[tunnel] *** Public URL: {TUNNEL_URL} ***")
                            return
            except Exception:
                pass
                
        print("[tunnel] Failed to get ngrok URL from local API")
        _tunnel_ready.set()
    except Exception as exc:
        print(f"[tunnel] Failed to start ngrok: {exc}")
        _tunnel_ready.set()  # unblock waiters even on failure


async def wait_for_tunnel(timeout: float = 30.0) -> str | None:
    """Block (async) until the tunnel is ready or *timeout* seconds elapse.

    If the tunnel was never started (TUNNEL_ENABLED=false) this returns
    immediately — otherwise every /upload, /search etc. would block for the
    full timeout on every request, making the media library appear frozen.
    """
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
        print("[tunnel] Wait timed out — falling back to internal URL.")
    return TUNNEL_URL


def is_ready() -> bool:
    """Return True if the tunnel thread has finished initialising."""
    return _tunnel_ready.is_set()
