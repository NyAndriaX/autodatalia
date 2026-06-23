// @ts-nocheck
import { config } from "./config";

/** Build the headers to send on every API call. */
function authHeaders(extra: any) {
  return { "Content-Type": "application/json", ...extra };
}

function networkError(path: string, cause: any) {
  const err: any = new Error(
    "Unable to reach the backend. Please check that the API is running and that NEXT_PUBLIC_API_BASE_URL is correct.",
  );
  err.code = "NETWORK_ERROR";
  err.path = path;
  err.cause = cause;
  return err;
}

export async function apiFetch(path: string, options: any = {}) {
  if (!config.apiBaseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL not configured");
  const { headers, ...rest } = options;
  let res;
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, {
      headers: authHeaders(headers),
      credentials: "include",
      ...rest,
    });
  } catch (err) {
    throw networkError(path, err);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      const baseDetail =
        data?.detail?.message ||
        data?.detail?.error ||
        (typeof data?.detail === "string" ? data.detail : "") ||
        data?.message ||
        "";
      const upstreamStatus = data?.detail?.upstream_status;
      const upstreamError = data?.detail?.upstream_error;
      if (upstreamStatus || upstreamError) {
        const suffix = [
          upstreamStatus ? `upstream ${upstreamStatus}` : "",
          upstreamError || "",
        ]
          .filter(Boolean)
          .join(": ");
        detail = baseDetail ? `${baseDetail} (${suffix})` : suffix;
      } else {
        detail = baseDetail;
      }
    } catch {}
    const err: any = new Error(detail || `API ${res.status} ${path}`);
    err.status = res.status;
    throw err;
  }
  // No body to parse (e.g. logout returns 204) — calling res.json() here throws.
  if (res.status === 204 || res.headers.get("content-length") === "0") return null;
  return res.json();
}

/** Same as apiFetch but for multipart (FormData) bodies — no JSON content-type. */
export async function apiUpload(path: string, formData: any) {
  if (!config.apiBaseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL not configured");
  let res;
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  } catch (err) {
    throw networkError(path, err);
  }
  if (!res.ok) {
    const err: any = new Error(`API ${res.status} ${path}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") return null;
  return res.json();
}

export async function apiHealthCheck() {
  if (!config.apiBaseUrl) return null;
  try {
    const res = await fetch(`${config.apiBaseUrl}/health`, {
      credentials: "include",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? "online" : "offline";
  } catch {
    return "offline";
  }
}
