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
  if (user) window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(SESSION_KEY);
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

  // Authenticate. Tries the backend, falls back to a mock session.
  async login({ email, password } = {}) {
    if (config.apiBaseUrl) {
      try {
        const data = await apiFetch("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        if (data?.user) {
          writeSession(data.user);
          return data.user;
        }
      } catch {
        /* fall through to mock */
      }
    }
    await delay();
    const user = { ...MOCK_USER, email: email || MOCK_USER.email };
    writeSession(user);
    return user;
  },

  async logout() {
    if (config.apiBaseUrl) {
      try {
        await apiFetch("/auth/logout", { method: "POST" });
      } catch {
        /* ignore — clear locally regardless */
      }
    }
    writeSession(null);
  },
};
