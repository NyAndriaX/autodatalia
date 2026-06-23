"use client";

import { fadeIn } from "../../lib/uiClasses";

export default function PageHero({
  eyebrow,
  title,
  subtitle,
  actions,
  stats,
  className = "",
}) {
  return (
    <header
      className={`relative mb-6 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] px-7 py-7 ${fadeIn} ${className}`.trim()}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-100"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(29, 63, 190, 0.12) 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 90% 100%, rgba(220, 38, 38, 0.06) 0%, transparent 50%)",
        }}
        aria-hidden="true"
      />
      <div className="relative z-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          {eyebrow && (
            <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[var(--accent-primary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-approved)] shadow-[0_0_8px_var(--status-approved)]" />
              {eyebrow}
            </p>
          )}
          <h1 className="m-0 text-[clamp(1.5rem,3vw,1.875rem)] font-extrabold leading-tight tracking-tight text-[var(--text-primary)]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-[var(--text-muted)]">
              {subtitle}
            </p>
          )}
          {actions && <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div>}
        </div>
        {stats && stats.length > 0 && (
          <div className="flex shrink-0 gap-7">
            {stats.map((s) => (
              <div key={s.label} className="text-right">
                <span
                  className="block text-3xl font-extrabold leading-none tracking-tight"
                  style={{
                    background: "var(--accent-gradient)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {s.value}
                </span>
                <span className="mt-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
