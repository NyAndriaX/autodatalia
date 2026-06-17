"""Unit tests for the Zernio unified-provider integration (app/zernio.py).

Fully hermetic: httpx is mocked via httpx.MockTransport and the workspace blob
store is replaced with an in-memory dict, so these never touch the real Zernio
API or MariaDB.
"""

import asyncio
import json

import httpx
import pytest

from app import zernio


def _mock_handler(request: httpx.Request, calls: list) -> httpx.Response:
    calls.append((request.method, request.url.path, request.read()))
    path = request.url.path
    method = request.method
    if method == "POST" and path.endswith("/profiles"):
        return httpx.Response(200, json={"profile": {"_id": "prof_1"}})
    if method == "GET" and "/connect/" in path:
        return httpx.Response(200, json={"authUrl": "https://zernio.com/oauth/go"})
    if method == "GET" and path.endswith("/accounts"):
        return httpx.Response(
            200,
            json={
                "accounts": [
                    {"_id": "acc_ig", "platform": "instagram", "username": "brand"},
                    {"_id": "acc_tt", "platform": "tiktok", "displayName": "Brand TT"},
                ]
            },
        )
    if method == "POST" and path.endswith("/media/presign"):
        return httpx.Response(
            200,
            json={"uploadUrl": "https://up.zernio/put", "publicUrl": "https://cdn.zernio/x.jpg"},
        )
    if method == "PUT":
        return httpx.Response(200)
    if method == "POST" and path.endswith("/posts"):
        return httpx.Response(200, json={"post": {"_id": "post_99"}})
    return httpx.Response(404, json={"error": {"message": "no mock route"}})


@pytest.fixture
def zenv(monkeypatch):
    """Mock Zernio HTTP + the workspace blob store; key always configured."""
    store: dict = {}
    calls: list = []

    monkeypatch.setattr(
        zernio,
        "load_scoped_blob",
        lambda name, *, user_id=None, default=None: store.get((name, user_id), default),
    )
    monkeypatch.setattr(
        zernio,
        "save_scoped_blob",
        lambda name, payload, *, user_id=None: store.__setitem__((name, user_id), payload),
    )
    monkeypatch.setattr(zernio, "_config", lambda wsid: ("sk_test", "https://zernio.com/api/v1"))

    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        return real_client(
            transport=httpx.MockTransport(lambda req: _mock_handler(req, calls)),
            timeout=5.0,
        )

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    return {"store": store, "calls": calls}


def _post_bodies(calls, suffix):
    return [json.loads(body) for m, p, body in calls if m == "POST" and p.endswith(suffix)]


def test_inert_without_key(monkeypatch):
    monkeypatch.setattr(zernio, "_config", lambda wsid: ("", "https://zernio.com/api/v1"))
    assert zernio.is_enabled(1) is False
    entry = asyncio.run(zernio.connections_entry(1))
    assert entry["configured"] is False
    assert entry["connected"] is False
    assert entry["targets"] == []
    assert entry["missing_env"] == ["ZERNIO_API_KEY"]
    assert entry["is_aggregator"] is True


def test_profile_created_and_cached(zenv):
    pid1 = asyncio.run(zernio.get_or_create_profile(7))
    assert pid1 == "prof_1"
    assert zenv["store"][("zernio", 7)]["profile_id"] == "prof_1"
    before = sum(1 for m, p, _ in zenv["calls"] if m == "POST" and p.endswith("/profiles"))
    pid2 = asyncio.run(zernio.get_or_create_profile(7))
    after = sum(1 for m, p, _ in zenv["calls"] if m == "POST" and p.endswith("/profiles"))
    assert pid2 == "prof_1"
    assert after == before  # cached — no second profile creation


def test_connections_entry_maps_targets(zenv):
    zenv["store"][("zernio", 7)] = {"profile_id": "prof_1"}
    entry = asyncio.run(zernio.connections_entry(7))
    assert entry["configured"] and entry["connected"]
    assert {t["kind"] for t in entry["targets"]} == {"zernio_instagram", "zernio_tiktok"}
    assert all(t["provider"] == "zernio" for t in entry["targets"])
    ig = next(t for t in entry["targets"] if t["kind"] == "zernio_instagram")
    assert (ig["id"], ig["platform"], ig["label"]) == ("acc_ig", "instagram", "brand")


def test_start_connect_returns_auth_url_and_provisions_profile(zenv):
    url = asyncio.run(zernio.start_connect(7, "instagram"))
    assert url == "https://zernio.com/oauth/go"
    assert zenv["store"][("zernio", 7)]["profile_id"] == "prof_1"


def test_start_connect_rejects_unknown_platform(zenv):
    with pytest.raises(zernio.ZernioError):
        asyncio.run(zernio.start_connect(7, "myspace"))


def test_request_maps_httpx_network_errors(monkeypatch):
    monkeypatch.setattr(zernio, "_config", lambda wsid: ("sk_test", "https://zernio.com/api/v1"))

    class BoomClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def request(self, *args, **kwargs):
            raise httpx.ConnectError("network down")

    monkeypatch.setattr(httpx, "AsyncClient", lambda *args, **kwargs: BoomClient())

    with pytest.raises(zernio.ZernioError) as exc:
        asyncio.run(zernio._request("GET", "/profiles", workspace_id=7))
    assert exc.value.status == 502
    assert "Zernio request failed" in str(exc.value)


def test_publish_text_only(zenv):
    targets = [
        {"id": "acc_ig", "label": "brand", "platform": "instagram"},
        {"id": "acc_tt", "label": "Brand TT", "platform": "tiktok"},
    ]
    rows = asyncio.run(zernio.publish(7, content="hello", targets=targets, media_urls=[]))
    assert len(rows) == 2
    assert all(r["ok"] for r in rows)
    assert all(r["platform_post_id"] == "post_99" for r in rows)
    bodies = _post_bodies(zenv["calls"], "/posts")
    assert len(bodies) == 1
    sent = bodies[0]
    assert sent["publishNow"] is True
    assert "mediaItems" not in sent
    assert {(x["platform"], x["accountId"]) for x in sent["platforms"]} == {
        ("instagram", "acc_ig"),
        ("tiktok", "acc_tt"),
    }


def test_publish_with_media(zenv, monkeypatch):
    async def fake_presign(workspace_id, url):
        return ("https://cdn.zernio/x.jpg", "image")

    monkeypatch.setattr(zernio, "_presign_and_upload", fake_presign)
    rows = asyncio.run(
        zernio.publish(
            7,
            content="post",
            targets=[{"id": "acc_ig", "platform": "instagram"}],
            media_urls=["http://datalia.local/content/x.jpg"],
        )
    )
    assert rows[0]["ok"]
    sent = _post_bodies(zenv["calls"], "/posts")[0]
    assert sent["mediaItems"] == [{"url": "https://cdn.zernio/x.jpg", "type": "image"}]


def test_publish_scheduled(zenv):
    rows = asyncio.run(
        zernio.publish(
            7,
            content="later",
            targets=[{"id": "acc_ig", "platform": "instagram"}],
            media_urls=[],
            schedule={"scheduledFor": "2026-07-01T10:00:00Z", "timezone": "Europe/Paris"},
        )
    )
    assert rows[0]["ok"]
    sent = _post_bodies(zenv["calls"], "/posts")[0]
    assert sent["scheduledFor"] == "2026-07-01T10:00:00Z"
    assert sent["timezone"] == "Europe/Paris"
    assert "publishNow" not in sent


def test_publish_maps_upstream_error(zenv, monkeypatch):
    async def boom(*args, **kwargs):
        raise zernio.ZernioError("insufficient credits", status=402)

    monkeypatch.setattr(zernio, "_request", boom)
    rows = asyncio.run(
        zernio.publish(
            7,
            content="x",
            targets=[{"id": "acc_ig", "platform": "instagram"}],
            media_urls=[],
        )
    )
    assert len(rows) == 1
    assert rows[0]["ok"] is False
    assert "insufficient credits" in rows[0]["error"]
