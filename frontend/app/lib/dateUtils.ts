// @ts-nocheck
/**
 * Pure, dependency-free date helpers for the Calendar view.
 *
 * All "keys" are local-time YYYY-MM-DD strings (never UTC) so a post
 * scheduled on the 5th stays on the 5th regardless of the user's timezone.
 */

/** Local-time YYYY-MM-DD key built from y/m/d (no UTC shift). */
export function isoDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Midnight today, local time. */
export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Parse a YYYY-MM-DD (or ISO) string to a local Date at midnight. */
export function parseDateKey(value) {
  if (value instanceof Date) return value;
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addMonths(date, delta) {
  const d = new Date(date);
  d.setDate(1); // avoid month-length overflow (e.g. Jan 31 + 1)
  d.setMonth(d.getMonth() + delta);
  return d;
}

export function addDays(date, delta) {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

export function addWeeks(date, delta) {
  return addDays(date, delta * 7);
}

/** Monday-start weekday index (Mon=0 … Sun=6). */
function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - mondayIndex(d));
  return d;
}

const today = () => startOfToday();

function decorate(date) {
  return {
    date,
    key: isoDateKey(date),
    isToday: isoDateKey(date) === isoDateKey(today()),
  };
}

/**
 * Month grid as weeks × 7 days (Monday-start), padded with the
 * trailing/leading days of the adjacent months so the grid is rectangular.
 */
export function buildMonthMatrix(cursor) {
  const base = new Date(cursor);
  const monthIdx = base.getMonth();
  const first = new Date(base.getFullYear(), monthIdx, 1);
  const gridStart = startOfWeek(first);

  const weeks = [];
  let day = gridStart;
  // 6 rows always → stable height as months change.
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      row.push({ ...decorate(day), inMonth: day.getMonth() === monthIdx });
      day = addDays(day, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/** The 7 days (Monday-start) of the week containing `cursor`. */
export function getWeekDays(cursor) {
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    return { ...decorate(d), inMonth: true };
  });
}

const MONTH_FMT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY_RANGE_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export function formatMonthLabel(cursor) {
  return MONTH_FMT.format(new Date(cursor));
}

/** "Apr 7 – Apr 13" style label for the week view. */
export function formatWeekLabel(cursor) {
  const start = startOfWeek(cursor);
  const end = addDays(start, 6);
  return `${DAY_RANGE_FMT.format(start)} – ${DAY_RANGE_FMT.format(end)}`;
}

/** Monday-start weekday headers, localized (e.g. ["Mon", … "Sun"]). */
export function weekdayHeaders() {
  // 2024-01-01 is a Monday — anchor for stable localized labels.
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) =>
    WEEKDAY_FMT.format(addDays(monday, i))
  );
}
