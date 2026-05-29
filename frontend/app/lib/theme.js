// Theme preference: "light" | "dark" | "system".
// "system" resolves to the OS preference at runtime.
export const THEME_STORAGE_KEY = "datalia-theme";

export function getStoredThemePref() {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function storeThemePref(pref) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* storage disabled / quota — theme reverts to default on reload */
  }
}

export function systemPrefersDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Resolve a preference to a concrete "light" | "dark".
export function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return systemPrefersDark() ? "dark" : "light";
}

// Apply the resolved theme to <html> so the CSS variables switch.
export function applyTheme(resolved) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

// Inlined into <head> as a blocking script to set the theme before first
// paint (prevents a light/dark flash). Self-contained — no imports.
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var k = "${THEME_STORAGE_KEY}";
    var p = localStorage.getItem(k);
    if (p !== "light" && p !== "dark" && p !== "system") p = "system";
    var dark = p === "dark" || (p === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
`;
