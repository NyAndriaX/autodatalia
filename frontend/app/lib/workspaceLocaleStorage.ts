// @ts-nocheck
const KEY = "datalia.workspaceLocales";

function normalizeLocale(value) {
  return String(value || "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function loadWorkspaceLocale(workspaceId, fallback = "en") {
  if (typeof window === "undefined" || !workspaceId) return normalizeLocale(fallback);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return normalizeLocale(fallback);
    const parsed = JSON.parse(raw);
    return normalizeLocale(parsed?.[String(workspaceId)] || fallback);
  } catch {
    return normalizeLocale(fallback);
  }
}

export function saveWorkspaceLocale(workspaceId, locale) {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[String(workspaceId)] = normalizeLocale(locale);
    window.localStorage.setItem(KEY, JSON.stringify(parsed));
  } catch {
    /* quota / privacy mode */
  }
}
