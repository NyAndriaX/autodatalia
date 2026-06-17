// Recall of AI-generated media the user made in the Image IA / Vidéo IA tabs,
// so the Create composer can offer a quick picker of them. Backed by
// localStorage and scoped PER WORKSPACE (same `datalia.active-workspace` key the
// connections cache uses) so one workspace's generations never show in another.
//
// This is a client-side convenience list (the file itself lives in the backend
// content dir and is referenced by URL). It reflects what was generated on this
// browser; a device-independent listing would need a backend per-workspace
// generated-media endpoint (tracked follow-up).

const PREFIX = "datalia.aimedia";
const WS_KEY = "datalia.active-workspace";
const CAP = 60;

function activeScope() {
  if (typeof window === "undefined") return "anon";
  try {
    return window.localStorage.getItem(WS_KEY) || "anon";
  } catch {
    return "anon";
  }
}

function storeKey() {
  return `${PREFIX}.${activeScope()}`;
}

/** All recorded AI media for the active workspace, newest first. Pass a `kind`
 *  ("image" | "video") to filter. */
export function listAiMedia(kind) {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storeKey());
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return kind ? arr.filter((m) => m.kind === kind) : arr;
  } catch {
    return [];
  }
}

/** Record one AI-generated media item ({ kind, url, name }). Deduped by url,
 *  newest first, capped. No-op without a url. */
export function recordAiMedia(item) {
  if (typeof window === "undefined" || !item?.url) return;
  try {
    const kind = item.kind === "video" ? "video" : "image";
    const entry = {
      id: item.id || `ai-${item.url}`,
      kind,
      url: item.url,
      name: item.name || (kind === "video" ? "AI video" : "AI image"),
      ts: item.ts || Date.now(),
    };
    const next = [entry, ...listAiMedia().filter((m) => m.url !== entry.url)].slice(0, CAP);
    window.localStorage.setItem(storeKey(), JSON.stringify(next));
  } catch {
    /* quota / private mode — non-fatal */
  }
}
