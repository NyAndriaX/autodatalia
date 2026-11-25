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
    # Tier hint to the LLM router. "auto" lets the backend decide based on
    # complexity heuristics (n_variants, presence of image, etc.).
    quality: str = Field(default="auto", pattern="^(auto|fast|standard|premium)$")
    # Free-form tone hint that influences caption voice (forwarded to the
    # prompt; no impact on tier selection).
    tone: str | None = None


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
    model: str | None = None
    tier: str | None = None


class HashtagsRequest(BaseModel):
    """Body for POST /hashtags."""

    content: str = Field(default="", max_length=10_000)
    max_tags: int = Field(default=8, ge=1, le=20)


class HashtagsResponse(BaseModel):
    """Response for POST /hashtags."""

    hashtags: list[str]
    usage: TokenUsage = TokenUsage()
    model: str | None = None


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
    locale: str | None = None
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
    # Automation provenance — set when the automation worker generated
    # this post from a rule. Calendar/bell views use these to render the
    # candidate distinctly and to skip duplicate fires.
    source_rule_id: str | None = None
    source_rule_name: str | None = None
    source_rule_updated_at: float | None = None
    scheduled_for: float | None = None


class PostCreate(BaseModel):
    """Body for POST /posts. ``id`` is optional — the server fills it in."""

    id: str | None = None
    content: str = ""
    platforms: dict[str, bool] = {}
    status: str = "draft"
    scheduledDate: str
    time: str | None = None
    locale: str | None = None
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
    locale: str | None = None
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
    id: str        # page_id | ig_user_id | open_id | urn | zernio account id
    label: str | None = None  # human-readable, for the response log
    # Which backend publishes this target. None/"direct" → the per-platform
    # handlers in publish.py; "zernio" → routed through the Zernio unified API
    # (zernio.py). The frontend tags each target from /oauth/connections.
    provider: str | None = None
    # IG only: when media_kind is "video" the publish call waits for IG
    # to finish processing before publishing the container.
    media_kind: str | None = None  # "image" | "video"
    # Optional per-target media override. When set, takes precedence over
    # the top-level PublishRequest.media_url for THIS target only — so the
    # frontend can send an image URL to Facebook and a video URL to TikTok
    # in the same publish call.
    media_url: str | None = None
    media_urls: list[str] | None = None


class TikTokOptions(BaseModel):
    """Per-publish TikTok flags the compose UI surfaces.

    These map to the fields TikTok's audit reviewers verify the editor
    exposes (visibility, disclose-branded toggles, music consent) before
    they'll grant `video.publish`.
    """

    privacy_level: str = "SELF_ONLY"  # PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | FOLLOWER_OF_CREATOR | SELF_ONLY
    disclose_video_branded: bool = False
    disclose_video_your_brand: bool = False
    # The frontend sets `music_confirmed` purely as a gate for the
    # Publish button; we don't forward it to TikTok (they don't accept
    # a field by that name), but we record it on /publish so the audit
    # trail shows the user ticked the consent.
    music_confirmed: bool = False
    # "direct" goes straight to the user's TikTok profile (no inbox draft
    # step). Requires `video.publish` in the OAuth scopes — set
    # TIKTOK_SCOPES="user.info.basic,video.upload,video.publish" and
    # reconnect TikTok if you switch from inbox to direct.
    audit_mode: str = "direct"  # "inbox" | "direct"
    # "file" (default, safe) or "pull". FILE_UPLOAD reads the file from
    # disk and PUTs bytes to TikTok's upload_url — no URL verification
    # needed. PULL_FROM_URL hands TikTok a public URL; requires the host
    # prefix to be pre-verified in the TikTok Developer Portal.
    upload_mode: str | None = None  # "file" | "pull" | None (env default)


class PublishRequest(BaseModel):
    """Body for POST /publish."""

    content: str = ""
    media_url: str | None = None  # public URL — required for IG
    media_urls: list[str] | None = None
    link: str | None = None       # optional FB link share
    locale: str | None = None
    # Per-platform aspect ratio override ("1:1", "4:5", "9:16", "16:9", ...).
    # When present, the backend center-crops the image to that ratio before
    # sending it to the platform — the editor's ratio picker actually
    # changes what gets published, not just the preview frame.
    ratios: dict[str, str] | None = None
    targets: list[PublishTarget]
    # TikTok-specific compose flags (visibility, branded toggles, music
    # confirmation). Optional — defaults match what the audit checklist
    # wants when not specified.
    tiktok: TikTokOptions | None = None


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


class ValidationSubmitRequest(BaseModel):
    """Body for POST /validation/submit."""

    post_id: str | None = None
    content: str = ""
    platforms: dict[str, bool] = {}
    scheduledDate: str | None = None
    time: str | None = None
    locale: str | None = None
    timezone: str | None = None
    media: list[dict[str, Any]] = []
    ratios: dict[str, str] | None = None
    tiktok: dict[str, Any] | None = None
    chat_id: str | None = None


class ValidationSubmitResponse(BaseModel):
    """Response for POST /validation/submit."""

    post_id: str
    status: str
    telegram_sent: bool
    chat_id: str | None = None
    message_id: int | None = None


class TelegramStatusResponse(BaseModel):
    """Response for GET /telegram/status."""

    configured: bool
    default_chat_configured: bool
    webhook_secret_configured: bool


class GeneratedMediaResponse(BaseModel):
    """Response for backend-generated image/video assets."""

    url: str
    filename: str
    kind: str
    status: str = "uploaded"
    provider: str
    prompt: str


class ImageGenerationRequest(BaseModel):
    """Body for POST /media/generate/image."""

    prompt: str = Field(min_length=1, max_length=2000)
    ratio: str = "1:1"


class VideoGenerationRequest(BaseModel):
    """Body for POST /media/generate/video.

    `provider` lets the caller force a backend ("fal", "openrouter",
    "ltx", "replicate", "fallback").
    Omitted ⇒ backend picks the first available based on env config.
    """

    prompt: str = Field(min_length=1, max_length=2000)
    ratio: str = "9:16"
    duration_seconds: int = Field(default=6, ge=3, le=15)
    # Optional reference image to animate (filename in content/). When
    # set, image-to-video providers will use it as the first frame.
    image_filename: str | None = None
    provider: str | None = None
    # Optional model override for the chosen provider (e.g. a fal.ai or
    # OpenRouter model id returned by /video-models).
    model_id: str | None = None
    # Backward-compatible alias kept so older frontends keep working.
    fal_model: str | None = None
    # ``standard`` / ``master`` / ``pro`` — interpreted by the model spec.
    quality: str | None = None
    # ``text`` / ``image`` / ``ugc`` — the UI's intent. Recorded for
    # analytics; the runner already routes on image presence.
    mode: str | None = None
    # Async path — when true (default) the request returns immediately
    # with a job id the client polls. False keeps the legacy synchronous
    # behaviour (useful for the automation worker which runs in-process).
    async_mode: bool = True


class VideoJob(BaseModel):
    """One queued / running / finished video generation job."""

    id: str
    user_id: str | None = None
    status: str  # queued | running | succeeded | failed | cancelled
    provider: str
    model: str
    model_id: str | None = None
    fal_model: str | None = None
    quality: str | None = None
    mode: str | None = None
    prompt: str
    ratio: str
    duration_seconds: int
    image_filename: str | None = None
    created_at: float
    started_at: float | None = None
    finished_at: float | None = None
    progress: float = 0.0  # 0.0 .. 1.0
    output_url: str | None = None
    output_filename: str | None = None
    error: str | None = None
    cost_usd: float | None = None
    external_id: str | None = None  # Replicate prediction id, etc.
    # Soundtrack added to locally rendered clips: {"voice": bool, "music": bool}.
    audio: dict[str, bool] | None = None


class VideoJobsResponse(BaseModel):
    """Response for GET /video-jobs."""

    jobs: list[VideoJob]


class VideoModelFeatures(BaseModel):
    """Which controls the UI should expose for a given video model."""

    image_to_video: bool = False
    audio: bool = False
    max_duration_seconds: int = 10
    supports_ugc: bool = False
    supported_aspect_ratios: list[str] = []


class VideoModel(BaseModel):
    """One entry in the /video-models catalogue."""

    id: str
    label: str
    provider: str
    cost_per_second_usd: float
    features: VideoModelFeatures
    endpoints: list[str] = []


class VideoModelsResponse(BaseModel):
    """Response for GET /video-models."""

    models: list[VideoModel]
    default: str


class SettingsKeyEntry(BaseModel):
    """One row in the editable-settings UI."""

    set: bool = False
    masked: str = ""
    value: str = ""
    secret: bool = True


class SettingsKeysResponse(BaseModel):
    """GET /settings/keys — current state of every editable setting."""

    keys: dict[str, SettingsKeyEntry]


class SettingsKeysUpdateRequest(BaseModel):
    """PATCH /settings/keys body. Map of env var name → new value.

    Empty strings clear that key. Keys not in EDITABLE_KEYS (server-side
    allowlist) are silently dropped — see runtime_config.py.
    """

    updates: dict[str, str]


# ── Cost dashboard ─────────────────────────────────────────────────────


class CostBucket(BaseModel):
    """One row in a /costs/summary breakdown (per workflow/tier/model/user)."""

    key: str
    calls: int = 0
    tokens: int = 0
    cost_usd: float = 0.0


class CostTotals(BaseModel):
    """Roll-up totals for the cost summary's window."""

    calls: int = 0
    cache_hits: int = 0
    tokens: int = 0
    cost_usd: float = 0.0
    cost_eur: float = 0.0
    saved_by_cache_usd: float = 0.0


class CostSummary(BaseModel):
    """Response for GET /costs/summary."""

    period_seconds: float | None = None
    totals: CostTotals = CostTotals()
    by_workflow: list[CostBucket] = []
    by_tier: list[CostBucket] = []
    by_model: list[CostBucket] = []
    by_user: list[CostBucket] = []


class CostLogEntry(BaseModel):
    """One row in the persistent cost log."""

    id: str
    ts: float
    user_id: str | None = None
    workflow: str
    tier: str
    model: str
    provider: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    cost_eur: float
    cached: bool = False
    price_exact: bool = True
    kind: str | None = None


class CostLogResponse(BaseModel):
    """Response for GET /costs/log."""

    entries: list[CostLogEntry]


# ── Automation rules ──────────────────────────────────────────────────
# A rule describes "what + when" for autonomous content generation. The
# Phase 2 worker scans active rules, generates a candidate Post when each
# rule's next fire-time minus its validation_lead_minutes ≤ now, and gates
# the publish behind Telegram approval. The rule itself doesn't publish —
# it only seeds Posts in `awaiting_validation` status.


class NumMediaSpec(BaseModel):
    """How many media items to generate per fire.

    Two modes: `fixed` (always N) or `range` (AI picks within [min,max]).
    `count` is used in fixed mode; `min`/`max` in range mode.
    """

    mode: str = Field(default="fixed", pattern="^(fixed|range)$")
    count: int = Field(default=1, ge=1, le=10)
    min: int = Field(default=2, ge=1, le=10)
    max: int = Field(default=4, ge=1, le=10)


class AutomationSchedule(BaseModel):
    """When the rule fires. The worker resolves these into absolute times
    in the rule's timezone, then compares against now() per tick."""

    frequency: str = Field(
        default="daily", pattern="^(daily|weekdays|weekly|monthly|custom)$"
    )
    times: list[str] = Field(default_factory=lambda: ["10:00"])
    # 0=Mon … 6=Sun. Used when frequency ∈ {weekdays, weekly}.
    weekdays: list[int] | None = None
    # 1–31. Used when frequency == "monthly".
    month_days: list[int] | None = None
    timezone: str | None = None


class AutomationRule(BaseModel):
    """A single content-automation rule. Persisted to automation_rules.json."""

    id: str | None = None
    user_id: str | None = None
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    created_at: float | None = None
    updated_at: float | None = None
    last_fire_at: float | None = None
    last_error: str | None = None

    # Content shape
    content_type: str = Field(
        default="photo", pattern="^(photo|video|carousel|template|text)$"
    )
    template_id: str | None = None
    num_media: NumMediaSpec = Field(default_factory=NumMediaSpec)

    # Generation context — feeds the AI prompt
    domain: str = ""
    target_audience: str = ""
    tone: str = ""
    objective: str = Field(
        default="informative",
        pattern="^(informative|promotional|engagement|acquisition)$",
    )
    description_style: str = ""
    extra_brief: str = ""

    # Schedule
    schedule: AutomationSchedule = Field(default_factory=AutomationSchedule)

    # Validation
    validation_lead_minutes: int = Field(default=30, ge=1, le=24 * 60)
    validation_chat_id: str | None = None
    locale: str | None = None

    # Publication target — same shape as Post.platforms
    platforms: dict[str, bool] = Field(default_factory=dict)
    ratios: dict[str, str] | None = None
    tiktok: TikTokOptions | None = None


class AutomationRulesResponse(BaseModel):
    """Response for GET /automation-rules."""

    rules: list[AutomationRule]
