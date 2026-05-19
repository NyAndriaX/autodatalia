// Lightweight localStorage mirror for scheduled posts so the calendar
// survives a refresh until the n8n/Airtable backend takes over hydration.
// Same spirit as lib/theme.js (persisted UI preference).

const KEY = "datalia.calendar.posts";

/** Returns the persisted array, or null if nothing was ever saved. */
export function loadScheduledPosts() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveScheduledPosts(posts) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(posts));
  } catch {
    /* quota / privacy mode — non-fatal, calendar still works in-memory */
  }
}
