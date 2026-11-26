"use client";

import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Plus, X, XCircle } from "lucide-react";
import { PLATFORM_MAP } from "../../lib/platforms";
import { btnPrimary, btnSecondary } from "../../lib/uiClasses";
import { clearPublishResult, setActiveView } from "../../store/uiSlice";
import { resetEditor } from "../../store/editorSlice";

function PlatformBadge({ platform }) {
  const p = PLATFORM_MAP[platform];
  const Icon = p?.icon;
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
      style={{ background: p?.color || "var(--text-muted)" }}
      aria-hidden="true"
    >
      {Icon ? <Icon size={17} /> : (platform || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

function Row({ platform, label, children }) {
  return (
    <li
      className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-secondary)" }}
    >
      <PlatformBadge platform={platform} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {PLATFORM_MAP[platform]?.label || platform}
          {label ? <span className="font-normal" style={{ color: "var(--text-muted)" }}> · {label}</span> : null}
        </p>
        {children}
      </div>
    </li>
  );
}

/**
 * "Publish now" progress + outcome dialog.
 *
 * Publishing used to give no visible feedback (results only reached the
 * notification bell), so users couldn't tell whether a post went out. This
 * shows a progress state, then one row per account: published (with a link
 * to the live post) or failed (with the reason), plus platforms skipped
 * because no account is connected.
 */
export default function PublishResultModal() {
  const result = useSelector((s) => s.ui.publishResult);
  const dispatch = useDispatch();
  const t = useTranslations("publishResult");

  const close = () => dispatch(clearPublishResult());

  useEffect(() => {
    if (!result) return undefined;
    const onKey = (e) => e.key === "Escape" && dispatch(clearPublishResult());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, dispatch]);

  if (!result) return null;

  const publishing = result.phase === "publishing";
  const ok = result.ok || [];
  const failed = result.failed || [];
  const skipped = result.skipped || [];
  const problems = failed.length + skipped.length + (result.error ? 1 : 0);

  let tone;
  if (publishing) tone = { icon: Loader2, color: "var(--accent-primary)", title: t("publishing"), spin: true };
  else if (ok.length && !problems) tone = { icon: CheckCircle2, color: "var(--status-approved)", title: t("success") };
  else if (ok.length) tone = { icon: AlertTriangle, color: "var(--status-pending)", title: t("partial") };
  else tone = { icon: XCircle, color: "var(--status-error)", title: t("failed") };
  const ToneIcon = tone.icon;

  const platformNames = (result.platforms || []).map((id) => PLATFORM_MAP[id]?.label || id).join(", ");
  const subtitle = publishing
    ? t("publishingDesc", { platforms: platformNames })
    : ok.length && !problems
      ? t("successDesc", { count: ok.length })
      : ok.length
        ? t("partialDesc", { ok: ok.length, failed: problems })
        : t("failedDesc");

  return (
    <div
      className="fixed inset-0 z-150 flex items-center justify-center p-4 motion-safe:animate-[fadeIn_0.2s_ease_forwards]"
      style={{ background: "rgba(15, 23, 42, 0.55)", backdropFilter: "blur(4px)" }}
      onClick={publishing ? undefined : close}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border p-6 shadow-2xl motion-safe:animate-[scaleIn_0.2s_ease_forwards]"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-result-title"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 rounded-lg p-1.5 transition-colors hover:bg-(--bg-secondary)"
          style={{ color: "var(--text-muted)" }}
          aria-label={t("close")}
        >
          <X size={16} />
        </button>

        <div className="flex flex-col items-center text-center">
          <span
            className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: `color-mix(in srgb, ${tone.color} 14%, transparent)`, color: tone.color }}
          >
            <ToneIcon size={28} className={tone.spin ? "animate-spin" : ""} />
          </span>
          <h2 id="publish-result-title" className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            {tone.title}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>
        </div>

        {!publishing && (ok.length > 0 || failed.length > 0 || skipped.length > 0) && (
          <ul className="mt-5 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {ok.map((r, i) => (
              <Row key={`ok-${i}`} platform={r.platform} label={r.target_label}>
                <p className="mt-0.5 flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--status-approved)" }}>
                    <CheckCircle2 size={12} /> {t("published")}
                  </span>
                  {r.permalink_url && (
                    <a
                      href={r.permalink_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold hover:underline"
                      style={{ color: "var(--accent-primary)" }}
                    >
                      {t("viewPost")} <ExternalLink size={11} />
                    </a>
                  )}
                </p>
              </Row>
            ))}
            {failed.map((r, i) => (
              <Row key={`ko-${i}`} platform={r.platform} label={r.target_label}>
                <p className="mt-0.5 text-xs" style={{ color: "var(--status-error)" }}>
                  {t("errorReason", { error: r.error || "unknown" })}
                </p>
              </Row>
            ))}
            {skipped.map((platform) => (
              <Row key={`skip-${platform}`} platform={platform}>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{t("notConnected")}</p>
              </Row>
            ))}
          </ul>
        )}

        {!publishing && result.error && (
          <p className="mt-4 rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,.08)", color: "var(--status-error)" }}>
            {t("errorReason", { error: result.error })}
          </p>
        )}

        {!publishing && (
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={btnSecondary} onClick={close}>
              {t("close")}
            </button>
            {ok.length > 0 && (
              <button
                type="button"
                className={`${btnPrimary} gap-1.5`}
                onClick={() => {
                  dispatch(resetEditor());
                  dispatch(clearPublishResult());
                  dispatch(setActiveView("creation"));
                }}
              >
                <Plus size={15} /> {t("newPost")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
