"use client";

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, X, XCircle } from "lucide-react";

// How long each kind stays on screen (ms). Errors linger so they can be read.
const DURATION = { success: 4500, info: 4500, warning: 6500, error: 8000 };
const META = {
  success: { icon: CheckCircle2, color: "var(--status-approved)" },
  error: { icon: XCircle, color: "var(--status-error)" },
  warning: { icon: AlertTriangle, color: "var(--status-pending)" },
  info: { icon: Info, color: "var(--accent-primary)" },
};
const MAX_VISIBLE = 4;

/**
 * On-screen toasts for in-app notifications.
 *
 * Thunks push events into `ui.notifications` (the bell feed). Until now they
 * only showed up as a badge on the bell, so actions like "post scheduled" or
 * "upload failed" looked like nothing happened. This surfaces every event
 * created after mount for a few seconds. Events flagged `toast: false` (e.g.
 * per-platform publish results, already shown in the publish dialog) stay in
 * the bell only.
 */
export default function Toaster() {
  const notifications = useSelector((s) => s.ui.notifications);
  const tNotif = useTranslations("notifications");
  const t = useTranslations("common");
  // Only toast what happens from now on, not the history already in the bell.
  const [mountedAt] = useState(() => new Date().toISOString());
  const [dismissed, setDismissed] = useState(() => new Set());

  const toasts = notifications
    .filter((n) => n.toast !== false && n.timestamp >= mountedAt && !dismissed.has(n.id))
    .slice(0, MAX_VISIBLE);
  const visibleKey = toasts.map((n) => n.id).join("|");

  // Auto-dismiss each toast after its duration.
  useEffect(() => {
    const timers = toasts.map((n) =>
      setTimeout(
        () => setDismissed((prev) => new Set(prev).add(n.id)),
        DURATION[n.type] || DURATION.info
      )
    );
    return () => timers.forEach(clearTimeout);
    // Re-arm only when the set of visible toasts changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-20 z-200 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
      role="status"
    >
      {toasts.map((n) => {
        const meta = META[n.type] || META.info;
        const Icon = meta.icon;
        const text = n.messageKey ? tNotif(n.messageKey, n.messageParams || {}) : n.message;
        return (
          <div
            key={n.id}
            className="pointer-events-auto flex items-start gap-3 overflow-hidden rounded-xl border p-3 pl-3.5 shadow-lg backdrop-blur-xl motion-safe:animate-[slideUp_0.25s_ease_forwards]"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border-default)",
              boxShadow: `inset 3px 0 0 ${meta.color}, var(--shadow-lg, 0 10px 30px rgba(0,0,0,.18))`,
            }}
          >
            <Icon size={18} className="mt-0.5 shrink-0" style={{ color: meta.color }} aria-hidden="true" />
            <p className="flex-1 text-[13px] leading-snug" style={{ color: "var(--text-primary)" }}>
              {text}
              {n.url && (
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1.5 inline-flex items-center gap-0.5 font-semibold hover:underline"
                  style={{ color: "var(--accent-primary)" }}
                >
                  {t("open")} <ExternalLink size={11} />
                </a>
              )}
            </p>
            <button
              type="button"
              onClick={() => setDismissed((prev) => new Set(prev).add(n.id))}
              className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-(--bg-secondary)"
              style={{ color: "var(--text-muted)" }}
              aria-label={t("close")}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
