"""Team & Access endpoints — workspace info, members, roles, invitations.

Every route is gated by a permission via authz.require_permission, so the role
catalog defines who can do what. Data is implicitly scoped to the caller's
active workspace (ctx.workspace_id); no route accepts a client-supplied
workspace id.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from . import workspaces
from .auth import (
    _auth_rate_limit_check,
    _auth_rate_limit_record_failure,
    _auth_rate_limit_reset,
    _send_email,
    require_token,
)
from .authz import WorkspaceContext, require_permission, require_workspace
from .db import get_user_by_email, get_user_by_id

log = logging.getLogger("datalia.workspaces")
router = APIRouter(tags=["workspace"])


class InviteRequest(BaseModel):
    email: str
    role_id: int


class MemberRoleBody(BaseModel):
    role_id: int


class RoleBody(BaseModel):
    name: str = ""
    permissions: list[str] = []


class SwitchBody(BaseModel):
    workspace_id: int


class CreateWorkspaceBody(BaseModel):
    name: str = ""


# ── Workspace ─────────────────────────────────────────────────────────────
@router.get("/workspace")
async def workspace_info(
    ctx: WorkspaceContext = Depends(require_workspace),
) -> dict[str, Any]:
    ws = workspaces.get_workspace(ctx.workspace_id) or {}
    return {
        "id": ctx.workspace_id,
        "name": ws.get("name"),
        "role": ctx.role,
        "permissions": sorted(ctx.permissions),
        "is_owner": workspaces.is_owner(ctx.workspace_id, ctx.user_id),
        "is_personal": bool(ws.get("is_personal")),
    }


@router.get("/workspace/permissions")
async def permission_catalog(
    ctx: WorkspaceContext = Depends(require_permission("roles.read")),
) -> dict[str, Any]:
    return {"groups": {k: list(v) for k, v in workspaces.PERMISSION_GROUPS.items()}}


# ── Members ───────────────────────────────────────────────────────────────
@router.get("/workspace/members")
async def members_list(
    ctx: WorkspaceContext = Depends(require_permission("members.read")),
) -> dict[str, Any]:
    members = workspaces.list_members(ctx.workspace_id)
    for m in members:
        uid = int(m["user_id"])
        m["user_id"] = uid
        m["is_owner"] = workspaces.is_owner(ctx.workspace_id, uid)
        m["is_self"] = uid == ctx.user_id
    return {"members": members}


@router.post("/workspace/members/invite")
async def members_invite(
    body: InviteRequest,
    request: Request,
    ctx: WorkspaceContext = Depends(require_permission("members.invite")),
) -> dict[str, Any]:
    email = (body.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "A valid email is required.")
    role = workspaces.get_role(body.role_id)
    if not role or int(role.get("workspace_id") or 0) != ctx.workspace_id:
        raise HTTPException(400, "Unknown role for this workspace.")
    rate_key = _auth_rate_limit_check("invite", request, f"{ctx.workspace_id}:{email}")
    # Invitations are restricted to people who already have a Datalia account —
    # you can't invite an arbitrary email into existence.
    existing = get_user_by_email(email)
    if not existing:
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(
            400, "No Datalia account exists for that email. Ask them to register first."
        )
    # Multi-workspace: a person may belong to many workspaces — only block
    # re-inviting someone already in THIS one.
    if workspaces.get_membership(int(existing["id"]), ctx.workspace_id):
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(400, "That person is already a member of this workspace.")
    token = workspaces.create_invitation(
        ctx.workspace_id, email, body.role_id, ctx.user_id
    )
    ws = workspaces.get_workspace(ctx.workspace_id) or {}
    base = os.getenv("PUBLIC_APP_URL", "").strip().rstrip("/")
    link = f"{base}/invite?token={token}"
    text = (
        f"You've been invited to join the workspace \"{ws.get('name')}\" on "
        f"Datalia as {role['name']}.\n\n"
        f"Accept the invitation (valid 7 days):\n{link}\n\n"
        "If you weren't expecting this, you can ignore this email."
    )
    try:
        if not _send_email(email, "You're invited to a Datalia workspace", text):
            log.warning(
                "Invitation for %s but no SMTP configured. Deliver manually: %s",
                email,
                link,
            )
    except Exception:
        log.exception("Failed to send invitation email to %s", email)
    _auth_rate_limit_reset(rate_key)
    return {"ok": True, "email": email}


@router.patch("/workspace/members/{user_id}")
async def members_change_role(
    user_id: int,
    body: MemberRoleBody,
    ctx: WorkspaceContext = Depends(require_permission("members.manage")),
) -> dict[str, Any]:
    if user_id == ctx.user_id:
        raise HTTPException(400, "You can't change your own role.")
    if not workspaces.get_membership(user_id, ctx.workspace_id):
        raise HTTPException(404, "Member not found.")
    if not workspaces.change_member_role(ctx.workspace_id, user_id, body.role_id):
        raise HTTPException(400, "Cannot change this member's role (unknown role, or demoting the owner).")
    return {"ok": True}


@router.delete("/workspace/members/{user_id}")
async def members_remove(
    user_id: int,
    ctx: WorkspaceContext = Depends(require_permission("members.manage")),
) -> dict[str, Any]:
    if user_id == ctx.user_id:
        raise HTTPException(400, "You can't remove yourself.")
    if not workspaces.remove_member(ctx.workspace_id, user_id):
        raise HTTPException(400, "Cannot remove this member (not found, or the owner).")
    return {"ok": True}


@router.delete("/workspace/members/{user_id}/account")
async def members_delete_account(
    user_id: int,
    ctx: WorkspaceContext = Depends(require_permission("members.manage")),
) -> dict[str, Any]:
    """Permanently delete another user's ACCOUNT (not just their membership) —
    destructive + irreversible. The target must be a member of this workspace
    and must not be its owner."""
    if user_id == ctx.user_id:
        raise HTTPException(400, "Use Delete account for yourself.")
    if not workspaces.get_membership(user_id, ctx.workspace_id):
        raise HTTPException(404, "Member not found.")
    if workspaces.is_owner(ctx.workspace_id, user_id):
        raise HTTPException(400, "You can't delete the workspace owner's account.")
    workspaces.delete_user(user_id)
    return {"ok": True}


# ── Workspace deletion / leave (destructive) ────────────────────────────────
@router.delete("/workspace")
async def workspace_delete(
    ctx: WorkspaceContext = Depends(require_permission("workspace.manage")),
) -> dict[str, Any]:
    """Delete the caller's active workspace and ALL its data (owner-only via the
    workspace.manage permission). Irreversible. A user's PERSONAL (home)
    workspace can never be deleted — create or switch to another workspace to
    delete that one instead."""
    if workspaces.is_personal_workspace(ctx.workspace_id):
        raise HTTPException(
            400,
            "You can't delete your personal workspace. Create or switch to "
            "another workspace to delete that one.",
        )
    workspaces.delete_workspace(ctx.workspace_id)
    return {"ok": True}


@router.post("/workspace/leave")
async def workspace_leave(
    ctx: WorkspaceContext = Depends(require_workspace),
) -> dict[str, Any]:
    """A non-owner member leaves their active workspace. The owner must transfer
    ownership or delete the workspace instead."""
    if not workspaces.leave_workspace(ctx.user_id, ctx.workspace_id):
        raise HTTPException(
            400,
            "You can't leave a workspace you own — transfer ownership or delete it instead.",
        )
    return {"ok": True}


# ── Roles ─────────────────────────────────────────────────────────────────
@router.get("/workspace/roles")
async def roles_list(
    ctx: WorkspaceContext = Depends(require_permission("roles.read")),
) -> dict[str, Any]:
    return {"roles": workspaces.list_roles(ctx.workspace_id)}


@router.post("/workspace/roles")
async def roles_create(
    body: RoleBody,
    ctx: WorkspaceContext = Depends(require_permission("roles.manage")),
) -> dict[str, Any]:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Role name is required.")
    if workspaces.get_role_id_by_name(ctx.workspace_id, name):
        raise HTTPException(400, "A role with that name already exists.")
    role_id = workspaces.create_role(ctx.workspace_id, name, body.permissions)
    return {"role": workspaces.get_role(role_id)}


@router.patch("/workspace/roles/{role_id}")
async def roles_update(
    role_id: int,
    body: RoleBody,
    ctx: WorkspaceContext = Depends(require_permission("roles.manage")),
) -> dict[str, Any]:
    role = workspaces.get_role(role_id)
    if not role or int(role.get("workspace_id") or 0) != ctx.workspace_id:
        raise HTTPException(404, "Role not found.")
    if role["is_system"]:
        raise HTTPException(400, "Built-in roles can't be modified.")
    workspaces.update_role(
        role_id,
        name=(body.name.strip() or None) if body.name else None,
        permissions=body.permissions,
    )
    return {"role": workspaces.get_role(role_id)}


@router.delete("/workspace/roles/{role_id}")
async def roles_delete(
    role_id: int,
    ctx: WorkspaceContext = Depends(require_permission("roles.manage")),
) -> dict[str, Any]:
    ok, reason = workspaces.delete_role(ctx.workspace_id, role_id)
    if not ok:
        msg = {
            "not_found": "Role not found.",
            "system_role": "Built-in roles can't be deleted.",
            "role_in_use": "That role is assigned to a member — reassign them first.",
        }.get(reason, "Cannot delete role.")
        raise HTTPException(400, msg)
    return {"ok": True}


# ── Invitations ───────────────────────────────────────────────────────────
@router.get("/workspace/invitations")
async def invitations_list(
    ctx: WorkspaceContext = Depends(require_permission("members.read")),
) -> dict[str, Any]:
    return {"invitations": workspaces.list_invitations(ctx.workspace_id)}


@router.delete("/workspace/invitations/{invitation_id}")
async def invitations_revoke(
    invitation_id: int,
    ctx: WorkspaceContext = Depends(require_permission("members.invite")),
) -> dict[str, Any]:
    if not workspaces.delete_invitation(ctx.workspace_id, invitation_id):
        raise HTTPException(404, "Invitation not found.")
    return {"ok": True}


# ── Multi-workspace: list mine + switch the active one ──────────────────────
@router.get("/workspaces")
async def my_workspaces(
    ctx: WorkspaceContext = Depends(require_workspace),
) -> dict[str, Any]:
    """Every workspace the caller belongs to (drives the switcher)."""
    return {"workspaces": workspaces.list_user_workspaces(ctx.user_id)}


@router.post("/workspace/switch")
async def workspace_switch(
    body: SwitchBody,
    ctx: WorkspaceContext = Depends(require_workspace),
) -> dict[str, Any]:
    """Switch the caller's active workspace (membership is verified). The client
    should re-fetch /auth/me to pick up the new role + permissions."""
    if not workspaces.switch_workspace(ctx.user_id, body.workspace_id):
        raise HTTPException(403, "You are not a member of that workspace.")
    return {"ok": True, "workspace_id": body.workspace_id}


@router.post("/workspaces")
async def workspaces_create(
    body: CreateWorkspaceBody,
    ctx: WorkspaceContext = Depends(require_workspace),
) -> dict[str, Any]:
    """Create a new (deletable, non-personal) workspace owned by the caller and
    switch to it — so a user can have more than just their home workspace."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Workspace name is required.")
    ws_id = workspaces.create_additional_workspace(ctx.user_id, name)
    workspaces.switch_workspace(ctx.user_id, ws_id)
    return {"ok": True, "workspace_id": ws_id}


# ── Invitations inbox (the invitee's own pending invites) ───────────────────
def _caller_email(user_id: int) -> str:
    if user_id <= 0:
        raise HTTPException(401, "Not signed in.")
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(401, "Not signed in.")
    return str(user["email"]).strip().lower()


@router.get("/invitations/mine")
async def invitations_mine(user_id: int = Depends(require_token)) -> dict[str, Any]:
    """Pending invitations addressed to the signed-in user (accept/refuse)."""
    return {"invitations": workspaces.list_invitations_for_email(_caller_email(user_id))}


@router.post("/invitations/{invitation_id}/accept")
async def invitation_accept(
    invitation_id: int, user_id: int = Depends(require_token)
) -> dict[str, Any]:
    email = _caller_email(user_id)
    inv = workspaces.get_invitation(invitation_id)
    if not inv or inv.get("accepted_at"):
        raise HTTPException(404, "Invitation not found.")
    if str(inv["email"]).strip().lower() != email:
        raise HTTPException(403, "This invitation isn't addressed to you.")
    if float(inv.get("expires_at") or 0) < time.time():
        workspaces.delete_invitation_by_id(int(inv["id"]))
        raise HTTPException(400, "This invitation has expired.")
    workspaces.add_member(int(inv["workspace_id"]), user_id, int(inv["role_id"]))
    workspaces.consume_invitation(int(inv["id"]))
    workspaces.switch_workspace(user_id, int(inv["workspace_id"]))
    return {"ok": True, "workspace_id": int(inv["workspace_id"])}


@router.post("/invitations/{invitation_id}/refuse")
async def invitation_refuse(
    invitation_id: int, user_id: int = Depends(require_token)
) -> dict[str, Any]:
    email = _caller_email(user_id)
    inv = workspaces.get_invitation(invitation_id)
    if not inv:
        raise HTTPException(404, "Invitation not found.")
    if str(inv["email"]).strip().lower() != email:
        raise HTTPException(403, "This invitation isn't addressed to you.")
    workspaces.delete_invitation_by_id(int(inv["id"]))
    return {"ok": True}
