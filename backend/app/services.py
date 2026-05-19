"""Core business logic — content scanning, AI caption generation, file I/O."""

import base64
import json
import mimetypes
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

from .config import settings

# ── Constants ──────────────────────────────────────────────────────────

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
DESCRIPTION_EXTENSIONS = (".txt", ".md")


# ── Content helpers ────────────────────────────────────────────────────

def read_description(image_path: Path) -> str:
    """Return the text from a matching .txt/.md file, or empty string."""
    for ext in DESCRIPTION_EXTENSIONS:
        desc_path = image_path.with_suffix(ext)
        if desc_path.exists():
            return desc_path.read_text(encoding="utf-8").strip()
    return ""


def iter_content_items() -> list[dict[str, Any]]:
    """Scan the content directory and return metadata for every image found."""
    items: list[dict[str, Any]] = []
    for image_path in sorted(settings.content_dir.rglob("*")):
        if not image_path.is_file():
            continue
        if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        items.append(
            {
                "filename": image_path.name,
                "relative_path": image_path.relative_to(
                    settings.content_dir
                ).as_posix(),
                "description": read_description(image_path),
                "image_path": image_path,
            }
        )
    return items


def build_image_data_uri(image_path: Path) -> str:
    """Return a ``data:<mime>;base64,...`` URI for the given image file."""
    mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(image_path.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{encoded}"


# ── AI caption generation ─────────────────────────────────────────────

def _extract_json(raw: str) -> dict[str, Any]:
    """Pull the first JSON object out of a potentially messy AI response."""
    stripped = raw.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return json.loads(stripped)
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("AI response did not contain a JSON object.")
    return json.loads(stripped[start : end + 1])


async def generate_captions(
    item: dict[str, Any], *, include_image: bool
) -> dict[str, str]:
    """Call the configured AI model and return Instagram + TikTok captions."""
    if not settings.ai_api_key:
        raise HTTPException(status_code=500, detail="AI_API_KEY is not configured.")

    prompt = (
        "Create one Instagram caption and one TikTok caption for this image.\n"
        "Use the description as the main context.\n"
        "Keep captions concise, natural, and ready to post.\n"
        'Return JSON only with this shape: '
        '{"instagram_caption":"...","tiktok_caption":"..."}\n'
        f"Filename: {item['filename']}\n"
        f"Description: {item['description'] or 'No description provided.'}"
    )

    user_content: Any = prompt
    if include_image:
        user_content = [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {
                    "url": build_image_data_uri(item["image_path"]),
                },
            },
        ]

    payload = {
        "model": settings.ai_model,
        "temperature": 0.7,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You write short social media captions for brands and "
                    "creators. Always respond with valid JSON only."
                ),
            },
            {"role": "user", "content": user_content},
        ],
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{settings.ai_api_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.ai_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://caption-api.local",
                "X-Title": "Caption API",
            },
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "AI API request failed.",
                "status_code": response.status_code,
                "response": response.text,
            },
        )

    data = response.json()
    message_content = data["choices"][0]["message"]["content"]
    if isinstance(message_content, list):
        message_content = "".join(
            part.get("text", "") for part in message_content if isinstance(part, dict)
        )

    try:
        captions = _extract_json(message_content)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not parse AI response: {exc}"
        ) from exc

    return {
        "instagram_caption": captions.get("instagram_caption", "").strip(),
        "tiktok_caption": captions.get("tiktok_caption", "").strip(),
    }


# ── File output ────────────────────────────────────────────────────────

def save_caption_file(item: dict[str, Any], captions: dict[str, str]) -> None:
    """Write generated captions to a .captions.json sidecar file."""
    out = item["image_path"].with_suffix(".captions.json")
    out.write_text(
        json.dumps(
            {
                "filename": item["filename"],
                "description": item["description"],
                **captions,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
