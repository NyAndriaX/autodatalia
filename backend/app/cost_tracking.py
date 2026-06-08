"""Persistent per-call cost tracking for the dashboard."""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from typing import Any

from .db import (
    delete_collection_document,
    list_collection_documents,
    upsert_collection_document,
)

_PRICING_USD_PER_1K: dict[str, tuple[float, float]] = {
    "google/gemini-2.0-flash-lite-001": (0.000075, 0.0003),
    "google/gemini-flash-1.5-8b": (0.0000375, 0.00015),
    "openai/gpt-4o-mini": (0.00015, 0.0006),
    "anthropic/claude-3-haiku": (0.00025, 0.00125),
    "meta-llama/llama-3.1-8b-instruct": (0.00005, 0.00005),
    "mistralai/mistral-7b-instruct": (0.00007, 0.00007),
    "google/gemini-2.0-flash-001": (0.000075, 0.0003),
    "google/gemini-pro-1.5": (0.00125, 0.005),
    "openai/gpt-4o": (0.0025, 0.01),
    "anthropic/claude-3.5-sonnet": (0.003, 0.015),
    "openai/gpt-4-turbo": (0.01, 0.03),
    "anthropic/claude-3-opus": (0.015, 0.075),
    "anthropic/claude-sonnet-4-5": (0.003, 0.015),
    "anthropic/claude-opus-4-1": (0.015, 0.075),
}

_DEFAULT_PRICE = (0.0005, 0.0015)
_USD_TO_EUR = 0.92
MAX_LOGS = 5000


def price_for_model(model: str) -> tuple[float, float, bool]:
    if model in _PRICING_USD_PER_1K:
        p, c = _PRICING_USD_PER_1K[model]
        return p, c, True
    return _DEFAULT_PRICE[0], _DEFAULT_PRICE[1], False


def usd_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    p, c, _ = price_for_model(model)
    return (prompt_tokens / 1000.0) * p + (completion_tokens / 1000.0) * c


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
    _persist_row(row)
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
    _persist_row(row)
    return row


def list_logs(
    limit: int = 200,
    *,
    user_id: str | int | None = None,
    all_users: bool = False,
) -> list[dict[str, Any]]:
    return list_collection_documents(
        "cost_logs",
        user_id=user_id,
        all_scopes=all_users,
        newest_first=True,
        limit=max(1, limit),
    )


def summarize(
    period_seconds: float | None = None,
    *,
    user_id: str | int | None = None,
    all_users: bool = False,
) -> dict[str, Any]:
    cutoff = (time.time() - period_seconds) if period_seconds else 0
    in_window = [
        r
        for r in list_logs(MAX_LOGS, user_id=user_id, all_users=all_users)
        if r.get("ts", 0) >= cutoff
    ]
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
        for row in in_window:
            label = row.get(key) or "(unknown)"
            group = groups[label]
            group["calls"] += 0 if row.get("cached") else 1
            group["tokens"] += row.get("total_tokens", 0)
            group["cost_usd"] += row.get("cost_usd", 0.0)
        rows = [
            {
                "key": name,
                **{
                    metric: round(value, 6) if isinstance(value, float) else value
                    for metric, value in payload.items()
                },
            }
            for name, payload in groups.items()
        ]
        rows.sort(key=lambda row: row["cost_usd"], reverse=True)
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


def _persist_row(row: dict[str, Any]) -> None:
    upsert_collection_document(
        "cost_logs",
        row["id"],
        row,
        user_id=row.get("user_id"),
        sort_ts=row["ts"],
    )
    _trim_logs()


def _trim_logs() -> None:
    items = list_collection_documents(
        "cost_logs", all_scopes=True, newest_first=True, limit=MAX_LOGS + 200
    )
    for row in items[MAX_LOGS:]:
        doc_id = row.get("id")
        if not doc_id:
            continue
        delete_collection_document("cost_logs", str(doc_id), user_id=row.get("user_id"))
