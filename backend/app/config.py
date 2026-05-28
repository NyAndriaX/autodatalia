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
    jwt_secret: str
    # Postgres connection string for the users table. Empty falls back to
    # the individual POSTGRES_* env vars in db._connect() so docker-compose
    # works without an explicit URL. Set this in prod to a managed Postgres
    # DSN (e.g. ``postgres://user:pw@host:5432/datalia``).
    database_url: str
    telegram_bot_token: str
    telegram_default_chat_id: str
    telegram_webhook_secret: str
    linkedin_api_version: str
    ai_image_api_base_url: str
    ai_image_api_key: str
    ai_image_model: str
    ai_video_api_base_url: str
    ai_video_api_key: str
    ai_video_model: str
    # Replicate-specific config — used by the LTX-Video integration in
    # video_jobs.py. When REPLICATE_API_TOKEN is set the backend creates
    # real Replicate predictions; otherwise the legacy ffmpeg fallback
    # (Ken Burns zoom on a generated still) runs.
    replicate_api_token: str
    replicate_video_model: str
    # Replicate's community-uploaded models (like LTX-Video) don't expose
    # the /models/{owner}/{name}/predictions shortcut — you have to POST
    # to /v1/predictions with a specific version hash. Paste it here from
    # the Replicate model page; the backend falls back to the model URL
    # path when this is unset (works for "official" models only).
    replicate_video_version: str
    # fal.ai — recommended free starting point for LTX-Video. Free credits
    # on signup at https://fal.ai/dashboard/keys (no card required for
    # the initial allowance).
    fal_api_key: str
    fal_video_model: str
    # Pre-computed per-second cost in USD for video runs — used to log
    # spend in the cost dashboard. Defaults to LTX-Video's published
    # price (≈$0.04/s). Override per provider if needed.
    video_cost_per_second_usd: float


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
        jwt_secret=os.getenv("JWT_SECRET", "super-secret-default-key-change-in-prod"),
        database_url=os.getenv("DATABASE_URL", "").strip(),
        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        telegram_default_chat_id=os.getenv("TELEGRAM_DEFAULT_CHAT_ID", "").strip(),
        telegram_webhook_secret=os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip(),
        linkedin_api_version=os.getenv("LINKEDIN_API_VERSION", "202603").strip(),
        ai_image_api_base_url=os.getenv(
            "AI_IMAGE_API_BASE_URL",
            os.getenv("AI_API_BASE_URL", "https://openrouter.ai/api/v1"),
        ).rstrip("/"),
        ai_image_api_key=os.getenv(
            "AI_IMAGE_API_KEY",
            os.getenv("AI_API_KEY", ""),
        ).strip(),
        ai_image_model=os.getenv("AI_IMAGE_MODEL", "").strip(),
        ai_video_api_base_url=os.getenv(
            "AI_VIDEO_API_BASE_URL",
            os.getenv("AI_API_BASE_URL", "https://openrouter.ai/api/v1"),
        ).rstrip("/"),
        ai_video_api_key=os.getenv(
            "AI_VIDEO_API_KEY",
            os.getenv("AI_API_KEY", ""),
        ).strip(),
        ai_video_model=os.getenv("AI_VIDEO_MODEL", "").strip(),
        replicate_api_token=os.getenv("REPLICATE_API_TOKEN", "").strip(),
        replicate_video_model=os.getenv(
            "REPLICATE_VIDEO_MODEL", "lightricks/ltx-video"
        ).strip(),
        replicate_video_version=os.getenv("REPLICATE_VIDEO_VERSION", "").strip(),
        fal_api_key=os.getenv("FAL_API_KEY", "").strip(),
        fal_video_model=os.getenv("FAL_VIDEO_MODEL", "fal-ai/ltx-video").strip(),
        video_cost_per_second_usd=float(
            os.getenv("VIDEO_COST_PER_SECOND_USD", "0.04")
        ),
    )

settings = load_settings()
