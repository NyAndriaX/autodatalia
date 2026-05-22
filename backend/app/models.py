"""Pydantic request / response schemas."""

from typing import Any

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
    # Optional: an image previously uploaded via /upload. When set, the
    # generator routes through a vision model so captions can describe what's
    # actually in the picture instead of writing blind.
    image_filename: str | None = None


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
    # Optional fields, set for `media` hits so the Library can render thumbs
    # without a second request. Omitted on non-media result types.
    kind: str | None = None  # "image" | "video"
    url: str | None = None


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


# ── Scheduled posts (calendar persistence) ──────────────────────────────
# Camel-case field names so the JSON shape matches the frontend store
# directly — no client-side mapping layer needed.


class Post(BaseModel):
    """One scheduled post as stored / returned."""

    id: str
    content: str = ""
    platforms: dict[str, bool] = {}
    status: str = "draft"
    scheduledDate: str  # YYYY-MM-DD
    time: str | None = None
    # IANA timezone (e.g. "Europe/Paris"). The scheduler interprets
    # scheduledDate + time in this zone — without it "09:00" is ambiguous.
    timezone: str | None = None
    media: list[dict] = []
    # Per-platform crop ratios, same shape /publish accepts.
    ratios: dict[str, str] | None = None
    # Filled in by the scheduler when the post fires.
    published_at: float | None = None
    publish_results: list[dict] | None = None
    error: str | None = None


class PostCreate(BaseModel):
    """Body for POST /posts. ``id`` is optional — the server fills it in."""

    id: str | None = None
    content: str = ""
    platforms: dict[str, bool] = {}
    status: str = "draft"
    scheduledDate: str
    time: str | None = None
    timezone: str | None = None
    media: list[dict] = []
    ratios: dict[str, str] | None = None


class PostUpdate(BaseModel):
    """Body for PATCH /posts/{id}. All fields optional (partial update)."""

    content: str | None = None
    platforms: dict[str, bool] | None = None
    status: str | None = None
    scheduledDate: str | None = None
    time: str | None = None
    timezone: str | None = None
    media: list[dict] | None = None
    ratios: dict[str, str] | None = None
    published_at: float | None = None
    publish_results: list[dict] | None = None
    error: str | None = None


class PostsResponse(BaseModel):
    """Response for GET /posts."""

    posts: list[Post]


# ── Publishing (real social-network posting) ────────────────────────────


class PublishTarget(BaseModel):
    """One destination in a /publish call.

    The frontend builds these from /oauth/connections — it picks which
    Pages / IG accounts the user toggled on for this specific post, then
    the backend resolves access tokens server-side (so tokens never round
    trip through the client).
    """

    platform: str  # "facebook" | "instagram" | "tiktok" | "linkedin"
    id: str        # page_id | ig_user_id | open_id | urn
    label: str | None = None  # human-readable, for the response log
    # IG only: when media_kind is "video" the publish call waits for IG
    # to finish processing before publishing the container.
    media_kind: str | None = None  # "image" | "video"


class PublishRequest(BaseModel):
    """Body for POST /publish."""

    content: str = ""
    media_url: str | None = None  # public URL — required for IG
    link: str | None = None       # optional FB link share
    # Per-platform aspect ratio override ("1:1", "4:5", "9:16", "16:9", ...).
    # When present, the backend center-crops the image to that ratio before
    # sending it to the platform — the editor's ratio picker actually
    # changes what gets published, not just the preview frame.
    ratios: dict[str, str] | None = None
    targets: list[PublishTarget]


class PublishResultModel(BaseModel):
    """One row in the /publish response."""

    target_id: str
    target_label: str
    platform: str
    ok: bool
    platform_post_id: str | None = None
    permalink_url: str | None = None
    error: str | None = None
    raw: dict[str, Any] | None = None
    elapsed_ms_total: int | None = None


class PublishResponse(BaseModel):
    """Response for POST /publish."""

    results: list[PublishResultModel]
