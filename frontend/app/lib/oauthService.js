/**
 * OAuth + publishing client.
 *
 * The backend handles the full OAuth dance — we just:
 *   1. Ask it for the authorize URL of a provider
 *   2. Pop it in a child window
 *   3. Listen for the `oauth:result` postMessage the callback page posts
 *      back to us right before it closes itself
 *   4. Refetch /oauth/connections to get the live state
 *
 * Tokens never touch the browser. We only ever hold ids + labels.
 */

import { apiFetch } from "./apiClient";
import { config } from "./config";

const POPUP_FEATURES = "width=560,height=720,left=200,top=120";

// localStorage-backed cache for the /oauth/connections response. Without
// this, every mount of SettingsView and DashboardView hits Meta's
// /me/accounts upstream — that's a real network round-trip the user feels
// every time they bounce between views.
//
// Cache layout: { providers, savedAt } where savedAt is a UTC epoch ms.
// Default TTL is 10 minutes — OAuth state doesn't change often, and any
// real change (Connect / Disconnect, the Refresh button) blows the cache
// explicitly via invalidateConnectionsCache().
const CONNECTIONS_CACHE_KEY = "datalia.connections.cache";
const CONNECTIONS_TTL_MS = 10 * 60 * 1000;

function readConnectionsCache() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONNECTIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.providers) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeConnectionsCache(data) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CONNECTIONS_CACHE_KEY,
      JSON.stringify({ providers: data.providers, savedAt: Date.now() })
    );
  } catch {
    /* quota / private mode — non-fatal, in-memory state still works */
  }
}

/** Wipe the cache. Call after Connect / Disconnect so the next read is
 *  guaranteed fresh, not a stale snapshot from before the user changed
 *  anything. */
export function invalidateConnectionsCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CONNECTIONS_CACHE_KEY);
  } catch {
    /* non-fatal */
  }
}

/** Snapshot (or null) from cache without touching the network. Useful for
 *  paint-first / refresh-later patterns. */
export function readCachedConnections() {
  return readConnectionsCache();
}

/** GET /oauth/connections → { providers: { meta: {...}, tiktok: {...}, ... } }
 *
 * Each provider entry has: { configured, connected, missing_env, targets[]
 * (publishable destinations once connected) }. Targets are kind-tagged
 * (facebook_page, instagram_business, …) so the UI can group them.
 *
 * Options:
 *   force = true        — bypass the cache entirely (Refresh button)
 *   maxAgeMs (number)   — return cached data if it's younger than this
 *                         (default 10 min); cache miss falls through to fetch
 *
 * On a successful network fetch, the response is also written to the
 * cache so the next mount renders instantly.
 */
export async function fetchConnections({
  force = false,
  maxAgeMs = CONNECTIONS_TTL_MS,
} = {}) {
  if (!config.apiBaseUrl) return { providers: {} };

  if (!force) {
    const cached = readConnectionsCache();
    if (cached && Date.now() - cached.savedAt < maxAgeMs) {
      return { providers: cached.providers, fromCache: true };
    }
  }

  try {
    const data = await apiFetch("/oauth/connections");
    writeConnectionsCache(data);
    return data;
  } catch (e) {
    // Network failure → fall back to whatever cache we have, even if stale.
    // Better to show last-known-good than a "0 connected" placeholder.
    const cached = readConnectionsCache();
    if (cached) {
      return { providers: cached.providers, fromCache: true, error: e.message };
    }
    return { providers: {}, error: e.message };
  }
}

/** Begin the OAuth dance for a provider, returning a Promise that resolves
 *  with { ok, message } when the popup closes (or rejects on timeout/blocked
 *  popup). */
export function startConnect(providerId, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise(async (resolve, reject) => {
    let popup = null;
    let timer = null;
    let pollHandle = null;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (timer) clearTimeout(timer);
      if (pollHandle) clearInterval(pollHandle);
      if (popup && !popup.closed) popup.close();
    };

    const onMessage = (event) => {
      const d = event.data;
      if (!d || d.type !== "oauth:result") return;
      if (d.provider !== providerId) return;
      cleanup();
      if (d.ok) resolve({ ok: true, message: d.message });
      else reject(new Error(d.message || "OAuth failed"));
    };

    window.addEventListener("message", onMessage);

    try {
      const { authorize_url: url } = await apiFetch(
        `/oauth/${providerId}/start`
      );
      popup = window.open(url, `oauth_${providerId}`, POPUP_FEATURES);
      if (!popup) {
        cleanup();
        reject(new Error("Popup blocked. Allow popups for this site."));
        return;
      }

      timer = setTimeout(() => {
        cleanup();
        reject(new Error("OAuth timed out"));
      }, timeoutMs);

      // Fallback: detect user closing the popup manually without finishing.
      pollHandle = setInterval(() => {
        if (popup.closed) {
          cleanup();
          // The postMessage may have fired before close — give it a tick
          // before treating "closed" as a cancellation.
          setTimeout(() => reject(new Error("Popup closed before completion")), 100);
        }
      }, 600);
    } catch (e) {
      cleanup();
      // Surface the backend's "missing creds" 503 with a clear message
      // instead of a raw "API 503" string.
      if (e.status === 503) {
        reject(new Error(`${providerId} is not configured on the backend yet`));
      } else {
        reject(e);
      }
    }
  });
}

/** DELETE /oauth/{provider} — forget the stored token. */
export async function disconnect(providerId) {
  if (!config.apiBaseUrl) return { ok: false };
  const result = await apiFetch(`/oauth/${providerId}`, { method: "DELETE" });
  // Cache must be blown so the next fetch shows the disconnected state
  // immediately instead of a stale "still connected" snapshot.
  invalidateConnectionsCache();
  return result;
}

/** POST /publish — fan content out to multiple targets in parallel.
 *
 * `ratios` is an optional `{ platformId: "1:1" }` map. When present, the
 * backend center-crops the image to that ratio per platform before
 * publishing — the editor's ratio picker actually changes what gets
 * posted, not just the preview.
 */
export async function publishToTargets({
  content,
  mediaUrl = null,
  link = null,
  targets,
  ratios = null,
}) {
  if (!targets?.length) throw new Error("publish requires at least one target");
  return apiFetch("/publish", {
    method: "POST",
    body: JSON.stringify({
      content,
      media_url: mediaUrl,
      link,
      targets,
      ratios: ratios || undefined,
    }),
  });
}
