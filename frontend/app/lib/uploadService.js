import { apiUpload } from "./apiClient";
import { config } from "./config";

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/quicktime"];
export const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

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
// IMPORTANT: We now upload directly to the backend bypassing Next.js entirely.
// The Next.js dev server has known bugs where it intercepts FormData POSTs
// and mistakenly throws "Failed to find Server Action" 404 errors, or
// buffers the multipart body causing 30s timeouts.
// Direct to backend (which has CORS enabled) solves this permanently.
export async function uploadToBackend(file) {
  try {
    const body = new FormData();
    body.append("file", file);
    
    // We use the same apiUpload client that handles auth headers natively
    const data = await apiUpload("/upload", body);
    
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
    else if (status === 401) error = "Auth required (sign in first)";
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
    const res = await fetch(
      `${config.apiBaseUrl}/media/${encodeURI(relativePath)}`,
      { method: "DELETE", credentials: "include" },
    );
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
