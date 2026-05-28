"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Coins,
  RefreshCcw,
  Sparkles,
  Film,
  Send,
  Wallet,
  TrendingUp,
  DollarSign,
  Tag,
} from "lucide-react";
import { fetchCostSummary } from "../../lib/costService";

/**
 * Credits & spend view.
 *
 * Reads live aggregates from /costs/summary instead of mocking from the
 * Redux session ring. The dashboard is per-workflow + per-tier + per-model
 * so the team can see EXACTLY where the LLM/media budget is going.
 *
 * Two display modes:
 *  - "credits": converts USD spend to a credit currency (1c = €0.01).
 *    Kept because the team's existing budgeting discussion is in credits.
 *  - "raw":    shows the actual USD/EUR numbers from the backend.
 *
 * Default window is 30 days because that matches monthly billing cadence.
 */
const CREDIT_TO_EUR = 0.01;
const EUR_TO_CREDITS = 1 / CREDIT_TO_EUR; // 100 credits per €1
const PERIODS = [
  { id: "24h", label: "Last 24h" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
];

const WORKFLOW_LABELS = {
  post_variants: { label: "Post generation", icon: Sparkles },
  captions: { label: "Caption generation", icon: Sparkles },
  hashtags: { label: "Hashtag suggestion", icon: Tag },
  summary: { label: "Post summarisation", icon: Sparkles },
  transform: { label: "Quick AI actions", icon: Sparkles },
  image_description: { label: "Image analysis (vision)", icon: Sparkles },
  image: { label: "AI image generation", icon: Sparkles },
  video: { label: "AI video (LTX)", icon: Film },
};

function workflowLabel(id) {
  return WORKFLOW_LABELS[id] || { label: id || "Other", icon: Coins };
}

function formatTokens(n) {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function eur(n) {
  return `€${(n || 0).toFixed(2)}`;
}

export default function CreditsView() {
  const [period, setPeriod] = useState("30d");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function reload(currentPeriod = period) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCostSummary(currentPeriod);
      setSummary(data);
    } catch (err) {
      setError(err.message || "Failed to load cost summary.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload(period);
    // Refresh every 30s so the credit view tracks live spend.
    const t = setInterval(() => reload(period), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const totals = summary?.totals || {};
  const totalCostUsd = totals.cost_usd || 0;
  const totalCostEur = totals.cost_eur || totalCostUsd * 0.92;
  const usedCredits = Math.round(totalCostEur * EUR_TO_CREDITS);
  const savedUsd = totals.saved_by_cache_usd || 0;

  const byWorkflow = useMemo(() => summary?.by_workflow || [], [summary]);
  const byTier = useMemo(() => summary?.by_tier || [], [summary]);
  const byModel = useMemo(() => summary?.by_model || [], [summary]);

  return (
    <div className="h-full overflow-y-auto animate-fade-in" style={{ padding: 24 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* Header */}
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
              Credits &amp; spend
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Live aggregate of every AI / media call this workspace has made.
              {savedUsd > 0 && (
                <span style={{ color: "var(--status-approved)" }}>
                  {" "}· {eur(savedUsd * 0.92)} saved by the cache.
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: period === p.id ? "var(--accent-primary)" : "var(--bg-secondary)",
                  color: period === p.id ? "white" : "var(--text-secondary)",
                  border: "1px solid var(--border-default)",
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => reload()}
              className="p-1.5 rounded-lg transition-all"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-default)",
              }}
              title="Refresh"
            >
              <RefreshCcw size={14} />
            </button>
          </div>
        </div>

        {error && (
          <div
            className="mb-4 p-3 rounded-lg text-sm"
            style={{ background: "var(--status-error-bg)", color: "var(--status-error)" }}
          >
            {error}
          </div>
        )}

        {/* Headline KPIs */}
        <div
          className="grid gap-3 mb-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        >
          <KpiCard
            icon={DollarSign}
            label="Spent"
            primary={eur(totalCostEur)}
            secondary={`$${totalCostUsd.toFixed(2)} USD`}
            loading={loading}
          />
          <KpiCard
            icon={Coins}
            label="Credits used"
            primary={usedCredits.toLocaleString()}
            secondary={`1 credit = €${CREDIT_TO_EUR.toFixed(2)}`}
            loading={loading}
          />
          <KpiCard
            icon={Send}
            label="AI calls"
            primary={(totals.calls || 0).toLocaleString()}
            secondary={`${totals.cache_hits || 0} cache hits (free)`}
            loading={loading}
          />
          <KpiCard
            icon={TrendingUp}
            label="Tokens"
            primary={formatTokens(totals.tokens || 0)}
            secondary={
              totals.calls > 0
                ? `~${formatTokens(Math.round(totals.tokens / totals.calls))}/call`
                : "—"
            }
            loading={loading}
          />
        </div>

        {/* By workflow + by tier side by side */}
        <div
          className="grid gap-4 mb-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}
        >
          <BreakdownCard
            icon={Wallet}
            title="Where credits went (by workflow)"
            rows={byWorkflow}
            totalCost={totalCostUsd}
            labelFor={workflowLabel}
            empty="No spend in this window."
          />
          <BreakdownCard
            icon={DollarSign}
            title="By LLM tier"
            rows={byTier}
            totalCost={totalCostUsd}
            labelFor={(id) => ({
              label:
                id === "fast"
                  ? "Fast tier (cheap)"
                  : id === "standard"
                  ? "Standard tier"
                  : id === "premium"
                  ? "Premium tier"
                  : id === "media"
                  ? "Media generation"
                  : id || "Unknown",
              icon: Coins,
            })}
            empty="No tiered spend yet."
          />
        </div>

        {/* Per-model rollup */}
        <div className="card" style={{ padding: 18 }}>
          <h2
            className="text-sm font-semibold mb-3 inline-flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <TrendingUp size={14} /> Top models by spend
          </h2>
          {byModel.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              No model usage in this window.
            </p>
          ) : (
            <table className="w-full text-sm" style={{ color: "var(--text-secondary)" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)" }} className="text-left text-xs uppercase tracking-wider">
                  <th className="pb-2 font-semibold">Model</th>
                  <th className="pb-2 font-semibold text-right">Calls</th>
                  <th className="pb-2 font-semibold text-right">Tokens</th>
                  <th className="pb-2 font-semibold text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byModel.slice(0, 12).map((r) => (
                  <tr key={r.key} style={{ borderTop: "1px solid var(--border-default)" }}>
                    <td className="py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                      {r.key}
                    </td>
                    <td className="py-2 text-right">{r.calls}</td>
                    <td className="py-2 text-right">{formatTokens(r.tokens)}</td>
                    <td className="py-2 text-right font-semibold">
                      ${r.cost_usd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, primary, secondary, loading }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="flex items-center justify-between mb-3">
        <Icon size={18} style={{ color: "var(--accent-primary)" }} />
        {loading && (
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            …
          </span>
        )}
      </div>
      <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {primary}
      </p>
      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      {secondary && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
          {secondary}
        </p>
      )}
    </div>
  );
}

function BreakdownCard({ icon: Icon, title, rows, totalCost, labelFor, empty }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <h2
        className="text-sm font-semibold mb-3 inline-flex items-center gap-2"
        style={{ color: "var(--text-primary)" }}
      >
        <Icon size={14} /> {title}
      </h2>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          {empty}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => {
            const meta = labelFor(row.key);
            const RowIcon = meta.icon;
            const pct = totalCost > 0 ? (row.cost_usd / totalCost) * 100 : 0;
            return (
              <div
                key={row.key}
                className="px-3 py-2.5 rounded-lg"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-default)",
                }}
              >
                <div className="flex items-center gap-3 mb-1.5">
                  <RowIcon size={14} style={{ color: "var(--accent-primary)" }} />
                  <span className="text-sm flex-1" style={{ color: "var(--text-primary)" }}>
                    {meta.label}
                  </span>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    ${row.cost_usd.toFixed(4)}
                  </span>
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--bg-tertiary)" }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      background: "var(--accent-gradient)",
                    }}
                  />
                </div>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                  {row.calls} call{row.calls === 1 ? "" : "s"} ·{" "}
                  {formatTokens(row.tokens)} tokens · {pct.toFixed(1)}%
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
