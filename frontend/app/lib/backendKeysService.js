import { apiFetch } from "./apiClient";

/**
 * Live state of backend settings — { keys: { ENV_NAME: {set, masked, value, secret} } }.
 * Secrets come back masked (abcd••••WXYZ); model ids and base URLs are
 * plain. Used by the Settings page to render the API-keys editor.
 */
export async function fetchBackendKeys() {
  return apiFetch("/settings/keys");
}

/**
 * Persist a batch of changes. `updates` is { ENV_NAME: newValue }.
 * Empty strings CLEAR that override (the env var falls through to
 * whatever was in infra/.env at boot, or empty).
 *
 * Returns the same shape as fetchBackendKeys() — the response is the
 * post-write snapshot so the UI doesn't need a second roundtrip.
 */
export async function patchBackendKeys(updates) {
  return apiFetch("/settings/keys", {
    method: "PATCH",
    body: JSON.stringify({ updates }),
  });
}
