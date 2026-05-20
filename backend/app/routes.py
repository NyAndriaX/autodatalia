"""FastAPI route handlers."""

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from . import tunnel
from .auth import require_token
from .models import (
    CaptionRequest,
    ContentItem,
    GenerateRequest,
    GenerateResponse,
    Post,
    PostCreate,
    PostUpdate,
    PostsResponse,
    SearchResponse,
    TransformRequest,
    TransformResponse,
    UploadResponse,
)
from .config import settings
from .services import (
    build_image_data_uri,
    generate_captions,
    generate_post_variants,
    iter_content_items,
    posts_create,
    posts_delete,
    posts_list,
    posts_update,
    rate_guard,
    rate_tick,
    save_caption_file,
    save_upload,
    search_media,
    transform_content,
)


def _client_id(request: Request) -> str:
    """Best-effort client key for rate limiting (proxy-aware)."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

router = APIRouter()
# Auth dependency applied only to spend-incurring / mutating endpoints
# (/generate, /transform, /upload, /captions/generate). Read endpoints
# stay open so the dashboard's health probe still works without a token.
auth_required = Depends(require_token)


# ── Utility endpoints ──────────────────────────────────────────────────

@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/tunnel-status")
async def tunnel_status() -> dict[str, Any]:
    return {
        "tunnel_ready": tunnel.is_ready(),
        "tunnel_url": tunnel.TUNNEL_URL,
    }


# ── Generation endpoints ──────────────────────────────────────────────

@router.post(
    "/generate",
    response_model=GenerateResponse,
    dependencies=[auth_required],
)
async def generate(request: Request, body: GenerateRequest) -> GenerateResponse:
    """Prompt-driven generation for the editor's "Generate via AI" button."""
    client = _client_id(request)
    rate_guard(client)
    variants, usage = await generate_post_variants(
        prompt=body.prompt,
        platforms=body.platforms,
        template=body.template,
        n=body.variants,
    )
    if usage["total_tokens"] > 0:  # don't count free cache hits
        rate_tick(client)
    return GenerateResponse(variants=variants, usage=usage)


@router.post(
    "/transform",
    response_model=TransformResponse,
    dependencies=[auth_required],
)
async def transform(request: Request, body: TransformRequest) -> TransformResponse:
    """Quick AI actions (shorten / expand / tone) on existing content."""
    client = _client_id(request)
    rate_guard(client)
    text, usage = await transform_content(body.content, body.action)
    if usage["total_tokens"] > 0:
        rate_tick(client)
    return TransformResponse(text=text, usage=usage)


# ── Media endpoints ───────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=UploadResponse,
    dependencies=[auth_required],
)
async def upload(request: Request, file: UploadFile = File(...)) -> UploadResponse:
    """Store an uploaded image/video and return its served URL."""
    meta = await save_upload(file)
    url = await tunnel.wait_for_tunnel(timeout=5.0)
    base = url or str(request.base_url).rstrip("/")
    return UploadResponse(
        url=f"{base}/content/{meta['relative_path']}",
        filename=meta["filename"],
        kind=meta["kind"],
    )


@router.get("/search", response_model=SearchResponse)
async def search(q: str = "") -> SearchResponse:
    """Search media in the content directory (posts/templates → Airtable TBD)."""
    return SearchResponse(results=search_media(q))


# ── Scheduled posts (calendar persistence) ────────────────────────────

@router.get("/posts", response_model=PostsResponse)
async def list_posts() -> PostsResponse:
    """Return all scheduled posts. Open so the calendar can hydrate on load."""
    return PostsResponse(posts=posts_list())


@router.post(
    "/posts",
    response_model=Post,
    dependencies=[auth_required],
)
async def create_post(body: PostCreate) -> Post:
    return Post(**posts_create(body.model_dump()))


@router.patch(
    "/posts/{post_id}",
    response_model=Post,
    dependencies=[auth_required],
)
async def patch_post(post_id: str, body: PostUpdate) -> Post:
    updated = posts_update(post_id, body.model_dump())
    if updated is None:
        raise HTTPException(status_code=404, detail="Post not found.")
    return Post(**updated)


@router.delete("/posts/{post_id}", dependencies=[auth_required])
async def delete_post(post_id: str) -> dict[str, bool]:
    if not posts_delete(post_id):
        raise HTTPException(status_code=404, detail="Post not found.")
    return {"deleted": True}


# ── Content endpoints ─────────────────────────────────────────────────

@router.get("/content-items")
async def list_content(request: Request) -> dict[str, Any]:
    url = await tunnel.wait_for_tunnel(timeout=15.0)
    base = url or str(request.base_url).rstrip("/")

    items = [
        {
            "filename": item["filename"],
            "relative_path": item["relative_path"],
            "description": item["description"],
            "image_url": f"{base}/content/{item['relative_path']}",
        }
        for item in iter_content_items()
    ]
    return {"count": len(items), "items": items}


@router.post("/captions/generate", dependencies=[auth_required])
async def generate_content_captions(
    request: Request, body: CaptionRequest
) -> dict[str, Any]:
    url = await tunnel.wait_for_tunnel(timeout=30.0)
    base = url or str(request.base_url).rstrip("/")

    if not url:
        print("WARNING: No tunnel URL — image_url will be internal-only.")
        print("         Use image_base64 for Instagram uploads instead.")

    items = iter_content_items()
    if body.limit is not None:
        items = items[: body.limit]

    include_image = (
        settings.ai_include_images
        if body.include_images_to_ai is None
        else body.include_images_to_ai
    )

    results: list[ContentItem] = []
    for item in items:
        captions = await generate_captions(item, include_image=include_image)

        if body.save_results:
            save_caption_file(item, captions)

        results.append(
            ContentItem(
                filename=item["filename"],
                relative_path=item["relative_path"],
                description=item["description"],
                image_url=f"{base}/content/{item['relative_path']}",
                image_base64=build_image_data_uri(item["image_path"]),
                instagram_caption=captions["instagram_caption"],
                tiktok_caption=captions["tiktok_caption"],
            )
        )

    return {
        "count": len(results),
        "items": [r.model_dump() for r in results],
    }
