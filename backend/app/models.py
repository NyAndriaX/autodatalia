"""Pydantic request / response schemas."""

from pydantic import BaseModel, Field


class CaptionRequest(BaseModel):
    """Body for POST /captions/generate."""

    limit: int | None = Field(default=None, ge=1)
    save_results: bool = False
    include_images_to_ai: bool | None = None


class ContentItem(BaseModel):
    """Single item returned in caption responses."""

    filename: str
    relative_path: str
    description: str
    image_url: str
    image_base64: str
    instagram_caption: str
    tiktok_caption: str
