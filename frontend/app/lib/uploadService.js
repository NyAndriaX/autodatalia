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

// Push a file to the backend. No endpoint exists yet, so this stays a
// graceful no-op that keeps the local preview. When /upload lands, this is
// the only function to change.
export async function uploadToBackend(file) {
  if (!config.apiBaseUrl) return { remoteUrl: null, status: "local" };
  try {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${config.apiBaseUrl}/upload`, { method: "POST", body });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    const data = await res.json();
    return { remoteUrl: data?.url ?? null, status: "uploaded" };
  } catch {
    return { remoteUrl: null, status: "local" };
  }
}
