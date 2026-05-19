import { config } from "./config";

export async function apiFetch(path, options = {}) {
  if (!config.apiBaseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL not configured");
  const { headers, ...rest } = options;
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...headers },
    ...rest,
  });
  if (!res.ok) throw new Error(`API ${res.status} ${path}`);
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
