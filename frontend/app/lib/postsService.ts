// @ts-nocheck
// Backend CRUD for scheduled posts. Used by calendarThunks. Each function
// returns null on network/backend failure so callers can fall back to the
// local Redux store.

import { apiFetch } from "./apiClient";
import { config } from "./config";

function offline() {
  return !config.apiBaseUrl;
}

function isHttpError(err) {
  return !!err && typeof err === "object" && "status" in err && !!err.status;
}

/** GET /posts → array (or null on failure / no backend configured). */
export async function fetchPosts() {
  if (offline()) return null;
  try {
    const data = await apiFetch("/posts");
    return Array.isArray(data?.posts) ? data.posts : null;
  } catch (err) {
    if (isHttpError(err)) throw err;
    return null;
  }
}

/** POST /posts → the created post (with server-issued id) or null. */
export async function createPost(post) {
  if (offline()) return null;
  try {
    return await apiFetch("/posts", {
      method: "POST",
      body: JSON.stringify(post),
    });
  } catch (err) {
    if (isHttpError(err)) throw err;
    return null;
  }
}

/** PATCH /posts/{id} → the updated post or null. */
export async function patchPost(id, patch) {
  if (offline()) return null;
  try {
    return await apiFetch(`/posts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch (err) {
    if (isHttpError(err)) throw err;
    return null;
  }
}

/** DELETE /posts/{id} → true on success, false otherwise. */
export async function deletePost(id) {
  if (offline()) return false;
  try {
    await apiFetch(`/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
    return true;
  } catch (err) {
    if (isHttpError(err)) throw err;
    return false;
  }
}
