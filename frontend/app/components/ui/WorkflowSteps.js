"use client";

/**
 * Horizontal workflow stepper — Tailwind only (no globals.css utilities).
 */
export default function WorkflowSteps({
  steps,
  currentId,
  completedIds = [],
  onStepClick,
  compact = false,
  ariaLabel = "Workflow progress",
}) {
  const completed = new Set(completedIds);
  const currentIdx = steps.findIndex((s) => s.id === currentId);

  return (
    <nav
      className="w-full rounded-xl border border-(--border-default) bg-(--bg-card) px-3 py-2.5"
      aria-label={ariaLabel}
    >
      <ol className="m-0 flex list-none items-start p-0">
        {steps.map((step, idx) => {
          const isComplete = completed.has(step.id);
          const isCurrent = step.id === currentId;
          const isPast = currentIdx > idx || isComplete;
          const Icon = step.icon;
          const clickable = !!onStepClick;

          return (
            <li key={step.id} className="relative flex min-w-0 flex-1 items-center">
              {idx > 0 && (
                <span
                  className={`absolute left-0 right-1/2 top-4.5 z-0 mr-[50%] h-0.5 -translate-y-1/2 ${
                    isPast ? "bg-(--accent-primary)" : "bg-(--border-default)"
                  }`}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                className="relative z-10 flex w-full flex-col items-center gap-1.5 border-0 bg-transparent px-1.5 py-0.5 text-center disabled:cursor-default"
                onClick={clickable ? () => onStepClick(step.id) : undefined}
                disabled={!clickable}
                aria-current={isCurrent ? "step" : undefined}
                title={step.hint || step.label}
              >
                <span
                  className={`flex items-center justify-center rounded-full border-2 font-bold transition-all duration-200 ${
                    compact ? "h-8 w-8 text-xs" : "h-8.5 w-8.5 text-sm"
                  } ${
                    isCurrent
                      ? "border-transparent text-white shadow-(--accent-glow) bg-(image:--accent-gradient)"
                      : isPast && !isCurrent
                      ? "border-(--status-approved) bg-green-500/15 text-(--status-approved)"
                      : "border-(--border-default) bg-(--bg-tertiary) text-(--text-muted)"
                  } ${clickable && !isCurrent ? "hover:scale-105 hover:shadow-(--accent-glow)" : ""}`}
                >
                  {isComplete && !isCurrent ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 7.2L5.8 10.5L11.5 3.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : Icon ? (
                    <Icon style={{ fontSize: compact ? 14 : 16 }} aria-hidden="true" />
                  ) : (
                    idx + 1
                  )}
                </span>
                {!compact && (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={`max-w-full truncate text-[11px] font-bold ${
                        isCurrent ? "text-(--accent-primary)" : "text-(--text-primary)"
                      }`}
                    >
                      {step.label}
                    </span>
                    {step.hint && (
                      <span className="max-w-full truncate text-[10px] leading-tight text-(--text-muted) max-sm:hidden">
                        {step.hint}
                      </span>
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
