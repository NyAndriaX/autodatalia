"use client";

import {
  btnPrimary,
  btnSecondary,
  btnGhost,
  iconTile,
  inputField,
  pageContainer,
  pageHero,
  pageHeroSubtitle,
  pageHeroTitle,
  pageSurface,
  panelCard,
  sectionEyebrow,
  sectionTitle,
  settingsNavItem,
  settingsNavItemActive,
} from "../../lib/uiClasses";
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslations } from "next-intl";
import { Alert, Card, ColorPicker, Form, Input as AntInput, Select as AntSelect, Spin } from "antd";
import { PLATFORMS } from "../../lib/platforms";
import { loadSettings, saveSettings } from "../../lib/settingsStorage";
import { addNotification } from "../../store/uiSlice";
import {
  fetchConnections,
  invalidateConnectionsCache,
  readCachedConnections,
  startConnect,
  connectZernio,
  disconnectZernio,
  disconnectZernioAccount,
  disconnect as oauthDisconnect,
} from "../../lib/oauthService";
import { fetchTelegramStatus, sendTelegramTest } from "../../lib/validationService";
import { fetchBackendKeys, patchBackendKeys } from "../../lib/backendKeysService";
import { deleteWorkspace, leaveWorkspace } from "../../lib/workspaceService";
import { authService } from "../../lib/authService";
import { authLogout } from "../../store/authSlice";
import { restoreSessionThunk } from "../../store/authThunks";
import { resetEditor } from "../../store/editorSlice";
import {
  Send, KeyRound, Palette, Plug, Check, BadgeCheck, Loader2,
  Trash2, RefreshCw, Clock, Users, Settings, HelpCircle, Zap, AlertTriangle, LogOut, ShieldCheck,
} from "lucide-react";
import { COMMON_TIMEZONES, getBrowserTimezone } from "../../lib/timezone";
import MembersView from "./MembersView";
import RolesView from "./RolesView";

const PLATFORM_TO_PROVIDER    = { facebook:"meta", instagram:"meta", tiktok:"tiktok", linkedin:"linkedin" };
const TARGET_KIND_FOR_PLATFORM = { facebook:"facebook_page", instagram:"instagram_business" };

// Networks offered for Zernio connect. Zernio supports 15, but Datalia only
// publishes to our four, so we only offer those (id = slug sent to
// /oauth/zernio/{id}/start). Mirrors the direct PLATFORMS set.
const ZERNIO_PLATFORMS = PLATFORMS;

function formatCompact(n) {
  if (n < 1000)          return String(n);
  if (n < 1_000_000)     return `${(n/1000).toFixed(n<10_000?1:0)} K`;
  if (n < 1_000_000_000) return `${(n/1_000_000).toFixed(n<10_000_000?1:0)} M`;
  return `${(n/1_000_000_000).toFixed(1)} G`;
}

/* ─── Champ générique ────────────────────────────────────────────────────*/
function Champ({
  label,
  name,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
  secret = false,
}: any) {
  return (
    <Form.Item label={label} style={{ marginBottom: 16 }} extra={hint}>
      <AntInput
        type={secret ? "text" : type}
        name={name}
        value={value ?? ""}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck="false"
        data-1p-ignore={secret ? "true" : undefined}
        data-lpignore={secret ? "true" : undefined}
        data-bwignore={secret ? "true" : undefined}
        data-form-type={secret ? "other" : undefined}
        style={secret ? ({ WebkitTextSecurity: "disc" } as any) : undefined}
      />
    </Form.Item>
  );
}

/* ─── Section container ──────────────────────────────────────────────────*/
function Section({ icon: Icon, title, description, badge, children }: any) {
  return (
    <div>
      <div className="settings-section-header">
        <div>
          <h2><Icon size={18} /> {title}</h2>
          {description && <p>{description}</p>}
        </div>
        {badge}
      </div>
      <Card className="pro-card" styles={{ body: { padding: 20 } }}>
        {children}
      </Card>
    </div>
  );
}

/* ─── Danger-zone action row (destructive, irreversible) ─────────────────*/
function DangerRow({ title, desc, icon: Icon, onAction }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3.5"
      style={{ border: "1px solid rgba(239,68,68,.3)", background: "rgba(239,68,68,.04)" }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: "rgba(239,68,68,.1)", color: "var(--status-error)" }}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</p>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{desc}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-white"
        style={{ background: "var(--status-error)", border: "none", cursor: "pointer" }}
      >
        {title}
      </button>
    </div>
  );
}

/* ─── Sélecteur de fuseau horaire ────────────────────────────────────────*/
function FuseauHoraire({ value, onChange }) {
  const t        = useTranslations("settings");
  const browser  = getBrowserTimezone();
  const options  = value && !COMMON_TIMEZONES.includes(value) ? [value, ...COMMON_TIMEZONES] : COMMON_TIMEZONES;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Form.Item label={t("timezoneSelectLabel")} style={{ marginBottom: 0 }}>
        <AntSelect
          value={value || ""}
          onChange={(next) => onChange(next)}
          options={[
            { value: "", label: t("timezoneAutoBrowser", { browser }) },
            ...options.map((tz) => ({ value: tz, label: tz })),
          ]}
        />
      </Form.Item>
      <Form.Item label={t("timezoneIanaLabel")} style={{ marginBottom: 0 }}>
        <AntInput value={value||""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Europe/Paris, America/Toronto" autoComplete="off" />
      </Form.Item>
      <p className="col-span-full text-[11px]" style={{ color:"var(--text-muted)" }}>
        {t("timezoneHint")}
      </p>
    </div>
  );
}

/* ─── Carte de plateforme ────────────────────────────────────────────────*/
function CartePlateforme({ p, connections, pendingProvider, onConnect, onDisconnect }) {
  const t           = useTranslations("settings");
  const Icon        = p.icon;
  const providerId  = PLATFORM_TO_PROVIDER[p.id];
  const provider    = connections?.[providerId];
  const providerLoaded = provider !== undefined;
  const connected   = !!provider?.connected;
  const configured  = !!provider?.configured;
  const isPending   = pendingProvider === providerId;
  const wantedKind  = TARGET_KIND_FOR_PLATFORM[p.id];
  const targets     = wantedKind
    ? (provider?.targets || []).filter((t) => t.kind === wantedKind)
    : provider?.targets || [];

  return (
    <div className="overflow-hidden rounded-2xl transition-all duration-150"
      style={{
        border: `1.5px solid ${connected ? p.color + "40" : "var(--border-default)"}`,
        background: connected ? p.color + "06" : "var(--bg-tertiary)",
      }}>
      {/* ligne principale */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: p.color, boxShadow:`0 4px 12px ${p.color}50` }}>
          {Icon ? <Icon size={20} aria-hidden="true" /> : p.label[0]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight" style={{ color:"var(--text-primary)" }}>{p.label}</p>
          {providerLoaded && !configured && connections !== null && (
            <Alert className="mt-2" type="error" showIcon title={t("platformNotConfigured")} />
          )}
          {providerLoaded && connected && targets.length > 0 && (
            <p className="mt-0.5 text-[11px]" style={{ color:"var(--text-muted)" }}>
              {t("platformAccountsCount", { count: targets.length })} · {targets.map(tgt => tgt.label).join(", ")}
            </p>
          )}
          {providerLoaded && !connected && configured && (
            <p className="mt-0.5 text-[11px]" style={{ color:"var(--text-muted)" }}>{t("platformNotConnected")}</p>
          )}
        </div>
        {providerLoaded && !configured ? (
          <span className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
            style={{ background:"rgba(239,68,68,.1)", color:"var(--status-error)" }}>
            {t("platformConfigRequired")}
          </span>
        ) : connected ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold"
              style={{ color:"var(--status-approved)" }}>
              <Check size={13} /> {t("platformConnected")}
            </span>
            <button type="button" onClick={() => onDisconnect(p.id)}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:scale-110"
              style={{ background:"rgba(239,68,68,.1)", border:"none", cursor:"pointer", color:"var(--status-error)" }}
              title={t("platformDisconnect")}>
              <Trash2 size={12} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => onConnect(p.id)} disabled={isPending}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all hover:-translate-y-px disabled:opacity-60"
            style={{ background: p.color, border:"none", cursor: isPending ? "default" : "pointer",
              boxShadow:`0 4px 10px ${p.color}40` }}>
            {isPending ? <><Loader2 size={11} className="animate-spin"/> {t("platformConnecting")}</> : t("platformConnect")}
          </button>
        )}
      </div>

      {/* comptes publiables */}
      {connected && targets.length > 0 && (
        <div className="px-4 py-3" style={{ borderTop:`1px solid ${p.color}20` }}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
            {t("platformPublishingAccounts")}
          </p>
          <div className="flex flex-col gap-1.5">
            {targets.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs" style={{ color:"var(--text-secondary)" }}>
                {t.profile_picture_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.profile_picture_url} alt="" className="h-5 w-5 rounded-full shrink-0 object-cover"
                    referrerPolicy="no-referrer" />
                ) : (
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
                )}
                <span className="truncate font-medium">{t.label}</span>
                {t.is_verified && <BadgeCheck size={12} className="shrink-0" style={{ color: p.color }} />}
                {t.category && <span className="text-[10px]" style={{ color:"var(--text-muted)" }}>· {t.category}</span>}
                {typeof t.audience === "number" && t.audience > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] tabular-nums"
                    style={{ color:"var(--text-muted)" }}>
                    <Users size={9} /> {formatCompact(t.audience)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {connected && targets.length === 0 && (
        <div className="px-4 py-3" style={{ borderTop:`1px solid ${p.color}20` }}>
          <Alert
            type="warning"
            showIcon
            title={
              p.id === "facebook"
                ? t("platformNoFacebookPages")
                : p.id === "instagram"
                ? t("platformNoInstagramAccounts")
                : t("platformNoTargets")
            }
          />
        </div>
      )}
    </div>
  );
}

/* ─── Carte Zernio (provider unifié) ─────────────────────────────────────
   Distinct from the direct provider cards: one key + one connect flow for 15
   networks. Inline key field (saved via patchBackendKeys → ZERNIO_API_KEY),
   per-network connect buttons, and a "?" help popover. */
function CarteZernio({
  connections,
  pendingZernio,
  onConnect,
  onDisconnectPlatform,
  onDisconnectAccount,
  onSaveKey,
}) {
  const t          = useTranslations("settings");
  const z          = connections?.zernio;
  const configured = !!z?.configured;
  const targets    = z?.targets || [];
  const publishReadyCount = targets.filter(
    (target) => target.can_post !== false && !target.needs_reconnect,
  ).length;
  const [keyEdit, setKeyEdit]   = useState("");
  const [savingKey, setSaving]  = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const save = async () => {
    if (!keyEdit.trim()) return;
    setSaving(true);
    try { await onSaveKey(keyEdit.trim()); setKeyEdit(""); }
    finally { setSaving(false); }
  };

  return (
    <div className={`overflow-hidden ${panelCard}`}
      style={{
        border: configured ? "1px solid rgba(29,63,190,.22)" : "1px solid var(--border-default)",
        background: configured ? "linear-gradient(180deg, rgba(29,63,190,.03), var(--bg-card))" : "var(--bg-card)",
        boxShadow: "var(--shadow-sm)",
      }}>
      <div className="flex flex-wrap items-center gap-3 px-6 py-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white"
          style={{ background:"var(--accent-primary)", boxShadow:"var(--shadow-sm)" }}>
          <Zap size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold leading-tight" style={{ color:"var(--text-primary)" }}>
            {t("zernioHeading")}
            <button type="button" onClick={() => setShowHelp((v) => !v)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full"
              style={{ background:"rgba(29,63,190,.1)", color:"var(--accent-primary)", border:"none", cursor:"pointer" }}
              title={t("zernioHelpTitle")} aria-label={t("zernioHelpTitle")}>
              <HelpCircle size={13} />
            </button>
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color:"var(--text-muted)" }}>{t("zernioTagline")}</p>
        </div>
        {configured && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold" style={{ color:"var(--status-approved)" }}>
            <Check size={13} /> {t("zernioConfigured")}
          </span>
        )}
      </div>

      {showHelp && (
        <Alert
          className="mx-4 mb-5 sm:mx-6"
          type="info"
          showIcon
          title={t("zernioHelpTitle")}
          description={(
            <div>
              <p>{t("zernioHelpBody")}</p>
              <a href="https://zernio.com" target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-block text-[10px] font-bold text-sky-500 hover:text-sky-600">
                {t("zernioGetKey")}
              </a>
            </div>
          )}
        />
      )}

      <div className="mx-4 border-t px-0 pb-5 pt-5 sm:mx-6" style={{ borderColor:"rgba(29,63,190,.14)" }}>
        <p className="form-label mb-1 mt-3">
          {t("zernioKeyLabel")}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputField} type="text" value={keyEdit}
            onChange={(e) => setKeyEdit(e.target.value)}
            placeholder={configured ? t("zernioKeyPlaceholderSet") : t("zernioKeyPlaceholderUnset")}
            autoComplete="off" spellCheck="false"
            data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other"
            style={{ WebkitTextSecurity:"disc" } as any} />
          <button type="button" onClick={save} disabled={savingKey || !keyEdit.trim()}
            className={`${btnPrimary} inline-flex items-center justify-center gap-1.5 text-xs sm:shrink-0`}>
            {savingKey ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            {t("zernioKeySave")}
          </button>
        </div>
        {!configured && (
          <Alert className="mt-4" type="warning" showIcon title={t("zernioNotConfigured")} />
        )}
        {configured && targets.length === 0 && !z?.error && (
          <Alert className="mt-4" type="info" showIcon title={t("zernioReadyToConnect")} />
        )}
        {configured && z?.error && (
          <Alert className="mt-4" type="error" showIcon title={z.error} />
        )}
      </div>

      {configured && (
        <div className="mx-4 border-t px-0 py-5 sm:mx-6" style={{ borderColor:"rgba(29,63,190,.12)" }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
              {t("zernioConnectedAccounts")}
            </p>
            {targets.length > 0 && (
              <span className="text-[10px] font-semibold" style={{ color:"var(--text-muted)" }}>
                {t("zernioConnectedAccountsSummary", { total: targets.length, ready: publishReadyCount })}
              </span>
            )}
          </div>
          {targets.length === 0 ? (
            <p className="text-xs" style={{ color:"var(--text-muted)" }}>{t("zernioNoAccounts")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {targets.map((tg) => {
                const platform = PLATFORMS.find((p) => p.id === tg.platform);
                const PlatformIcon = platform?.icon;
                const issues = Array.isArray(tg.issues) ? tg.issues.filter(Boolean) : [];
                const stateTone = tg.needs_reconnect
                  ? { bg:"rgba(239,68,68,.08)", border:"rgba(239,68,68,.18)" }
                  : tg.can_post === false
                  ? { bg:"rgba(245,158,11,.08)", border:"rgba(245,158,11,.18)" }
                  : { bg:"rgba(29,63,190,.04)", border:"rgba(29,63,190,.14)" };
                return (
                <div key={tg.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-2 text-xs" style={{ color:"var(--text-secondary)", background: stateTone.bg, borderColor: stateTone.border }}>
                  {tg.profile_picture_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tg.profile_picture_url} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                  ) : PlatformIcon ? (
                    <PlatformIcon size={16} className="shrink-0" style={{ color:platform.color }} aria-hidden="true" />
                  ) : (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background:"var(--accent-primary)" }} />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{tg.label}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{
                      color: tg.needs_reconnect ? "var(--status-error)" : tg.can_post === false ? "#d97706" : "var(--text-muted)",
                      background: tg.needs_reconnect ? "rgba(239,68,68,.12)" : tg.can_post === false ? "rgba(245,158,11,.14)" : "rgba(29,63,190,.08)",
                    }}>
                    {tg.needs_reconnect ? t("zernioNeedsReconnect") : tg.can_post === false ? t("zernioPostingBlocked") : (platform?.label || tg.platform)}
                  </span>
                  {typeof tg.audience === "number" && tg.audience > 0 && (
                    <span className="text-[10px]" style={{ color:"var(--text-muted)" }}>
                      {formatCompact(tg.audience)}
                    </span>
                  )}
                  {tg.profile_name && (
                    <span className="text-[10px]" style={{ color:"var(--text-muted)" }}>
                      {t("zernioProfileName", { name: tg.profile_name })}
                    </span>
                  )}
                  {tg.can_fetch_analytics === true && (
                    <span className="text-[10px]" style={{ color:"var(--status-approved)" }}>
                      {t("zernioAnalyticsReady")}
                    </span>
                  )}
                  {tg.can_fetch_analytics === false && (
                    <span className="text-[10px]" style={{ color:"var(--text-muted)" }}>
                      {t("zernioAnalyticsUnavailable")}
                    </span>
                  )}
                  {tg.is_workspace_profile === false && (
                    <span className="text-[10px]" style={{ color:"var(--text-muted)" }}>
                      {t("zernioLinkedOnSameKey")}
                    </span>
                  )}
                  <button type="button" onClick={() => onDisconnectAccount(tg)} disabled={!!pendingZernio}
                    className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{ background:"rgba(239,68,68,.08)", border:"none", color:"var(--status-error)", cursor:"pointer" }}
                    title={t("zernioDisconnectAccount", { account: tg.label })}
                    aria-label={t("zernioDisconnectAccount", { account: tg.label })}>
                    <Trash2 size={12} />
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {configured && (
        <div className="mx-4 border-t px-0 py-5 sm:mx-6" style={{ borderColor:"rgba(29,63,190,.12)" }}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
            {t("zernioAvailableNetworks")}
          </p>
          <div className="flex flex-wrap gap-2">
            {ZERNIO_PLATFORMS.map((p) => {
              const pending = pendingZernio === p.id;
              const connected = targets.some((target) => target.platform === p.id);
              const Icon = p.icon;
              return (
                <button key={p.id} type="button"
                  onClick={() => connected ? onDisconnectPlatform(p.id) : onConnect(p.id)}
                  disabled={!!pendingZernio}
                  title={connected ? t("zernioDisconnect", { platform:p.label }) : t("zernioConnect", { platform:p.label })}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:-translate-y-px disabled:opacity-60"
                  style={{
                    background:connected ? `${p.color}14` : "var(--bg-card)",
                    border:`1px solid ${connected ? `${p.color}70` : "var(--border-default)"}`,
                    color:connected ? p.color : "var(--text-secondary)",
                    cursor:pendingZernio ? "default" : "pointer",
                  }}>
                  {pending ? <Loader2 size={12} className="animate-spin" /> : connected ? <Check size={12} /> : <Icon size={13} />}
                  {pending ? t("zernioConnecting") : p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Backend API keys editor ────────────────────────────────────────────
   Lives in backend/content/runtime_settings*.json. JWT users get a
   personal override file; shared/open mode uses the global file.
   at runtime — no container restart needed. Secrets come back masked
   (abcd••••WXYZ); typing a new value replaces, empty clears the override
   so the env default kicks back in. PATCH only sends fields the user
   touched so an empty-but-untouched secret doesn't clobber a set key. */
function BackendKeysSection() {
  const t        = useTranslations("settings");
  const dispatch = useDispatch<any>();
  const [keys, setKeys] = useState({});
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState("llm");

  const GROUPS = [
    {
      id: "llm",
      title: t("backendKeysGroupLLM"),
      ids: ["AI_API_KEY", "AI_MODEL", "AI_MODEL_FAST", "AI_MODEL_PREMIUM"],
    },
    {
      id: "image",
      title: t("backendKeysGroupImage"),
      ids: ["AI_IMAGE_API_KEY", "AI_IMAGE_API_BASE_URL", "AI_IMAGE_MODEL"],
    },
    {
      id: "video",
      title: t("backendKeysGroupVideo"),
      ids: [
        "FAL_API_KEY",
        "FAL_VIDEO_MODEL",
        "LTX_API_KEY",
        "LTX_VIDEO_MODEL",
        "REPLICATE_API_TOKEN",
        "REPLICATE_VIDEO_MODEL",
        "REPLICATE_VIDEO_VERSION",
      ],
    },
    {
      id: "telegram",
      title: t("backendKeysGroupTelegram"),
      ids: ["TELEGRAM_DEFAULT_CHAT_ID"],
    },
  ];

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBackendKeys();
      setKeys(data?.keys || {});
      setEdits({});
    } catch {
      /* leave keys empty; UI shows empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      reload();
    });
  }, [reload]);

  async function handleSave() {
    if (Object.keys(edits).length === 0) return;
    setSaving(true);
    try {
      const data = await patchBackendKeys(edits);
      setKeys(data?.keys || {});
      setEdits({});
      dispatch(addNotification({
        message: t("backendKeysSaved"),
        type: "success",
      }));
    } catch (err) {
      dispatch(addNotification({
        message: t("backendKeysSaveFailed", { error: err.message || String(err) }),
        type: "error",
      }));
    } finally {
      setSaving(false);
    }
  }

  const dirty = Object.keys(edits).length > 0;
  const currentGroup = GROUPS.find((group) => group.id === activeGroup) || GROUPS[0];

  const KEY_LINKS = {
    AI_API_KEY: "https://openrouter.ai/keys",
    AI_IMAGE_API_KEY: "https://aistudio.google.com/app/apikey",
    FAL_API_KEY: "https://fal.ai/dashboard/keys",
    REPLICATE_API_TOKEN: "https://replicate.com/account/api-tokens",
  };

  if (loading) {
    return <Spin size="small" tip={t("backendKeysLoading")} />;
  }

  return (
    <div>
      <Alert className="mb-4" type="info" showIcon title={t("backendKeysBanner")} />
      <div className="mb-4 flex gap-2 overflow-x-auto rounded-lg border p-1"
        style={{ borderColor:"var(--border-default)", background:"var(--bg-secondary)" }}>
        {GROUPS.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => setActiveGroup(group.id)}
            className="shrink-0 rounded-md px-3 py-2 text-xs font-semibold transition-all"
            style={{
              background: activeGroup === group.id ? "var(--bg-card)" : "transparent",
              color: activeGroup === group.id ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: activeGroup === group.id ? "var(--shadow-sm)" : "none",
              cursor: "pointer",
            }}
          >
            {group.title}
          </button>
        ))}
      </div>
      <div className="mb-4 rounded-lg border p-4"
        style={{ borderColor:"var(--border-default)", background:"var(--bg-secondary)" }}>
          <p className="form-label mb-3">
            {currentGroup.title}
          </p>
          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
          {currentGroup.ids.map((id) => {
            const entry = keys[id] || { set: false, masked: "", value: "", secret: false };
            const editValue = id in edits ? edits[id] : "";
            const isSecret = entry.secret;
            return (
              <label key={id} className="block mb-3">
                <span className="form-label mb-1 flex items-center gap-2">
                  {id}
                  {KEY_LINKS[id] && (
                    <a
                      href={KEY_LINKS[id]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-0.5 text-[9px] font-bold text-sky-500 hover:text-sky-600 transition-colors uppercase tracking-normal"
                    >
                      Get Key ↗
                    </a>
                  )}
                  {entry.set && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-normal"
                      style={{ color: "var(--status-approved)" }}>
                      <Check size={10} />
                      {isSecret ? entry.masked : t("backendKeysSet")}
                    </span>
                  )}
                </span>
                <input
                  className={inputField}
                  type="text"
                  value={isSecret ? editValue : (id in edits ? editValue : entry.value)}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [id]: e.target.value }))}
                  placeholder={
                    isSecret
                      ? (entry.set ? t("backendKeysReplacePlaceholder") : t("backendKeysNotSet"))
                      : t("backendKeysEnvDefault")
                  }
                  autoComplete="off"
                  spellCheck="false"
                  data-1p-ignore={isSecret ? "true" : undefined}
                  data-lpignore={isSecret ? "true" : undefined}
                  data-bwignore={isSecret ? "true" : undefined}
                  data-form-type={isSecret ? "other" : undefined}
                  style={isSecret ? ({ WebkitTextSecurity: "disc" } as any) : undefined}
                />
              </label>
            );
          })}
          </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`${btnPrimary} inline-flex items-center gap-2`}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {t("backendKeysSave")}
          {dirty && <span className="text-[10px] opacity-80">({Object.keys(edits).length})</span>}
        </button>
        {dirty && (
          <button type="button" onClick={() => setEdits({})} className={`${btnGhost} text-xs`}>
            {t("backendKeysDiscard")}
          </button>
        )}
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className={`${btnGhost} text-xs inline-flex items-center gap-1 ml-auto`}
        >
          <RefreshCw size={12} /> {t("backendKeysReload")}
        </button>
      </div>
    </div>
  );
}

/* ─── Composant principal ────────────────────────────────────────────────*/
export default function SettingsView() {
  const t        = useTranslations("settings");
  const dispatch = useDispatch<any>();
  const user                                  = useSelector((st: any) => st.auth.user);
  const activeWorkspaceId                     = user?.workspace?.id;
  const [s,               setS]               = useState(null);
  const [connections,     setConnections]     = useState(() => readCachedConnections()?.providers || null);
  const [pendingProvider, setPendingProvider] = useState(null);
  const [pendingZernio,   setPendingZernio]   = useState(null);
  const [refreshing,      setRefreshing]      = useState(false);
  const [telegramStatus,  setTelegramStatus]  = useState(null);
  const [telegramBackend, setTelegramBackend] = useState({ chatId:"" });
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [savingTelegram,  setSavingTelegram]  = useState(false);
  const [onglet,          setOnglet]          = useState("overview");

  useEffect(() => {
    queueMicrotask(() => {
      setS(loadSettings());
    });
  }, []);

  const actualiserConnexions = useCallback(async ({ force = false } = {}) => {
    setRefreshing(true);
    try {
      const data = await fetchConnections({ force });
      const nextProviders = data?.providers || {};
      if (data?.error && Object.keys(nextProviders).length === 0) return;
      setConnections(nextProviders);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      actualiserConnexions();
    });
  }, [actualiserConnexions]);

  useEffect(() => {
    if (activeWorkspaceId == null) return;
    invalidateConnectionsCache();
    queueMicrotask(() => {
      actualiserConnexions({ force: true });
    });
  }, [activeWorkspaceId, actualiserConnexions]);

  const reloadTelegramConfig = useCallback(async () => {
    try {
      const [status, keysData] = await Promise.all([
        fetchTelegramStatus(),
        fetchBackendKeys(),
      ]);
      const savedChatId = keysData?.keys?.TELEGRAM_DEFAULT_CHAT_ID?.value || "";
      setTelegramStatus(status);
      setTelegramBackend({ chatId: savedChatId });
      setS((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          telegramChatId: savedChatId || prev.telegramChatId || "",
        };
      });
    } catch {
      setTelegramStatus({
        configured:false, default_chat_configured:false, webhook_secret_configured:false,
      });
      setTelegramBackend({ chatId:"" });
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      reloadTelegramConfig();
    });
  }, [reloadTelegramConfig]);

  if (s === null) return null;

  const update = (key, value) => setS((p) => ({ ...p, [key]: value }));

  const handleConnect = async (platformId) => {
    const providerId = PLATFORM_TO_PROVIDER[platformId];
    const label = PLATFORMS.find((p) => p.id === platformId)?.label || platformId;
    if (!providerId) return;
    setPendingProvider(providerId);
    try {
      await startConnect(providerId);
      dispatch(addNotification({ message: t("platformConnectedNotification", { platform: label }), type:"success" }));
      invalidateConnectionsCache();
      await actualiserConnexions({ force: true });
    } catch (err) {
      dispatch(addNotification({ message: t("platformConnectFailed", { error: err.message || t("unknownError") }), type:"error" }));
    } finally {
      setPendingProvider(null);
    }
  };

  const handleDisconnect = async (platformId) => {
    const providerId = PLATFORM_TO_PROVIDER[platformId];
    const label = PLATFORMS.find((p) => p.id === platformId)?.label || platformId;
    if (!providerId) return;
    if (!confirm(t("platformDisconnectConfirm", { platform: label }))) return;
    try {
      await oauthDisconnect(providerId);
      dispatch(addNotification({ message: t("platformDisconnectedNotification", { platform: label }), type:"info" }));
      await actualiserConnexions({ force: true });
    } catch (err) {
      dispatch(addNotification({ message: t("platformDisconnectFailed", { error: err.message || t("unknownError") }), type:"error" }));
    }
  };

  const handleZernioConnect = async (platform) => {
    const alreadyConnected = (connections?.zernio?.targets || []).some(
      (target) => target.platform === platform,
    );
    if (alreadyConnected) return;
    setPendingZernio(platform);
    try {
      await connectZernio(platform);
      await actualiserConnexions({ force: true });
      dispatch(addNotification({ message: t("zernioConnectDone"), type:"success" }));
    } catch (err) {
      dispatch(addNotification({ message: t("zernioConnectFailed", { error: err.message || t("unknownError") }), type:"error" }));
    } finally {
      setPendingZernio(null);
    }
  };

  const handleZernioDisconnectPlatform = async (platform) => {
    const label = PLATFORMS.find((p) => p.id === platform)?.label || platform;
    if (!confirm(t("zernioDisconnectConfirm", { platform:label }))) return;
    setPendingZernio(platform);
    try {
      await disconnectZernio(platform);
      await actualiserConnexions({ force: true });
      dispatch(addNotification({ message:t("zernioDisconnected", { platform:label }), type:"info" }));
    } catch (err) {
      dispatch(addNotification({ message:t("zernioDisconnectFailed", { error:err.message || t("unknownError") }), type:"error" }));
    } finally {
      setPendingZernio(null);
    }
  };

  const handleZernioDisconnectAccount = async (target) => {
    const label = target?.label || target?.id || t("zernioConnectedAccounts");
    if (!confirm(t("zernioDisconnectAccountConfirm", { account: label }))) return;
    setPendingZernio(target?.id || "account");
    try {
      await disconnectZernioAccount(target.id);
      await actualiserConnexions({ force: true });
      dispatch(addNotification({ message:t("zernioAccountDisconnected", { account: label }), type:"info" }));
    } catch (err) {
      dispatch(addNotification({ message:t("zernioDisconnectFailed", { error:err.message || t("unknownError") }), type:"error" }));
    } finally {
      setPendingZernio(null);
    }
  };

  const handleSaveZernioKey = async (value) => {
    try {
      await patchBackendKeys({ ZERNIO_API_KEY: value });
      setConnections((prev) => ({
        ...(prev || {}),
        zernio: {
          ...(prev?.zernio || {}),
          id: "zernio",
          label: prev?.zernio?.label || "Zernio",
          configured: true,
          connected: prev?.zernio?.connected || false,
          missing_env: [],
          targets: prev?.zernio?.targets || [],
          error: null,
          is_aggregator: true,
        },
      }));
      dispatch(addNotification({ message: t("zernioKeySaved"), type:"success" }));
      invalidateConnectionsCache();
      await actualiserConnexions({ force: true });
    } catch (err) {
      dispatch(addNotification({ message: t("backendKeysSaveFailed", { error: err.message || String(err) }), type:"error" }));
      throw err;
    }
  };

  const handleSave = () => {
    saveSettings(s);
    dispatch(addNotification({ message: t("saved"), type:"success" }));
  };

  // ── Danger zone (destructive, irreversible) ──────────────────────────────
  const handleLeaveWorkspace = async () => {
    if (!confirm(t("leaveConfirm"))) return;
    try {
      await leaveWorkspace();
      dispatch(addNotification({ message: t("leftWorkspace"), type: "info" }));
      dispatch(restoreSessionThunk());
    } catch (err) {
      dispatch(addNotification({ message: err.message || t("unknownError"), type: "error" }));
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!confirm(t("deleteWorkspaceConfirm"))) return;
    try {
      await deleteWorkspace();
      dispatch(addNotification({ message: t("workspaceDeleted"), type: "info" }));
      dispatch(restoreSessionThunk());
    } catch (err) {
      dispatch(addNotification({ message: err.message || t("unknownError"), type: "error" }));
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm(t("deleteAccountConfirm"))) return;
    try {
      await authService.deleteAccount();
      dispatch(addNotification({ message: t("accountDeleted"), type: "info" }));
      dispatch(resetEditor());
      dispatch(authLogout());
    } catch (err) {
      dispatch(addNotification({ message: err.message || t("unknownError"), type: "error" }));
    }
  };

  const handlePairTelegram = async () => {
    if (!s.telegramChatId) {
      dispatch(addNotification({ message: t("telegramChatIdRequired"), type:"error" }));
      return;
    }
    setSavingTelegram(true);
    try {
      const updates = {
        TELEGRAM_DEFAULT_CHAT_ID: s.telegramChatId.trim(),
      };
      const data = await patchBackendKeys(updates);
      const nextChatId = data?.keys?.TELEGRAM_DEFAULT_CHAT_ID?.value || s.telegramChatId.trim();
      setTelegramBackend({ chatId: nextChatId });
      const nextSettings = {
        ...s,
        telegramChatId: nextChatId,
      };
      setS(nextSettings);
      saveSettings(nextSettings);
      await reloadTelegramConfig();
      dispatch(addNotification({ message: t("telegramChatIdSaved"), type:"info" }));
    } catch (err) {
      dispatch(addNotification({
        message: t("backendKeysSaveFailed", { error: err.message || String(err) }),
        type:"error",
      }));
    } finally {
      setSavingTelegram(false);
    }
  };

  const handleTestTelegram = async () => {
    if (!telegramStatus?.configured) {
      dispatch(addNotification({ message: t("telegramBotTokenMissing"), type:"error" }));
      return;
    }
    setTestingTelegram(true);
    try {
      const result = await sendTelegramTest(s.telegramChatId || null);
      dispatch(addNotification({ message: t("telegramTestSent", { chatId: result.chat_id }), type:"success" }));
    } catch (err) {
      dispatch(addNotification({ message: t("telegramTestFailed", { error: err.message }), type:"error" }));
    } finally {
      setTestingTelegram(false);
    }
  };

  const platformIsConnected = (platform) => {
    const provider = connections?.[PLATFORM_TO_PROVIDER[platform]];
    const kind = TARGET_KIND_FOR_PLATFORM[platform];
    const directTargets = kind
      ? (provider?.targets || []).filter((target) => target.kind === kind)
      : provider?.targets || [];
    const zernioTargets = (connections?.zernio?.targets || []).filter(
      (target) => target.platform === platform,
    );
    return directTargets.length > 0 || zernioTargets.length > 0;
  };
  const connectéCount = PLATFORMS.filter((platform) => platformIsConnected(platform.id)).length;
  const totalProviders = PLATFORMS.length;

  const ONGLETS = [
    { id:"overview",    label:t("overviewTitle"), icon:Settings,      desc:t("overviewDesc"),       group:"config" },
    { id:"plateformes", label:t("tabPlatforms"),  icon:Plug,          desc:t("sectionPlatformsDesc"), badge: connectéCount > 0 ? `${connectéCount}/${totalProviders}` : null, group:"config" },
    { id:"ia",          label:t("tabAiKeys"),     icon:KeyRound,      desc:t("sectionKeysDesc"),    group:"config" },
    { id:"telegram",    label:t("tabTelegram"),   icon:Send,          desc:t("sectionTelegramDesc"),group:"config" },
    { id:"marque",      label:t("tabBrandKit"),   icon:Palette,       desc:t("sectionBrandDesc"),   group:"config" },
    { id:"fuseau",      label:t("tabTimezone"),   icon:Clock,         desc:t("sectionTimezoneDesc"),group:"config" },
    { id:"members",     label:t("tabMembers"),    icon:Users,         desc:t("sectionMembersDesc"), group:"team" },
    { id:"roles",       label:t("tabRoles"),      icon:ShieldCheck,   desc:t("sectionRolesDesc"),   group:"team" },
    { id:"danger",      label:t("tabDanger"),     icon:AlertTriangle, desc:t("sectionDangerDesc"),  group:"danger" },
  ];

  const currentTab = ONGLETS.find((tab) => tab.id === onglet) || ONGLETS[0];
  const brandReady = Boolean(s.brandName || s.brandToneOfVoice || s.brandPrimaryColor);
  const timezoneLabel = s.scheduleTimezone || getBrowserTimezone() || "Auto";
  const overviewCards = [
    {
      id:"integrations",
      icon:Plug,
      label:t("overviewIntegrations"),
      value:`${connectéCount}/${totalProviders}`,
      desc:t("overviewIntegrationsDesc"),
      target:"plateformes",
      tone:"var(--accent-primary)",
    },
    {
      id:"keys",
      icon:KeyRound,
      label:t("overviewKeys"),
      value:t("backendKeysSet"),
      desc:t("overviewKeysDesc"),
      target:"ia",
      tone:"var(--status-awaiting)",
    },
    {
      id:"validation",
      icon:Send,
      label:t("overviewValidation"),
      value:telegramStatus?.configured ? t("telegramStatusOk") : t("telegramStatusMissing"),
      desc:t("overviewValidationDesc"),
      target:"telegram",
      tone:telegramStatus?.configured ? "var(--status-approved)" : "var(--status-pending)",
    },
    {
      id:"brand",
      icon:Palette,
      label:t("overviewBrand"),
      value:brandReady ? t("telegramStatusOk") : t("telegramStatusMissing"),
      desc:t("overviewBrandDesc"),
      target:"marque",
      tone:brandReady ? "var(--status-approved)" : "var(--text-muted)",
    },
    {
      id:"scheduling",
      icon:Clock,
      label:t("overviewScheduling"),
      value:timezoneLabel,
      desc:t("overviewSchedulingDesc"),
      target:"fuseau",
      tone:"var(--status-published)",
    },
    {
      id:"members",
      icon:Users,
      label:t("tabMembers"),
      value:t("overviewMembersShortcut"),
      desc:t("sectionMembersDesc"),
      target:"members",
      tone:"var(--accent-deep)",
    },
    {
      id:"roles",
      icon:ShieldCheck,
      label:t("tabRoles"),
      value:t("overviewRolesShortcut"),
      desc:t("sectionRolesDesc"),
      target:"roles",
      tone:"var(--accent-secondary)",
    },
  ];

  return (
    <div className={pageSurface}>
      <div className="settings-page">

      {/* ═ EN-TÊTE ══════════════════════════════════════════════════════ */}
      <div className="settings-hero">
        <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Settings size={22} className="shrink-0 opacity-90" />
          <div>
          <h1 className={pageHeroTitle}>{t("title")}</h1>
          <p>{currentTab.label}</p>
          </div>
        </div>
        <button type="button" onClick={handleSave}
          className={`${btnPrimary} inline-flex items-center gap-2`}>
          <Settings size={14} /> {t("saveAll")}
        </button>
        </div>
      </div>

      <div className="settings-layout">
        <aside className="settings-nav">
          <nav className="settings-nav-scroll" aria-label={t("title")}>
            {/* Config section */}
            <p className="settings-nav-group">
              {t("navGroupConfig")}
            </p>
            {ONGLETS.filter((o) => o.group === "config").map(({ id, label, icon: Icon, badge }) => {
              const active = onglet === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setOnglet(id)}
                  className={`settings-nav-item ${active ? "settings-nav-item--active" : ""}`}
                >
                  <span className="settings-nav-icon">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {label}
                  </span>
                  {badge && (
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background:"rgba(34,197,94,.12)", color:"var(--status-approved)" }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Team section */}
            <div className="settings-nav-divider" />
            <p className="settings-nav-group">
              {t("navGroupTeam")}
            </p>
            {ONGLETS.filter((o) => o.group === "team").map(({ id, label, icon: Icon }) => {
              const active = onglet === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setOnglet(id)}
                  className={`settings-nav-item ${active ? "settings-nav-item--active" : ""}`}
                >
                  <span className="settings-nav-icon">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {label}
                  </span>
                </button>
              );
            })}

            {/* Danger section */}
            <div className="settings-nav-divider" />
            {ONGLETS.filter((o) => o.group === "danger").map(({ id, label, icon: Icon }) => {
              const active = onglet === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setOnglet(id)}
                  className={`settings-nav-item ${active ? "settings-nav-item--active" : ""}`}
                >
                  <span className="settings-nav-icon">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {label}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="settings-content">
          <div className="settings-content-inner">

      {/* ═ OVERVIEW ══════════════════════════════════════════════════════ */}
      {onglet === "overview" && (
        <Section icon={Settings} title={t("overviewTitle")} description={t("overviewDesc")}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {overviewCards.map(({ id, icon: Icon, label, value, desc, target, tone }) => (
              <button
                key={id}
                type="button"
                onClick={() => setOnglet(target)}
                className="content-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-(--shadow-md)"
                style={{ cursor:"pointer" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f8fafc]" style={{ color:tone }}>
                    <Icon size={17} />
                  </span>
                  <span className="max-w-40 truncate text-sm font-extrabold" style={{ color:"var(--text-primary)" }}>
                    {value}
                  </span>
                </div>
                <p className="mt-4 text-sm font-bold" style={{ color:"var(--text-primary)" }}>{label}</p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color:"var(--text-muted)" }}>{desc}</p>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ═ PLATEFORMES ══════════════════════════════════════════════════ */}
      {onglet === "plateformes" && (
        <Section
          icon={Plug}
          title={t("platformsTitle")}
          description={t("sectionPlatformsDesc")}
          badge={
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color:"var(--text-muted)" }}>
                {connections === null
                  ? t("platformsLoading")
                  : t("platformsConnectedCount", { connected: connectéCount, total: totalProviders })}
              </span>
              <button type="button" onClick={() => actualiserConnexions({ force: true })}
                disabled={refreshing}
                className={`${btnGhost} inline-flex items-center gap-1 text-[11px]`}
                style={{ padding:"3px 8px" }}>
                <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
                {t("platformsRefresh")}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.75fr)]">
            <CarteZernio
              connections={connections}
              pendingZernio={pendingZernio}
              onConnect={handleZernioConnect}
              onDisconnectPlatform={handleZernioDisconnectPlatform}
              onDisconnectAccount={handleZernioDisconnectAccount}
              onSaveKey={handleSaveZernioKey}
            />

            <div className="content-card p-4">
              <div className="mb-4">
                <p className={sectionEyebrow}>{t("directConnectionsHeading")}</p>
                <p className="mt-1 text-xs" style={{ color:"var(--text-muted)" }}>
                  {t("directConnectionsTagline")}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                {PLATFORMS.map((p) => (
                  <CartePlateforme
                    key={p.id} p={p}
                    connections={connections}
                    pendingProvider={pendingProvider}
                    onConnect={handleConnect}
                    onDisconnect={handleDisconnect}
                  />
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ═ FUSEAU HORAIRE ═══════════════════════════════════════════════ */}
      {onglet === "fuseau" && (
        <Section icon={Clock} title={t("timezoneTitle")} description={t("sectionTimezoneDesc")}>
          <p className="mb-5 text-xs leading-relaxed" style={{ color:"var(--text-muted)" }}>
            {t("timezoneHelp")}
          </p>
          <FuseauHoraire value={s.scheduleTimezone} onChange={(v) => update("scheduleTimezone", v)} />
        </Section>
      )}

      {/* ═ CLÉS IA ══════════════════════════════════════════════════════ */}
      {onglet === "ia" && (
        <Section icon={KeyRound} title={t("backendKeysTitle")} description={t("sectionKeysDesc")}>
          <BackendKeysSection />
        </Section>
      )}

      {/* ═ TELEGRAM ═════════════════════════════════════════════════════ */}
      {onglet === "telegram" && (
        <Section icon={Send} title={t("telegramSectionTitle")} description={t("sectionTelegramDesc")}>
          {/* The bot token / webhook secret are server-side deployment config —
              not surfaced here. Users only manage their own chat id + test. */}
          <Alert
            className="mb-5"
            type="info"
            showIcon
            title={t("telegramHowToTitle")}
            description={(
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                {[t("telegramStep1"), t("telegramStep2"), t("telegramStep3")].map((step, index) => (
                  <div key={step} className="rounded-lg border border-[#dbeafe] bg-white p-3">
                    <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background:"var(--accent-primary)" }}>
                      {index + 1}
                    </span>
                    <p>{step}</p>
                  </div>
                ))}
              </div>
            )}
          />
          <Alert
            className="mb-5"
            type={telegramStatus?.configured ? "success" : "warning"}
            showIcon
            title={telegramStatus?.configured ? t("telegramStatusOk") : t("telegramStatusMissing")}
            description={
              telegramStatus?.configured
                ? t("telegramTest")
                : t("telegramBotTokenMissing")
            }
          />
          <Champ label={t("telegramChatIdLabel")} name="telegramChatId" value={s.telegramChatId}
            onChange={update} placeholder={t("telegramChatIdPlaceholder")} />

          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" onClick={handlePairTelegram}
              disabled={savingTelegram}
              className={`${btnPrimary} text-sm inline-flex items-center gap-2`}>
              {savingTelegram ? <><Loader2 size={13} className="animate-spin" /> {t("backendKeysSave")}</> : t("telegramPairBot")}
            </button>
            <button type="button" onClick={handleTestTelegram}
              disabled={testingTelegram || !telegramStatus?.configured}
              className={`${btnSecondary} text-sm inline-flex items-center gap-2`}>
              {testingTelegram
                ? <><Loader2 size={13} className="animate-spin"/> {t("telegramSending")}</>
                : t("telegramTest")}
            </button>
          </div>
        </Section>
      )}

      {/* ═ KIT MARQUE ═══════════════════════════════════════════════════ */}
      {onglet === "marque" && (
        <div>
          <div className="settings-section-header">
            <div>
              <h2><Palette size={18} /> {t("brandKitTitle")}</h2>
              <p>{t("sectionBrandDesc")}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card
              className="pro-card"
              title={t("brandKitTitle")}
              styles={{ body: { padding: 20 } }}
            >
              <p className="mb-5 text-sm leading-relaxed text-[#64748b]">
                {t("brandKitHelp")}
              </p>
              <Form layout="vertical" requiredMark={false}>
                <Form.Item label={t("brandName")}>
                  <AntInput
                    size="large"
                    value={s.brandName || ""}
                    onChange={(e) => update("brandName", e.target.value)}
                    placeholder={t("brandNamePlaceholder")}
                  />
                </Form.Item>

                <Form.Item label={t("brandPrimaryColor")}>
                  <div className="flex flex-wrap items-center gap-3">
                    <ColorPicker
                      value={s.brandPrimaryColor || "#3b82f6"}
                      onChange={(_, hex) => update("brandPrimaryColor", hex)}
                      showText
                    />
                    <AntInput
                      size="large"
                      value={s.brandPrimaryColor || ""}
                      onChange={(e) => update("brandPrimaryColor", e.target.value)}
                      placeholder="#3b82f6"
                      style={{ maxWidth: 180 }}
                    />
                  </div>
                </Form.Item>

                <Form.Item label={t("brandTone")} extra={t("brandToneHint")}>
                  <AntInput.TextArea
                    rows={4}
                    value={s.brandToneOfVoice || ""}
                    onChange={(e) => update("brandToneOfVoice", e.target.value)}
                    placeholder={t("brandTonePlaceholder")}
                  />
                </Form.Item>
              </Form>
            </Card>

            <Card
              className="pro-card"
              title="Preview"
              styles={{ body: { padding: 20 } }}
            >
              <div
                className="rounded-xl p-5 text-white"
                style={{
                  background: `linear-gradient(135deg, ${s.brandPrimaryColor || "#3b82f6"}, #1e3a8a)`,
                }}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70">
                  {t("brandName")}
                </p>
                <p className="mt-2 text-2xl font-bold">
                  {s.brandName || t("brandNamePlaceholder")}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-white/80">
                  {s.brandToneOfVoice || t("brandTonePlaceholder")}
                </p>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-[#64748b]">
                {t("brandKitHelp")}
              </p>
            </Card>
          </div>
        </div>
      )}

      {/* ═ MEMBRES ══════════════════════════════════════════════════════ */}
      {onglet === "members" && (
        <MembersView embedded />
      )}

      {/* ═ RÔLES & PERMISSIONS ══════════════════════════════════════════ */}
      {onglet === "roles" && (
        <RolesView embedded />
      )}

      {/* ═ ZONE SENSIBLE ════════════════════════════════════════════════ */}
      {onglet === "danger" && (
        <Section icon={AlertTriangle} title={t("dangerTitle")} description={t("sectionDangerDesc")}>
          <p className="mb-5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {t("dangerHelp")}
          </p>
          <div className="flex flex-col gap-3">
            {user?.workspace && !user?.workspace?.is_owner && (
              <DangerRow
                title={t("leaveWorkspaceBtn")}
                desc={t("leaveWorkspaceDesc")}
                icon={LogOut}
                onAction={handleLeaveWorkspace}
              />
            )}
            {/* Your personal (home) workspace can never be deleted — the row
                only shows for additional workspaces you can manage. */}
            {!user?.workspace?.is_personal &&
              (user?.workspace?.is_owner ||
                (user?.permissions || []).includes("workspace.manage")) && (
                <DangerRow
                  title={t("deleteWorkspaceBtn")}
                  desc={t("deleteWorkspaceDesc")}
                  icon={Trash2}
                  onAction={handleDeleteWorkspace}
                />
              )}
            <DangerRow
              title={t("deleteAccountBtn")}
              desc={t("deleteAccountDesc")}
              icon={Trash2}
              onAction={handleDeleteAccount}
            />
          </div>
        </Section>
      )}

          </div>
        </main>
      </div>
      </div>
    </div>
  );
}
