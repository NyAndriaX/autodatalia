"""Persistent per-call cost tracking — the backbone of the cost dashboard.

Every real (non-cached) AI call lands a row here with token counts, the
workflow it belonged to, the LLM tier used, and a calculated USD cost
based on a static pricing table. The dashboard reads aggregates from
``cost_logs.json``; the per-call detail view lists rows newest-first.

Pricing table: USD per 1k tokens (prompt/completion split). Numbers track
OpenRouter's published prices for the listed models as of 2026-05; if
the model id isn't in the table we fall back to ``_DEFAULT_PRICE`` and
flag the row so it shows up in the dashboard as "approximate".

Token cost is independent of the LLM tier label — two rules of thumb:
- ``tier`` tells the UI **why** we picked the model (Fast/Standard/Premium)
- ``cost_usd`` tells the user **what** that decision cost
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any

from .config import settings

# ── Pricing table ─────────────────────────────────────────────────────
# (prompt_per_1k_usd, completion_per_1k_usd). When a model isn't listed,
# we use _DEFAULT_PRICE which represents a typical mid-tier model so the
# dashboard never reports zero cost just because we forgot to add a row.

_PRICING_USD_PER_1K: dict[str, tuple[float, float]] = {
    # Fast tier — cheap models for hashtags, descriptions, transforms.
    "google/gemini-2.0-flash-lite-001": (0.000075, 0.0003),
    "google/gemini-flash-1.5-8b": (0.0000375, 0.00015),
    "openai/gpt-4o-mini": (0.00015, 0.0006),
    "anthropic/claude-3-haiku": (0.00025, 0.00125),
    "meta-llama/llama-3.1-8b-instruct": (0.00005, 0.00005),
    "mistralai/mistral-7b-instruct": (0.00007, 0.00007),
    # Standard tier — variant generation, post composition.
    "google/gemini-2.0-flash-001": (0.000075, 0.0003),
    "google/gemini-pro-1.5": (0.00125, 0.005),
    "openai/gpt-4o": (0.0025, 0.01),
    "anthropic/claude-3.5-sonnet": (0.003, 0.015),
    # Premium tier — flagship for the rare hard cases.
    "openai/gpt-4-turbo": (0.01, 0.03),
    "anthropic/claude-3-opus": (0.015, 0.075),
    "anthropic/claude-sonnet-4-5": (0.003, 0.015),
    "anthropic/claude-opus-4-1": (0.015, 0.075),
}

_DEFAULT_PRICE = (0.0005, 0.0015)
_USD_TO_EUR = 0.92


def price_for_model(model: str) -> tuple[float, float, bool]:
    """Return (prompt_per_1k, completion_per_1k, exact_match)."""
    if model in _PRICING_USD_PER_1K:
        p, c = _PRICING_USD_PER_1K[model]
        return p, c, True
    return _DEFAULT_PRICE[0], _DEFAULT_PRICE[1], False


def usd_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Estimated USD spent on one call given the token counts."""
    p, c, _ = price_for_model(model)
    return (prompt_tokens / 1000.0) * p + (completion_tokens / 1000.0) * c


# ── Persistence ───────────────────────────────────────────────────────
# Single JSON file, newest-first ring of MAX_LOGS entries. Same pattern
# as posts/messages so deploy stays simple — no DB required.

_LOG_FILE = settings.content_dir / "cost_logs.json"
_LOG_LOCK = threading.Lock()
MAX_LOGS = 5000


def _read_raw() -> list[dict[str, Any]]:
    try:
        data = json.loads(_LOG_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []


def _write_raw(items: list[dict[str, Any]]) -> None:
    _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    _LOG_FILE.write_text(json.dumps(items, indent=2), encoding="utf-8")


def record_call(
    *,
    workflow: str,
    tier: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    user_id: str | int | None = None,
    cached: bool = False,
    provider: str = "openrouter",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist one AI call to the cost log. Cached hits land too — with
    ``cost_usd=0`` — because the dashboard's "tokens saved" stat needs
    visibility into them.

    Returns the persisted row so the caller can echo cost data back into
    the API response (the frontend uses this to update its live meter
    without a second round-trip).
    """
    total = (prompt_tokens or 0) + (completion_tokens or 0)
    cost = 0.0 if cached else usd_cost(model, prompt_tokens, completion_tokens)
    _, _, exact = price_for_model(model)
    row = {
        "id": f"cost-{uuid.uuid4().hex[:10]}",
        "ts": time.time(),
        "user_id": str(user_id) if user_id is not None else None,
        "workflow": workflow,
        "tier": tier,
        "model": model,
        "provider": provider,
        "prompt_tokens": int(prompt_tokens or 0),
        "completion_tokens": int(completion_tokens or 0),
        "total_tokens": total,
        "cost_usd": round(cost, 6),
        "cost_eur": round(cost * _USD_TO_EUR, 6),
        "cached": bool(cached),
        "price_exact": exact,
    }
    if metadata:
        row["metadata"] = metadata
    with _LOG_LOCK:
        items = _read_raw()
        items.insert(0, row)
        del items[MAX_LOGS:]
        _write_raw(items)
    return row


def record_media_job(
    *,
    workflow: str,
    provider: str,
    model: str,
    cost_usd: float,
    user_id: str | int | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Log a media-generation cost (image/video) — providers charge per
    asset, not per token. We store the dollar cost directly and leave
    token fields zero so dashboard aggregations stay sane.
    """
    row = {
        "id": f"cost-{uuid.uuid4().hex[:10]}",
        "ts": time.time(),
        "user_id": str(user_id) if user_id is not None else None,
        "workflow": workflow,
        "tier": "media",
        "model": model,
        "provider": provider,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "cost_usd": round(float(cost_usd or 0.0), 6),
        "cost_eur": round(float(cost_usd or 0.0) * _USD_TO_EUR, 6),
        "cached": False,
        "price_exact": True,
        "kind": "media",
    }
    if metadata:
        row["metadata"] = metadata
    with _LOG_LOCK:
        items = _read_raw()
        items.insert(0, row)
        del items[MAX_LOGS:]
        _write_raw(items)
    return row


def list_logs(limit: int = 200) -> list[dict[str, Any]]:
    """Return up to `limit` recent log rows (newest first)."""
    with _LOG_LOCK:
        items = _read_raw()
    return items[: max(1, limit)]


def summarize(period_seconds: float | None = None) -> dict[str, Any]:
    """Aggregate cost by workflow, tier, model, user. Set period_seconds
    to None for all-time. Returns a JSON-safe dict.
    """
    cutoff = (time.time() - period_seconds) if period_seconds else 0
    with _LOG_LOCK:
        items = _read_raw()

    in_window = [r for r in items if r.get("ts", 0) >= cutoff]
    total_tokens = sum(r.get("total_tokens", 0) for r in in_window)
    total_cost_usd = sum(r.get("cost_usd", 0.0) for r in in_window)
    total_cost_eur = sum(r.get("cost_eur", 0.0) for r in in_window)
    call_count = sum(1 for r in in_window if not r.get("cached"))
    cache_hits = sum(1 for r in in_window if r.get("cached"))
    saved_usd = sum(
        usd_cost(r["model"], r["prompt_tokens"], r["completion_tokens"])
        for r in in_window
        if r.get("cached")
    )

    def _bucket(key: str) -> list[dict[str, Any]]:
        groups: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"calls": 0, "tokens": 0, "cost_usd": 0.0}
        )
        for r in in_window:
            label = r.get(key) or "(unknown)"
            g = groups[label]
            g["calls"] += 0 if r.get("cached") else 1
            g["tokens"] += r.get("total_tokens", 0)
            g["cost_usd"] += r.get("cost_usd", 0.0)
        rows = [
            {"key": k, **{kk: round(vv, 6) if isinstance(vv, float) else vv for kk, vv in v.items()}}
            for k, v in groups.items()
        ]
        rows.sort(key=lambda r: r["cost_usd"], reverse=True)
        return rows

    return {
        "period_seconds": period_seconds,
        "totals": {
            "calls": call_count,
            "cache_hits": cache_hits,
            "tokens": total_tokens,
            "cost_usd": round(total_cost_usd, 4),
            "cost_eur": round(total_cost_eur, 4),
            "saved_by_cache_usd": round(saved_usd, 4),
        },
        "by_workflow": _bucket("workflow"),
        "by_tier": _bucket("tier"),
        "by_model": _bucket("model"),
        "by_user": _bucket("user_id"),
    }
