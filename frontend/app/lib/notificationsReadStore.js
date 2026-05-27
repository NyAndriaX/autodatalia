/**
 * Per-browser store of "I've seen this notification" IDs.
 *
 * The backend `/messages` feed has no per-user read state — it returns
 * every message with `read: false` each poll. Without this store, the
 * bell badge would shout "40 unread" every time you logged back in,
 * because the in-memory `read: true` flag died with the page reload.
 *
 * We persist a Set of read IDs in localStorage. On each `setMessages`,
 * the thunk merges this set with whatever the server returned. Capped
 * at MAX_IDS so a chatty backend can't blow out storage quota.
 */
const STORAGE_KEY = "datalia-read-message-ids";
const MAX_IDS = 500;

function readStored() {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function writeStored(set) {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(set);
    const trimmed = arr.length > MAX_IDS ? arr.slice(-MAX_IDS) : arr;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage quota / disabled — drop silently, the worst case is the
    // badge re-shows on next reload.
  }
}

export function getReadIds() {
  return readStored();
}

export function addReadId(id) {
  if (!id) return;
  const set = readStored();
  if (set.has(id)) return;
  set.add(id);
  writeStored(set);
}

export function addReadIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const set = readStored();
  let changed = false;
  for (const id of ids) {
    if (id && !set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (changed) writeStored(set);
}

export function clearReadIds() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
