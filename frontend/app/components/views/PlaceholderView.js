"use client";

import {
  CalendarDays,
  Image as ImageIcon,
  BarChart3,
  Settings,
  Construction,
} from "lucide-react";

const PLACEHOLDER_VIEWS = {
  calendar: {
    icon: CalendarDays,
    title: "Calendar & Scheduling",
    subtitle: "Interactive calendar with drag & drop — Coming in Day 2",
    features: [
      "Month, Week & Timeline views",
      "Full Drag & Drop reordering",
      "Platform color-coded cards",
      "Status indicators (Draft → Approved → Published)",
    ],
  },
  library: {
    icon: ImageIcon,
    title: "Media & Templates",
    subtitle: "Asset management and brand kits — Coming soon",
    features: [
      "Grid media library with drag-drop upload",
      "AI-generated assets tab (ComfyUI/LTX)",
      "Reusable brand kit templates",
      "Persona/tone of voice presets",
    ],
  },
  analytics: {
    icon: BarChart3,
    title: "Analytics & API Costs",
    subtitle: "KPIs and token usage dashboards — Coming soon",
    features: [
      "Engagement KPIs per network",
      "LLM token usage & cost tracking",
      "ComfyUI generation cost breakdown",
      "Per-user & per-workflow analytics",
    ],
  },
  settings: {
    icon: Settings,
    title: "Settings & Integrations",
    subtitle: "OAuth connections and API configuration — Coming soon",
    features: [
      "Meta, TikTok, LinkedIn OAuth",
      "AI API key management",
      "Telegram Bot pairing",
      "Brand Kit configuration",
    ],
  },
};

export default function PlaceholderView({ viewId }) {
  const config = PLACEHOLDER_VIEWS[viewId];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className="flex items-center justify-center h-full animate-fade-in">
      <div
        className="text-center max-w-md mx-auto px-6"
        style={{ color: "var(--text-secondary)" }}
      >
        <div
          className="w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center"
          style={{
            background: "rgba(99, 102, 241, 0.1)",
            border: "1px solid rgba(99, 102, 241, 0.2)",
          }}
        >
          <Icon size={36} style={{ color: "var(--accent-primary)" }} />
        </div>

        <h2
          className="text-2xl font-bold mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          {config.title}
        </h2>
        <p
          className="text-sm mb-8"
          style={{ color: "var(--text-muted)" }}
        >
          {config.subtitle}
        </p>

        <div className="text-left">
          <div
            className="rounded-xl p-5"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-default)",
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Construction
                size={16}
                style={{ color: "var(--status-pending)" }}
              />
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-tertiary)" }}
              >
                Planned Features
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {config.features.map((f, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                    style={{ background: "var(--accent-primary)" }}
                  />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
