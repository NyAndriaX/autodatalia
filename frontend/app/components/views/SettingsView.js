"use client";

import { PLATFORMS } from "../../lib/platforms";
import { Send, KeyRound, Palette, Plug, Lock } from "lucide-react";

/* Skeleton — wires to plan tasks CG-T01 (API/OAuth/bot config), PL-T01..T04
   (social OAuth), TP-T03 (brand kit). Inputs are non-functional. */

function Section({ icon: Icon, title, desc, children }) {
  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={17} style={{ color: "var(--accent-primary)" }} />
        <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h3>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        {desc}
      </p>
      {children}
    </div>
  );
}

function Field({ label, placeholder, type = "text" }) {
  return (
    <label className="block mb-3">
      <span
        className="text-xs font-semibold uppercase tracking-wider block mb-1.5"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </span>
      <input className="input-field" type={type} placeholder={placeholder} disabled />
    </label>
  );
}

export default function SettingsView() {
  return (
    <div className="h-full overflow-y-auto" style={{ padding: 20 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Section
          icon={Plug}
          title="Connected Platforms"
          desc="OAuth for Facebook, Instagram, TikTok & LinkedIn (PL-T01..T04)."
        >
          <div className="flex flex-col gap-2">
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                  style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}
                >
                  <span className="inline-flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                    <Icon size={16} style={{ color: p.color }} />
                    {p.label}
                  </span>
                  <button className="btn-secondary text-xs" disabled>
                    Connect
                  </button>
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          icon={KeyRound}
          title="AI API Keys"
          desc="LLM Router providers — stored server-side later (CG-T01)."
        >
          <Field label="OpenRouter / OpenAI key" placeholder="sk-or-v1-…" type="password" />
          <Field label="Anthropic key" placeholder="sk-ant-…" type="password" />
          <Field label="Default model" placeholder="google/gemini-2.0-flash-lite-001" />
        </Section>

        <Section
          icon={Send}
          title="Telegram Validation Bot"
          desc="Pair the BotFather bot used for the approve/reject loop (TG-T01)."
        >
          <Field label="Bot token" placeholder="123456:ABC-DEF…" type="password" />
          <Field label="Your Telegram chat ID" placeholder="e.g. 84217734" />
          <button className="btn-primary text-sm mt-1" disabled>
            Pair bot
          </button>
        </Section>

        <Section
          icon={Palette}
          title="Brand Kit"
          desc="Logo, palette, fonts & tone of voice injected into AI prompts (TP-T03)."
        >
          <Field label="Brand name" placeholder="DATALIA" />
          <Field label="Primary color" placeholder="#3b82f6" />
          <Field label="Tone of voice" placeholder="Confident, friendly, concise" />
        </Section>

        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Lock size={12} />
          Skeleton view — fields are disabled until the config backend (CG-T01) is wired.
        </div>
      </div>
    </div>
  );
}
