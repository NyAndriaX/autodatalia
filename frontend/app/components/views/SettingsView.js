"use client";

import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { PLATFORMS } from "../../lib/platforms";
import { loadSettings, saveSettings } from "../../lib/settingsStorage";
import { addNotification } from "../../store/uiSlice";
import { Send, KeyRound, Palette, Plug, Check } from "lucide-react";

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

function Field({ label, name, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block mb-3">
      <span
        className="text-xs font-semibold uppercase tracking-wider block mb-1.5"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </span>
      <input
        className="input-field"
        type={type}
        name={name}
        value={value ?? ""}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </label>
  );
}

export default function SettingsView() {
  const dispatch = useDispatch();
  const [s, setS] = useState(null);

  // Hydrate from localStorage on mount. The intentional cascading render is
  // how we avoid a SSR/client value mismatch on controlled inputs — server
  // renders nothing, client fills in the saved values.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setS(loadSettings());
  }, []);

  if (s === null) {
    // First client tick before hydration — render nothing to avoid SSR mismatch.
    return null;
  }

  const update = (key, value) =>
    setS((prev) => ({ ...prev, [key]: value }));

  const toggleConnection = (platformId) => {
    setS((prev) => {
      const current = prev.connections?.[platformId];
      const next = current === "connected" ? "disconnected" : "connected";
      return {
        ...prev,
        connections: { ...prev.connections, [platformId]: next },
      };
    });
  };

  const handleSave = () => {
    saveSettings(s);
    dispatch(addNotification({ message: "Settings saved on this device.", type: "success" }));
  };

  const handlePairTelegram = () => {
    if (!s.telegramBotToken || !s.telegramChatId) {
      dispatch(
        addNotification({ message: "Enter both the bot token and your chat ID.", type: "error" })
      );
      return;
    }
    saveSettings(s);
    dispatch(
      addNotification({
        message: "Telegram pairing saved locally. Backend wiring coming next.",
        type: "info",
      })
    );
  };

  return (
    <div className="h-full overflow-y-auto" style={{ padding: 20 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Section
          icon={Plug}
          title="Connected Platforms"
          desc="OAuth for Facebook, Instagram, TikTok & LinkedIn (PL-T01..T04). Toggle marks them as connected on this device until the OAuth flow lands."
        >
          <div className="flex flex-col gap-2">
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const connected = s.connections?.[p.id] === "connected";
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                  style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}
                >
                  <span
                    className="inline-flex items-center gap-2 text-sm"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <Icon size={16} style={{ color: p.color }} />
                    {p.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleConnection(p.id)}
                    className={connected ? "btn-secondary text-xs inline-flex items-center gap-1" : "btn-secondary text-xs"}
                  >
                    {connected ? (
                      <>
                        <Check size={12} /> Connected
                      </>
                    ) : (
                      "Connect"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          icon={KeyRound}
          title="AI API Keys"
          desc="LLM Router providers. Stored only on this device — server-side secret manager comes later (CG-T01)."
        >
          <Field
            label="OpenRouter / OpenAI key"
            name="openrouterKey"
            value={s.openrouterKey}
            onChange={update}
            placeholder="sk-or-v1-…"
            type="password"
          />
          <Field
            label="Anthropic key"
            name="anthropicKey"
            value={s.anthropicKey}
            onChange={update}
            placeholder="sk-ant-…"
            type="password"
          />
          <Field
            label="Default model"
            name="defaultModel"
            value={s.defaultModel}
            onChange={update}
            placeholder="google/gemini-2.0-flash-lite-001"
          />
        </Section>

        <Section
          icon={Send}
          title="Telegram Validation Bot"
          desc="Pair the BotFather bot used for the approve/reject loop (TG-T01)."
        >
          <Field
            label="Bot token"
            name="telegramBotToken"
            value={s.telegramBotToken}
            onChange={update}
            placeholder="123456:ABC-DEF…"
            type="password"
          />
          <Field
            label="Your Telegram chat ID"
            name="telegramChatId"
            value={s.telegramChatId}
            onChange={update}
            placeholder="e.g. 84217734"
          />
          <button
            type="button"
            onClick={handlePairTelegram}
            className="btn-primary text-sm mt-1"
          >
            Pair bot
          </button>
        </Section>

        <Section
          icon={Palette}
          title="Brand Kit"
          desc="Logo, palette, fonts & tone of voice injected into AI prompts (TP-T03)."
        >
          <Field
            label="Brand name"
            name="brandName"
            value={s.brandName}
            onChange={update}
            placeholder="DATALIA"
          />
          <Field
            label="Primary color"
            name="brandPrimaryColor"
            value={s.brandPrimaryColor}
            onChange={update}
            placeholder="#3b82f6"
          />
          <Field
            label="Tone of voice"
            name="brandToneOfVoice"
            value={s.brandToneOfVoice}
            onChange={update}
            placeholder="Confident, friendly, concise"
          />
        </Section>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={handleSave} className="btn-primary">
            Save all
          </button>
        </div>
      </div>
    </div>
  );
}
