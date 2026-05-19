"""FastAPI route handlers."""

from typing import Any

from fastapi import APIRouter, Request

from . import tunnel
from .models import CaptionRequest, ContentItem
from .config import settings
from .services import (
    build_image_data_uri,
    generate_captions,
    iter_content_items,
    save_caption_file,
)

router = APIRouter()


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


@router.post("/captions/generate")
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
