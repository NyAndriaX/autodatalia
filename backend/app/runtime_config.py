"""Runtime-editable settings persisted as JSON.

The Settings page lets the team rotate API keys / model ids without
SSH-ing into the VM and editing ``infra/.env``. Edits land here in
``runtime_settings.json`` next to the other JSON stores on the content
volume. Lookup order at boot:

   environment variable  →  runtime_settings.json  →  hardcoded default

…meaning a key set both in env and via the UI uses the UI value. After
PATCH /settings/keys we also hot-update the live ``settings`` object so
modules that already imported it pick up the new value without a
container restart.

Only a hand-picked allowlist is editable — random env vars (like the
Postgres connection string) would brick the app if mistyped.
"""

from __future__ import annotations

import json
from typing import Any

from .config import settings, _resolve_jwt_secret  # noqa: F401
from .services import atomic_write_text


# Keys the Settings page is allowed to read + edit. Each entry maps the
# external env var name to the attribute name on ``settings``.
EDITABLE_KEYS: dict[str, str] = {
    # LLM (text)
    "AI_API_KEY": "ai_api_key",
    "AI_MODEL": "ai_model",
    "AI_MODEL_FAST": "ai_model_fast",
    "AI_MODEL_PREMIUM": "ai_model_premium",
    # AI image
    "AI_IMAGE_API_KEY": "ai_image_api_key",
    "AI_IMAGE_API_BASE_URL": "ai_image_api_base_url",
    "AI_IMAGE_MODEL": "ai_image_model",
    # Video providers
    "FAL_API_KEY": "fal_api_key",
    "FAL_VIDEO_MODEL": "fal_video_model",
    "LTX_API_KEY": "ltx_api_key",
    "LTX_VIDEO_MODEL": "ltx_video_model",
    "REPLICATE_API_TOKEN": "replicate_api_token",
    "REPLICATE_VIDEO_MODEL": "replicate_video_model",
    "REPLICATE_VIDEO_VERSION": "replicate_video_version",
    # Telegram
    "TELEGRAM_BOT_TOKEN": "telegram_bot_token",
    "TELEGRAM_DEFAULT_CHAT_ID": "telegram_default_chat_id",
}


# Which keys must be masked when read back (treat the entire string as
# secret). The model-id ones don't need masking — they're not secrets.
SECRET_KEYS: set[str] = {
    "AI_API_KEY",
    "AI_IMAGE_API_KEY",
    "FAL_API_KEY",
    "LTX_API_KEY",
    "REPLICATE_API_TOKEN",
    "TELEGRAM_BOT_TOKEN",
}


def _overrides_path():
    return settings.content_dir / "runtime_settings.json"


def load_overrides() -> dict[str, str]:
    """Return the persisted overrides (or empty dict if none yet)."""
    try:
        return json.loads(_overrides_path().read_text(encoding="utf-8")) or {}
    except FileNotFoundError:
        return {}
    except Exception:
        # Corrupt JSON — log and start fresh rather than crash the API.
        return {}


def save_overrides(updates: dict[str, str]) -> dict[str, str]:
    """Merge ``updates`` into the overrides file. Empty strings clear
    that key. Unknown keys are silently dropped — defense in depth so
    a typo in the request doesn't smuggle in arbitrary settings."""
    current = load_overrides()
    for env_name, value in (updates or {}).items():
        if env_name not in EDITABLE_KEYS:
            continue
        if value is None or value == "":
            current.pop(env_name, None)
        else:
            current[env_name] = value.strip()
    atomic_write_text(_overrides_path(), json.dumps(current, indent=2))
    return current


def apply_overrides_to_settings() -> None:
    """Push the overrides into the live ``settings`` object so every
    module that already imported it picks up the new values without a
    container restart. Safe to call repeatedly."""
    overrides = load_overrides()
    for env_name, attr in EDITABLE_KEYS.items():
        if env_name in overrides:
            setattr(settings, attr, overrides[env_name])


def _mask(value: str) -> str:
    """Return a previewable representation of a secret: empty if unset,
    otherwise ``XXXX…last4`` so the user can recognise the key without
    seeing the whole thing."""
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return f"{value[:4]}{'•' * 6}{value[-4:]}"


def snapshot_for_ui() -> dict[str, dict[str, Any]]:
    """Build the payload the Settings page renders.

    Returns ``{env_name: {set: bool, masked: "...", value: ...}}``. For
    non-secret keys (like AI_MODEL) the full value is returned in
    ``value``; secrets only ever expose ``masked``."""
    out: dict[str, dict[str, Any]] = {}
    for env_name, attr in EDITABLE_KEYS.items():
        current = getattr(settings, attr, "") or ""
        is_secret = env_name in SECRET_KEYS
        out[env_name] = {
            "set": bool(current),
            "masked": _mask(current) if is_secret else "",
            "value": "" if is_secret else current,
            "secret": is_secret,
        }
    return out
