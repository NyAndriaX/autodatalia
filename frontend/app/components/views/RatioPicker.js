"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Frame } from "lucide-react";
import { RATIOS_BY_PLATFORM, parseRatio } from "../../lib/platforms";

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
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const spec = RATIOS_BY_PLATFORM[platform.id];
  const options = spec?.options || [];

  useEffect(() => {
    if (!open) return;
    const away = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!options.length) return null;
  const effective = value || spec.defaultRatio;

  return (
    <div className="relative" ref={ref}>
      <button
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
        title={`Aspect ratio for ${platform.label}`}
      >
        <Frame size={11} aria-hidden="true" />
        {effective}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-[120] mt-1 rounded-xl p-1.5 shadow-lg animate-fade-in"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-dropdown)",
            minWidth: 220,
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
                    default
                  </span>
                )}
                {isSelected && (
                  <Check size={12} style={{ color: "var(--accent-primary)" }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
