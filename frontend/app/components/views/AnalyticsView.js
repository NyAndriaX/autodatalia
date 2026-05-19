"use client";

import { useSelector } from "react-redux";
import {
  TrendingUp,
  Send,
  Heart,
  DollarSign,
  Lock,
  Coins,
} from "lucide-react";

/* Skeleton — wires to plan tasks AN-T01 (KPIs) and AN-T02 (token/cost
   analytics from Airtable Token_Logs). Numbers are mocked. */
const KPIS = [
  { label: "Posts published (30d)", value: "128", delta: "+12%", icon: Send },
  { label: "Avg. engagement", value: "4.7%", delta: "+0.6pt", icon: Heart },
  { label: "Reach", value: "82.4k", delta: "+9%", icon: TrendingUp },
  { label: "LLM cost (30d)", value: "$37.10", delta: "-4%", icon: DollarSign },
];

const USAGE = [
  { day: "Mon", value: 62 },
  { day: "Tue", value: 48 },
  { day: "Wed", value: 75 },
  { day: "Thu", value: 90 },
  { day: "Fri", value: 53 },
  { day: "Sat", value: 30 },
  { day: "Sun", value: 41 },
];

const TOKEN_LOGS = [
  { model: "gemini-2.0-flash-lite", calls: 412, tokens: "1.9M", cost: "$6.20" },
  { model: "gpt-4o", calls: 88, tokens: "642k", cost: "$21.40" },
  { model: "claude-3.5", calls: 51, tokens: "388k", cost: "$8.10" },
  { model: "stable-diffusion", calls: 36, tokens: "—", cost: "$1.40" },
];

export default function AnalyticsView() {
  const max = Math.max(...USAGE.map((u) => u.value));
  const aiUsage = useSelector((s) => s.ui.aiUsage);

  return (
    <div className="h-full overflow-y-auto" style={{ padding: 20 }}>
      {/* Real, live session spend (everything else here is still mock) */}
      <div
        className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 rounded-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)" }}
      >
        <Coins size={16} style={{ color: "var(--status-pending)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {aiUsage.totalTokens.toLocaleString()} tokens
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          across {aiUsage.calls} real AI call{aiUsage.calls !== 1 ? "s" : ""} this session
          (cache hits cost 0) — live
        </span>
      </div>
      {/* KPI cards */}
      <div
        className="grid gap-3 mb-5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        {KPIS.map((k) => {
          const Icon = k.icon;
          const negative = k.delta.startsWith("-");
          return (
            <div
              key={k.label}
              className="card"
              style={{ padding: 18 }}
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
        {/* Usage bar chart (pure CSS — no chart lib) */}
        <div className="card" style={{ padding: 18 }}>
          <p className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
            LLM calls — last 7 days
          </p>
          <div className="flex items-end gap-3" style={{ height: 160 }}>
            {USAGE.map((u) => (
              <div key={u.day} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${(u.value / max) * 130}px`,
                    background: "var(--accent-gradient)",
                  }}
                  title={`${u.value} calls`}
                />
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {u.day}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Token/cost table */}
        <div className="card" style={{ padding: 18 }}>
          <p className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
            Token &amp; cost by model
          </p>
          <table className="w-full text-sm" style={{ color: "var(--text-secondary)" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)" }} className="text-left text-xs uppercase tracking-wider">
                <th className="pb-2 font-semibold">Model</th>
                <th className="pb-2 font-semibold">Calls</th>
                <th className="pb-2 font-semibold">Tokens</th>
                <th className="pb-2 font-semibold text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {TOKEN_LOGS.map((r) => (
                <tr key={r.model} style={{ borderTop: "1px solid var(--border-default)" }}>
                  <td className="py-2 font-medium" style={{ color: "var(--text-primary)" }}>{r.model}</td>
                  <td className="py-2">{r.calls}</td>
                  <td className="py-2">{r.tokens}</td>
                  <td className="py-2 text-right">{r.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <Lock size={12} />
        Skeleton view — KPIs/logs are mocked until Airtable Token_Logs (AN-T02) is wired.
      </div>
    </div>
  );
}
