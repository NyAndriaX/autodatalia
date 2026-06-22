// Team & Access API (workspace, members, roles, invitations). Read helpers
// return safe defaults on failure; mutations throw so the caller can surface
// the backend's error message (antd message.error).
import { apiFetch } from "./apiClient";
import { config } from "./config";

function offline() {
  return !config.apiBaseUrl;
}

export async function fetchWorkspace() {
  if (offline()) return null;
  try {
    return await apiFetch("/workspace");
  } catch {
    return null;
  }
}

// ── Members ───────────────────────────────────────────────────────────────
export async function fetchMembers() {
  if (offline()) return [];
  try {
    const data = await apiFetch("/workspace/members");
    return Array.isArray(data?.members) ? data.members : [];
  } catch {
    return [];
  }
}

export async function inviteMember(email, roleId) {
  return apiFetch("/workspace/members/invite", {
    method: "POST",
    body: JSON.stringify({ email, role_id: roleId }),
  });
}

export async function changeMemberRole(userId, roleId) {
  return apiFetch(`/workspace/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ role_id: roleId }),
  });
}

export async function removeMember(userId) {
  return apiFetch(`/workspace/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

// ── Roles ───────────────────────────────────────────────────────────────
export async function fetchRoles() {
  if (offline()) return [];
  try {
    const data = await apiFetch("/workspace/roles");
    return Array.isArray(data?.roles) ? data.roles : [];
  } catch {
    return [];
  }
}

export async function createRole(name, permissions) {
  return apiFetch("/workspace/roles", {
    method: "POST",
    body: JSON.stringify({ name, permissions }),
  });
}

export async function updateRole(roleId, { name, permissions }) {
  return apiFetch(`/workspace/roles/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name, permissions }),
  });
}

export async function deleteRole(roleId) {
  return apiFetch(`/workspace/roles/${encodeURIComponent(roleId)}`, {
    method: "DELETE",
  });
}

// ── Invitations ───────────────────────────────────────────────────────────
export async function fetchInvitations() {
  if (offline()) return [];
  try {
    const data = await apiFetch("/workspace/invitations");
    return Array.isArray(data?.invitations) ? data.invitations : [];
  } catch {
    return [];
  }
}

export async function revokeInvitation(invitationId) {
  return apiFetch(`/workspace/invitations/${encodeURIComponent(invitationId)}`, {
    method: "DELETE",
  });
}

// ── Multi-workspace: list mine + switch ─────────────────────────────────────
export async function fetchMyWorkspaces() {
  if (offline()) return [];
  try {
    const data = await apiFetch("/workspaces");
    return Array.isArray(data?.workspaces) ? data.workspaces : [];
  } catch {
    return [];
  }
}

export async function switchWorkspace(workspaceId) {
  return apiFetch("/workspace/switch", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

// Create a new (deletable, non-personal) workspace and switch to it.
export async function createWorkspace(name) {
  return apiFetch("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

// ── Destructive: delete the active workspace / leave it ─────────────────────
export async function deleteWorkspace() {
  return apiFetch("/workspace", { method: "DELETE" });
}

export async function leaveWorkspace() {
  return apiFetch("/workspace/leave", { method: "POST" });
}

// ── Invitations inbox (the signed-in user's own invites) ────────────────────
export async function fetchMyInvitations() {
  if (offline()) return [];
  try {
    const data = await apiFetch("/invitations/mine");
    return Array.isArray(data?.invitations) ? data.invitations : [];
  } catch {
    return [];
  }
}

export async function acceptInvitation(invitationId) {
  return apiFetch(`/invitations/${encodeURIComponent(invitationId)}/accept`, {
    method: "POST",
  });
}

export async function refuseInvitation(invitationId) {
  return apiFetch(`/invitations/${encodeURIComponent(invitationId)}/refuse`, {
    method: "POST",
  });
}
