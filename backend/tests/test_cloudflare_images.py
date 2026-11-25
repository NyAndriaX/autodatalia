import base64
import io

import httpx
import pytest
from PIL import Image

from app import config as config_module
from app.config import settings

FLUX = "@cf/black-forest-labs/flux-1-schnell"
SDXL = "@cf/bytedance/stable-diffusion-xl-lightning"
ACCOUNT = "0123456789abcdef0123456789abcdef"


def _img_bytes(fmt: str, size=(1024, 1024)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 60, 200)).save(buf, format=fmt)
    return buf.getvalue()


@pytest.fixture
def cloudflare(monkeypatch):
    monkeypatch.setattr(settings, "cloudflare_account_id", ACCOUNT)
    monkeypatch.setattr(settings, "cloudflare_api_token", "cf-token")
    calls = []

    def install(model, response_factory):
        monkeypatch.setattr(settings, "ai_image_model", model)

        async def fake_post(self, url, *args, **kwargs):
            calls.append({"url": url, "json": kwargs.get("json"), "headers": kwargs.get("headers")})
            return response_factory(httpx.Request("POST", url))

        monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    return install, calls


def _generated_file(response):
    from pathlib import Path

    rel = response.json()["url"].split("/content/", 1)[1]
    return Path(settings.content_dir) / rel


def test_flux_json_base64_is_saved_as_png_at_requested_ratio(workspace_client, cloudflare):
    install, calls = cloudflare
    b64 = base64.b64encode(_img_bytes("JPEG")).decode()
    install(FLUX, lambda req: httpx.Response(200, json={"result": {"image": b64}, "success": True}, request=req))

    r = workspace_client.post("/media/generate/image", json={"prompt": "blue square", "ratio": "9:16"})
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == FLUX
    call = calls[-1]
    assert call["url"] == f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/run/{FLUX}"
    assert call["headers"]["Authorization"] == "Bearer cf-token"
    assert call["json"]["steps"] == 4 and "width" not in call["json"]
    with Image.open(_generated_file(r)) as img:
        assert img.format == "PNG"
        assert img.size == (1080, 1920)


def test_sdxl_binary_png_with_requested_size(workspace_client, cloudflare):
    install, calls = cloudflare
    install(SDXL, lambda req: httpx.Response(200, content=_img_bytes("PNG", (576, 1024)), headers={"content-type": "image/png"}, request=req))

    r = workspace_client.post("/media/generate/image", json={"prompt": "blue square", "ratio": "9:16"})
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == SDXL
    assert calls[-1]["json"]["width"] == 576 and calls[-1]["json"]["height"] == 1024


def test_upstream_error_falls_back_to_poster(workspace_client, cloudflare):
    install, _ = cloudflare
    install(FLUX, lambda req: httpx.Response(429, json={"success": False}, request=req))
    r = workspace_client.post("/media/generate/image", json={"prompt": "blue square"})
    assert r.status_code == 200
    assert r.json()["provider"] == "fallback-poster"


def test_missing_or_invalid_credentials_fall_back_without_calling_out(workspace_client, cloudflare, monkeypatch):
    install, calls = cloudflare
    install(FLUX, lambda req: httpx.Response(500, request=req))
    monkeypatch.setattr(settings, "cloudflare_api_token", "")
    assert workspace_client.post("/media/generate/image", json={"prompt": "blue square"}).json()["provider"] == "fallback-poster"

    monkeypatch.setattr(settings, "cloudflare_api_token", "cf-token")
    monkeypatch.setattr(settings, "cloudflare_account_id", "../../zones/evil")
    assert workspace_client.post("/media/generate/image", json={"prompt": "blue square"}).json()["provider"] == "fallback-poster"
    assert calls == []


def test_cloudflare_model_not_rewritten_by_google_key(monkeypatch):
    monkeypatch.setenv("AI_API_KEY", "AQ.fake-google-key")
    monkeypatch.setenv("AI_IMAGE_MODEL", FLUX)
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT)
    loaded = config_module.load_settings()
    assert loaded.ai_image_model == FLUX
    assert loaded.cloudflare_account_id == ACCOUNT


LONG_PROMPT = "Affiche moderne pour une formation en marketing digital a Antananarivo"


def _refiner_and_flux(monkeypatch, chat_statuses):
    """Fake Google/OpenRouter chat (statuses consumed in order) + FLUX."""
    from app import media_generation

    async def no_sleep(_):
        return None

    monkeypatch.setattr(media_generation.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(settings, "ai_image_model", FLUX)
    monkeypatch.setattr(settings, "cloudflare_account_id", ACCOUNT)
    monkeypatch.setattr(settings, "cloudflare_api_token", "cf-token")
    monkeypatch.setattr(settings, "ai_model_fast", "fast-model")
    monkeypatch.setattr(settings, "ai_model", "main-model")
    statuses = list(chat_statuses)
    chat_models, flux_prompts = [], []
    b64 = base64.b64encode(_img_bytes("JPEG")).decode()

    async def fake_post(self, url, *args, **kwargs):
        req = httpx.Request("POST", url)
        body = kwargs.get("json") or {}
        if "api.cloudflare.com" in url:
            flux_prompts.append(body["prompt"])
            return httpx.Response(200, json={"result": {"image": b64}}, request=req)
        chat_models.append(body["model"])
        status = statuses.pop(0) if statuses else 200
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "busy"}}, request=req)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Blue and orange abstract shapes"}}]}, request=req)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return chat_models, flux_prompts


def test_refiner_retries_503_then_uses_refined_prompt(workspace_client, monkeypatch):
    chat_models, flux_prompts = _refiner_and_flux(monkeypatch, [503])
    r = workspace_client.post("/media/generate/image", json={"prompt": LONG_PROMPT})
    assert r.status_code == 200 and r.json()["provider"] == FLUX
    assert chat_models == ["fast-model", "fast-model"]
    assert flux_prompts[-1].startswith("Blue and orange abstract shapes")
    assert "Antananarivo" not in flux_prompts[-1]


def test_refiner_falls_back_to_main_model_when_fast_is_overloaded(workspace_client, monkeypatch):
    chat_models, flux_prompts = _refiner_and_flux(monkeypatch, [503, 503])
    workspace_client.post("/media/generate/image", json={"prompt": LONG_PROMPT})
    assert chat_models == ["fast-model", "fast-model", "main-model"]
    assert flux_prompts[-1].startswith("Blue and orange abstract shapes")


def test_refiner_gives_up_and_uses_raw_prompt(workspace_client, monkeypatch):
    chat_models, flux_prompts = _refiner_and_flux(monkeypatch, [503, 503, 503, 503])
    r = workspace_client.post("/media/generate/image", json={"prompt": LONG_PROMPT})
    assert r.json()["provider"] == FLUX
    assert len(chat_models) == 4
    assert flux_prompts[-1].startswith(LONG_PROMPT)
