import { apiFetch } from "./apiClient";
import { config } from "./config";

function delay(ms = 150) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUser(data) {
  return data?.user || data || null;
}

export const authService = {
  async restore() {
    await delay();
    if (!config.apiBaseUrl) return null;
    try {
      return normalizeUser(await apiFetch("/auth/me"));
    } catch (err) {
      if (err?.status === 401) return null;
      throw err;
    }
  },

  async login({ email, password } = {}) {
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

  async register({ email, password, name } = {}) {
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
    if (!config.apiBaseUrl) return;
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (err) {
      if (err?.status !== 401) throw err;
    }
  },

  async changePassword({ currentPassword, newPassword } = {}) {
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

  async forgotPassword({ email } = {}) {
    if (!config.apiBaseUrl) {
      throw new Error("Backend not configured.");
    }
    return apiFetch("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword({ token, newPassword } = {}) {
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
};
