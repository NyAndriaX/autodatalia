"use client";

import { useMemo } from "react";
import { useSelector } from "react-redux";
import {
  Coins,
  Plus,
  Sparkles,
  Film,
  Send,
  Wallet,
  TrendingUp,
} from "lucide-react";

/**
 * Credits & billing view.
 *
 * Working model (placeholder until the real billing backend lands):
 *   1 credit = €0.01  (i.e. 100 credits = €1)
 *   1 AI request ≈ tokens used × CREDIT_PER_1K_TOKENS
 *
 * The token → credit conversion is a flat estimate per 1k tokens; the
 * actual cost per provider is set per-row in `WORKFLOW_RATES` so the user
 * can see *which workflow* burns the most. When the real metering lands
 * (per-provider $ rates from the LLM router), these constants get hot-
 * swapped for live data and the view does not change.
 */
const CREDIT_TO_EUR = 0.01; // 1 credit = €0.01
const TOKEN_TO_CREDIT_PER_1K = 1; // 1k tokens ≈ 1 credit at current avg blended rate

// Per-workflow estimated cost in credits (placeholder rates — the live
// router will overwrite these once billing data starts flowing).
const WORKFLOW_RATES = [
  { id: "ai-text", label: "AI text generation", icon: Sparkles, perCallCredits: 2 },
  { id: "ai-image", label: "AI image (DALL·E / SD)", icon: Sparkles, perCallCredits: 18 },
  { id: "ai-video", label: "AI video (LTX)", icon: Film, perCallCredits: 80 },
  { id: "telegram-validation", label: "Telegram validation round", icon: Send, perCallCredits: 1 },
];

// Starting allowance for the workspace (placeholder — replace with real
// balance from billing API once available).
const STARTING_CREDITS = 5000;

export default function CreditsView() {
  const aiUsage = useSelector((s) => s.ui.aiUsage);

  const consumed = useMemo(() => {
    const fromTokens =
      (aiUsage.totalTokens / 1000) * TOKEN_TO_CREDIT_PER_1K;
    return Math.round(fromTokens);
  }, [aiUsage.totalTokens]);

  const remaining = Math.max(STARTING_CREDITS - consumed, 0);
  const usedPct = Math.min((consumed / STARTING_CREDITS) * 100, 100);

  // Group recent AI calls into rough buckets so the table shows where the
  // credits actually went.
  const usageByKind = useMemo(() => {
    const groups = new Map();
    for (const c of aiUsage.recentCalls || []) {
      const kind = c.kind || "generate";
      const prev = groups.get(kind) || { calls: 0, tokens: 0 };
      groups.set(kind, {
        calls: prev.calls + 1,
        tokens: prev.tokens + (c.totalTokens || 0),
      });
    }
    return Array.from(groups.entries()).map(([kind, v]) => ({
      kind,
      calls: v.calls,
      tokens: v.tokens,
      credits: Math.round((v.tokens / 1000) * TOKEN_TO_CREDIT_PER_1K),
    }));
  }, [aiUsage.recentCalls]);

  return (
    <div
      className="h-full overflow-y-auto animate-fade-in"
      style={{ padding: 24 }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Hero */}
        <div className="mb-6">
          <h1
            className="text-2xl font-bold mb-1"
            style={{ color: "var(--text-primary)" }}
          >
            Credits
          </h1>
          <p
            className="text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            One credit = €{CREDIT_TO_EUR.toFixed(2)} · automatically debited per AI
            call or video render.
          </p>
        </div>

        {/* Balance + top-up */}
        <div
          className="card mb-6"
          style={{ padding: 22 }}
        >
          <div
            className="flex flex-wrap items-end justify-between gap-4 mb-4"
          >
            <div>
              <p
                className="text-[11px] uppercase tracking-wider mb-1"
                style={{ color: "var(--text-muted)" }}
              >
                Available balance
              </p>
              <div className="flex items-baseline gap-3">
                <span
                  className="text-4xl font-bold leading-none"
                  style={{ color: "var(--text-primary)" }}
                >
                  {remaining.toLocaleString()}
                </span>
                <span
                  className="text-sm"
                  style={{ color: "var(--text-muted)" }}
                >
                  credits · €{(remaining * CREDIT_TO_EUR).toFixed(2)}
                </span>
              </div>
              <p
                className="text-xs mt-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                {consumed.toLocaleString()} credits used this period (€
                {(consumed * CREDIT_TO_EUR).toFixed(2)})
              </p>
            </div>
            <button
              className="btn-primary inline-flex items-center gap-1.5"
              onClick={() =>
                alert(
                  "Top-up integration coming when the billing backend is wired."
                )
              }
            >
              <Plus size={14} /> Top up credits
            </button>
          </div>

          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: "var(--bg-secondary)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${usedPct}%`,
                background:
                  usedPct > 90
                    ? "var(--status-error)"
                    : usedPct > 70
                    ? "var(--status-pending)"
                    : "var(--accent-primary)",
              }}
            />
          </div>
          <div
            className="flex justify-between mt-2 text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            <span>0 credits</span>
            <span>{STARTING_CREDITS.toLocaleString()} credits</span>
          </div>
        </div>

        {/* Per-workflow rates */}
        <div
          className="card mb-6"
          style={{ padding: 18 }}
        >
          <h2
            className="text-sm font-semibold mb-3 inline-flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <Wallet size={14} /> Rates by workflow
          </h2>
          <div className="flex flex-col gap-1.5">
            {WORKFLOW_RATES.map((w) => {
              const Icon = w.icon;
              return (
                <div
                  key={w.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  <Icon
                    size={15}
                    style={{ color: "var(--accent-primary)" }}
                  />
                  <span
                    className="text-sm flex-1"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {w.label}
                  </span>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {w.perCallCredits} credit
                    {w.perCallCredits === 1 ? "" : "s"}
                  </span>
                  <span
                    className="text-[11px] w-14 text-right"
                    style={{ color: "var(--text-muted)" }}
                  >
                    €{(w.perCallCredits * CREDIT_TO_EUR).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
          <p
            className="text-[11px] mt-3"
            style={{ color: "var(--text-tertiary)" }}
          >
            Estimates based on average provider pricing. Live per-call cost is
            metered through the LLM router.
          </p>
        </div>

        {/* Usage breakdown */}
        <div className="card" style={{ padding: 18 }}>
          <h2
            className="text-sm font-semibold mb-3 inline-flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <TrendingUp size={14} /> Usage this session
          </h2>
          {usageByKind.length === 0 ? (
            <p
              className="py-6 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              No AI calls yet this session.
            </p>
          ) : (
            <div
              className="grid gap-2 text-xs"
              style={{
                gridTemplateColumns:
                  "minmax(120px, 1fr) auto auto auto",
              }}
            >
              <span
                className="font-semibold uppercase tracking-wider text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                Workflow
              </span>
              <span
                className="font-semibold uppercase tracking-wider text-[10px] text-right"
                style={{ color: "var(--text-muted)" }}
              >
                Calls
              </span>
              <span
                className="font-semibold uppercase tracking-wider text-[10px] text-right"
                style={{ color: "var(--text-muted)" }}
              >
                Tokens
              </span>
              <span
                className="font-semibold uppercase tracking-wider text-[10px] text-right"
                style={{ color: "var(--text-muted)" }}
              >
                Credits
              </span>
              {usageByKind.map((row) => (
                <div
                  key={row.kind}
                  className="contents"
                >
                  <span
                    className="py-1.5"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {row.kind}
                  </span>
                  <span
                    className="py-1.5 text-right"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {row.calls}
                  </span>
                  <span
                    className="py-1.5 text-right"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {row.tokens.toLocaleString()}
                  </span>
                  <span
                    className="py-1.5 text-right font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {row.credits}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
