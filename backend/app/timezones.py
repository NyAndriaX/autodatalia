"""Timezone helpers shared by scheduler and automation workers."""

from __future__ import annotations

import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TZ_FALLBACK = "Europe/Paris"


def get_default_timezone_name() -> str:
    """Return the configured default IANA timezone."""
    return (
        os.environ.get("DATALIA_DEFAULT_TZ")
        or os.environ.get("DEFAULT_TIMEZONE")
        or DEFAULT_TZ_FALLBACK
    )


def resolve_zoneinfo(name: str | None) -> ZoneInfo:
    """Resolve an IANA timezone, falling back to the configured default."""
    default_name = get_default_timezone_name()
    try:
        return ZoneInfo(name or default_name)
    except ZoneInfoNotFoundError:
        try:
            return ZoneInfo(default_name)
        except ZoneInfoNotFoundError:
            return ZoneInfo("UTC")
