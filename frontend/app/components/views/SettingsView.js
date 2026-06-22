"use client";

import { btnPrimary, btnSecondary, btnGhost, inputField } from "../../lib/uiClasses";
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslations } from "next-intl";
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
  Trash2, RefreshCw, Clock, Users, Settings, HelpCircle, Zap, AlertTriangle, LogOut,
} from "lucide-react";
import { COMMON_TIMEZONES, getBrowserTimezone } from "../../lib/timezone";

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
}) {
  return (
    <label className="block mb-4">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest"
        style={{ color:"var(--text-muted)" }}>
        {label}
      </span>
      <input className={inputField} type={secret ? "text" : type} name={name} value={value ?? ""}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck="false"
        data-1p-ignore={secret ? "true" : undefined}
        data-lpignore={secret ? "true" : undefined}
        data-bwignore={secret ? "true" : undefined}
        data-form-type={secret ? "other" : undefined}
        style={secret ? { WebkitTextSecurity: "disc" } : undefined} />
      {hint && <p className="mt-1 text-[11px]" style={{ color:"var(--text-muted)" }}>{hint}</p>}
    </label>
  );
}

/* ─── Section container ──────────────────────────────────────────────────*/
function Section({ icon: Icon, title, badge, children }) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4"
        style={{ borderBottom:"1px solid var(--border-default)" }}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background:"rgba(29,63,190,.1)", color:"var(--accent-primary)" }}>
          <Icon size={15} />
        </span>
        <h3 className="flex-1 text-sm font-bold" style={{ color:"var(--text-primary)" }}>{title}</h3>
        {badge}
      </div>
      <div className="px-5 py-5">{children}</div>
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
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest"
          style={{ color:"var(--text-muted)" }}>
          {t("timezoneSelectLabel")}
        </span>
        <select className={inputField} value={value||""} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("timezoneAutoBrowser", { browser })}</option>
          {options.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest"
          style={{ color:"var(--text-muted)" }}>
          {t("timezoneIanaLabel")}
        </span>
        <input className={inputField} type="text" value={value||""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Europe/Paris, America/Toronto" autoComplete="off" />
      </label>
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
            <p className="mt-0.5 text-[11px]" style={{ color:"var(--status-error)" }}>
              {t("platformNotConfigured")}
            </p>
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
        <div className="px-4 py-3 text-xs" style={{ borderTop:`1px solid ${p.color}20`, color:"var(--text-muted)" }}>
          {p.id === "facebook"
            ? t("platformNoFacebookPages")
            : p.id === "instagram"
            ? t("platformNoInstagramAccounts")
            : t("platformNoTargets")}
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
    <div className="overflow-hidden rounded-2xl"
      style={{
        border: configured ? "1px solid rgba(29,63,190,.22)" : "1px solid var(--border-default)",
        background: configured ? "linear-gradient(180deg, rgba(29,63,190,.035), rgba(29,63,190,.02))" : "var(--bg-tertiary)",
        boxShadow: configured ? "0 12px 30px rgba(29,63,190,.08)" : "none",
      }}>
      <div className="flex flex-wrap items-center gap-3 px-6 py-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background:"var(--accent-primary)", boxShadow:"0 4px 12px rgba(29,63,190,.4)" }}>
          <Zap size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold leading-tight" style={{ color:"var(--text-primary)" }}>
            {t("zernioHeading")}
            <button type="button" onClick={() => setShowHelp((v) => !v)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full"
              style={{ background:"rgba(29,63,190,.1)", color:"var(--accent-primary)", border:"none", cursor:"pointer" }}
              title={t("zernioHelpTitle")} aria-label={t("zernioHelpTitle")}>
              <HelpCircle size={12} />
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
        <div className="mx-6 mb-4 rounded-xl p-3 text-[11px] leading-relaxed"
          style={{ background:"rgba(29,63,190,.07)", border:"1px solid rgba(29,63,190,.2)", color:"var(--text-secondary)" }}>
          <p className="mb-1 font-bold">{t("zernioHelpTitle")}</p>
          {t("zernioHelpBody")}
          <a href="https://zernio.com" target="_blank" rel="noopener noreferrer"
            className="mt-1 inline-block text-[10px] font-bold text-sky-500 hover:text-sky-600">
            {t("zernioGetKey")}
          </a>
        </div>
      )}

      <div className="mx-6 border-t px-0 pb-4 pt-4" style={{ borderColor:"rgba(29,63,190,.14)" }}>
        <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color:"var(--text-tertiary)" }}>
          {t("zernioKeyLabel")}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputField} type="text" value={keyEdit}
            onChange={(e) => setKeyEdit(e.target.value)}
            placeholder={configured ? t("zernioKeyPlaceholderSet") : t("zernioKeyPlaceholderUnset")}
            autoComplete="off" spellCheck="false"
            data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other"
            style={{ WebkitTextSecurity:"disc" }} />
          <button type="button" onClick={save} disabled={savingKey || !keyEdit.trim()}
            className={`${btnPrimary} inline-flex items-center justify-center gap-1.5 text-xs sm:shrink-0`}>
            {savingKey ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            {t("zernioKeySave")}
          </button>
        </div>
        {!configured && (
          <p className="mt-1.5 text-[11px]" style={{ color:"var(--text-muted)" }}>{t("zernioNotConfigured")}</p>
        )}
        {configured && targets.length === 0 && !z?.error && (
          <p className="mt-1.5 text-[11px]" style={{ color:"var(--text-muted)" }}>
            {t("zernioReadyToConnect")}
          </p>
        )}
        {configured && z?.error && (
          <p className="mt-2 rounded-lg px-3 py-2 text-[11px]"
            style={{ background:"rgba(239,68,68,.08)", color:"var(--status-error)" }}>
            {z.error}
          </p>
        )}
      </div>

      {configured && (
        <div className="mx-6 border-t px-0 py-4" style={{ borderColor:"rgba(29,63,190,.12)" }}>
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
        <div className="mx-6 border-t px-0 py-4" style={{ borderColor:"rgba(29,63,190,.12)" }}>
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
  const dispatch = useDispatch();
  const [keys, setKeys] = useState({});
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const GROUPS = [
    {
      title: t("backendKeysGroupLLM"),
      ids: ["AI_API_KEY", "AI_MODEL", "AI_MODEL_FAST", "AI_MODEL_PREMIUM"],
    },
    {
      title: t("backendKeysGroupImage"),
      ids: ["AI_IMAGE_API_KEY", "AI_IMAGE_API_BASE_URL", "AI_IMAGE_MODEL"],
    },
    {
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

  const KEY_LINKS = {
    AI_API_KEY: "https://openrouter.ai/keys",
    AI_IMAGE_API_KEY: "https://aistudio.google.com/app/apikey",
    FAL_API_KEY: "https://fal.ai/dashboard/keys",
    REPLICATE_API_TOKEN: "https://replicate.com/account/api-tokens",
  };

  if (loading) {
    return <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("backendKeysLoading")}</p>;
  }

  return (
    <div>
      <div className="mb-4 rounded-xl p-3.5 text-xs leading-relaxed"
        style={{ background:"rgba(29,63,190,.07)", border:"1px solid rgba(29,63,190,.2)", color:"var(--text-secondary)" }}>
        {t("backendKeysBanner")}
      </div>
      {GROUPS.map((group) => (
        <div key={group.title} className="mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--text-tertiary)" }}>
            {group.title}
          </p>
          {group.ids.map((id) => {
            const entry = keys[id] || { set: false, masked: "", value: "", secret: false };
            const editValue = id in edits ? edits[id] : "";
            const isSecret = entry.secret;
            return (
              <label key={id} className="block mb-3">
                <span className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wider"
                  style={{ color: "var(--text-tertiary)" }}>
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
                  style={isSecret ? { WebkitTextSecurity: "disc" } : undefined}
                />
              </label>
            );
          })}
        </div>
      ))}
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
  const dispatch = useDispatch();
  const user                                  = useSelector((st) => st.auth.user);
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
  const [onglet,          setOnglet]          = useState("plateformes");

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
    actualiserConnexions({ force: true });
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
    { id:"plateformes", label:t("tabPlatforms"), icon:Plug,     badge: connectéCount > 0 ? `${connectéCount}/${totalProviders}` : null },
    { id:"fuseau",      label:t("tabTimezone"),  icon:Clock                                                                             },
    { id:"ia",          label:t("tabAiKeys"),    icon:KeyRound                                                                          },
    { id:"telegram",    label:t("tabTelegram"),  icon:Send,     badge: null                                                            },
    { id:"marque",      label:t("tabBrandKit"),  icon:Palette                                                                           },
    { id:"danger",      label:t("tabDanger"),    icon:AlertTriangle                                                                     },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6" style={{ background:"var(--bg-primary)" }}>

      {/* ═ EN-TÊTE ══════════════════════════════════════════════════════ */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold" style={{ color:"var(--text-primary)" }}>{t("title")}</h1>
          <p className="mt-0.5 text-xs" style={{ color:"var(--text-muted)" }}>
            {t("subtitle")}
          </p>
        </div>
        <button type="button" onClick={handleSave}
          className={`${btnPrimary} inline-flex items-center gap-2`}>
          <Settings size={14} /> {t("saveAll")}
        </button>
      </div>

      {/* ═ ONGLETS ══════════════════════════════════════════════════════ */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-2xl p-1"
        style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
        {ONGLETS.map(({ id, label, icon: Icon, badge }) => (
          <button key={id} type="button" onClick={() => setOnglet(id)}
            className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-150"
            style={{
              background: onglet === id ? "var(--accent-primary)" : "transparent",
              color:      onglet === id ? "#fff"                  : "var(--text-secondary)",
              cursor:"pointer",
              minWidth: 0,
            }}>
            <Icon size={13} />
            <span>{label}</span>
            {badge && (
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-black"
                style={{
                  background: onglet === id ? "rgba(255,255,255,.25)" : "rgba(34,197,94,.2)",
                  color:      onglet === id ? "#fff"                  : "var(--status-approved)",
                }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═ PLATEFORMES ══════════════════════════════════════════════════ */}
      {onglet === "plateformes" && (
        <Section
          icon={Plug}
          title={t("platformsTitle")}
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
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
              {t("directConnectionsHeading")}
            </p>
            {PLATFORMS.map((p) => (
              <CartePlateforme
                key={p.id} p={p}
                connections={connections}
                pendingProvider={pendingProvider}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
              />
            ))}

            <div className="mt-2" />
            <CarteZernio
              connections={connections}
              pendingZernio={pendingZernio}
              onConnect={handleZernioConnect}
              onDisconnectPlatform={handleZernioDisconnectPlatform}
              onDisconnectAccount={handleZernioDisconnectAccount}
              onSaveKey={handleSaveZernioKey}
            />
          </div>
        </Section>
      )}

      {/* ═ FUSEAU HORAIRE ═══════════════════════════════════════════════ */}
      {onglet === "fuseau" && (
        <Section icon={Clock} title={t("timezoneTitle")}>
          <p className="mb-5 text-xs leading-relaxed" style={{ color:"var(--text-muted)" }}>
            {t("timezoneHelp")}
          </p>
          <FuseauHoraire value={s.scheduleTimezone} onChange={(v) => update("scheduleTimezone", v)} />
        </Section>
      )}

      {/* ═ CLÉS IA ══════════════════════════════════════════════════════ */}
      {onglet === "ia" && (
        <Section icon={KeyRound} title={t("backendKeysTitle")}>
          <BackendKeysSection />
        </Section>
      )}

      {/* ═ TELEGRAM ═════════════════════════════════════════════════════ */}
      {onglet === "telegram" && (
        <Section icon={Send} title={t("telegramSectionTitle")}>
          {/* The bot token / webhook secret are server-side deployment config —
              not surfaced here. Users only manage their own chat id + test. */}
          <div className="mb-4 rounded-xl p-3.5 text-xs leading-relaxed"
            style={{ background:"rgba(29,63,190,.07)", border:"1px solid rgba(29,63,190,.2)", color:"var(--text-secondary)" }}>
            <p className="mb-1.5 font-bold">{t("telegramHowToTitle")}</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>{t("telegramStep1")}</li>
              <li>{t("telegramStep2")}</li>
              <li>{t("telegramStep3")}</li>
            </ol>
          </div>
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
        <Section icon={Palette} title={t("brandKitTitle")}>
          <p className="mb-5 text-xs leading-relaxed" style={{ color:"var(--text-muted)" }}>
            {t("brandKitHelp")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <Champ label={t("brandName")} name="brandName" value={s.brandName}
              onChange={update} placeholder={t("brandNamePlaceholder")} />
            <div className="mb-4">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
                {t("brandPrimaryColor")}
              </p>
              <div className="flex items-center gap-3">
                <input type="color" value={s.brandPrimaryColor || "#3b82f6"}
                  onChange={(e) => update("brandPrimaryColor", e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-lg"
                  style={{ border:"1px solid var(--border-default)", background:"none", padding:2 }} />
                <input className={inputField} type="text" value={s.brandPrimaryColor || ""}
                  onChange={(e) => update("brandPrimaryColor", e.target.value)}
                  placeholder="#3b82f6" />
              </div>
            </div>
            <div className="col-span-full">
              <Champ label={t("brandTone")} name="brandToneOfVoice" value={s.brandToneOfVoice}
                onChange={update} placeholder={t("brandTonePlaceholder")}
                hint={t("brandToneHint")} />
            </div>
          </div>
        </Section>
      )}

      {/* ═ ZONE SENSIBLE ════════════════════════════════════════════════ */}
      {onglet === "danger" && (
        <Section icon={AlertTriangle} title={t("dangerTitle")}>
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
  );
}
