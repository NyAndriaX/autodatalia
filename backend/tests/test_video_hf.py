import io
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from app import video_audio, video_jobs
from app.config import settings


def _ffmpeg() -> str:
    from imageio_ffmpeg import get_ffmpeg_exe

    return get_ffmpeg_exe()


def _png(color, size=(800, 600)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _clip(path: Path, *, audio: bool = False, seconds: float = 3.5) -> Path:
    cmd = [_ffmpeg(), "-y", "-f", "lavfi", "-i", f"color=c=green:s=320x320:d={seconds}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=f=300:d={seconds}", "-c:a", "aac"]
    cmd += ["-pix_fmt", "yuv420p", "-shortest", str(path)]
    subprocess.run(cmd, check=True, capture_output=True)
    return path


@pytest.fixture
def hf(monkeypatch, tmp_path):
    """HF token set, Space calls recorded and faked, no AI/TTS network."""
    monkeypatch.setattr(settings, "hf_token", "hf_test")
    calls = []

    def fake_predict(space, token, api_name, *, files, **inputs):
        calls.append({"space": space, "token": token, "api": api_name, "files": dict(files), "inputs": inputs})
        if api_name == "/generate_video":
            with Image.open(files["input_image"]) as img:
                calls[-1]["source_size"] = img.size
        return _clip(tmp_path / f"out{len(calls)}.mp4", audio=api_name == "/generate_motion")

    async def fake_motion(prompt, **kwargs):
        return f"EN: {prompt}"

    async def no_script(*args, **kwargs):
        raise RuntimeError("no AI in tests")

    async def fake_speech(text, workdir, **kwargs):
        calls.append({"tts": text})
        wav = workdir / "voice.wav"
        subprocess.run([_ffmpeg(), "-y", "-f", "lavfi", "-i", "sine=f=440:d=2", str(wav)], check=True, capture_output=True)
        return wav

    monkeypatch.setattr(video_jobs, "_hf_predict", fake_predict)
    monkeypatch.setattr(video_jobs, "_english_motion_prompt", fake_motion)
    monkeypatch.setattr(video_audio, "write_narration_script", no_script)
    monkeypatch.setattr(video_audio, "synthesize_speech", fake_speech)
    return calls


def _upload(client, color=(200, 30, 30)):
    r = client.post("/upload", files={"file": ("girl.png", _png(color), "image/png")})
    assert r.status_code == 200, r.text
    return r.json()["filename"]


def _generate(client, **body):
    payload = {"prompt": "she waves and dances", "duration_seconds": 5, "ratio": "9:16", "async_mode": False, **body}
    return client.post("/media/generate/video", json=payload)


def _probe(path: Path) -> str:
    return subprocess.run([_ffmpeg(), "-i", str(path)], capture_output=True, text=True).stderr


def _local(response) -> Path:
    return Path(settings.content_dir) / response.json()["url"].split("/content/", 1)[1]


def test_animate_sends_cropped_image_and_motion_prompt_then_adds_sound(workspace_client, hf):
    name = _upload(workspace_client)
    r = _generate(workspace_client, image_filename=name, mode="image", model_id=video_jobs.HF_FREE_MODEL_ID)
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == "huggingface"
    call = next(c for c in hf if c.get("api") == "/generate_video")
    assert call["space"] == settings.hf_animate_space and call["token"] == "hf_test"
    assert call["inputs"]["prompt"] == "EN: she waves and dances"
    assert call["inputs"]["duration_seconds"] == 5.0
    w, h = call["source_size"]
    assert abs(w / h - 9 / 16) < 0.01  # cropped to the job ratio
    assert "Audio: aac" in _probe(_local(r))  # music bed added to the silent clip


def test_talk_mode_reads_the_text_and_lip_syncs(workspace_client, hf):
    name = _upload(workspace_client)
    r = _generate(workspace_client, image_filename=name, mode="talk", prompt="Bonjour, rejoignez notre formation !")
    assert r.status_code == 200, r.text
    assert any(c.get("tts") == "Bonjour, rejoignez notre formation !" for c in hf)
    call = next(c for c in hf if c.get("api") == "/generate_motion")
    assert call["space"] == settings.hf_talk_space
    assert set(call["files"]) == {"source_image_path", "driving_audio_path"}
    assert "Audio: aac" in _probe(_local(r))


def test_quota_error_falls_back_to_local_render(workspace_client, hf, monkeypatch):
    def quota(*args, **kwargs):
        raise RuntimeError("You have exceeded your ZeroGPU quota")

    monkeypatch.setattr(video_jobs, "_hf_predict", quota)
    name = _upload(workspace_client)
    r = _generate(workspace_client, image_filename=name, mode="image")
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == "fallback"


def test_unconfigured_paid_model_routes_to_free_provider(monkeypatch):
    monkeypatch.setattr(settings, "hf_token", "hf_test")
    monkeypatch.setattr(settings, "fal_api_key", "")
    assert video_jobs._pick_provider("fal", model_id="fal-ai/ltx-video") == "huggingface"
    monkeypatch.setattr(settings, "hf_token", "")
    assert video_jobs._pick_provider("fal", model_id="fal-ai/ltx-video") == "fallback"


def test_free_model_is_the_default_when_only_hf_is_configured(workspace_client, monkeypatch):
    monkeypatch.setattr(settings, "hf_token", "hf_test")
    monkeypatch.setattr(settings, "fal_api_key", "")
    monkeypatch.setattr(settings, "ltx_api_key", "")
    # Production setup: the text AI key is a Google one, so no OpenRouter video.
    monkeypatch.setattr(settings, "ai_api_base_url", "https://generativelanguage.googleapis.com/v1beta/openai")
    monkeypatch.setattr(settings, "ai_video_api_key", "")
    data = workspace_client.get("/video-models").json()
    assert data["default"] == video_jobs.HF_FREE_MODEL_ID
    free = next(m for m in data["models"] if m["id"] == video_jobs.HF_FREE_MODEL_ID)
    assert free["features"]["supports_talk"] is True and free["cost_per_second_usd"] == 0.0
