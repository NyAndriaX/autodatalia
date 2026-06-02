import { apiFetch } from "./apiClient";
import { config } from "./config";

// Session persistence. Swap localStorage for an httpOnly cookie / real token
// store when a backend auth endpoint exists — this is the only place to change.
const SESSION_KEY = "datalia-session";

const MOCK_USER = {
  id: "u_demo",
  name: "DATALIA Team",
  email: "team@datalia.app",
  initials: "DT",
  role: "admin",
};

function readSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(user) {
  if (typeof window === "undefined") return;
  try {
    if (user) window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {}
}

function delay(ms = 500) {
  return new Promise((r) => setTimeout(r, ms));
}

export const authService = {
  // Restore a previously saved session (no network).
  async restore() {
    await delay(150);
    return readSession();
  },

  // Authenticate via backend /auth/login.
  async login({ email, password } = {}) {
    if (config.apiBaseUrl) {
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (data?.user && data?.token) {
        const sessionData = { ...data.user, token: data.token };
        writeSession(sessionData);
        return sessionData;
      }
    }
    throw new Error("Login failed or backend not configured.");
  },

  async register({ email, password, name } = {}) {
    if (config.apiBaseUrl) {
      const data = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      });
      if (data?.user && data?.token) {
        const sessionData = { ...data.user, token: data.token };
        writeSession(sessionData);
        return sessionData;
      }
    }
    throw new Error("Registration failed or backend not configured.");
  },

  async logout() {
    writeSession(null);
  },
};
