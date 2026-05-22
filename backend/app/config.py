"""Application settings loaded from environment variables."""

import os
from pathlib import Path

from pydantic import BaseModel


class Settings(BaseModel):
    """Runtime configuration for the Caption API."""

    content_dir: Path
    ai_api_base_url: str
    ai_api_key: str
    # Three-tier model routing — pick the cheapest model that's good enough
    # for the task to keep operational cost down (CDC §4):
    #   ai_model_fast    : SIMPLE   — hashtags, reformulations, image
    #                      descriptions. Free-tier or sub-cent models.
    #   ai_model         : STANDARD — default for variant generation /
    #                      transforms where quality still matters.
    #   ai_model_premium : PREMIUM  — reserved for the rare complex jobs
    #                      where the cheaper models clearly fall short.
    ai_model: str
    ai_model_fast: str
    ai_model_premium: str
    ai_include_images: bool
    ai_daily_limit: int
    cors_allow_origins: list[str]
    backend_auth_token: str
    tunnel_enabled: bool


def load_settings() -> Settings:
    """Read environment variables and return a validated Settings instance."""
    content_dir = Path(os.getenv("CONTENT_DIR", "/app/content")).resolve()
    return Settings(
        content_dir=content_dir,
        ai_api_base_url=os.getenv(
            "AI_API_BASE_URL", "https://openrouter.ai/api/v1"
        ).rstrip("/"),
        ai_api_key=os.getenv("AI_API_KEY", ""),
        ai_model=os.getenv("AI_MODEL", "google/gemini-2.0-flash-lite-001"),
        # Cheap/fast model for quick actions & low-stakes calls (LLM Router
        # cost strategy). Defaults to the main model if unset.
        ai_model_fast=os.getenv(
            "AI_MODEL_FAST",
            os.getenv("AI_MODEL", "google/gemini-2.0-flash-lite-001"),
        ),
        # Premium model reserved for the rare complex jobs where the
        # default model produces obviously worse output. Defaults to the
        # standard model so unset env never escalates spend silently.
        ai_model_premium=os.getenv(
            "AI_MODEL_PREMIUM",
            os.getenv("AI_MODEL", "google/gemini-2.0-flash-lite-001"),
        ),
        # Default OFF — sending image bytes to a vision model is the single
        # most expensive input. Opt in per-request or via this env.
        ai_include_images=os.getenv("AI_INCLUDE_IMAGES", "false").lower()
        in {"1", "true", "yes", "on"},
        # Hard ceiling on real AI calls per client per day (0 = unlimited).
        ai_daily_limit=int(os.getenv("AI_DAILY_LIMIT", "200")),
        cors_allow_origins=[
            o.strip()
            for o in os.getenv(
                "CORS_ALLOW_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000",
            ).split(",")
            if o.strip()
        ],
        # When set, /generate /transform /upload /posts require
        # `Authorization: Bearer <token>`. Empty = open mode (local dev).
        backend_auth_token=os.getenv("BACKEND_AUTH_TOKEN", "").strip(),
        # Quick Cloudflare tunnel is OFF by default — it exposes the API
        # publicly with no auth. Opt in via env when IG publishing needs it.
        tunnel_enabled=os.getenv("TUNNEL_ENABLED", "false").lower()
        in {"1", "true", "yes", "on"},
    )


settings = load_settings()
