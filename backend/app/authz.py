"""Workspace authorization layer.

``auth.require_token`` answers *who* the caller is (identity → user_id). This
module answers *what they may do*: it resolves the caller's active workspace and
their effective permission set — read LIVE from the DB on every request, so role
/ permission / membership changes take effect immediately — and exposes
``require_permission("<perm>")`` for routes to depend on.

The data-layer scope isolation (``db._scope_key`` + ``AND scope_key=%s``) stays
as defense-in-depth: a handler that scopes by ``ctx.workspace_id`` cannot reach
another workspace's rows even if a permission check were wrong.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

from .auth import require_token
from .runtime_config import set_active_workspace
from .workspaces import get_active_workspace_id, permissions_for, role_name_for


@dataclass(frozen=True)
class WorkspaceContext:
    user_id: int          # the authenticated caller (author / audit)
    workspace_id: int     # the scope owner for all data access
    permissions: frozenset[str]
    role: str | None = None

    def has(self, permission: str) -> bool:
        return permission in self.permissions


def require_workspace(
    request: Request, user_id: int = Depends(require_token)
) -> WorkspaceContext:
    """Resolve the caller's active workspace + permissions, or 401/403.

    The shared/global machine identity (``user_id <= 0``) has no workspace and is
    rejected here, exactly as ``auth.get_me`` rejects it for ``/me``. The active
    workspace derives ONLY from ``workspace_members`` — no route accepts a
    client-supplied workspace id.
    """
    if user_id <= 0:
        raise HTTPException(status_code=401, detail="Not signed in to a workspace.")
    workspace_id = get_active_workspace_id(user_id)
    if workspace_id is None:
        raise HTTPException(status_code=403, detail="No active workspace.")
    perms = frozenset(permissions_for(user_id, workspace_id))
    # Make the active workspace available to in-process code (e.g.
    # runtime_config settings resolution) without threading it everywhere.
    set_active_workspace(workspace_id)
    return WorkspaceContext(
        user_id=user_id,
        workspace_id=workspace_id,
        permissions=perms,
        role=role_name_for(user_id, workspace_id),
    )


def require_permission(permission: str):
    """Dependency factory: 403 unless the caller's active workspace grants
    ``permission``."""

    def _dep(ctx: WorkspaceContext = Depends(require_workspace)) -> WorkspaceContext:
        if permission not in ctx.permissions:
            raise HTTPException(
                status_code=403, detail=f"Missing permission: {permission}"
            )
        return ctx

    return _dep
