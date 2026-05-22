"""Image processing helpers — currently just a center-crop to a chosen
aspect ratio.

Used by the publish pipeline so the editor's "1:1 / 4:5 / 9:16" picker
actually changes what Meta receives, not just the preview frame.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

from PIL import Image

from .config import settings


def parse_ratio(spec: str | None) -> float | None:
    """Parse a 'W:H' (or 'W/H') string into a float W/H ratio.

    Returns None if the spec is missing or unparseable so callers can
    fall back to "no crop".
    """
    if not spec:
        return None
    sep = ":" if ":" in spec else "/" if "/" in spec else None
    if not sep:
        return None
    try:
        w_str, h_str = spec.split(sep, 1)
        w = float(w_str.strip())
        h = float(h_str.strip())
        if w <= 0 or h <= 0:
            return None
        return w / h
    except (ValueError, TypeError):
        return None


def _ratio_suffix(spec: str) -> str:
    """Filename-safe suffix for a ratio spec — '4:5' → '4x5'."""
    return spec.replace(":", "x").replace("/", "x").replace(" ", "")


def _local_path_from_public_url(url: str) -> Path | None:
    """Map a /content/<rel> public URL back to its file on disk.

    Returns None if the URL doesn't point at our content dir, in which
    case the caller should skip the crop and pass the original URL
    through to the platform.
    """
    parsed = urlparse(url)
    path = parsed.path or url
    marker = "/content/"
    if marker not in path:
        return None
    rel = path.split(marker, 1)[1]
    if not rel:
        return None
    candidate = (settings.content_dir / rel).resolve()
    # Block path traversal — never serve outside content_dir.
    try:
        candidate.relative_to(settings.content_dir.resolve())
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    return candidate


def crop_media_to_ratio(media_url: str, ratio_spec: str) -> str:
    """Return a media URL whose image is center-cropped to ratio_spec.

    Falls back to the input URL on any error (unparseable ratio, unknown
    host, unreadable file, video, …) — the caller will then just publish
    the original. Cached on disk: same input + ratio reuses the file.
    """
    target_ratio = parse_ratio(ratio_spec)
    if target_ratio is None:
        return media_url
    src = _local_path_from_public_url(media_url)
    if src is None:
        return media_url
    suffix = _ratio_suffix(ratio_spec)
    out = src.with_name(f"{src.stem}_r{suffix}{src.suffix}")
    if not out.exists():
        try:
            with Image.open(src) as img:
                img = img.convert("RGB") if img.mode in ("P", "RGBA") else img
                w, h = img.size
                cur = w / h
                if abs(cur - target_ratio) < 0.005:
                    return media_url  # already close enough, skip
                if cur > target_ratio:
                    # Too wide — crop sides.
                    new_w = int(round(h * target_ratio))
                    left = (w - new_w) // 2
                    box = (left, 0, left + new_w, h)
                else:
                    # Too tall — crop top/bottom.
                    new_h = int(round(w / target_ratio))
                    top = (h - new_h) // 2
                    box = (0, top, w, top + new_h)
                img.crop(box).save(out, quality=92, optimize=True)
        except (OSError, ValueError):
            return media_url
    # Replace the filename in the public URL while preserving the host
    # and the /content/ prefix the caller already gave us.
    return media_url.replace(src.name, out.name, 1)


def crop_for_targets(
    *,
    media_url: str | None,
    ratios: dict[str, str] | None,
    platform: str,
) -> str | None:
    """Convenience for the publish route — returns media_url cropped for
    the given platform, or the original if no per-platform ratio is set.
    """
    if not media_url or not ratios:
        return media_url
    spec = ratios.get(platform)
    if not spec:
        return media_url
    return crop_media_to_ratio(media_url, spec)
