"""Zernio unified social-publishing provider (optional, per-workspace).

Zernio (https://zernio.com/api/v1) is a unified social API: one API key + one
hosted connect flow publishes to 15 platforms with NO per-platform developer
apps. When a workspace has ``ZERNIO_API_KEY`` set (a runtime setting, see
runtime_config.EDITABLE_KEYS), its social accounts can be connected and
published through Zernio *alongside* Datalia's direct per-platform handlers.

Design:
  * One Zernio **profile per Datalia workspace** — auto-provisioned, the id
    cached in the workspace-scoped ``zernio`` blob. This gives the same tenant
    isolation the rest of the app has: a workspace only ever sees the accounts
    under its own profile.
  * **Inert when no key is configured** — ``is_enabled()`` is False and every
    entry point no-ops / returns empty, so merging this changes nothing until a
    key is set.
  * Tokens/keys never reach the browser; the frontend only sees account ids +
    labels, exactly like the direct providers.

The Zernio API base URL is read from env only (not a tenant-editable setting),
so there is no SSRF surface here — we never POST the bearer key to a
tenant-controlled host.
"""

from __future__ import annotations

import mimetypes
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from .config import settings
from .db import load_scoped_blob, save_scoped_blob
from .runtime_config import resolved_settings

LABEL = "Zernio"
_TIMEOUT = 30.0
_UPLOAD_TIMEOUT = 120.0

# Datalia platform name -> Zernio platform slug. Mostly identity; Zernio also
# supports platforms Datalia doesn't model directly (x/twitter, youtube, ...).
_PLATFORM_TO_ZERNIO: dict[str, str] = {
    "facebook": "facebook",
    "instagram": "instagram",
    "tiktok": "tiktok",
    "linkedin": "linkedin",
    "twitter": "twitter",
    "x": "twitter",
    "youtube": "youtube",
    "pinterest": "pinterest",
    "threads": "threads",
    "reddit": "reddit",
    "bluesky": "bluesky",
    "telegram": "telegram",
    "googlebusiness": "googlebusiness",
    "snapchat": "snapchat",
    "whatsapp": "whatsapp",
    "discord": "discord",
}
# Reverse map for labelling targets (skip the "x" alias so each slug has one
# canonical Datalia-facing name).
_ZERNIO_TO_PLATFORM: dict[str, str] = {
    slug: name for name, slug in _PLATFORM_TO_ZERNIO.items() if name != "x"
}

# The platforms the Settings "connect via Zernio" UI can offer.
ZERNIO_PLATFORMS: tuple[str, ...] = (
    "instagram", "tiktok", "twitter", "facebook", "linkedin", "youtube",
    "whatsapp", "threads", "pinterest", "reddit", "bluesky", "telegram",
    "googlebusiness", "snapchat", "discord",
)


class ZernioError(RuntimeError):
    """Raised when a Zernio API call fails. Carries the upstream status."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


# ── Config ───────────────────────────────────────────────────────────────

def _config(workspace_id: int | None) -> tuple[str, str]:
    """Return (api_key, base_url) resolved for the workspace.

    The key is a per-workspace runtime setting; the base URL is env-only.
    """
    resolved = resolved_settings(workspace_id)
    key = (getattr(resolved, "zernio_api_key", "") or "").strip()
    base = (getattr(resolved, "zernio_api_base_url", "") or settings.zernio_api_base_url or "").rstrip("/")
    return key, base


def is_enabled(workspace_id: int | None = None) -> bool:
    """True when this workspace has a Zernio key configured."""
    key, _ = _config(workspace_id)
    return bool(key)


# ── HTTP ─────────────────────────────────────────────────────────────────

def _headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _error_text(resp: httpx.Response) -> str:
    """Best-effort concise upstream error string (mirrors services.py)."""
    try:
        payload = resp.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            text = err.get("message") or err.get("detail") or err.get("type") or ""
            if text:
                return str(text).strip()[:240]
        for k in ("message", "detail", "error"):
            v = payload.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()[:240]
    text = (resp.text or "").strip()
    return text[:240] if text else f"Zernio HTTP {resp.status_code}"


async def _request(
    method: str,
    path: str,
    *,
    workspace_id: int | None,
    json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    key, base = _config(workspace_id)
    if not key:
        raise ZernioError("Zernio is not configured for this workspace.", status=503)
    url = f"{base}{path}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.request(method, url, headers=_headers(key), json=json)
    except httpx.HTTPError as exc:
        raise ZernioError(f"Zernio request failed: {exc}", status=502) from exc
    if resp.status_code >= 400:
        body = _error_text(resp)
        # Log the exact upstream failure so a 500/401/403 from Zernio is
        # diagnosable from the server logs (the key, profile, or platform-
        # enablement is the usual culprit), and put it in the error message so
        # it reaches the UI notification instead of a bare "API 500".
        print(f"[zernio] {method} {path} -> {resp.status_code}: {body}")
        raise ZernioError(
            f"{method} {path} -> HTTP {resp.status_code}: {body}", status=resp.status_code
        )
    try:
        data = resp.json()
    except Exception:
        data = {}
    return data if isinstance(data, dict) else {"data": data}


# ── Profile (one per workspace) ────────────────────────────────────────────

def _state(workspace_id: int | None) -> dict[str, Any]:
    blob = load_scoped_blob("zernio", user_id=workspace_id, default={}) or {}
    return blob if isinstance(blob, dict) else {}


def _save_state(workspace_id: int | None, state: dict[str, Any]) -> None:
    save_scoped_blob("zernio", state, user_id=workspace_id)


def _profile_id_of(profile: Any) -> str | None:
    if not isinstance(profile, dict):
        return None
    pid = profile.get("_id") or profile.get("id")
    return str(pid) if pid else None


async def _list_profiles(workspace_id: int | None) -> list[dict[str, Any]]:
    """All Zernio profiles under the current key (or [] if the call fails)."""
    try:
        data = await _request("GET", "/profiles", workspace_id=workspace_id)
    except ZernioError:
        return []
    profiles = data.get("profiles")
    if not isinstance(profiles, list):
        profiles = data.get("data") if isinstance(data.get("data"), list) else []
    return [p for p in profiles if isinstance(p, dict)]


async def _find_profile_by_name(workspace_id: int | None, name: str) -> dict[str, Any] | None:
    for p in await _list_profiles(workspace_id):
        if p.get("name") == name:
            return p
    return None


def _cache_profile(workspace_id: int | None, pid: str) -> None:
    state = _state(workspace_id)
    state["profile_id"] = pid
    state["profile_created_at"] = time.time()
    _save_state(workspace_id, state)


async def get_or_create_profile(workspace_id: int | None, *, name: str | None = None) -> str:
    """Return this workspace's Zernio profile id, provisioning it on first use.

    Idempotent by name: if we have no cached id but Zernio already has a profile
    with our deterministic name (a previous create succeeded but the cached id
    was lost, or two requests raced), we ADOPT that profile instead of trying to
    create a duplicate — which Zernio rejects with
    ``400 A profile with this name already exists`` and which used to surface as
    a permanent connect failure.
    """
    state = _state(workspace_id)
    pid = state.get("profile_id")
    if pid:
        return str(pid)
    desired = name or f"datalia-ws-{workspace_id or 'global'}"
    # Adopt an existing same-named profile before attempting to create one.
    existing = await _find_profile_by_name(workspace_id, desired)
    if existing and _profile_id_of(existing):
        pid = _profile_id_of(existing)
        _cache_profile(workspace_id, pid)
        return pid
    try:
        data = await _request(
            "POST", "/profiles", workspace_id=workspace_id, json={"name": desired}
        )
    except ZernioError as exc:
        # Lost the race (or a list call that briefly failed): the name now
        # exists. Re-resolve by name and adopt it rather than failing.
        if exc.status == 400 and "already exist" in str(exc).lower():
            existing = await _find_profile_by_name(workspace_id, desired)
            if existing and _profile_id_of(existing):
                pid = _profile_id_of(existing)
                _cache_profile(workspace_id, pid)
                return pid
        raise
    pid = _profile_id_of(data.get("profile") if isinstance(data.get("profile"), dict) else data)
    if not pid:
        raise ZernioError("Zernio did not return a profile id.")
    _cache_profile(workspace_id, pid)
    return pid


# ── Connect + accounts ─────────────────────────────────────────────────────

async def start_connect(workspace_id: int | None, platform: str) -> str:
    """Return the hosted authorize URL to link ``platform`` to this workspace's
    Zernio profile. The frontend pops it; Zernio handles the OAuth and links the
    account to the profile, after which it shows up in list_accounts()."""
    slug = _PLATFORM_TO_ZERNIO.get((platform or "").lower(), (platform or "").lower())
    if slug not in ZERNIO_PLATFORMS:
        raise ZernioError(f"Unsupported Zernio platform: {platform}", status=400)
    profile_id = await get_or_create_profile(workspace_id)
    try:
        data = await _request(
            "GET", f"/connect/{slug}?profileId={profile_id}", workspace_id=workspace_id
        )
    except ZernioError:
        # The cached profile may be stale — e.g. the API key was rotated, so the
        # stored profile_id belongs to a *different* Zernio account and
        # /connect?profileId=<stale> fails. Drop it, create a fresh profile under
        # the current key, and retry once. (Usual cause of a sudden 500 on /start
        # after the key was replaced.)
        state = _state(workspace_id)
        if state.get("profile_id"):
            state.pop("profile_id", None)
            state.pop("profile_created_at", None)
            _save_state(workspace_id, state)
            profile_id = await get_or_create_profile(workspace_id)
            data = await _request(
                "GET", f"/connect/{slug}?profileId={profile_id}", workspace_id=workspace_id
            )
        else:
            raise
    auth_url = data.get("authUrl") or data.get("url") or data.get("authorize_url")
    if not auth_url:
        raise ZernioError("Zernio did not return an authorize URL.")
    return str(auth_url)


async def list_accounts(workspace_id: int | None) -> list[dict[str, Any]]:
    """Raw Zernio account objects under this workspace's profile (or [])."""
    state = _state(workspace_id)
    profile_id = state.get("profile_id")
    if not profile_id:
        return []
    data = await _request(
        "GET", f"/accounts?profileId={profile_id}", workspace_id=workspace_id
    )
    accounts = data.get("accounts")
    return accounts if isinstance(accounts, list) else []


async def connections_entry(workspace_id: int | None) -> dict[str, Any]:
    """Provider entry for /oauth/connections, shaped like the direct providers.

    Targets carry ``provider: "zernio"`` so the publish path can route them
    through Zernio instead of the per-platform handlers.
    """
    key, _ = _config(workspace_id)
    entry: dict[str, Any] = {
        "id": "zernio",
        "label": LABEL,
        "configured": bool(key),
        "connected": False,
        "missing_env": [] if key else ["ZERNIO_API_KEY"],
        "targets": [],
        # Flag so the UI can render this distinctly from the direct providers
        # (CEO ask: "bien différencier connexion zernio / autres").
        "is_aggregator": True,
    }
    if not key:
        return entry
    try:
        accounts = await list_accounts(workspace_id)
    except ZernioError as exc:
        entry["error"] = str(exc)
        return entry
    for acc in accounts:
        zslug = acc.get("platform") or ""
        platform = _ZERNIO_TO_PLATFORM.get(zslug, zslug)
        acc_id = acc.get("_id") or acc.get("id")
        if not acc_id:
            continue
        label = (
            acc.get("name")
            or acc.get("username")
            or acc.get("displayName")
            or acc.get("display_name")
            or platform
        )
        entry["targets"].append(
            {
                "id": acc_id,
                "label": label,
                "kind": f"zernio_{zslug}",
                "platform": platform,
                "provider": "zernio",
                "profile_picture_url": acc.get("avatarUrl") or acc.get("profilePictureUrl"),
            }
        )
    entry["connected"] = bool(entry["targets"])
    return entry


# ── Media + publish ────────────────────────────────────────────────────────

def _local_path_for_media_url(media_url: str | None) -> Path | None:
    """Map a ``/content/...`` public URL back to a local file under content_dir,
    blocking path traversal. Returns None for foreign URLs."""
    if not media_url:
        return None
    path = urlparse(media_url).path
    marker = "/content/"
    idx = path.find(marker)
    if idx == -1:
        return None
    rel = path[idx + len(marker):]
    root = settings.content_dir.resolve()
    candidate = (root / rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


async def _presign_and_upload(workspace_id: int | None, media_url: str) -> tuple[str, str]:
    """Upload one media file to Zernio and return (publicUrl, type).

    Reads bytes from our content dir when the URL is local; otherwise fetches it
    through the SSRF guard before uploading.
    """
    local = _local_path_for_media_url(media_url)
    if local is not None:
        data = local.read_bytes()
        filename = local.name
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    else:
        from .net_guard import safe_get_async

        async with httpx.AsyncClient(timeout=_UPLOAD_TIMEOUT, follow_redirects=False) as c:
            r = await safe_get_async(c, media_url)
        data = r.content
        filename = Path(urlparse(media_url).path).name or "upload.bin"
        content_type = (
            r.headers.get("content-type")
            or mimetypes.guess_type(filename)[0]
            or "application/octet-stream"
        )

    presign = await _request(
        "POST",
        "/media/presign",
        workspace_id=workspace_id,
        json={"filename": filename, "contentType": content_type},
    )
    upload_url = presign.get("uploadUrl")
    public_url = presign.get("publicUrl")
    if not upload_url or not public_url:
        raise ZernioError("Zernio presign did not return upload/public URLs.")
    async with httpx.AsyncClient(timeout=_UPLOAD_TIMEOUT) as c:
        up = await c.put(upload_url, content=data, headers={"Content-Type": content_type})
    if up.status_code >= 400:
        raise ZernioError(
            f"Zernio media upload failed (HTTP {up.status_code}).", status=up.status_code
        )
    kind = "video" if str(content_type).startswith("video/") else "image"
    return str(public_url), kind


def _result_row(
    target: dict[str, Any],
    *,
    ok: bool,
    post_id: str | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    """A publish-result row matching publish.py's PublishResult dict shape."""
    return {
        "target_id": target["id"],
        "target_label": target.get("label") or target["id"],
        "platform": target.get("platform") or "zernio",
        "ok": ok,
        "platform_post_id": post_id,
        "permalink_url": None,
        "error": error,
        "raw": None,
    }


async def publish(
    workspace_id: int | None,
    *,
    content: str,
    targets: list[dict[str, Any]],
    media_urls: list[str] | None = None,
    schedule: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Publish to a batch of Zernio targets in one POST /posts.

    ``targets`` items are ``{id, label, platform}`` (Zernio account id + the
    Datalia-facing platform name). All targets here share the same media set —
    callers group by media before calling. Returns one result row per target.
    """
    if not targets:
        return []
    try:
        media_items: list[dict[str, str]] = []
        for url in media_urls or []:
            if not url:
                continue
            public_url, kind = await _presign_and_upload(workspace_id, url)
            media_items.append({"url": public_url, "type": kind})

        platforms = []
        for t in targets:
            slug = _PLATFORM_TO_ZERNIO.get(
                (t.get("platform") or "").lower(), (t.get("platform") or "").lower()
            )
            platforms.append({"platform": slug, "accountId": t["id"]})

        body: dict[str, Any] = {"content": content or "", "platforms": platforms}
        if media_items:
            body["mediaItems"] = media_items
        if schedule and schedule.get("scheduledFor"):
            body["scheduledFor"] = schedule["scheduledFor"]
            if schedule.get("timezone"):
                body["timezone"] = schedule["timezone"]
        else:
            body["publishNow"] = True

        data = await _request("POST", "/posts", workspace_id=workspace_id, json=body)
    except ZernioError as exc:
        return [_result_row(t, ok=False, error=str(exc)) for t in targets]

    post = data.get("post") if isinstance(data.get("post"), dict) else data
    post_id = post.get("_id") or post.get("id")
    return [_result_row(t, ok=True, post_id=str(post_id) if post_id else None) for t in targets]
