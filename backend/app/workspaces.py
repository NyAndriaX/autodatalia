"""Workspaces + custom RBAC control plane (Phase 1).

Real MariaDB tables (created in ``db.init_db``) hold the authorization control
plane — workspaces, memberships, roles, role_permissions, invitations. Tenant
*data* stays in ``app_documents`` but is scoped by ``ws:{workspace_id}`` (see
``db._scope_key``) so members of a workspace collaborate on the same data while
remaining isolated from other workspaces.

This module is intentionally side-effect free at import time: it only defines the
permission catalog and pure data helpers. Seeding happens per workspace at
registration / migration time.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import shutil
import time
from typing import Any

from .config import settings
from .db import _DOC_TABLE, _connect, _execute, _fetchall, _fetchone

log = logging.getLogger("datalia.workspaces")

# ---------------------------------------------------------------------------
# Permission catalog — the single allowlist that BOTH the role editor and
# `authz.require_permission` validate against. Grouped by area to drive the
# frontend permission matrix. Adding a permission here is the only way to make
# it assignable; an unknown key is silently dropped on write (see
# `set_role_permissions`) so a client can never grant a permission the backend
# doesn't enforce.
# ---------------------------------------------------------------------------
PERMISSION_GROUPS: dict[str, tuple[str, ...]] = {
    "content": (
        "posts.read",
        "posts.create",
        "posts.update",
        "posts.delete",
        "posts.publish",
    ),
    "ai": ("ai.generate", "media.generate"),
    "media": ("media.read", "media.upload", "media.delete"),
    "automation": ("automation.read", "automation.write", "automation.validate"),
    "connections": ("connections.read", "connections.manage"),
    "settings": ("settings.read", "settings.manage"),
    "team": (
        "members.read",
        "members.invite",
        "members.manage",
        "roles.read",
        "roles.manage",
        "workspace.manage",
    ),
}

ALL_PERMISSIONS: frozenset[str] = frozenset(
    p for perms in PERMISSION_GROUPS.values() for p in perms
)

_READ_PERMISSIONS: frozenset[str] = frozenset(
    p for p in ALL_PERMISSIONS if p.endswith(".read")
)

# Editor: full content/AI/media/automation, can see (not manage) connections &
# settings, but no team administration and no key rotation.
_EDITOR_PERMISSIONS: frozenset[str] = frozenset(
    {
        "posts.read",
        "posts.create",
        "posts.update",
        "posts.delete",
        "posts.publish",
        "ai.generate",
        "media.generate",
        "media.read",
        "media.upload",
        "media.delete",
        "automation.read",
        "automation.write",
        "automation.validate",
        "connections.read",
        "settings.read",
    }
)

# Seeded per-workspace default roles. Order matters: Owner is created first and
# assigned to the workspace creator. All four are is_system (not deletable;
# Owner is immutable). `workspace.manage` (rename / transfer / delete) is
# Owner-only.
DEFAULT_ROLES: tuple[dict[str, Any], ...] = (
    {"name": "Owner", "permissions": ALL_PERMISSIONS},
    {"name": "Admin", "permissions": ALL_PERMISSIONS - {"workspace.manage"}},
    {"name": "Editor", "permissions": _EDITOR_PERMISSIONS},
    {"name": "Viewer", "permissions": _READ_PERMISSIONS},
)

OWNER_ROLE_NAME = "Owner"
DEFAULT_INVITE_ROLE_NAME = "Editor"
INVITATION_TTL_SECONDS = 7 * 24 * 3600


def _now() -> float:
    return time.time()


def workspace_name_for(full_name: str | None, email: str | None) -> str:
    """A friendly default name for a user's personal workspace."""
    base = (full_name or "").strip() or (email or "").split("@", 1)[0].strip()
    base = base or "My"
    return f"{base}'s workspace"


# ---------------------------------------------------------------------------
# Workspace / role / membership creation (used by registration + migration)
# ---------------------------------------------------------------------------
def create_workspace(name: str, owner_user_id: int, *, is_personal: bool = False) -> int:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO workspaces (name, owner_user_id, is_personal, created_at) "
            "VALUES (%s, %s, %s, %s)",
            (name, int(owner_user_id), 1 if is_personal else 0, _now()),
        )
        return int(cur.lastrowid)
    finally:
        conn.close()


def _create_role_row(workspace_id: int, name: str, *, is_system: bool = False) -> int:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO roles (workspace_id, name, is_system, created_at) "
            "VALUES (%s, %s, %s, %s)",
            (int(workspace_id), name, 1 if is_system else 0, _now()),
        )
        return int(cur.lastrowid)
    finally:
        conn.close()


def set_role_permissions(role_id: int, permissions: "frozenset[str] | set[str] | list[str] | tuple[str, ...]") -> None:
    """Replace a role's permission set. Unknown keys are dropped (only catalog
    permissions can ever be granted)."""
    valid = sorted({p for p in permissions if p in ALL_PERMISSIONS})
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM role_permissions WHERE role_id = %s", (int(role_id),))
        for perm in valid:
            cur.execute(
                "INSERT INTO role_permissions (role_id, permission_key) VALUES (%s, %s)",
                (int(role_id), perm),
            )
    finally:
        conn.close()


def seed_default_roles(workspace_id: int) -> dict[str, int]:
    """Create the four system roles for a workspace; return {name: role_id}."""
    out: dict[str, int] = {}
    for spec in DEFAULT_ROLES:
        role_id = _create_role_row(workspace_id, spec["name"], is_system=True)
        set_role_permissions(role_id, spec["permissions"])
        out[spec["name"]] = role_id
    return out


def add_member(workspace_id: int, user_id: int, role_id: int) -> None:
    _execute(
        "INSERT INTO workspace_members (workspace_id, user_id, role_id, created_at) "
        "VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)",
        (int(workspace_id), int(user_id), int(role_id), _now()),
    )


def create_workspace_with_owner(
    name: str, owner_user_id: int, *, is_personal: bool = True
) -> int:
    """Atomic-ish bootstrap: workspace + seeded roles + owner membership.

    Used by registration and by the legacy migration so a user can never exist
    without a workspace — those create the user's PERSONAL (home) workspace, so
    is_personal defaults True. Additional workspaces created later pass
    is_personal=False (see create_additional_workspace). Returns the new id.
    """
    workspace_id = create_workspace(name, owner_user_id, is_personal=is_personal)
    roles = seed_default_roles(workspace_id)
    add_member(workspace_id, owner_user_id, roles[OWNER_ROLE_NAME])
    return workspace_id


def create_additional_workspace(owner_user_id: int, name: str) -> int:
    """Create a NON-personal workspace the user owns (the 'create workspace'
    action). Unlike the home workspace, an additional one can be deleted."""
    return create_workspace_with_owner(name, owner_user_id, is_personal=False)


# ---------------------------------------------------------------------------
# Resolution helpers (the security-critical reads used by authz)
# ---------------------------------------------------------------------------
def get_active_workspace_id(user_id: int) -> int | None:
    """The user's ACTIVE workspace (multi-workspace membership + switcher).

    Prefers ``users.active_workspace_id`` when the user is still a member of it;
    otherwise falls back to their earliest membership. None if they belong to no
    workspace.
    """
    if not user_id or int(user_id) <= 0:
        return None
    uid = int(user_id)
    row = _fetchone("SELECT active_workspace_id FROM users WHERE id = %s", (uid,))
    active = (row or {}).get("active_workspace_id")
    if active and get_membership(uid, int(active)):
        return int(active)
    first = _fetchone(
        "SELECT workspace_id FROM workspace_members WHERE user_id = %s "
        "ORDER BY id ASC LIMIT 1",
        (uid,),
    )
    return int(first["workspace_id"]) if first else None


def switch_workspace(user_id: int, workspace_id: int) -> bool:
    """Set the user's active workspace. False if they aren't a member of it."""
    if not get_membership(int(user_id), int(workspace_id)):
        return False
    _execute(
        "UPDATE users SET active_workspace_id = %s WHERE id = %s",
        (int(workspace_id), int(user_id)),
    )
    return True


def list_user_workspaces(user_id: int) -> list[dict[str, Any]]:
    """Every workspace the user belongs to, with their role there + which is active."""
    uid = int(user_id)
    active = get_active_workspace_id(uid)
    rows = _fetchall(
        """
        SELECT w.id, w.name, w.owner_user_id, w.is_personal, r.name AS role_name
        FROM workspace_members m
        JOIN workspaces w ON w.id = m.workspace_id
        JOIN roles r ON r.id = m.role_id
        WHERE m.user_id = %s
        ORDER BY m.created_at ASC
        """,
        (uid,),
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        wid = int(r["id"])
        out.append(
            {
                "id": wid,
                "name": r["name"],
                "role": r["role_name"],
                "is_owner": int(r["owner_user_id"]) == uid,
                "is_personal": bool(r["is_personal"]),
                "is_active": wid == active,
            }
        )
    return out


def list_invitations_for_email(email: str) -> list[dict[str, Any]]:
    """Pending invitations addressed to this email — the invitee's inbox."""
    return _fetchall(
        """
        SELECT i.id, i.workspace_id, i.role_id, r.name AS role_name,
               w.name AS workspace_name, i.created_at, i.expires_at
        FROM workspace_invitations i
        JOIN roles r ON r.id = i.role_id
        JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.email = %s AND i.accepted_at IS NULL
        ORDER BY i.created_at DESC
        """,
        ((email or "").strip().lower(),),
    )


def get_invitation(invitation_id: int) -> dict[str, Any] | None:
    return _fetchone(
        "SELECT * FROM workspace_invitations WHERE id = %s", (int(invitation_id),)
    )


def delete_invitation_by_id(invitation_id: int) -> bool:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM workspace_invitations WHERE id = %s", (int(invitation_id),)
        )
        return cur.rowcount > 0
    finally:
        conn.close()


def get_membership(user_id: int, workspace_id: int) -> dict[str, Any] | None:
    return _fetchone(
        "SELECT * FROM workspace_members WHERE user_id = %s AND workspace_id = %s",
        (int(user_id), int(workspace_id)),
    )


def permissions_for(user_id: int, workspace_id: int) -> set[str]:
    """Effective permission set for a user IN a workspace, read live from the DB.

    The JOIN on workspace_members is the authorization boundary: if the user is
    not a member of that workspace the result is empty. Never cached — role,
    permission, and membership changes take effect on the next call.
    """
    rows = _fetchall(
        """
        SELECT rp.permission_key AS pk
        FROM workspace_members m
        JOIN role_permissions rp ON rp.role_id = m.role_id
        WHERE m.user_id = %s AND m.workspace_id = %s
        """,
        (int(user_id), int(workspace_id)),
    )
    return {r["pk"] for r in rows if r.get("pk") in ALL_PERMISSIONS}


def role_name_for(user_id: int, workspace_id: int) -> str | None:
    row = _fetchone(
        """
        SELECT r.name AS name
        FROM workspace_members m JOIN roles r ON r.id = m.role_id
        WHERE m.user_id = %s AND m.workspace_id = %s
        """,
        (int(user_id), int(workspace_id)),
    )
    return row["name"] if row else None


# ---------------------------------------------------------------------------
# Workspace + role reads
# ---------------------------------------------------------------------------
def get_workspace(workspace_id: int) -> dict[str, Any] | None:
    row = _fetchone(
        "SELECT id, name, owner_user_id, is_personal, created_at FROM workspaces WHERE id = %s",
        (int(workspace_id),),
    )
    if row:
        row["is_personal"] = bool(row.get("is_personal"))
    return row


def get_role(role_id: int) -> dict[str, Any] | None:
    row = _fetchone(
        "SELECT id, workspace_id, name, is_system FROM roles WHERE id = %s",
        (int(role_id),),
    )
    if not row:
        return None
    row["is_system"] = bool(row["is_system"])
    row["permissions"] = [
        r["permission_key"]
        for r in _fetchall(
            "SELECT permission_key FROM role_permissions WHERE role_id = %s",
            (int(role_id),),
        )
    ]
    return row


def list_roles(workspace_id: int) -> list[dict[str, Any]]:
    roles = _fetchall(
        "SELECT id, name, is_system FROM roles WHERE workspace_id = %s ORDER BY id ASC",
        (int(workspace_id),),
    )
    for r in roles:
        r["is_system"] = bool(r["is_system"])
        r["permissions"] = [
            p["permission_key"]
            for p in _fetchall(
                "SELECT permission_key FROM role_permissions WHERE role_id = %s",
                (int(r["id"]),),
            )
        ]
    return roles


def get_role_id_by_name(workspace_id: int, name: str) -> int | None:
    row = _fetchone(
        "SELECT id FROM roles WHERE workspace_id = %s AND name = %s",
        (int(workspace_id), name),
    )
    return int(row["id"]) if row else None


# ---------------------------------------------------------------------------
# Invitation token hashing (raw token is emailed; only the hash is stored)
# ---------------------------------------------------------------------------
def hash_invite_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def new_invite_token() -> str:
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# One-time migration: flat per-user data -> per-workspace
# ---------------------------------------------------------------------------
# Document collections whose rows carry a per-item owner; the migration stamps
# payload["workspace_id"] on these so background workers can resolve scope.
# Blob collections (oauth_tokens, runtime_settings, ai_cache, blobs) only need
# their scope_key moved — their payload is opaque content, not an owned record.
_OWNED_DOC_COLLECTIONS = frozenset(
    {"posts", "automation_rules", "messages", "video_jobs", "cost_logs"}
)


def _rescope_user_data(user_id: int, workspace_id: int) -> int:
    """Move every app_documents row from ``user:{uid}`` to ``ws:{wsid}`` and
    stamp ``workspace_id`` on owned documents. Returns rows moved."""
    old_scope = f"user:{int(user_id)}"
    new_scope = f"ws:{int(workspace_id)}"
    rows = _fetchall(
        f"SELECT collection_name, doc_id, sort_ts, payload_json, created_at "
        f"FROM {_DOC_TABLE} WHERE scope_key = %s",
        (old_scope,),
    )
    if not rows:
        return 0
    conn = _connect()
    try:
        cur = conn.cursor()
        for r in rows:
            try:
                payload = json.loads(r["payload_json"]) if r["payload_json"] else {}
            except Exception:
                payload = {}
            if (
                isinstance(payload, dict)
                and r["collection_name"] in _OWNED_DOC_COLLECTIONS
            ):
                payload["workspace_id"] = int(workspace_id)
            encoded = json.dumps(payload, ensure_ascii=False)
            cur.execute(
                f"INSERT INTO {_DOC_TABLE} "
                "(collection_name, scope_key, doc_id, sort_ts, payload_json, "
                "created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s) "
                "ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json), "
                "sort_ts=VALUES(sort_ts), updated_at=VALUES(updated_at)",
                (
                    r["collection_name"],
                    new_scope,
                    r["doc_id"],
                    r["sort_ts"],
                    encoded,
                    r["created_at"],
                    _now(),
                ),
            )
            cur.execute(
                f"DELETE FROM {_DOC_TABLE} "
                "WHERE collection_name=%s AND scope_key=%s AND doc_id=%s",
                (r["collection_name"], old_scope, r["doc_id"]),
            )
        return len(rows)
    finally:
        conn.close()


def is_owner(workspace_id: int, user_id: int) -> bool:
    ws = get_workspace(workspace_id)
    return bool(ws and int(ws["owner_user_id"]) == int(user_id))


def is_personal_workspace(workspace_id: int) -> bool:
    """True if this is a user's home workspace (created at registration) — these
    can never be deleted."""
    ws = get_workspace(workspace_id)
    return bool(ws and ws.get("is_personal"))


def get_personal_workspace_id(user_id: int) -> int | None:
    """The user's home workspace (owned + is_personal), earliest if several."""
    row = _fetchone(
        "SELECT id FROM workspaces WHERE owner_user_id = %s AND is_personal = 1 "
        "ORDER BY id ASC LIMIT 1",
        (int(user_id),),
    )
    return int(row["id"]) if row else None


def ensure_personal_workspace(
    user_id: int, full_name: str | None = None, email: str | None = None
) -> int:
    """Guarantee the user has a home workspace, creating one if missing and
    pointing their active workspace at it. Safety net so a user can never be left
    workspace-less. Returns the personal workspace id."""
    pid = get_personal_workspace_id(int(user_id))
    if pid:
        return pid
    ws_id = create_workspace_with_owner(
        workspace_name_for(full_name, email), int(user_id), is_personal=True
    )
    _execute(
        "UPDATE users SET active_workspace_id = %s WHERE id = %s",
        (int(ws_id), int(user_id)),
    )
    return ws_id


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------
def list_members(workspace_id: int) -> list[dict[str, Any]]:
    return _fetchall(
        """
        SELECT m.user_id, m.role_id, r.name AS role_name,
               u.email, u.full_name, m.created_at
        FROM workspace_members m
        JOIN roles r ON r.id = m.role_id
        JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = %s
        ORDER BY m.created_at ASC
        """,
        (int(workspace_id),),
    )


def change_member_role(workspace_id: int, user_id: int, role_id: int) -> bool:
    """Change a member's role. The role must belong to this workspace, and the
    sole Owner cannot be demoted (would orphan the workspace)."""
    role = get_role(role_id)
    if not role or int(role.get("workspace_id") or 0) != int(workspace_id):
        return False
    if role["name"] == OWNER_ROLE_NAME and not is_owner(workspace_id, user_id):
        return False  # ownership only moves via transfer_ownership()
    if is_owner(workspace_id, user_id) and role["name"] != OWNER_ROLE_NAME:
        return False  # never demote the workspace owner
    _execute(
        "UPDATE workspace_members SET role_id = %s WHERE workspace_id = %s AND user_id = %s",
        (int(role_id), int(workspace_id), int(user_id)),
    )
    return True


def remove_member(workspace_id: int, user_id: int) -> bool:
    if is_owner(workspace_id, user_id):
        return False  # the owner cannot be removed
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM workspace_members WHERE workspace_id = %s AND user_id = %s",
            (int(workspace_id), int(user_id)),
        )
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Deletion — workspace / leave / account (all destructive + irreversible)
# ---------------------------------------------------------------------------
def _delete_workspace_rows(cur, workspace_id: int) -> None:
    """Delete all DB rows owned by one workspace using the caller's cursor."""
    wid = int(workspace_id)
    cur.execute("SELECT id FROM roles WHERE workspace_id = %s", (wid,))
    role_ids = [int(r["id"]) for r in cur.fetchall()]
    if role_ids:
        placeholders = ",".join(["%s"] * len(role_ids))
        cur.execute(
            f"DELETE FROM role_permissions WHERE role_id IN ({placeholders})",
            tuple(role_ids),
        )
    cur.execute("DELETE FROM roles WHERE workspace_id = %s", (wid,))
    cur.execute("DELETE FROM workspace_members WHERE workspace_id = %s", (wid,))
    cur.execute("DELETE FROM workspace_invitations WHERE workspace_id = %s", (wid,))
    cur.execute(f"DELETE FROM {_DOC_TABLE} WHERE scope_key = %s", (f"ws:{wid}",))
    cur.execute(
        "UPDATE users SET active_workspace_id = NULL WHERE active_workspace_id = %s",
        (wid,),
    )
    cur.execute("DELETE FROM workspaces WHERE id = %s", (wid,))


def _transfer_ownership_rows(cur, workspace_id: int, new_owner_user_id: int) -> bool:
    """Cursor-aware ownership transfer used inside larger transactions."""
    wid, nid = int(workspace_id), int(new_owner_user_id)
    if not get_membership(nid, wid):
        return False
    cur.execute("UPDATE workspaces SET owner_user_id = %s WHERE id = %s", (nid, wid))
    owner_role_id = get_role_id_by_name(wid, OWNER_ROLE_NAME)
    if owner_role_id:
        cur.execute(
            "UPDATE workspace_members SET role_id = %s WHERE workspace_id = %s AND user_id = %s",
            (int(owner_role_id), wid, nid),
        )
    return True


def transfer_ownership(workspace_id: int, new_owner_user_id: int) -> bool:
    """Make ``new_owner_user_id`` the workspace owner and give them the Owner
    role. They must already be a member."""
    conn = _connect()
    try:
        conn.begin()
        cur = conn.cursor()
        ok = _transfer_ownership_rows(cur, int(workspace_id), int(new_owner_user_id))
        if not ok:
            conn.rollback()
            return False
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _delete_workspace_media(workspace_id: int) -> None:
    # Media cleanup must never block the DB delete — swallow any FS error.
    try:
        shutil.rmtree(settings.content_dir / "ws" / str(int(workspace_id)), ignore_errors=True)
    except Exception:  # noqa: BLE001
        pass


def delete_workspace(workspace_id: int) -> bool:
    """Delete a workspace and ALL of its data: roles, role-permissions, members,
    invitations, the tenant's app_documents (``ws:{id}`` scope) and uploaded
    media. Clears ``active_workspace_id`` for anyone pointing at it."""
    wid = int(workspace_id)
    conn = _connect()
    try:
        conn.begin()
        cur = conn.cursor()
        _delete_workspace_rows(cur, wid)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _delete_workspace_media(wid)
    return True


def leave_workspace(user_id: int, workspace_id: int) -> bool:
    """A non-owner member removes themselves. The owner must transfer ownership
    or delete the workspace instead (returns False for an owner / non-member)."""
    uid, wid = int(user_id), int(workspace_id)
    if is_owner(wid, uid):
        return False
    if not get_membership(uid, wid):
        return False
    _execute(
        "DELETE FROM workspace_members WHERE workspace_id = %s AND user_id = %s",
        (wid, uid),
    )
    # If they were sitting in this workspace, repoint active to any remaining one.
    _execute(
        "UPDATE users SET active_workspace_id = "
        "(SELECT workspace_id FROM workspace_members WHERE user_id = %s ORDER BY id ASC LIMIT 1) "
        "WHERE id = %s AND active_workspace_id = %s",
        (uid, uid, wid),
    )
    return True


def delete_user(user_id: int) -> bool:
    """Delete a user account. For each workspace they OWN: transfer ownership to
    the earliest other member if any, else delete the workspace outright. Then
    drop all remaining memberships and the user row.

    Media for any workspace that is fully deleted (no heir) is removed from disk
    AFTER the DB transaction commits — mirroring ``delete_workspace`` — so a
    deleted account leaves no orphaned ``content/ws/{id}/`` files behind and a
    later re-registration with the same email starts from a clean slate.

    Pending invitations addressed to this user's email are also purged, so a
    re-registration with the same address starts with an empty inbox rather than
    inheriting invites that were sent to the now-deleted account."""
    uid = int(user_id)
    deleted_media_wids: list[int] = []
    conn = _connect()
    try:
        conn.begin()
        cur = conn.cursor()
        # Capture the email up front (inside the txn) so we can purge invitations
        # addressed to it before the users row is gone.
        cur.execute("SELECT email FROM users WHERE id = %s", (uid,))
        urow = cur.fetchone()
        email = str((urow or {}).get("email") or "").strip().lower()
        cur.execute("SELECT id FROM workspaces WHERE owner_user_id = %s", (uid,))
        owned = [dict(row) for row in cur.fetchall()]
        for row in owned:
            wid = int(row["id"])
            cur.execute(
                "SELECT user_id FROM workspace_members "
                "WHERE workspace_id = %s AND user_id <> %s ORDER BY created_at ASC, id ASC LIMIT 1",
                (wid, uid),
            )
            heir = cur.fetchone()
            if heir:
                ok = _transfer_ownership_rows(cur, wid, int(heir["user_id"]))
                if not ok:
                    conn.rollback()
                    return False
            else:
                _delete_workspace_rows(cur, wid)
                deleted_media_wids.append(wid)
        cur.execute("DELETE FROM workspace_members WHERE user_id = %s", (uid,))
        cur.execute("DELETE FROM users WHERE id = %s", (uid,))
        if email:
            # Purge invitations addressed to this email (the deleted account's
            # inbox). Invites the user SENT for workspaces that survive (via heir
            # transfer) stay valid; only the addressee's pending invites go.
            cur.execute(
                "DELETE FROM workspace_invitations WHERE email = %s", (email,)
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    for wid in deleted_media_wids:
        _delete_workspace_media(wid)
    return True


# ---------------------------------------------------------------------------
# Roles (write)
# ---------------------------------------------------------------------------
def create_role(workspace_id: int, name: str, permissions) -> int:
    role_id = _create_role_row(workspace_id, name, is_system=False)
    set_role_permissions(role_id, permissions)
    return role_id


def update_role(role_id: int, *, name: str | None = None, permissions=None) -> bool:
    role = get_role(role_id)
    if not role:
        return False
    # Built-in (system) roles are immutable — neither the name nor the
    # permission set can change (Owner/Admin/Editor/Viewer stay as seeded).
    if role["is_system"]:
        return False
    if name is not None:
        _execute("UPDATE roles SET name = %s WHERE id = %s", (name, int(role_id)))
    if permissions is not None:
        set_role_permissions(role_id, permissions)
    return True


def delete_role(workspace_id: int, role_id: int) -> tuple[bool, str]:
    role = get_role(role_id)
    if not role or int(role.get("workspace_id") or 0) != int(workspace_id):
        return False, "not_found"
    if role["is_system"]:
        return False, "system_role"
    used = _fetchone(
        "SELECT COUNT(*) AS n FROM workspace_members WHERE role_id = %s", (int(role_id),)
    )
    if int((used or {}).get("n") or 0) > 0:
        return False, "role_in_use"
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM role_permissions WHERE role_id = %s", (int(role_id),))
        cur.execute("DELETE FROM roles WHERE id = %s", (int(role_id),))
    finally:
        conn.close()
    return True, "ok"


# ---------------------------------------------------------------------------
# Invitations
# ---------------------------------------------------------------------------
def create_invitation(workspace_id: int, email: str, role_id: int, invited_by: int) -> str:
    """Create an invitation and return the RAW token (emailed; only its hash is
    stored)."""
    token = new_invite_token()
    _execute(
        "INSERT INTO workspace_invitations "
        "(workspace_id, email, role_id, token_hash, invited_by, expires_at, "
        "accepted_at, created_at) VALUES (%s, %s, %s, %s, %s, %s, NULL, %s)",
        (
            int(workspace_id),
            email.strip().lower(),
            int(role_id),
            hash_invite_token(token),
            int(invited_by),
            _now() + INVITATION_TTL_SECONDS,
            _now(),
        ),
    )
    return token


def get_invitation_by_token(token: str) -> dict[str, Any] | None:
    return _fetchone(
        "SELECT * FROM workspace_invitations WHERE token_hash = %s",
        (hash_invite_token(token),),
    )


def list_invitations(workspace_id: int, *, pending_only: bool = True) -> list[dict[str, Any]]:
    q = (
        "SELECT i.id, i.email, i.role_id, r.name AS role_name, i.expires_at, "
        "i.accepted_at, i.created_at FROM workspace_invitations i "
        "JOIN roles r ON r.id = i.role_id WHERE i.workspace_id = %s"
    )
    if pending_only:
        q += " AND i.accepted_at IS NULL"
    q += " ORDER BY i.created_at DESC"
    return _fetchall(q, (int(workspace_id),))


def delete_invitation(workspace_id: int, invitation_id: int) -> bool:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM workspace_invitations WHERE id = %s AND workspace_id = %s",
            (int(invitation_id), int(workspace_id)),
        )
        return cur.rowcount > 0
    finally:
        conn.close()


def consume_invitation(invitation_id: int) -> None:
    _execute(
        "UPDATE workspace_invitations SET accepted_at = %s WHERE id = %s",
        (_now(), int(invitation_id)),
    )


def migrate_to_workspaces() -> None:
    """One-time, idempotent: give every existing user a personal workspace they
    own, and move their ``user:{id}``-scoped data into ``ws:{workspace_id}``.

    No-op once any workspace exists, so it is safe to call on every boot (it runs
    from ``db.init_db`` right after ``migrate_legacy_state``). NOTE: this must be
    deployed together with the ``_scope_key`` -> ``ws:`` cutover, otherwise the
    running app (still reading ``user:``) would see the moved data as missing.
    """
    existing = _fetchone("SELECT COUNT(*) AS n FROM workspaces", ())
    if int((existing or {}).get("n") or 0) > 0:
        return
    users = _fetchall("SELECT id, email, full_name FROM users ORDER BY id ASC", ())
    if not users:
        return  # fresh install — registration creates workspaces on demand
    for u in users:
        uid = int(u["id"])
        ws_id = create_workspace_with_owner(
            workspace_name_for(u.get("full_name"), u.get("email")), uid
        )
        moved = _rescope_user_data(uid, ws_id)
        log.info(
            "[workspaces] migrated user %s -> workspace %s (%s docs moved)",
            uid,
            ws_id,
            moved,
        )
