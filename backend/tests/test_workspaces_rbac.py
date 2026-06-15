"""Workspaces + custom RBAC — isolation, permissions, invitations.

These are the security-critical tests for the Phase-1 workspace feature. They
require the MariaDB the app normally uses (the test harness points at the same
DB via conftest env). Run with:

    docker compose -f infra/docker-compose.yml exec -T caption-api \
        python -m pytest tests/test_workspaces_rbac.py -q

Each test forces real auth (settings.allow_open_auth = False) and uses separate
TestClient instances (separate cookie jars) to represent different users.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app import workspaces


def _new_client() -> TestClient:
    return TestClient(app)


def _register(client: TestClient, email: str, name: str = "U", pw: str = "secret123"):
    return client.post(
        "/auth/register", json={"email": email, "password": pw, "name": name}
    )


# ── 1. Registration bootstraps a workspace the user owns ──────────────────
def test_register_creates_owner_workspace():
    settings.allow_open_auth = False
    c = _new_client()
    assert _register(c, "owner@a.com", "Owner").status_code == 200

    ws = c.get("/workspace")
    assert ws.status_code == 200
    body = ws.json()
    assert body["role"] == "Owner"
    assert body["is_owner"] is True
    # Owner holds every catalog permission, including workspace.manage.
    assert set(body["permissions"]) == set(workspaces.ALL_PERMISSIONS)


# ── 2. Two workspaces cannot see each other's data (THE isolation test) ───
def test_two_workspaces_are_isolated():
    settings.allow_open_auth = False
    a, b = _new_client(), _new_client()
    _register(a, "a@x.com", "A")
    _register(b, "b@x.com", "B")

    made = a.post("/posts", json={"scheduledDate": "2026-06-01", "content": "secret-A"})
    assert made.status_code == 200
    pid = made.json()["id"]

    # A sees its own post...
    assert any(p["id"] == pid for p in a.get("/posts").json()["posts"])
    # ...B sees nothing of A's, and a direct cross-workspace mutation 404s.
    assert b.get("/posts").json()["posts"] == []
    assert b.patch(f"/posts/{pid}", json={"status": "approved"}).status_code == 404
    assert b.delete(f"/posts/{pid}").status_code == 404


# ── 3. Seeded roles + their permission sets ───────────────────────────────
def test_seeded_roles_and_permissions():
    settings.allow_open_auth = False
    c = _new_client()
    _register(c, "owner@r.com", "Owner")

    roles = {r["name"]: r for r in c.get("/workspace/roles").json()["roles"]}
    assert set(roles) == {"Owner", "Admin", "Editor", "Viewer"}
    assert all(roles[n]["is_system"] for n in roles)
    assert "workspace.manage" in roles["Owner"]["permissions"]
    assert "workspace.manage" not in roles["Admin"]["permissions"]
    assert "posts.publish" in roles["Editor"]["permissions"]
    assert "members.manage" not in roles["Editor"]["permissions"]
    assert all(p.endswith(".read") for p in roles["Viewer"]["permissions"])


# ── 4. Invite → accept → shared workspace (collaboration) ─────────────────
def test_invite_accept_collaboration():
    settings.allow_open_auth = False
    owner = _new_client()
    _register(owner, "owner@team.com", "Owner")
    ws_id = owner.get("/workspace").json()["id"]
    owner_uid = int(owner.get("/auth/me").json()["id"])
    editor_role = workspaces.get_role_id_by_name(ws_id, "Editor")

    owner.post("/posts", json={"scheduledDate": "2026-06-01", "content": "team-post"})

    # Create the invitation via the helper to obtain the raw token (the email
    # endpoint only returns {ok}). Then accept as a brand-new account.
    token = workspaces.create_invitation(ws_id, "member@team.com", editor_role, owner_uid)
    member = _new_client()
    acc = member.post(
        "/auth/accept-invite",
        json={"token": token, "name": "Member", "password": "secret123"},
    )
    assert acc.status_code == 200

    # The invited member now collaborates in the SAME workspace and sees the
    # owner's post.
    mws = member.get("/workspace").json()
    assert mws["id"] == ws_id and mws["role"] == "Editor"
    assert any(p["content"] == "team-post" for p in member.get("/posts").json()["posts"])

    # The token is single-use.
    assert member.post(
        "/auth/accept-invite",
        json={"token": token, "password": "secret123"},
    ).status_code == 400


# ── 5. Role permissions actually gate actions ─────────────────────────────
def test_viewer_role_is_read_only():
    settings.allow_open_auth = False
    owner = _new_client()
    _register(owner, "owner@v.com", "Owner")
    ws_id = owner.get("/workspace").json()["id"]
    owner_uid = int(owner.get("/auth/me").json()["id"])
    viewer_role = workspaces.get_role_id_by_name(ws_id, "Viewer")

    token = workspaces.create_invitation(ws_id, "viewer@v.com", viewer_role, owner_uid)
    viewer = _new_client()
    viewer.post(
        "/auth/accept-invite",
        json={"token": token, "name": "Viewer", "password": "secret123"},
    )

    # Viewer can READ...
    assert viewer.get("/posts").status_code == 200
    # ...but cannot create or publish (403, not 404 — permission, not isolation).
    assert viewer.post(
        "/posts", json={"scheduledDate": "2026-06-01", "content": "x"}
    ).status_code == 403
    assert viewer.post("/settings/keys", json={"updates": {}}).status_code in (403, 405)


# ── 6. Revoking a permission takes effect immediately ─────────────────────
def test_permission_change_is_live():
    settings.allow_open_auth = False
    owner = _new_client()
    _register(owner, "owner@live.com", "Owner")
    ws_id = owner.get("/workspace").json()["id"]
    owner_uid = int(owner.get("/auth/me").json()["id"])
    editor_role = workspaces.get_role_id_by_name(ws_id, "Editor")
    viewer_role = workspaces.get_role_id_by_name(ws_id, "Viewer")

    token = workspaces.create_invitation(ws_id, "ed@live.com", editor_role, owner_uid)
    member = _new_client()
    member.post(
        "/auth/accept-invite",
        json={"token": token, "name": "Ed", "password": "secret123"},
    )
    member_uid = int(member.get("/auth/me").json()["id"])

    # As Editor the member can create.
    assert member.post(
        "/posts", json={"scheduledDate": "2026-06-01", "content": "ok"}
    ).status_code == 200

    # Owner demotes them to Viewer → next create is 403 with no re-login.
    assert owner.patch(
        f"/workspace/members/{member_uid}", json={"role_id": viewer_role}
    ).status_code == 200
    assert member.post(
        "/posts", json={"scheduledDate": "2026-06-02", "content": "no"}
    ).status_code == 403
