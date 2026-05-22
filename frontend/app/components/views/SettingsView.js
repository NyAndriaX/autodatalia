"use client";

import { useCallback, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { PLATFORMS } from "../../lib/platforms";
import { loadSettings, saveSettings } from "../../lib/settingsStorage";
import { addNotification } from "../../store/uiSlice";
import {
  fetchConnections,
  invalidateConnectionsCache,
  readCachedConnections,
  startConnect,
  disconnect as oauthDisconnect,
} from "../../lib/oauthService";
import {
  Send,
  KeyRound,
  Palette,
  Plug,
  Check,
  Loader2,
  Trash2,
  RefreshCw,
  Clock,
} from "lucide-react";
import { COMMON_TIMEZONES, getBrowserTimezone } from "../../lib/timezone";

// Each visible platform row maps to one backend OAuth provider. Facebook
// and Instagram share the Meta provider — connecting once gets both.
const PLATFORM_TO_PROVIDER = {
  facebook: "meta",
  instagram: "meta",
  tiktok: "tiktok",
  linkedin: "linkedin",
};

// Which target kinds (from /oauth/connections) belong under which platform
// row when we display them.
const TARGET_KIND_FOR_PLATFORM = {
  facebook: "facebook_page",
  instagram: "instagram_business",
};

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

// Two-line picker: a dropdown of common IANA zones + a free-text override
// for anything exotic. Empty value (Auto) tells the resolver to fall back
// to the browser's OS timezone — listed inline so the user sees what
// "Auto" actually resolves to today.
function TimezoneField({ value, onChange }) {
  const browser = getBrowserTimezone();
  // If the saved value isn't in the common list, surface it as the first
  // option so the dropdown can still display the user's actual pick.
  const options = value && !COMMON_TIMEZONES.includes(value)
    ? [value, ...COMMON_TIMEZONES]
    : COMMON_TIMEZONES;
  return (
    <div>
      <label className="block mb-3">
        <span
          className="text-xs font-semibold uppercase tracking-wider block mb-1.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          Active timezone
        </span>
        <select
          className="input-field"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Auto — use my browser ({browser})</option>
          {options.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span
          className="text-xs font-semibold uppercase tracking-wider block mb-1.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          Or type any IANA zone
        </span>
        <input
          className="input-field"
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Europe/Paris, America/Toronto"
          autoComplete="off"
        />
      </label>
      <p
        className="text-[11px] mt-2"
        style={{ color: "var(--text-muted)" }}
      >
        Leave blank to follow your device. Save below to apply.
      </p>
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
  const [connections, setConnections] = useState(null); // backend-driven OAuth state
  const [pendingProvider, setPendingProvider] = useState(null); // provider being connected
  const [refreshing, setRefreshing] = useState(false);

  // Hydrate from localStorage on mount. The intentional cascading render is
  // how we avoid a SSR/client value mismatch on controlled inputs — server
  // renders nothing, client fills in the saved values.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setS(loadSettings());
  }, []);

  // `force: true` bypasses the localStorage cache; the Refresh button
  // uses this so the user can always trigger an authoritative re-fetch.
  // Normal mounts pass force: false and fall back to the cache when it's
  // fresh, so bouncing between views doesn't re-hit Meta every time.
  const refreshConnections = useCallback(async ({ force = false } = {}) => {
    setRefreshing(true);
    try {
      const data = await fetchConnections({ force });
      setConnections(data?.providers || {});
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Mount: paint instantly from cache if we have one, then validate in the
  // background. This is the pattern the user asked for — Settings should
  // remember the signed-in accounts instead of refreshing on every visit.
  useEffect(() => {
    const cached = readCachedConnections();
    if (cached?.providers) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnections(cached.providers);
    }
    // Still run a (possibly cache-served) fetch so we refresh anything
    // older than the TTL without blocking the initial paint.
    refreshConnections();
  }, [refreshConnections]);

  if (s === null) {
    // First client tick before hydration — render nothing to avoid SSR mismatch.
    return null;
  }

  const update = (key, value) =>
    setS((prev) => ({ ...prev, [key]: value }));

  const handleConnect = async (platformId) => {
    const providerId = PLATFORM_TO_PROVIDER[platformId];
    if (!providerId) return;
    setPendingProvider(providerId);
    try {
      await startConnect(providerId);
      dispatch(
        addNotification({ message: `${platformId} connected.`, type: "success" })
      );
      // Connect just changed the truth on the backend; force a fresh
      // fetch so the new pages/IGs appear immediately (no stale cache).
      invalidateConnectionsCache();
      await refreshConnections({ force: true });
    } catch (err) {
      dispatch(
        addNotification({
          message: `Connect failed: ${err.message || "unknown error"}`,
          type: "error",
        })
      );
    } finally {
      setPendingProvider(null);
    }
  };

  const handleDisconnect = async (platformId) => {
    const providerId = PLATFORM_TO_PROVIDER[platformId];
    if (!providerId) return;
    if (!confirm(`Disconnect ${platformId}? Stored tokens will be removed.`)) return;
    try {
      await oauthDisconnect(providerId);
      dispatch(
        addNotification({ message: `${platformId} disconnected.`, type: "info" })
      );
      // disconnect() already invalidates the cache server-side; force a
      // re-fetch so the row updates to "Not connected" immediately.
      await refreshConnections({ force: true });
    } catch (err) {
      dispatch(
        addNotification({
          message: `Disconnect failed: ${err.message || "unknown"}`,
          type: "error",
        })
      );
    }
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
        message: "Telegram pairing saved.",
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
          desc="OAuth-connected accounts that can publish through Datalia."
        >
          <div
            className="flex items-center justify-between mb-2 text-[11px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            <span>
              {connections === null
                ? "Loading…"
                : `${
                    Object.values(connections).filter((c) => c.connected).length
                  } / ${Object.keys(connections).length} providers connected`}
            </span>
            <button
              type="button"
              onClick={() => refreshConnections({ force: true })}
              disabled={refreshing}
              className="btn-ghost text-[11px] inline-flex items-center gap-1"
              style={{ padding: "2px 6px" }}
              title="Refresh from backend"
              aria-label="Refresh connections"
            >
              <RefreshCw
                size={11}
                className={refreshing ? "animate-spin" : undefined}
              />
              Refresh
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const providerId = PLATFORM_TO_PROVIDER[p.id];
              const provider = connections?.[providerId];
              const connected = !!provider?.connected;
              const configured = !!provider?.configured;
              const isPending = pendingProvider === providerId;

              // Targets to show under this row. For FB and IG we filter by
              // kind so each row shows only the relevant accounts even
              // though both share the meta provider.
              const wantedKind = TARGET_KIND_FOR_PLATFORM[p.id];
              const targets = wantedKind
                ? (provider?.targets || []).filter((t) => t.kind === wantedKind)
                : provider?.targets || [];

              return (
                <div
                  key={p.id}
                  className="rounded-lg"
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span
                      className="inline-flex items-center gap-2 text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Icon size={16} style={{ color: p.color }} />
                      {p.label}
                      {!configured && connections !== null && (
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{
                            background: "rgba(239,68,68,0.08)",
                            color: "var(--status-error)",
                          }}
                          title={
                            provider?.missing_env?.length
                              ? `Missing env: ${provider.missing_env.join(", ")}`
                              : "Provider not configured on the backend"
                          }
                        >
                          not configured
                        </span>
                      )}
                    </span>

                    {!configured ? (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled
                        title="Add credentials to the backend .env first"
                      >
                        Connect
                      </button>
                    ) : connected ? (
                      <div className="flex items-center gap-1">
                        <span
                          className="text-xs inline-flex items-center gap-1"
                          style={{ color: "var(--status-approved)" }}
                        >
                          <Check size={12} /> Connected
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDisconnect(p.id)}
                          className="btn-ghost text-xs inline-flex items-center gap-1"
                          style={{ padding: "4px 8px" }}
                          title="Forget the stored token"
                          aria-label="Disconnect"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConnect(p.id)}
                        disabled={isPending}
                        className="btn-secondary text-xs inline-flex items-center gap-1"
                      >
                        {isPending ? (
                          <>
                            <Loader2 size={11} className="animate-spin" />
                            Connecting…
                          </>
                        ) : (
                          "Connect"
                        )}
                      </button>
                    )}
                  </div>

                  {connected && targets.length > 0 && (
                    <div
                      className="px-3 py-2 flex flex-col gap-1 border-t"
                      style={{ borderColor: "var(--border-default)" }}
                    >
                      <p
                        className="text-[10px] uppercase tracking-wider"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        Publishable accounts
                      </p>
                      {targets.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center gap-2 text-xs"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: p.color }}
                            aria-hidden="true"
                          />
                          <span className="truncate">{t.label}</span>
                          {t.category && (
                            <span
                              className="text-[10px]"
                              style={{ color: "var(--text-muted)" }}
                            >
                              · {t.category}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {connected && targets.length === 0 && (
                    <div
                      className="px-3 py-2 text-xs border-t"
                      style={{
                        borderColor: "var(--border-default)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {p.id === "facebook"
                        ? "No Pages found for this account. Make sure you admin at least one FB Page, then reconnect."
                        : p.id === "instagram"
                        ? "No IG Business account found. Link an IG Business account to a FB Page you admin, then reconnect."
                        : "Connected, but no publishable accounts surfaced."}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          icon={Clock}
          title="Scheduling timezone"
          desc="What '09:00' means when you schedule a post. Set this to the brand's posting timezone so a team member traveling, on a non-local clock, or behind a VPN doesn't accidentally publish at 03:00 in your audience's market."
        >
          <TimezoneField
            value={s.scheduleTimezone}
            onChange={(v) => update("scheduleTimezone", v)}
          />
        </Section>

        <Section
          icon={KeyRound}
          title="AI API Keys"
          desc="Provider keys. Stored only on this device."
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
          desc="Pair your Telegram bot for the approve/reject flow."
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
          desc="Logo, palette, fonts & tone of voice used in AI prompts."
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
