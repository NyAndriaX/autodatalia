"use client";
import { btnPrimary, btnSecondary, btnGhost, inputField, card, glassCard, fadeIn, badgeDraft } from "../../lib/uiClasses";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  buildMonthMatrix,
  formatMonthLabel,
  isoDateKey,
  parseDateKey,
  startOfToday,
  weekdayHeaders,
} from "../../lib/dateUtils";

/**
 * Compact popover date picker — replaces the native <input type="date">
 * for dialogs where the browser default looks out of place. Emits a
 * YYYY-MM-DD string via `onChange` so callers can drop it in next to the
 * existing string-keyed scheduling state.
 *
 * Props:
 *   value     — YYYY-MM-DD (or null)
 *   onChange  — (key: string) => void
 *   minKey    — optional YYYY-MM-DD lower bound (past dates are disabled)
 */
export default function DatePicker({ value, onChange, minKey = null }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() =>
    value ? parseDateKey(value) : startOfToday()
  );
  const wrapRef = useRef(null);

  // Close on outside click / Escape so the popover doesn't trap focus.
  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedKey = value || null;
  const todayKey = isoDateKey(startOfToday());
  const matrix = buildMonthMatrix(cursor);
  const weekdays = weekdayHeaders();

  const label = selectedKey
    ? parseDateKey(selectedKey).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Pick a date";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-all"
        style={{
          background: "var(--bg-card)",
          border: `1px solid ${open ? "var(--border-active)" : "var(--border-default)"}`,
          color: "var(--text-primary)",
          minWidth: 200,
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={14} style={{ color: "var(--text-muted)" }} />
        <span className="flex-1 text-left">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className={`absolute z-[110] mt-1 rounded-xl p-3 shadow-lg ${fadeIn}`}
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-dropdown)",
            width: 280,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setCursor((c) => addMonths(c, -1))}
              className={`${btnGhost}`}
              style={{ padding: 6 }}
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {formatMonthLabel(cursor)}
            </span>
            <button
              type="button"
              onClick={() => setCursor((c) => addMonths(c, 1))}
              className={`${btnGhost}`}
              style={{ padding: 6 }}
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div
            className="grid gap-1 mb-1"
            style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
          >
            {weekdays.map((w) => (
              <div
                key={w}
                className="text-center text-[10px] uppercase tracking-wide py-1"
                style={{ color: "var(--text-muted)" }}
              >
                {w.slice(0, 2)}
              </div>
            ))}
          </div>

          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
          >
            {matrix.flat().map((d) => {
              const isSelected = d.key === selectedKey;
              const isToday = d.key === todayKey;
              const disabled = minKey && d.key < minKey;
              return (
                <button
                  key={d.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(d.key);
                    setOpen(false);
                  }}
                  className="h-8 rounded-md text-xs transition-all"
                  style={{
                    background: isSelected
                      ? "var(--accent-primary)"
                      : isToday
                      ? "var(--bg-tertiary)"
                      : "transparent",
                    color: isSelected
                      ? "#fff"
                      : !d.inMonth
                      ? "var(--text-muted)"
                      : disabled
                      ? "var(--text-muted)"
                      : "var(--text-primary)",
                    opacity: disabled ? 0.4 : !d.inMonth ? 0.6 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontWeight: isSelected || isToday ? 600 : 400,
                    border:
                      isToday && !isSelected
                        ? "1px solid var(--border-default)"
                        : "1px solid transparent",
                  }}
                  aria-label={d.key}
                  aria-pressed={isSelected}
                >
                  {d.date.getDate()}
                </button>
              );
            })}
          </div>

          <div
            className="flex items-center justify-between mt-3 pt-2"
            style={{ borderTop: "1px solid var(--border-default)" }}
          >
            <button
              type="button"
              onClick={() => {
                onChange(todayKey);
                setCursor(startOfToday());
                setOpen(false);
              }}
              className="text-xs font-medium"
              style={{ color: "var(--accent-primary)" }}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
