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
from app import publish as publish_module


def _mock_handler(request: httpx.Request, calls: list) -> httpx.Response:
    calls.append((request.method, request.url.path, request.read()))
    path = request.url.path
    method = request.method
    if method == "GET" and path.endswith("/profiles"):
        # No pre-existing profiles by default, so get_or_create takes the create
        # path. Tests that exercise adoption use their own stateful handler.
        return httpx.Response(200, json={"profiles": []})
    if method == "POST" and path.endswith("/profiles"):
        return httpx.Response(200, json={"profile": {"_id": "prof_1"}})
    if method == "GET" and "/connect/" in path:
        return httpx.Response(200, json={"authUrl": "https://zernio.com/oauth/go"})
    if method == "GET" and path.endswith("/accounts"):
        platform = request.url.params.get("platform")
        accounts = [
            {
                "_id": "acc_ig",
                "platform": "instagram",
                "username": "brand",
                "followersCount": 3210,
                "profilePicture": "https://cdn.zernio/brand.jpg",
                "profileId": {"_id": "prof_1", "name": "Workspace Profile"},
            },
            {
                "_id": "acc_tt",
                "platform": "tiktok",
                "displayName": "Brand TT",
                "profileId": {"_id": "prof_else", "name": "Other Profile"},
            },
        ]
        if platform:
            accounts = [account for account in accounts if account["platform"] == platform]
        return httpx.Response(
            200,
            json={"accounts": accounts},
        )
    if method == "GET" and path.endswith("/accounts/health"):
        return httpx.Response(
            200,
            json={
                "accounts": [
                    {
                        "accountId": "acc_ig",
                        "platform": "instagram",
                        "status": "connected",
                        "canPost": True,
                        "canFetchAnalytics": True,
                        "needsReconnect": False,
                        "issues": [],
                    },
                    {
                        "accountId": "acc_tt",
                        "platform": "tiktok",
                        "status": "disconnected",
                        "canPost": False,
                        "canFetchAnalytics": False,
                        "needsReconnect": True,
                        "issues": ["Token expired"],
                    },
                ]
            },
        )
    if method == "DELETE" and "/accounts/" in path:
        return httpx.Response(200, json={"message": "Disconnected"})
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
    entry = asyncio.run(zernio.connections_entry(7))
    assert entry["configured"] and entry["connected"]
    assert {t["kind"] for t in entry["targets"]} == {"zernio_instagram", "zernio_tiktok"}
    assert all(t["provider"] == "zernio" for t in entry["targets"])
    ig = next(t for t in entry["targets"] if t["kind"] == "zernio_instagram")
    assert (ig["id"], ig["platform"], ig["label"]) == ("acc_ig", "instagram", "brand")
    assert ig["profile_name"] == "Workspace Profile"
    assert ig["audience"] == 3210
    assert ig["can_post"] is True
    tt = next(t for t in entry["targets"] if t["kind"] == "zernio_tiktok")
    assert tt["needs_reconnect"] is True
    assert tt["is_workspace_profile"] is False


def test_disconnect_platform_only_removes_matching_accounts(zenv):
    zenv["store"][("zernio", 7)] = {"profile_id": "prof_1"}
    count = asyncio.run(zernio.disconnect_platform(7, "instagram"))
    assert count == 1
    deletes = [
        (method, path)
        for method, path, _body in zenv["calls"]
        if method == "DELETE"
    ]
    assert deletes == [("DELETE", "/api/v1/accounts/acc_ig")]


def test_disconnect_account_removes_only_requested_account(zenv):
    removed = asyncio.run(zernio.disconnect_account(7, "acc_tt"))
    assert removed["displayName"] == "Brand TT"
    deletes = [
        (method, path)
        for method, path, _body in zenv["calls"]
        if method == "DELETE"
    ]
    assert deletes == [("DELETE", "/api/v1/accounts/acc_tt")]


def test_workspace_profiles_are_cached_independently(zenv):
    assert asyncio.run(zernio.get_or_create_profile(7)) == "prof_1"
    assert asyncio.run(zernio.get_or_create_profile(8)) == "prof_1"
    assert zenv["store"][("zernio", 7)]["profile_id"] == "prof_1"
    assert zenv["store"][("zernio", 8)]["profile_id"] == "prof_1"


def test_start_connect_returns_auth_url_and_provisions_profile(zenv):
    url = asyncio.run(zernio.start_connect(7, "facebook"))
    assert url == "https://zernio.com/oauth/go"
    assert zenv["store"][("zernio", 7)]["profile_id"] == "prof_1"


def test_start_connect_rejects_already_connected_platform(zenv):
    zenv["store"][("zernio", 7)] = {"profile_id": "prof_1"}
    with pytest.raises(zernio.ZernioError) as exc:
        asyncio.run(zernio.start_connect(7, "instagram"))
    assert exc.value.status == 409
    assert "already connected" in str(exc.value)
    assert not any("/connect/" in path for method, path, _ in zenv["calls"] if method == "GET")


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


def _zernio_with_handler(monkeypatch, handler):
    """Wire a custom MockTransport + in-memory blob store + key for one test."""
    store: dict = {}
    monkeypatch.setattr(
        zernio, "load_scoped_blob",
        lambda name, *, user_id=None, default=None: store.get((name, user_id), default),
    )
    monkeypatch.setattr(
        zernio, "save_scoped_blob",
        lambda name, payload, *, user_id=None: store.__setitem__((name, user_id), payload),
    )
    monkeypatch.setattr(zernio, "_config", lambda wsid: ("sk_test", "https://zernio.com/api/v1"))
    real = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient",
        lambda *a, **k: real(transport=httpx.MockTransport(handler), timeout=5.0),
    )
    return store


def test_get_or_create_adopts_existing_profile_by_name(monkeypatch):
    # Cached id is gone but Zernio already has our named profile -> adopt it,
    # never POST a duplicate (which Zernio 400s "already exists").
    posts: list = []

    def handler(req):
        if req.method == "GET" and req.url.path.endswith("/profiles"):
            return httpx.Response(200, json={"profiles": [{"_id": "prof_x", "name": "datalia-ws-7"}]})
        if req.method == "POST" and req.url.path.endswith("/profiles"):
            posts.append(1)
            return httpx.Response(200, json={"profile": {"_id": "prof_new"}})
        return httpx.Response(404, json={"error": {"message": "no route"}})

    _zernio_with_handler(monkeypatch, handler)
    assert asyncio.run(zernio.get_or_create_profile(7)) == "prof_x"
    assert posts == []  # adopted, never created


def test_get_or_create_recovers_from_duplicate_name_400(monkeypatch):
    # The list is briefly empty so a create is attempted, Zernio 400s on the
    # duplicate name, then a re-list finds it and we adopt instead of failing.
    state = {"created": False}

    def handler(req):
        p, m = req.url.path, req.method
        if m == "GET" and p.endswith("/profiles"):
            profiles = [{"_id": "prof_dup", "name": "datalia-ws-7"}] if state["created"] else []
            return httpx.Response(200, json={"profiles": profiles})
        if m == "POST" and p.endswith("/profiles"):
            state["created"] = True
            return httpx.Response(400, json={"error": {"message": "A profile with this name already exists"}})
        return httpx.Response(404, json={"error": {"message": "no route"}})

    _zernio_with_handler(monkeypatch, handler)
    assert asyncio.run(zernio.get_or_create_profile(7)) == "prof_dup"


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


def test_account_limit_error_is_actionable(monkeypatch):
    def handler(_req):
        return httpx.Response(
            402,
            json={"error": {"message": "Add a payment method to connect more than 2 accounts."}},
        )

    _zernio_with_handler(monkeypatch, handler)
    with pytest.raises(zernio.ZernioError) as exc:
        asyncio.run(zernio.start_connect(7, "instagram"))
    assert exc.value.status == 402
    assert "connected-account limit" in str(exc.value)
    assert "/connect/" not in str(exc.value)


def test_scheduler_dispatch_routes_zernio_target(monkeypatch):
    captured = {}

    async def fake_publish(workspace_id, **kwargs):
        captured["workspace_id"] = workspace_id
        captured.update(kwargs)
        return [{
            "ok": True,
            "platform_post_id": "z_post",
            "permalink_url": None,
            "error": None,
        }]

    monkeypatch.setattr(zernio, "publish", fake_publish)
    rows = asyncio.run(
        publish_module.publish_to_targets(
            content="hello team",
            targets=[{
                "provider": "zernio",
                "workspace_id": 7,
                "platform": "facebook",
                "id": "acc_fb",
                "label": "Team Page",
                "media_urls": [],
            }],
        )
    )
    assert rows[0]["ok"] is True
    assert rows[0]["platform_post_id"] == "z_post"
    assert captured["workspace_id"] == 7
    assert captured["targets"][0]["id"] == "acc_fb"


def test_build_targets_from_post_crops_zernio_fallback(monkeypatch):
    from app import images, oauth

    monkeypatch.setattr(oauth, "_load_tokens", lambda _user_id: {})

    async def fake_fetch_meta_pages(_token):
        return []

    async def fake_list_accounts(_workspace_id):
        return [{"_id": "acc_ig", "platform": "instagram", "username": "brand"}]

    monkeypatch.setattr(oauth, "_fetch_meta_pages", fake_fetch_meta_pages)
    monkeypatch.setattr(zernio, "is_enabled", lambda _workspace_id: True)
    monkeypatch.setattr(zernio, "list_accounts", fake_list_accounts)
    monkeypatch.setattr(
        images,
        "crop_for_targets",
        lambda *, media_url, ratios, platform: f"{platform}:{media_url}",
    )

    resolved, skipped = asyncio.run(
        publish_module.build_targets_from_post(
            platforms={"instagram": True},
            media_url="https://cdn.example/original.jpg",
            user_id=7,
        )
    )

    assert skipped == []
    assert len(resolved) == 1
    assert resolved[0]["provider"] == "zernio"
    assert resolved[0]["media_url"] == "instagram:https://cdn.example/original.jpg"
    assert resolved[0]["media_urls"] == ["instagram:https://cdn.example/original.jpg"]
