// Lightweight localStorage mirror for the Settings view. Same pattern as
// calendarStorage / theme — survives a refresh until the config backend
// (CG-T01) takes over. Secret-ish fields (bot token, API keys) live only
// on the current device; we never ship them to a third party.

const KEY = "datalia.settings";

const EMPTY = Object.freeze({
  // AI keys (CG-T01)
  openrouterKey: "",
  anthropicKey: "",
  defaultModel: "",
  // Telegram pairing (TG-T01)
  telegramBotToken: "",
  telegramChatId: "",
  // Brand kit (TP-T03)
  brandName: "",
  brandPrimaryColor: "",
  brandToneOfVoice: "",
  // OAuth connection state (per platform id → "connected" | "disconnected")
  connections: {},
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
