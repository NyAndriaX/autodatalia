"""Pydantic request / response schemas."""

from pydantic import BaseModel, Field


class CaptionRequest(BaseModel):
    """Body for POST /captions/generate."""

    limit: int | None = Field(default=None, ge=1)
    save_results: bool = False
    include_images_to_ai: bool | None = None


class GenerateRequest(BaseModel):
    """Body for POST /generate (prompt-driven content generation)."""

    prompt: str = ""
    platforms: dict[str, bool] | None = None
    template: str | None = None
    # One variant by default — extra alternatives are opt-in (≈Nx output cost).
    variants: int = Field(default=1, ge=1, le=5)


class GenerateVariant(BaseModel):
    """One generated caption variant (matches the frontend aiService shape)."""

    id: int
    text: str
    tone: str = ""


class TokenUsage(BaseModel):
    """Token accounting for the dashboard's spend meter (0 on a cache hit)."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class GenerateResponse(BaseModel):
    """Response for POST /generate."""

    variants: list[GenerateVariant]
    usage: TokenUsage = TokenUsage()


class TransformRequest(BaseModel):
    """Body for POST /transform (quick AI actions on existing content)."""

    content: str
    action: str  # shorten | expand | tone-casual | tone-pro


class TransformResponse(BaseModel):
    """Response for POST /transform."""

    text: str
    usage: TokenUsage = TokenUsage()  # 0 on a cache hit


class UploadResponse(BaseModel):
    """Response for POST /upload (matches frontend uploadService)."""

    url: str
    filename: str
    kind: str  # image | video
    status: str = "uploaded"


class SearchResult(BaseModel):
    """One search hit (matches frontend searchService shape)."""

    id: str
    type: str  # post | template | media
    title: str
    subtitle: str = ""


class SearchResponse(BaseModel):
    """Response for GET /search."""

    results: list[SearchResult]


class ContentItem(BaseModel):
    """Single item returned in caption responses."""

    filename: str
    relative_path: str
    description: str
    image_url: str
    image_base64: str
    instagram_caption: str
    tiktok_caption: str
