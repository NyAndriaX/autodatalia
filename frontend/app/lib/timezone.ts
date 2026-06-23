// @ts-nocheck
// Single source of truth for which IANA timezone the scheduler interprets
// "09:00" in. Read it everywhere that builds a post payload — never call
// `Intl.DateTimeFormat().resolvedOptions().timeZone` directly, otherwise
// the configured override won't be honoured.
//
// Resolution order:
//   1. Settings.scheduleTimezone   — explicit org/team override
//   2. Browser OS timezone         — sensible default for solo dev / first use
//   3. "Europe/Paris"              — final fallback matching the backend's
//                                    DEFAULT_TIMEZONE env, so the two layers
//                                    agree even if everything else fails

import { getSetting } from "./settingsStorage";

const FALLBACK = "Europe/Paris";

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** Returns the IANA timezone to stamp on outgoing scheduled posts. */
export function getScheduleTimezone() {
  const configured = (getSetting("scheduleTimezone") || "").trim();
  if (configured) return configured;
  return browserTimezone();
}

/** Returns just the browser TZ — useful for showing "auto-detected: X" in UI. */
export function getBrowserTimezone() {
  return browserTimezone();
}

/**
 * List of common IANA zones surfaced in the Settings dropdown. Not exhaustive
 * — `Intl.supportedValuesOf("timeZone")` returns 400+ entries which is fine
 * for a free-text field but overwhelming as a dropdown. The handful below
 * covers Datalia's target markets + their nearest neighbours; users who need
 * anything else can paste an arbitrary IANA name into the override input.
 */
export const COMMON_TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];
