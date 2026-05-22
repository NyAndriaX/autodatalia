import { apiUpload } from "./apiClient";
import { config } from "./config";

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/quicktime"];
export const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

let idSeq = 0;

export function validateFile(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return `Unsupported type: ${file.type || "unknown"}`;
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `Too large (max ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB)`;
  }
  return null;
}

// Build a serializable media descriptor with a local object-URL preview.
// The File itself is never put into Redux — only this descriptor.
export function toMediaItem(file) {
  return {
    id: `m_${Date.now()}_${idSeq++}`,
    name: file.name,
    kind: file.type.startsWith("video/") ? "video" : "image",
    mime: file.type,
    size: file.size,
    previewUrl: URL.createObjectURL(file),
    remoteUrl: null,
    status: "local", // "local" | "uploading" | "uploaded" | "error"
  };
}

export function revokeMediaItem(item) {
  if (item?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
}

// Push a file to the backend /upload endpoint.
//
// IMPORTANT: We post to `/api/upload` (a Next.js Route Handler in
// app/api/upload/route.js), NOT through `${apiBaseUrl}/upload` which
// goes via the rewrite proxy. The dev rewrite buffers the entire
// multipart body in memory and times out at 30s on files larger than
// ~5-10MB — confirmed via curl. The Route Handler streams the body
// directly to the backend without buffering, so a 48MB video uploads
// in ~4s instead of failing after 30s.
//
// All other endpoints (small JSON requests) continue using the rewrite
// proxy via apiBaseUrl — that path works fine for them.
export async function uploadToBackend(file) {
  try {
    const body = new FormData();
    body.append("file", file);
    const headers = {};
    if (config.backendAuthToken) {
      headers.Authorization = `Bearer ${config.backendAuthToken}`;
    }
    const res = await fetch("/api/upload", {
      method: "POST",
      headers,
      body,
    });
    if (!res.ok) {
      const err = new Error(`API ${res.status} /upload`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return {
      remoteUrl: data?.url ?? null,
      status: "uploaded",
      filename: data?.filename ?? file.name,
      kind: data?.kind ?? (file.type.startsWith("video/") ? "video" : "image"),
    };
  } catch (e) {
    const status = e?.status;
    let error;
    if (!status) error = "Backend offline";
    else if (status === 401) error = "Auth required (set token)";
    else if (status === 413) error = "File too large";
    else if (status === 415) error = "Unsupported type";
    else if (status >= 500) error = `Server error (${status})`;
    else error = `Upload failed (${status})`;
    return { remoteUrl: null, status: "local", error };
  }
}

/** Delete a media item by its server-side relative path (the `id` field
 *  search returns). Resolves to { ok, status } so callers can show a toast. */
export async function deleteFromBackend(relativePath) {
  if (!config.apiBaseUrl) return { ok: false, status: 0 };
  try {
    const headers = {};
    if (config.backendAuthToken) headers.Authorization = `Bearer ${config.backendAuthToken}`;
    const res = await fetch(
      `${config.apiBaseUrl}/media/${encodeURI(relativePath)}`,
      { method: "DELETE", headers },
    );
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
