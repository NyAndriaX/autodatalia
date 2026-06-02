"use client";
import { btnPrimary, btnSecondary, btnGhost, inputField, card, glassCard, fadeIn, badgeDraft } from "../../lib/uiClasses";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ChevronDown, Check, Frame } from "lucide-react";
import { RATIOS_BY_PLATFORM, parseRatio } from "../../lib/platforms";

const POPOVER_WIDTH = 240;
const POPOVER_HEIGHT_APPROX = 220;

/**
 * Per-platform aspect-ratio popover. Extracted from CreationEditor so the
 * schedule + edit modals can reuse the exact same picker — every place
 * that builds a post payload writes into the same `ratios` map the backend
 * already understands, so the scheduler crops correctly no matter where
 * the post was authored.
 *
 * Props
 *   platform — one entry from PLATFORMS (provides id, label)
 *   value    — currently selected ratio string ("1:1", "4:5", …)
 *   onChange — (next: string) => void
 *   compact  — slimmer trigger; useful inline in a modal form row
 */
export default function RatioPicker({ platform, value, onChange, compact = false }) {
  const t = useTranslations("ratio");
  const tCreation = useTranslations("creation");
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const spec = RATIOS_BY_PLATFORM[platform.id];
  const options = spec?.options || [];

  // Anchor the popover to the trigger via fixed-position math. The previous
  // absolute-positioned popover got clipped by the modal's overflow:auto,
  // so the user only saw the first option (the screenshot showed nothing
  // but the "DEFAULT" badge). Same fix the TimePicker uses.
  const reposition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vpH = window.innerHeight;
    const vpW = window.innerWidth;
    const popH = popoverRef.current?.offsetHeight || POPOVER_HEIGHT_APPROX;
    const flipUp = rect.bottom + popH + 8 > vpH && rect.top - popH - 8 > 0;
    const top = flipUp ? rect.top - popH - 6 : rect.bottom + 6;
    // Right-align with the trigger, then clamp into the viewport.
    const preferredLeft = rect.right - POPOVER_WIDTH;
    const left = Math.max(8, Math.min(preferredLeft, vpW - POPOVER_WIDTH - 8));
    setPopoverPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    reposition();
    const onClickAway = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
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

  // Re-measure after first paint so the flip-up math uses the real height.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  if (!options.length) return null;
  const effective = value || spec.defaultRatio;

  const popover = open && popoverPos && (
    <div
      ref={popoverRef}
      role="listbox"
      className={`rounded-xl p-1.5 shadow-lg ${fadeIn}`}
      style={{
        position: "fixed",
        top: popoverPos.top,
        left: popoverPos.left,
        zIndex: 200,
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-dropdown)",
        minWidth: POPOVER_WIDTH,
      }}
    >
      {options.map((opt) => {
        const isSelected = opt.value === effective;
        const isDefault = opt.value === spec.defaultRatio;
        return (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-xs transition-all"
            style={{
              background: isSelected ? "rgba(99,102,241,0.12)" : "transparent",
              color: "var(--text-primary)",
            }}
          >
            <span
              className="rounded-sm shrink-0"
              style={{
                width: 22,
                height: 22 / parseRatio(opt.value),
                minHeight: 10,
                background: isSelected
                  ? "var(--accent-primary)"
                  : "var(--bg-tertiary)",
                border: "1px solid var(--border-default)",
              }}
              aria-hidden="true"
            />
            <span className="flex-1">
              <span className="block font-medium">{opt.label}</span>
              <span
                className="block text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                {opt.hint}
              </span>
            </span>
            {isDefault && (
              <span
                className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-muted)",
                }}
              >
                {tCreation("defaultBadge")}
              </span>
            )}
            {isSelected && (
              <Check size={12} style={{ color: "var(--accent-primary)" }} />
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium transition-all"
        style={{
          padding: compact ? "4px 8px" : "6px 10px",
          background: "var(--bg-secondary)",
          border: `1px solid ${open ? "var(--border-active)" : "var(--border-default)"}`,
          color: "var(--text-secondary)",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("aspectRatioFor", { platform: platform.label })}
      >
        <Frame size={11} aria-hidden="true" />
        {effective}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {/* Portal-render so the popover escapes any modal overflow:auto.
          Without this it gets clipped to the modal scroll area and only
          the first option is visible — see screenshot the user shared. */}
      {popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </>
  );
}
