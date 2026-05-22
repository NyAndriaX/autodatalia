"use client";

import { useSelector, useDispatch } from "react-redux";
import {
  TrendingUp,
  Send,
  Heart,
  DollarSign,
  Coins,
  RotateCcw,
} from "lucide-react";
import { useMemo } from "react";
import { resetTokenUsage } from "../../store/uiSlice";

/* KPIs that are still mocked while their data sources are unwired:
   AN-T01 (publish/engagement/reach) hydrates from Airtable, AN-T02
   (LLM cost) from the Token_Logs table. The session-side cards below
   are derived from the live `aiUsage` ring buffer. */
const MOCK_KPIS = [
  { label: "Posts published (30d)", value: "128", delta: "+12%", icon: Send },
  { label: "Avg. engagement", value: "4.7%", delta: "+0.6pt", icon: Heart },
  { label: "Reach", value: "82.4k", delta: "+9%", icon: TrendingUp },
  { label: "LLM cost (30d)", value: "$37.10", delta: "-4%", icon: DollarSign },
];

/* Derive 7 hourly buckets from the most recent calls so the chart shows
   a real activity shape even when the dataset is tiny (a single call
   becomes one visible bar). */
function buildHourlyBuckets(calls, bucketCount = 7) {
  if (!calls.length) {
    return Array.from({ length: bucketCount }, (_, i) => ({
      label: `${i + 1}h`,
      calls: 0,
      tokens: 0,
    }));
  }
  const now = Date.now();
  const bucketMs = 60 * 60 * 1000; // 1h
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    label: i === 0 ? "now" : `-${i}h`,
    calls: 0,
    tokens: 0,
  }));
  for (const c of calls) {
    const offsetHours = Math.floor((now - c.at) / bucketMs);
    if (offsetHours >= 0 && offsetHours < bucketCount) {
      buckets[offsetHours].calls += 1;
      buckets[offsetHours].tokens += c.totalTokens || 0;
    }
  }
  // Render oldest → newest left-to-right (matches the read direction).
  return buckets.reverse();
}

/* Per-model rollup: real session calls grouped by model, sorted by
   spend so the loudest contributor appears first. */
function rollupByModel(calls) {
  const byModel = new Map();
  for (const c of calls) {
    const key = c.model || "llm-router";
    const row = byModel.get(key) || {
      model: key,
      calls: 0,
      tokens: 0,
    };
    row.calls += 1;
    row.tokens += c.totalTokens || 0;
    byModel.set(key, row);
  }
  return [...byModel.values()].sort((a, b) => b.tokens - a.tokens);
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function AnalyticsView() {
  const dispatch = useDispatch();
  const aiUsage = useSelector((s) => s.ui.aiUsage);
  // useMemo with a stable identity so the downstream hooks below don't
  // re-run on every render (the inline `|| []` would create a new array
  // each time — react-hooks/exhaustive-deps catches that).
  const calls = useMemo(() => aiUsage.recentCalls || [], [aiUsage.recentCalls]);

  const buckets = useMemo(() => buildHourlyBuckets(calls), [calls]);
  const maxBar = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.calls)),
    [buckets]
  );
  const byModel = useMemo(() => rollupByModel(calls), [calls]);

  const hasRealData = calls.length > 0 || (aiUsage.cacheHits || 0) > 0;
  const sessionTokens = aiUsage.totalTokens || 0;
  const sessionCalls = aiUsage.calls || 0;
  const cacheHits = aiUsage.cacheHits || 0;
  const totalRequests = sessionCalls + cacheHits;
  const cacheHitRate = totalRequests
    ? Math.round((cacheHits / totalRequests) * 100)
    : 0;
  const avgPerCall = sessionCalls
    ? Math.round(sessionTokens / sessionCalls)
    : 0;

  return (
    <div className="h-full overflow-y-auto" style={{ padding: 20 }}>
      {/* Live session strip — real data first, primary surface */}
      <div
        className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 rounded-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)" }}
      >
        <Coins size={16} style={{ color: "var(--status-pending)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {sessionTokens.toLocaleString()} tokens
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          across {sessionCalls} real AI call{sessionCalls !== 1 ? "s" : ""} this session
          (cache hits cost 0) — live
        </span>
        <div className="flex-1" />
        {hasRealData && (
          <button
            onClick={() => dispatch(resetTokenUsage())}
            className="btn-ghost inline-flex items-center gap-1.5 text-xs"
            style={{ color: "var(--text-muted)" }}
            title="Reset the session counters and per-call log"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        )}
      </div>

      {/* Live KPI row — derived from the per-call log; sits above the
          still-mocked engagement KPIs so users see the real numbers first. */}
      <div
        className="grid gap-3 mb-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        <LiveKpi
          icon={Coins}
          label="Tokens (session)"
          value={formatTokens(sessionTokens)}
          sub={`${sessionCalls} call${sessionCalls !== 1 ? "s" : ""}`}
        />
        <LiveKpi
          icon={TrendingUp}
          label="Avg tokens / call"
          value={avgPerCall ? formatTokens(avgPerCall) : "—"}
          sub={hasRealData ? "session avg" : "no calls yet"}
        />
        <LiveKpi
          icon={DollarSign}
          label="Models used"
          value={`${byModel.length}`}
          sub={byModel[0]?.model ?? "—"}
        />
        <LiveKpi
          icon={Send}
          label="Cache hit rate"
          value={totalRequests ? `${cacheHitRate}%` : "—"}
          sub={`${cacheHits} hit${cacheHits !== 1 ? "s" : ""} · ${sessionCalls} paid`}
        />
      </div>

      {/* Still-mocked engagement / publishing KPIs — clearly labeled below
          so we don't pass mock numbers off as live. */}
      <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
        Sample data — no engagement records yet
      </p>
      <div
        className="grid gap-3 mb-5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        {MOCK_KPIS.map((k) => {
          const Icon = k.icon;
          const negative = k.delta.startsWith("-");
          return (
            <div
              key={k.label}
              className="card"
              style={{ padding: 18, opacity: 0.92 }}
            >
              <div className="flex items-center justify-between mb-3">
                <Icon size={18} style={{ color: "var(--accent-primary)" }} />
                <span
                  className="text-xs font-semibold"
                  style={{ color: negative ? "var(--status-error)" : "var(--status-approved)" }}
                >
                  {k.delta}
                </span>
              </div>
              <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                {k.value}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {k.label}
              </p>
            </div>
          );
        })}
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
      >
        {/* Hourly bar chart — driven by the session ring buffer */}
        <div className="card" style={{ padding: 18 }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              LLM calls — last 7 hours
            </p>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              live
            </span>
          </div>
          {hasRealData ? (
            <div className="flex items-end gap-3" style={{ height: 160 }}>
              {buckets.map((b, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {b.calls > 0 ? b.calls : ""}
                  </span>
                  <div
                    className="w-full rounded-t-md transition-all"
                    style={{
                      height: `${(b.calls / maxBar) * 130}px`,
                      minHeight: b.calls > 0 ? 4 : 0,
                      background: "var(--accent-gradient)",
                    }}
                    title={`${b.calls} call${b.calls !== 1 ? "s" : ""} · ${formatTokens(b.tokens)} tokens`}
                  />
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {b.label}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="Generate a post to start collecting session data." />
          )}
        </div>

        {/* Per-model table — real session usage */}
        <div className="card" style={{ padding: 18 }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Token usage by model
            </p>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              live · session
            </span>
          </div>
          {hasRealData ? (
            <table className="w-full text-sm" style={{ color: "var(--text-secondary)" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)" }} className="text-left text-xs uppercase tracking-wider">
                  <th className="pb-2 font-semibold">Model</th>
                  <th className="pb-2 font-semibold">Calls</th>
                  <th className="pb-2 font-semibold text-right">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((r) => (
                  <tr key={r.model} style={{ borderTop: "1px solid var(--border-default)" }}>
                    <td className="py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                      {r.model}
                    </td>
                    <td className="py-2">{r.calls}</td>
                    <td className="py-2 text-right">{formatTokens(r.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState message="No AI calls yet this session." />
          )}
        </div>
      </div>

    </div>
  );
}

function LiveKpi({ icon: Icon, label, value, sub }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="flex items-center justify-between mb-3">
        <Icon size={18} style={{ color: "var(--accent-primary)" }} />
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          live
        </span>
      </div>
      <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      {sub && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div
      className="flex items-center justify-center text-center px-4"
      style={{ height: 160, color: "var(--text-muted)", fontSize: 12 }}
    >
      {message}
    </div>
  );
}

