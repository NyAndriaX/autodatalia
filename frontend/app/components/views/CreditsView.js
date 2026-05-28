"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
// Periods carry a translation key + the id sent to the API.
const PERIODS = [
  { id: "24h", key: "period24h" },
  { id: "7d", key: "period7d" },
  { id: "30d", key: "period30d" },
  { id: "all", key: "periodAll" },
];

// Workflow id → (translation key, icon). The translation key is resolved
// inside the component so locale changes flip the legend immediately.
const WORKFLOW_META = {
  post_variants: { key: "workflowPostVariants", icon: Sparkles },
  captions: { key: "workflowCaptions", icon: Sparkles },
  hashtags: { key: "workflowHashtags", icon: Tag },
  summary: { key: "workflowSummary", icon: Sparkles },
  transform: { key: "workflowTransform", icon: Sparkles },
  image_description: { key: "workflowImageDescription", icon: Sparkles },
  image: { key: "workflowImage", icon: Sparkles },
  video: { key: "workflowVideo", icon: Film },
};

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
  const t = useTranslations("credits");
  const tCommon = useTranslations("common");
  const [period, setPeriod] = useState("30d");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const workflowLabel = (id) => {
    const meta = WORKFLOW_META[id] || { key: null, icon: Coins };
    return {
      label: meta.key ? t(meta.key) : id || "—",
      icon: meta.icon,
    };
  };
  const tierLabel = (id) => {
    const key =
      id === "fast"
        ? "tierFast"
        : id === "standard"
        ? "tierStandard"
        : id === "premium"
        ? "tierPremium"
        : id === "media"
        ? "tierMedia"
        : null;
    return { label: key ? t(key) : id || "—", icon: Coins };
  };

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
              {t("title")}
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("subtitle")}
              {savedUsd > 0 && (
                <span style={{ color: "var(--status-approved)" }}>
                  {" "}· {t("savedByCache", {eur: eur(savedUsd * 0.92)})}
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
                {t(p.key)}
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
              title={tCommon("refresh")}
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
            label={t("spent")}
            primary={eur(totalCostEur)}
            secondary={`$${totalCostUsd.toFixed(2)} USD`}
            loading={loading}
          />
          <KpiCard
            icon={Coins}
            label={t("creditsUsed")}
            primary={usedCredits.toLocaleString()}
            secondary={t("creditDefinition", { eur: CREDIT_TO_EUR.toFixed(2) })}
            loading={loading}
          />
          <KpiCard
            icon={Send}
            label={t("aiCalls")}
            primary={(totals.calls || 0).toLocaleString()}
            secondary={`${t("cacheHitsFree", {n: totals.cache_hits || 0})}`}
            loading={loading}
          />
          <KpiCard
            icon={TrendingUp}
            label={t("tokens")}
            primary={formatTokens(totals.tokens || 0)}
            secondary={
              totals.calls > 0
                ? t("perCall", {
                    n: formatTokens(Math.round(totals.tokens / totals.calls)),
                  })
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
            title={t("byWorkflow")}
            rows={byWorkflow}
            totalCost={totalCostUsd}
            labelFor={workflowLabel}
            empty={t("noWindowSpend")}
          />
          <BreakdownCard
            icon={DollarSign}
            title={t("byTier")}
            rows={byTier}
            totalCost={totalCostUsd}
            labelFor={tierLabel}
            empty={t("noTieredSpend")}
          />
        </div>

        {/* Per-model rollup */}
        <div className="card" style={{ padding: 18 }}>
          <h2
            className="text-sm font-semibold mb-3 inline-flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <TrendingUp size={14} /> {t("topModels")}
          </h2>
          {byModel.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {t("noModels")}
            </p>
          ) : (
            <table className="w-full text-sm" style={{ color: "var(--text-secondary)" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)" }} className="text-left text-xs uppercase tracking-wider">
                  <th className="pb-2 font-semibold">{t("tableModel")}</th>
                  <th className="pb-2 font-semibold text-right">{t("tableCalls")}</th>
                  <th className="pb-2 font-semibold text-right">{t("tableTokens")}</th>
                  <th className="pb-2 font-semibold text-right">{t("tableCost")}</th>
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
  const t = useTranslations("credits");
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
                  {t("callPlural", { n: row.calls })} ·{" "}
                  {formatTokens(row.tokens)} {t("tokens").toLowerCase()} ·{" "}
                  {pct.toFixed(1)}%
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
