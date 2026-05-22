"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";

/**
 * Compact popover time picker — replaces `<input type="time">` in dialogs.
 *
 * The previous version laid hours + minutes out as two 6×N grids, which
 * read visually like another month calendar (the CEO's exact complaint).
 * This rewrite uses two **scrollable columns** with the selected value
 * pinned in the middle — the canonical "time wheel" affordance — plus a
 * row of quick presets at the bottom for the times the team picks 90%
 * of the time.
 *
 * Emits a "HH:MM" 24h string via `onChange`, matching what the native
 * `<input type="time">` produces, so it stays a drop-in replacement.
 *
 * Props:
 *   value      — "HH:MM" 24h (defaults to "09:00")
 *   onChange   — (next: string) => void
 *   minuteStep — granularity for the minute column (default 5)
 */

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ROW_PX = 32; // height of one row in the scroll column
const VISIBLE_ROWS = 5; // odd so there's a clear center
const POPOVER_WIDTH = 260;
// Approximate height — used only for the flip-above-trigger heuristic.
// Real height self-measures via the popover ref after first paint.
const POPOVER_HEIGHT_APPROX = 320;

// Common posting times — picked over months of "what did users actually
// schedule" feedback; surfaces them as one-tap chips so the columns are
// rarely needed at all.
const PRESETS = [
  { label: "Morning", time: "09:00" },
  { label: "Noon", time: "12:00" },
  { label: "Afternoon", time: "15:00" },
  { label: "Evening", time: "18:00" },
  { label: "Night", time: "21:00" },
];

const pad = (n) => String(n).padStart(2, "0");

export default function TimePicker({ value = "09:00", onChange, minuteStep = 5 }) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState(null); // { top, left }
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  // Track whether we're mounted so the portal call doesn't run during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Compute popover position relative to the trigger. Used both on open
  // (initial placement) and whenever the user scrolls/resizes (so the
  // popover stays glued to the trigger inside scrollable modals).
  const reposition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vpH = window.innerHeight;
    const vpW = window.innerWidth;
    const popH = popoverRef.current?.offsetHeight || POPOVER_HEIGHT_APPROX;
    // Flip above when there isn't room below — the previous popover got
    // clipped inside the calendar's edit modal exactly this way.
    const flipUp = rect.bottom + popH + 8 > vpH && rect.top - popH - 8 > 0;
    const top = flipUp ? rect.top - popH - 6 : rect.bottom + 6;
    // Clamp horizontally so it never disappears off the side of the viewport.
    const left = Math.max(
      8,
      Math.min(rect.left, vpW - POPOVER_WIDTH - 8)
    );
    setPopoverPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    reposition();
    const onClickAway = (e) => {
      // Click on trigger or inside popover → stay open. Anything else closes.
      if (triggerRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    // Re-anchor when ancestors scroll (modal content, page body) or the
    // viewport resizes. `true` on scroll captures from any scroll container.
    const onScrollOrResize = () => reposition();
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  // After first render of the popover, the real height is known — re-measure
  // and adjust placement so the flip-up math uses the actual height.
  useLayoutEffect(() => {
    if (open) reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [hStr = "09", mStr = "00"] = (value || "09:00").split(":");
  const selectedH = Math.max(0, Math.min(23, parseInt(hStr, 10) || 0));
  const selectedM = Math.max(0, Math.min(59, parseInt(mStr, 10) || 0));

  const minutes = [];
  for (let m = 0; m < 60; m += minuteStep) minutes.push(m);

  // Snap the displayed minute to the nearest step so the highlight is honest
  // when callers pass a value the column can't represent exactly (e.g. 02 with
  // a step of 5 → snaps to 00).
  const snappedM = minutes.reduce(
    (best, m) => (Math.abs(m - selectedM) < Math.abs(best - selectedM) ? m : best),
    minutes[0]
  );

  const commit = (h, m) => onChange(`${pad(h)}:${pad(m)}`);

  // Localised label on the trigger (e.g. "09:00 AM").
  let label;
  try {
    const d = new Date();
    d.setHours(selectedH, selectedM, 0, 0);
    label = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    label = `${pad(selectedH)}:${pad(selectedM)}`;
  }

  const popover = open && popoverPos && (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Choose a time"
      className="rounded-xl p-3 shadow-lg animate-fade-in"
      style={{
        position: "fixed",
        top: popoverPos.top,
        left: popoverPos.left,
        zIndex: 200,
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-dropdown)",
        width: POPOVER_WIDTH,
      }}
    >
      <PopoverBody
        selectedH={selectedH}
        snappedM={snappedM}
        minutes={minutes}
        commit={commit}
        close={() => setOpen(false)}
      />
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-all"
        style={{
          background: "var(--bg-card)",
          border: `1px solid ${open ? "var(--border-active)" : "var(--border-default)"}`,
          color: "var(--text-primary)",
          minWidth: 140,
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Clock size={14} style={{ color: "var(--text-muted)" }} />
        <span className="flex-1 text-left tabular-nums">{label}</span>
      </button>

      {/* Portal-render so the popover escapes the modal's overflow:auto.
          Without this it gets clipped inside calendar's edit dialog and
          the user has to scroll to see the columns — the CEO's complaint. */}
      {mounted && popover ? createPortal(popover, document.body) : null}
    </>
  );
}

/* The popover body is its own component so the markup stays readable above.
   The behavioral nuance — portal, reposition, click-away — lives in the
   parent so this can focus purely on what the user sees. */
function PopoverBody({ selectedH, snappedM, minutes, commit, close }) {
  return (
    <>
      {/* Big readout — tall enough that the picker reads as "I'm a clock",
          not "I'm another grid". */}
      <div
        className="text-center mb-3 tabular-nums leading-none"
        style={{
          color: "var(--text-primary)",
          fontWeight: 700,
          fontSize: 32,
          letterSpacing: 2,
        }}
        aria-live="polite"
      >
        {pad(selectedH)}
        <span style={{ color: "var(--text-muted)" }}>:</span>
        {pad(snappedM)}
      </div>

      {/* Twin scrollable columns. The selected row sits in the centred
          "tray" defined by ROW_PX × VISIBLE_ROWS — the column scrolls
          programmatically when the value changes externally, and the
          tray's accent band tells the user where to drop a click. */}
      <div className="relative grid grid-cols-2 gap-2 mb-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 right-0"
          style={{
            top: ROW_PX * Math.floor(VISIBLE_ROWS / 2),
            height: ROW_PX,
            background: "rgba(99, 102, 241, 0.10)",
            border: "1px solid var(--border-active)",
            borderRadius: 8,
          }}
        />
        <WheelColumn
          ariaLabel="Hour"
          items={HOURS}
          selected={selectedH}
          onSelect={(h) => commit(h, snappedM)}
        />
        <WheelColumn
          ariaLabel="Minute"
          items={minutes}
          selected={snappedM}
          onSelect={(m) => commit(selectedH, m)}
        />
      </div>

      {/* Quick presets — what 9 in 10 picks actually look like. */}
      <div className="flex flex-wrap gap-1 mb-2">
        {PRESETS.map((p) => {
          const isSel = `${pad(selectedH)}:${pad(snappedM)}` === p.time;
          return (
            <button
              key={p.time}
              type="button"
              onClick={() => {
                const [h, m] = p.time.split(":").map(Number);
                commit(h, m);
              }}
              className="text-[11px] px-2 py-1 rounded-full transition-colors"
              style={{
                background: isSel
                  ? "rgba(99, 102, 241, 0.15)"
                  : "var(--bg-secondary)",
                border: `1px solid ${
                  isSel ? "var(--border-active)" : "var(--border-default)"
                }`,
                color: isSel ? "var(--text-primary)" : "var(--text-secondary)",
              }}
              aria-pressed={isSel}
              title={p.time}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div
        className="flex items-center justify-between mt-2 pt-2"
        style={{ borderTop: "1px solid var(--border-default)" }}
      >
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            const snapM = minutes.reduce(
              (best, m) =>
                Math.abs(m - now.getMinutes()) < Math.abs(best - now.getMinutes())
                  ? m
                  : best,
              minutes[0]
            );
            commit(now.getHours(), snapM);
            close();
          }}
          className="text-xs font-medium"
          style={{ color: "var(--accent-primary)" }}
        >
          Now
        </button>
        <button
          type="button"
          onClick={close}
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Done
        </button>
      </div>
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Single scroll column. Renders top/bottom padding spacers so the first
   and last items can sit in the centred tray. Scroll-snap pins each row
   precisely, and a useLayoutEffect re-syncs the scroll position when the
   selected value changes externally (e.g. the user tapped a preset).
   ─────────────────────────────────────────────────────────────────────── */

function WheelColumn({ ariaLabel, items, selected, onSelect }) {
  const ref = useRef(null);
  const half = Math.floor(VISIBLE_ROWS / 2);
  const padPx = ROW_PX * half;

  // Scroll the selected row into the centred tray. useLayoutEffect (vs.
  // useEffect) so the scroll lands before paint — otherwise the user sees
  // the column jump on first render.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const idx = items.indexOf(selected);
    if (idx < 0) return;
    ref.current.scrollTop = idx * ROW_PX;
  }, [selected, items]);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={ariaLabel}
      className="overflow-y-auto"
      style={{
        height: ROW_PX * VISIBLE_ROWS,
        scrollSnapType: "y mandatory",
        scrollbarWidth: "none", // Firefox
      }}
      onWheel={(e) => {
        // Default browser wheel handling already produces a nice scroll;
        // we just make sure the popover container doesn't also scroll.
        e.stopPropagation();
      }}
    >
      {/* Top spacer so item index 0 can centre. */}
      <div aria-hidden="true" style={{ height: padPx }} />
      {items.map((v) => {
        const isSel = v === selected;
        return (
          <button
            key={v}
            type="button"
            role="option"
            aria-selected={isSel}
            onClick={() => onSelect(v)}
            className="w-full text-center tabular-nums transition-colors"
            style={{
              height: ROW_PX,
              scrollSnapAlign: "center",
              fontSize: isSel ? 18 : 14,
              fontWeight: isSel ? 700 : 400,
              color: isSel ? "var(--text-primary)" : "var(--text-muted)",
              opacity: isSel ? 1 : 0.7,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            {pad(v)}
          </button>
        );
      })}
      <div aria-hidden="true" style={{ height: padPx }} />
    </div>
  );
}
