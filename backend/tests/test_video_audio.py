import asyncio
import base64
import io
import math
import struct
import subprocess
from pathlib import Path

import httpx
import pytest
from PIL import Image

from app import video_audio, video_jobs
from app.config import settings


def _ffmpeg() -> str:
    from imageio_ffmpeg import get_ffmpeg_exe

    return get_ffmpeg_exe()


def _probe(path: Path) -> str:
    """ffmpeg's stream summary (stderr of `ffmpeg -i`)."""
    return subprocess.run([_ffmpeg(), "-i", str(path)], capture_output=True, text=True).stderr


def _png(color) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (640, 640), color).save(buf, format="PNG")
    return buf.getvalue()


def _first_frame_color(video: Path) -> tuple[int, int, int]:
    out = subprocess.run(
        [_ffmpeg(), "-v", "error", "-i", str(video), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
        capture_output=True,
    ).stdout
    img = Image.open(io.BytesIO(out)).convert("RGB")
    return img.getpixel((img.width // 2, img.height // 2))


@pytest.fixture
def no_voice(monkeypatch):
    """No AI calls: narration fails, so the clip gets the music bed only."""

    async def boom(*args, **kwargs):
        raise RuntimeError("no AI in tests")

    monkeypatch.setattr(video_audio, "write_narration_script", boom)


def _generate(client, **body):
    payload = {"prompt": "Promo video", "duration_seconds": 3, "ratio": "1:1", "provider": "fallback", "async_mode": False, **body}
    return client.post("/media/generate/video", json=payload)


def _local_output(response) -> Path:
    rel = response.json()["url"].split("/content/", 1)[1]
    return Path(settings.content_dir) / rel


def test_image_to_video_animates_the_uploaded_image_with_sound(workspace_client, monkeypatch, no_voice):
    async def must_not_generate(*args, **kwargs):
        raise AssertionError("image-to-video must not generate a new image")

    from app import media_generation

    monkeypatch.setattr(media_generation, "_generate_image_file", must_not_generate)
    up = workspace_client.post("/upload", files={"file": ("red.png", _png((220, 20, 20)), "image/png")})
    assert up.status_code == 200, up.text

    r = _generate(workspace_client, image_filename=up.json()["filename"], mode="image")
    assert r.status_code == 200, r.text
    video = _local_output(r)
    red, green, blue = _first_frame_color(video)
    assert red > 150 and green < 90 and blue < 90  # it's our red picture
    assert "Audio:" in _probe(video)


def test_missing_reference_image_fails_instead_of_ignoring_it(workspace_client, no_voice):
    r = _generate(workspace_client, image_filename="does-not-exist.png", mode="image")
    assert r.status_code == 502
    assert "Reference image not found" in r.text


def test_reference_image_cannot_escape_the_workspace(workspace_client, no_voice):
    r = _generate(workspace_client, image_filename="../../../etc/passwd", mode="image")
    assert r.status_code == 502
    assert "passwd" in r.text and "etc/" not in r.json()["detail"]["error"].split("found:")[-1]


def test_job_image_public_url_points_at_the_workspace(tmp_path, monkeypatch):
    ws_dir = Path(settings.content_dir) / "ws" / "77"
    (ws_dir / "generated").mkdir(parents=True, exist_ok=True)
    (ws_dir / "generated" / "gen.png").write_bytes(_png((0, 0, 0)))
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://api.example.com")
    url = video_jobs._job_image_public_url({"user_id": "77", "image_filename": "gen.png"})
    assert url == "https://api.example.com/content/ws/77/generated/gen.png"


def test_text_to_video_gets_a_music_bed_without_ai(workspace_client, no_voice):
    r = _generate(workspace_client)
    assert r.status_code == 200, r.text
    assert "Audio: aac" in _probe(_local_output(r))


def test_voice_over_is_mixed_in(tmp_path, monkeypatch):
    clip = tmp_path / "clip.mp4"
    subprocess.run(
        [_ffmpeg(), "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x320:d=3", "-pix_fmt", "yuv420p", str(clip)],
        check=True, capture_output=True,
    )

    async def script(*args, **kwargs):
        return "Bonjour et bienvenue."

    async def speech(text, workdir, **kwargs):
        wav = workdir / "voice.wav"
        subprocess.run([_ffmpeg(), "-y", "-f", "lavfi", "-i", "sine=f=440:d=1.5", str(wav)], check=True, capture_output=True)
        return wav

    monkeypatch.setattr(video_audio, "write_narration_script", script)
    monkeypatch.setattr(video_audio, "synthesize_speech", speech)
    result = asyncio.run(video_audio.add_soundtrack(clip, "promo", 3))
    assert result == {"voice": True, "music": True}
    info = _probe(clip)
    assert "Audio: aac" in info and "Video: h264" in info
    assert "Duration: 00:00:03" in info


def test_gemini_pcm_tts_is_converted_to_wav(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ai_api_key", "AQ.fake")
    pcm = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / 24000))) for i in range(24000))

    async def fake_post(self, url, *args, **kwargs):
        assert "tts" in url and kwargs["headers"]["x-goog-api-key"] == "AQ.fake"
        data = {"candidates": [{"content": {"parts": [{"inlineData": {
            "mimeType": "audio/L16;codec=pcm;rate=24000", "data": base64.b64encode(pcm).decode()}}]}}]}
        return httpx.Response(200, json=data, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    wav = asyncio.run(video_audio.synthesize_speech("Bonjour", tmp_path))
    assert wav and wav.suffix == ".wav"
    assert "24000 Hz" in _probe(wav)


def test_tts_skipped_without_google_key(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ai_api_key", "sk-or-openrouter")
    assert asyncio.run(video_audio.synthesize_speech("Bonjour", tmp_path)) is None
