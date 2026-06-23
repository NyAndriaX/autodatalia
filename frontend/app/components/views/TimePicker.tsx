"use client";
import { btnPrimary, btnSecondary, btnGhost, inputField, card, glassCard, fadeIn, badgeDraft } from "../../lib/uiClasses";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { getScheduleTimezone } from "../../lib/timezone";

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

const pad = (n) => String(n).padStart(2, "0");

export default function TimePicker({ value = "09:00", onChange, minuteStep = 5 }) {
  const t = useTranslations("timePicker");
  // Common posting times — picked over months of "what did users actually
  // schedule" feedback; surfaces them as one-tap chips so the columns are
  // rarely needed at all. Memoized on the translator so labels update with
  // locale changes without rebuilding on every render.
  const PRESETS = useMemo(
    () => [
      { label: t("morning"), time: "09:00" },
      { label: t("noon"), time: "12:00" },
      { label: t("afternoon"), time: "15:00" },
      { label: t("evening"), time: "18:00" },
      { label: t("night"), time: "21:00" },
    ],
    [t]
  );
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState(null); // { top, left }
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

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
  }, [open]);

  const [hStr = "09", mStr = "00"] = (value || "09:00").split(":");
  const selectedH = Math.max(0, Math.min(23, parseInt(hStr, 10) || 0));
  const selectedM = Math.max(0, Math.min(59, parseInt(mStr, 10) || 0));

  // Memoise by `minuteStep` so the array reference stays stable across
  // unrelated parent re-renders. Without this, every re-render of the
  // popover handed WheelColumn a new `items` array → its useLayoutEffect
  // re-fired → isProgScroll flipped true for ~70ms → user scrolls/clicks
  // on the minute column were silently swallowed. The hour column never
  // showed the bug because HOURS is a module-level constant.
  const minutes = useMemo(() => {
    const arr = [];
    for (let m = 0; m < 60; m += minuteStep) arr.push(m);
    return arr;
  }, [minuteStep]);

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
      aria-label={t("chooseTime")}
      className={`rounded-xl p-3 shadow-lg ${fadeIn}`}
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
        presets={PRESETS}
        timezoneTooltip={t("scheduleTimezoneTooltip")}
        hourLabel={t("hour")}
        minuteLabel={t("minute")}
        nowLabel={t("now")}
        doneLabel={t("done")}
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
      {popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </>
  );
}

/* The popover body is its own component so the markup stays readable above.
   The behavioral nuance — portal, reposition, click-away — lives in the
   parent so this can focus purely on what the user sees. */
function PopoverBody({
  selectedH,
  snappedM,
  minutes,
  commit,
  close,
  presets,
  timezoneTooltip,
  hourLabel,
  minuteLabel,
  nowLabel,
  doneLabel,
}) {
  return (
    <>
      {/* Big readout — tall enough that the picker reads as "I'm a clock",
          not "I'm another grid". The tiny line below names the active
          scheduling timezone so the user can never be surprised about
          what "09:00" will actually mean to the scheduler. */}
      <div
        className="text-center mb-1 tabular-nums leading-none"
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
      <div
        className="text-center text-[10px] mb-3"
        style={{ color: "var(--text-muted)" }}
        title={timezoneTooltip}
      >
        {getScheduleTimezone()}
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
          ariaLabel={hourLabel}
          items={HOURS}
          selected={selectedH}
          onSelect={(h) => commit(h, snappedM)}
        />
        <WheelColumn
          ariaLabel={minuteLabel}
          items={minutes}
          selected={snappedM}
          onSelect={(m) => commit(selectedH, m)}
        />
      </div>

      {/* Quick presets — what 9 in 10 picks actually look like. */}
      <div className="flex flex-wrap gap-1 mb-2">
        {presets.map((p) => {
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
          {nowLabel}
        </button>
        <button
          type="button"
          onClick={close}
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          {doneLabel}
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
  // Track whether a programmatic scroll is in progress so the scroll
  // handler doesn't fight external value changes (presets, clicks).
  const isProgScroll = useRef(false);
  // Debounce timer for scroll-end detection.
  const scrollTimer = useRef(null);
  // Pointer-down origin so we can distinguish "tap on a row" from
  // "drag to scroll the column". Without this, scroll-snap-mandatory
  // can swallow taps on touch devices (the press is interpreted as a
  // 0-px drag and `onClick` never resolves).
  const pressOrigin = useRef(null);

  // Helper: re-enable scroll-snap. Kept as a function so both the
  // programmatic scroll and the user-scroll-end paths can call it.
  const enableSnap = () => {
    if (ref.current) ref.current.style.scrollSnapType = "y mandatory";
  };
  const disableSnap = () => {
    if (ref.current) ref.current.style.scrollSnapType = "none";
  };

  // Scroll the selected row into the centred tray. useLayoutEffect (vs.
  // useEffect) so the scroll lands before paint — otherwise the user sees
  // the column jump on first render.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const idx = items.indexOf(selected);
    if (idx < 0) return;
    const target = idx * ROW_PX;
    // No-op when we're already on the right row. This matters because
    // unrelated parent re-renders would otherwise flip isProgScroll true
    // for ~70 ms and silently swallow a mid-flight user scroll/tap.
    if (ref.current.scrollTop === target) return;
    isProgScroll.current = true;
    disableSnap();
    ref.current.scrollTop = target;
    requestAnimationFrame(() => {
      enableSnap();
      setTimeout(() => { isProgScroll.current = false; }, 60);
    });
  }, [selected, items]);

  // After the user stops scrolling (touch swipe, mouse wheel, trackpad),
  // figure out which item sits in the centred tray and commit it.
  // Snap is disabled WHILE scrolling so the column doesn't jitter under
  // the finger, then re-enabled at the end so the final position locks.
  const handleScroll = () => {
    if (isProgScroll.current) return;
    disableSnap();
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      if (!ref.current || isProgScroll.current) return;
      const idx = Math.round(ref.current.scrollTop / ROW_PX);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      enableSnap();
      if (items[clamped] !== selected) {
        onSelect(items[clamped]);
      } else {
        // Snap manually to the exact row when the value didn't change —
        // otherwise the column can end up a few pixels off after the
        // user's flick decelerates.
        ref.current.scrollTop = clamped * ROW_PX;
      }
    }, 140);
  };

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
        WebkitOverflowScrolling: "touch",
        msOverflowStyle: "none", // IE/Edge
        touchAction: "pan-y", // let vertical drags scroll, intercept the rest
      }}
      onScroll={handleScroll}
      onWheel={(e) => {
        // Default browser wheel handling already produces a nice scroll;
        // we just make sure the popover container doesn't also scroll.
        e.stopPropagation();
      }}
    >
      {/* Hide Webkit scrollbar */}
      <style>{`[role="listbox"]::-webkit-scrollbar { display: none; }`}</style>
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
            // Tap-vs-drag detection: record where the press started on
            // pointerdown; on pointerup, only treat it as a tap if the
            // pointer barely moved. A real drag falls through to the
            // browser's native scroll and `handleScroll` picks up the
            // final row.
            onPointerDown={(e) => {
              pressOrigin.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const o = pressOrigin.current;
              pressOrigin.current = null;
              if (!o) return;
              const moved = Math.hypot(e.clientX - o.x, e.clientY - o.y);
              if (moved < 6 && v !== selected) onSelect(v);
            }}
            onPointerCancel={() => {
              pressOrigin.current = null;
            }}
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
              touchAction: "pan-y",
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
