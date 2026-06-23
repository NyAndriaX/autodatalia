// @ts-nocheck
// Lightweight localStorage mirror for the Settings view. Same pattern as
// calendarStorage / theme. Brand and timezone preferences stay local;
// backend/API keys persist through the authenticated runtime-settings API.

const KEY = "datalia.settings";

const EMPTY = Object.freeze({
  // Telegram pairing (TG-T01)
  telegramBotToken: "",
  telegramChatId: "",
  // Brand kit (TP-T03)
  brandName: "",
  brandPrimaryColor: "",
  brandToneOfVoice: "",
  // OAuth connection state (per platform id → "connected" | "disconnected")
  connections: {},
  // IANA timezone the scheduler interprets "09:00" in. Empty string means
  // "use the browser's OS timezone" (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
  // Set this to the brand's posting timezone (e.g. "Europe/Paris") so a
  // team member scheduling from a different time zone — or hopping on via
  // a laptop set to a non-local clock — doesn't accidentally publish at
  // 03:00 in the audience's market. VPNs do NOT change this: the browser
  // reads OS settings, not IP geolocation, so a VPN to a different
  // country still reports the laptop's actual timezone.
  scheduleTimezone: "",
});

export function loadSettings() {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed, connections: { ...(parsed?.connections ?? {}) } };
  } catch {
    return { ...EMPTY };
  }
}

export function saveSettings(partial) {
  if (typeof window === "undefined") return;
  try {
    const current = loadSettings();
    const next = {
      ...current,
      ...partial,
      connections: { ...current.connections, ...(partial?.connections ?? {}) },
    };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / privacy mode — non-fatal */
  }
}

export function getSetting(key) {
  return loadSettings()[key];
}
