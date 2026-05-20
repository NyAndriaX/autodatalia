import { config } from "./config";

/** Build the headers to send on every API call. */
function authHeaders(extra) {
  const base = { "Content-Type": "application/json", ...extra };
  if (config.backendAuthToken) {
    base.Authorization = `Bearer ${config.backendAuthToken}`;
  }
  return base;
}

export async function apiFetch(path, options = {}) {
  if (!config.apiBaseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL not configured");
  const { headers, ...rest } = options;
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: authHeaders(headers),
    ...rest,
  });
  if (!res.ok) {
    const err = new Error(`API ${res.status} ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Same as apiFetch but for multipart (FormData) bodies — no JSON content-type. */
export async function apiUpload(path, formData) {
  if (!config.apiBaseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL not configured");
  const headers = {};
  if (config.backendAuthToken) {
    headers.Authorization = `Bearer ${config.backendAuthToken}`;
  }
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    const err = new Error(`API ${res.status} ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function apiHealthCheck() {
  if (!config.apiBaseUrl) return null;
  try {
    const res = await fetch(`${config.apiBaseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? "online" : "offline";
  } catch {
    return "offline";
  }
}
