"""Application settings loaded from environment variables."""

import os
from pathlib import Path

from pydantic import BaseModel


class Settings(BaseModel):
    """Runtime configuration for the Caption API."""

    content_dir: Path
    ai_api_base_url: str
    ai_api_key: str
    ai_model: str
    ai_include_images: bool


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
        ai_include_images=os.getenv("AI_INCLUDE_IMAGES", "true").lower()
        in {"1", "true", "yes", "on"},
    )


settings = load_settings()
