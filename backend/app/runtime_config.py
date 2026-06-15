"""Runtime-editable settings persisted as JSON.

The Settings page lets a user rotate API keys and model ids without
editing ``infra/.env``. Overrides are stored beside the other JSON
stores on the content volume.

Lookup order for an authenticated user is:

   environment -> global runtime_settings.json -> runtime_settings_user_<id>.json

User overrides win over global ones, but users still inherit any shared
fallbacks they did not override themselves.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from fastapi import HTTPException

from .config import Settings, load_settings, settings, _resolve_jwt_secret  # noqa: F401
from .db import load_scoped_blob, save_scoped_blob
from .net_guard import assert_safe_url


# Editable keys whose value is an outbound base URL the backend will later
# fetch (with our API key attached). When a tenant SETS one of these we must
# reject private/internal targets at write time — otherwise it's an SSRF +
# credential-exfil sink (the Authorization header rides along to whatever host
# they pointed us at). Model-id / API-key keys are not URLs and are skipped.
URL_KEYS: set[str] = {
    "AI_API_BASE_URL",
    "AI_IMAGE_API_BASE_URL",
}


# Keys the Settings page is allowed to read + edit. Each entry maps the
# external env var name to the attribute name on ``settings``.
EDITABLE_KEYS: dict[str, str] = {
    # LLM (text)
    "AI_API_KEY": "ai_api_key",
    "AI_API_BASE_URL": "ai_api_base_url",
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
    # Telegram — the bot TOKEN is intentionally NOT editable: the bot is a
    # single shared instance configured only via the TELEGRAM_BOT_TOKEN env
    # var (see telegram_validation.register_webhook). Only the per-tenant
    # default chat id is editable here.
    "TELEGRAM_DEFAULT_CHAT_ID": "telegram_default_chat_id",
}


# Which keys must be masked when read back (treat the entire string as
# secret). The model-id ones do not need masking because they are not secrets.
SECRET_KEYS: set[str] = {
    "AI_API_KEY",
    "AI_IMAGE_API_KEY",
    "FAL_API_KEY",
    "LTX_API_KEY",
    "REPLICATE_API_TOKEN",
}


_ACTIVE_USER_ID: ContextVar[int | None] = ContextVar(
    "runtime_settings_active_user_id",
    default=None,
)
# Settings (AI keys/models) are WORKSPACE-scoped: there is one set of provider
# keys per workspace, set by an admin, and the automation worker bills the
# workspace. This ContextVar carries the active workspace, set by
# authz.require_workspace, and is the fallback scope for settings resolution.
_ACTIVE_WORKSPACE_ID: ContextVar[int | None] = ContextVar(
    "runtime_settings_active_workspace_id",
    default=None,
)


def _pos_int(value: int | None) -> int | None:
    if value is None:
        return None
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return None
    return normalized if normalized > 0 else None


def _normalize_user_id(user_id: int | None) -> int | None:
    # Despite the legacy name, the settings scope id is now a WORKSPACE id. When
    # no explicit scope is passed, fall back to the active workspace (NOT the
    # active user — provider keys are shared across the workspace).
    if user_id is None:
        user_id = _ACTIVE_WORKSPACE_ID.get()
    return _pos_int(user_id)


def set_active_user(user_id: int | None) -> None:
    # Retained for callers (e.g. auth.require_token); identity only, no longer
    # the settings scope.
    _ACTIVE_USER_ID.set(_pos_int(user_id))


def get_active_user() -> int | None:
    return _pos_int(_ACTIVE_USER_ID.get())


def set_active_workspace(workspace_id: int | None) -> None:
    _ACTIVE_WORKSPACE_ID.set(_pos_int(workspace_id))


def get_active_workspace() -> int | None:
    return _pos_int(_ACTIVE_WORKSPACE_ID.get())


def _normalize_overrides(values: dict[str, str]) -> dict[str, str]:
    current = {
        key: str(value).strip()
        for key, value in (values or {}).items()
        if key in EDITABLE_KEYS and value not in (None, "")
    }

    # Auto-wrap for Google AI Studio image keys.
    if current.get("AI_IMAGE_API_KEY", "").startswith(("AIzaSy", "AQ.")):
        current_base = current.get("AI_IMAGE_API_BASE_URL", "")
        if not current_base or "openrouter.ai" in current_base:
            current["AI_IMAGE_API_BASE_URL"] = (
                "https://generativelanguage.googleapis.com/v1beta/openai"
            )
        current_model = current.get("AI_IMAGE_MODEL", "")
        if not current_model or "gemini" not in current_model.lower():
            current["AI_IMAGE_MODEL"] = "gemini-2.5-flash-image"
    else:
        if (
            current.get("AI_IMAGE_API_BASE_URL")
            == "https://generativelanguage.googleapis.com/v1beta/openai"
        ):
            current.pop("AI_IMAGE_API_BASE_URL", None)
        if current.get("AI_IMAGE_MODEL") == "gemini-2.5-flash-image":
            current.pop("AI_IMAGE_MODEL", None)

    # Auto-wrap for Google AI Studio text keys.
    if current.get("AI_API_KEY", "").startswith(("AIzaSy", "AQ.")):
        current_base = current.get("AI_API_BASE_URL", "")
        if not current_base or "openrouter.ai" in current_base:
            current["AI_API_BASE_URL"] = (
                "https://generativelanguage.googleapis.com/v1beta/openai"
            )

        current_model = current.get("AI_MODEL", "")
        if (
            not current_model
            or "gemini" not in current_model.lower()
            or "google/" in current_model
            or "-lite" in current_model
        ):
            current["AI_MODEL"] = "gemini-2.5-flash"

        current_fast = current.get("AI_MODEL_FAST", "")
        if (
            not current_fast
            or "gemini" not in current_fast.lower()
            or "google/" in current_fast
            or "-lite" in current_fast
        ):
            current["AI_MODEL_FAST"] = "gemini-2.5-flash"

        current_premium = current.get("AI_MODEL_PREMIUM", "")
        if (
            not current_premium
            or "gemini" not in current_premium.lower()
            or "google/" in current_premium
            or "-lite" in current_premium
        ):
            current["AI_MODEL_PREMIUM"] = "gemini-2.5-pro"
    else:
        if (
            current.get("AI_API_BASE_URL")
            == "https://generativelanguage.googleapis.com/v1beta/openai"
        ):
            current.pop("AI_API_BASE_URL", None)
        if current.get("AI_MODEL") == "gemini-2.5-flash":
            current.pop("AI_MODEL", None)
        if current.get("AI_MODEL_FAST") == "gemini-2.5-flash":
            current.pop("AI_MODEL_FAST", None)
        if current.get("AI_MODEL_PREMIUM") == "gemini-2.5-pro":
            current.pop("AI_MODEL_PREMIUM", None)

    return current


def load_overrides(
    user_id: int | None = None,
    *,
    merge_global: bool = True,
) -> dict[str, str]:
    """Return persisted overrides for the active user context."""
    runtime_user_id = _normalize_user_id(user_id)
    if runtime_user_id is None:
        payload = load_scoped_blob("runtime_settings", default={}) or {}
        return _normalize_overrides(payload if isinstance(payload, dict) else {})
    if not merge_global:
        payload = load_scoped_blob("runtime_settings", user_id=runtime_user_id, default={}) or {}
        return _normalize_overrides(payload if isinstance(payload, dict) else {})
    global_payload = load_scoped_blob("runtime_settings", default={}) or {}
    user_payload = load_scoped_blob(
        "runtime_settings", user_id=runtime_user_id, default={}
    ) or {}
    merged = {
        **_normalize_overrides(global_payload if isinstance(global_payload, dict) else {}),
        **_normalize_overrides(user_payload if isinstance(user_payload, dict) else {}),
    }
    return _normalize_overrides(merged)


def save_overrides(
    updates: dict[str, str],
    *,
    user_id: int | None = None,
) -> dict[str, str]:
    """Merge ``updates`` into the scoped overrides file.

    Empty strings clear that key. Unknown keys are silently dropped so a typo
    in the request cannot smuggle in arbitrary settings.
    """
    runtime_user_id = _normalize_user_id(user_id)
    current = load_scoped_blob("runtime_settings", user_id=runtime_user_id, default={}) or {}
    if not isinstance(current, dict):
        current = {}
    for env_name, value in (updates or {}).items():
        if env_name not in EDITABLE_KEYS:
            continue
        if value is None or value == "":
            current.pop(env_name, None)
        else:
            cleaned = str(value).strip()
            # SSRF guard: a tenant-supplied outbound base URL must resolve to a
            # public host. Reject private/internal targets before persisting so
            # a poisoned override can never reach the outbound httpx callers.
            # Raised as HTTPException(400) so the /settings/keys route returns a
            # clean client error instead of a 500 (routes.py is untouched and
            # FastAPI renders HTTPException for us).
            if env_name in URL_KEYS:
                try:
                    assert_safe_url(cleaned)
                except ValueError as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{env_name} must be a public http(s) URL: {exc}",
                    ) from exc
            current[env_name] = cleaned
    current = _normalize_overrides(current)
    save_scoped_blob("runtime_settings", current, user_id=runtime_user_id)
    return current


def resolved_settings(user_id: int | None = None) -> Settings:
    """Return a fresh Settings snapshot with runtime overrides applied."""
    runtime_user_id = _normalize_user_id(user_id)
    fresh = settings.model_copy(deep=True)
    overrides = (
        load_overrides(runtime_user_id, merge_global=False)
        if runtime_user_id is not None
        else {}
    )
    for env_name, attr in EDITABLE_KEYS.items():
        if env_name in overrides:
            setattr(fresh, attr, overrides[env_name])
    return fresh


def apply_overrides_to_settings(user_id: int | None = None) -> None:
    """Hot-update the shared settings object from the chosen override scope."""
    runtime_user_id = _normalize_user_id(user_id)
    if runtime_user_id is None:
        resolved = load_settings()
        overrides = load_overrides(None, merge_global=False)
        for env_name, attr in EDITABLE_KEYS.items():
            if env_name in overrides:
                setattr(resolved, attr, overrides[env_name])
    else:
        resolved = resolved_settings(runtime_user_id)
    for env_name, attr in EDITABLE_KEYS.items():
        setattr(settings, attr, getattr(resolved, attr))


def _mask(value: str) -> str:
    """Return a previewable representation of a secret."""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 6}{value[-4:]}"


def snapshot_for_ui(user_id: int | None = None) -> dict[str, dict[str, Any]]:
    """Build the payload the Settings page renders."""
    resolved = resolved_settings(user_id)
    out: dict[str, dict[str, Any]] = {}
    for env_name, attr in EDITABLE_KEYS.items():
        current = getattr(resolved, attr, "") or ""
        is_secret = env_name in SECRET_KEYS
        out[env_name] = {
            "set": bool(current),
            "masked": _mask(current) if is_secret else "",
            "value": "" if is_secret else current,
            "secret": is_secret,
        }
    return out
