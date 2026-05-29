"use client";
import { card, fadeIn } from "../../lib/uiClasses";

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
 * Crédits & dépenses view.
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

const WORKFLOW_ICONS = {
  post_variants: Sparkles,
  captions: Sparkles,
  hashtags: Tag,
  summary: Sparkles,
  transform: Sparkles,
  image_description: Sparkles,
  image: Sparkles,
  video: Film,
};

const WORKFLOW_LABEL_KEYS = {
  post_variants: "workflowPostVariants",
  captions: "workflowCaptions",
  hashtags: "workflowHashtags",
  summary: "workflowSummary",
  transform: "workflowTransform",
  image_description: "workflowImageDescription",
  image: "workflowImage",
  video: "workflowVideo",
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

  const PERIODS = [
    { id: "24h", label: t("period24h") },
    { id: "7d", label: t("period7d") },
    { id: "30d", label: t("period30d") },
    { id: "all", label: t("periodAll") },
  ];

  function workflowLabel(id) {
    const key = WORKFLOW_LABEL_KEYS[id];
    const icon = WORKFLOW_ICONS[id] || Coins;
    if (key) return { label: t(key), icon };
    return { label: id || t("other"), icon };
  }

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
    // Actualiser every 30s so the credit view tracks live spend.
    const t = setInterval(() => reload(period), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const totals = summary?.totals || {};
  const totalCoûtUsd = totals.cost_usd || 0;
  const totalCoûtEur = totals.cost_eur || totalCoûtUsd * 0.92;
  const usedCredits = Math.round(totalCoûtEur * EUR_TO_CREDITS);
  const savedUsd = totals.saved_by_cache_usd || 0;

  const byFlux = useMemo(() => summary?.by_workflow || [], [summary]);
  const byNiveau = useMemo(() => summary?.by_tier || [], [summary]);
  const byModèle = useMemo(() => summary?.by_model || [], [summary]);

  return (
    <div className={`h-full overflow-y-auto p-4 md:p-6 ${fadeIn}`}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
              {t("title")}
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("subtitle")}
              {savedUsd > 0 && (
                <span style={{ color: "var(--status-approved)" }}>
                  {" "}· {t("savedByCache", { eur: eur(savedUsd * 0.92) })}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
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
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" }}
        >
          <KpiCard
            icon={DollarSign}
            label={t("spent")}
            primary={eur(totalCoûtEur)}
            secondary={`$${totalCoûtUsd.toFixed(2)} USD`}
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
            secondary={t("cacheHitsFree", { n: totals.cache_hits || 0 })}
            loading={loading}
          />
          <KpiCard
            icon={TrendingUp}
            label={t("tokens")}
            primary={formatTokens(totals.tokens || 0)}
            secondary={
              totals.calls > 0
                ? t("perCall", { n: formatTokens(Math.round(totals.tokens / totals.calls)) })
                : "—"
            }
            loading={loading}
          />
        </div>

        {/* Par flux + by tier side by side */}
        <div
          className="grid gap-4 mb-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" }}
        >
          <BreakdownCard
            icon={Wallet}
            title={t("byWorkflow")}
            rows={byFlux}
            totalCoût={totalCoûtUsd}
            labelFor={workflowLabel}
            empty={t("noWindowSpend")}
          />
          <BreakdownCard
            icon={DollarSign}
            title={t("byTier")}
            rows={byNiveau}
            totalCoût={totalCoûtUsd}
            labelFor={(id) => ({
              label:
                id === "fast"
                  ? t("tierFast")
                  : id === "standard"
                  ? t("tierStandard")
                  : id === "premium"
                  ? t("tierPremium")
                  : id === "media"
                  ? t("tierMedia")
                  : id || t("unknown"),
              icon: Coins,
            })}
            empty={t("noTieredSpend")}
          />
        </div>

        {/* Per-model rollup */}
        <div className={card} style={{ padding: 18 }}>
          <h2
            className="text-sm font-semibold mb-3 inline-flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <TrendingUp size={14} /> {t("topModels")}
          </h2>
          {byModèle.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {t("noModels")}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full min-w-[420px] text-sm" style={{ color: "var(--text-secondary)" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)" }} className="text-left text-xs uppercase tracking-wider">
                    <th className="pb-2 font-semibold">{t("tableModel")}</th>
                    <th className="pb-2 font-semibold text-right">{t("tableCalls")}</th>
                    <th className="pb-2 font-semibold text-right">{t("tableTokens")}</th>
                    <th className="pb-2 font-semibold text-right">{t("tableCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {byModèle.slice(0, 12).map((r) => (
                    <tr key={r.key} style={{ borderTop: "1px solid var(--border-default)" }}>
                      <td className="py-2 font-medium break-all" style={{ color: "var(--text-primary)" }}>
                        {r.key}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">{r.calls}</td>
                      <td className="py-2 text-right whitespace-nowrap">{formatTokens(r.tokens)}</td>
                      <td className="py-2 text-right font-semibold whitespace-nowrap">
                        ${r.cost_usd.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, primary, secondary, loading }) {
  return (
    <div className={card} style={{ padding: 18 }}>
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

function BreakdownCard({ icon: Icon, title, rows, totalCoût, labelFor, empty }) {
  const t = useTranslations("credits");
  return (
    <div className={card} style={{ padding: 18 }}>
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
            const pct = totalCoût > 0 ? (row.cost_usd / totalCoût) * 100 : 0;
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
                  <RowIcon size={14} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                  <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                    {meta.label}
                  </span>
                  <span
                    className="text-sm font-semibold whitespace-nowrap"
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
                  {t("tokensWithCount", { n: formatTokens(row.tokens) })} · {pct.toFixed(1)}%
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
