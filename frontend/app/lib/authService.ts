// @ts-nocheck
import { apiFetch } from "./apiClient";
import { config } from "./config";
import { rememberActiveWorkspace } from "./oauthService";

function delay(ms = 150) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUser(data: any) {
  const user = data?.user || data || null;
  // The backend now rides workspace + permissions on the user; default the
  // permission list so frontend gating (hasPermission) is always safe.
  if (user && !Array.isArray(user.permissions)) user.permissions = [];
  // Keep the connections-cache scope in lockstep with the active workspace so a
  // workspace switch can't surface the previous workspace's connected accounts.
  rememberActiveWorkspace(user?.workspace?.id ?? null);
  return user;
}

export const authService = {
  async restore() {
    await delay();
    if (!config.apiBaseUrl) return null;
    try {
      return normalizeUser(await apiFetch("/auth/me"));
    } catch (err: any) {
      if (err?.status === 401) return null;
      throw err;
    }
  },

  async login({ email, password }: any = {}) {
    if (!config.apiBaseUrl) {
      throw new Error("Login failed or backend not configured.");
    }
    return normalizeUser(
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    );
  },

  async register({ email, password, name }: any = {}) {
    if (!config.apiBaseUrl) {
      throw new Error("Registration failed or backend not configured.");
    }
    return normalizeUser(
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      }),
    );
  },

  async logout() {
    rememberActiveWorkspace(null);
    if (!config.apiBaseUrl) return;
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (err: any) {
      if (err?.status !== 401) throw err;
    }
  },

  // Destructive + irreversible: delete the caller's own account.
  async deleteAccount() {
    if (!config.apiBaseUrl) throw new Error("Backend not configured.");
    rememberActiveWorkspace(null);
    return apiFetch("/auth/delete-account", { method: "POST" });
  },

  async changePassword({ currentPassword, newPassword }: any = {}) {
    if (!config.apiBaseUrl) {
      throw new Error("Backend not configured.");
    }
    return apiFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  },

  async forgotPassword({ email }: any = {}) {
    if (!config.apiBaseUrl) {
      throw new Error("Backend not configured.");
    }
    return apiFetch("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword({ token, newPassword }: any = {}) {
    if (!config.apiBaseUrl) {
      throw new Error("Backend not configured.");
    }
    return normalizeUser(
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: newPassword }),
      }),
    );
  },

  // ── Workspace invitations ────────────────────────────────────────────
  /** Preview an invite (public) — returns {email, workspace_name, role_name,
   *  needs_account} or null if the link is invalid/expired. */
  async lookupInvite(token: any) {
    if (!config.apiBaseUrl || !token) return null;
    try {
      return await apiFetch(`/auth/invite/${encodeURIComponent(token)}`);
    } catch {
      return null;
    }
  },

  /** Accept an invite — creates/links the account, joins the workspace, signs
   *  in (sets the session cookie). Returns the normalized user. */
  async acceptInvite({ token, name, password }: any = {}) {
    if (!config.apiBaseUrl) {
      throw new Error("Backend not configured.");
    }
    return normalizeUser(
      await apiFetch("/auth/accept-invite", {
        method: "POST",
        body: JSON.stringify({ token, name, password }),
      }),
    );
  },
};
