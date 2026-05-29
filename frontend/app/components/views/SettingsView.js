"use client";

import { btnPrimary, btnSecondary, btnGhost, inputField } from "../../lib/uiClasses";
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
import { fetchTelegramStatus, sendTelegramTest } from "../../lib/validationService";
import { fetchBackendKeys, patchBackendKeys } from "../../lib/backendKeysService";
import {
  Send, KeyRound, Palette, Plug, Check, BadgeCheck, Loader2,
  Trash2, RefreshCw, Clock, Users, Settings,
} from "lucide-react";
import { COMMON_TIMEZONES, getBrowserTimezone } from "../../lib/timezone";

const PLATFORM_TO_PROVIDER    = { facebook:"meta", instagram:"meta", tiktok:"tiktok", linkedin:"linkedin" };
const TARGET_KIND_FOR_PLATFORM = { facebook:"facebook_page", instagram:"instagram_business" };

function formatCompact(n) {
  if (n < 1000)          return String(n);
  if (n < 1_000_000)     return `${(n/1000).toFixed(n<10_000?1:0)} K`;
  if (n < 1_000_000_000) return `${(n/1_000_000).toFixed(n<10_000_000?1:0)} M`;
  return `${(n/1_000_000_000).toFixed(1)} G`;
}

/* ─── Champ générique ────────────────────────────────────────────────────*/
function Champ({ label, name, value, onChange, placeholder, type = "text", hint }) {
  return (
    <label className="block mb-4">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest"
        style={{ color:"var(--text-muted)" }}>
        {label}
      </span>
      <input className={inputField} type={type} name={name} value={value ?? ""}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder} autoComplete="off" />
      {hint && <p className="mt-1 text-[11px]" style={{ color:"var(--text-muted)" }}>{hint}</p>}
    </label>
  );
}

/* ─── Section container ──────────────────────────────────────────────────*/
function Section({ icon: Icon, title, badge, children }) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
      <div className="flex items-center gap-3 px-5 py-4"
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

/* ─── Sélecteur de fuseau horaire ────────────────────────────────────────*/
function FuseauHoraire({ value, onChange }) {
  const browser  = getBrowserTimezone();
  const options  = value && !COMMON_TIMEZONES.includes(value) ? [value, ...COMMON_TIMEZONES] : COMMON_TIMEZONES;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest"
          style={{ color:"var(--text-muted)" }}>
          Sélectionner le fuseau
        </span>
        <select className={inputField} value={value||""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Auto — navigateur ({browser})</option>
          {options.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest"
          style={{ color:"var(--text-muted)" }}>
          Ou saisir une zone IANA
        </span>
        <input className={inputField} type="text" value={value||""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Europe/Paris, America/Toronto" autoComplete="off" />
      </label>
      <p className="col-span-full text-[11px]" style={{ color:"var(--text-muted)" }}>
        Laisser vide pour suivre l'horloge de votre appareil. Les modifications s'appliquent après enregistrement.
      </p>
    </div>
  );
}

/* ─── Carte de plateforme ────────────────────────────────────────────────*/
function CartePlateforme({ p, connections, pendingProvider, onConnect, onDisconnect }) {
  const Icon        = p.icon;
  const providerId  = PLATFORM_TO_PROVIDER[p.id];
  const provider    = connections?.[providerId];
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
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white text-sm font-black"
          style={{ background: p.color, boxShadow:`0 4px 12px ${p.color}50` }}>
          {p.label[0]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight" style={{ color:"var(--text-primary)" }}>{p.label}</p>
          {!configured && connections !== null && (
            <p className="mt-0.5 text-[11px]" style={{ color:"var(--status-error)" }}>
              Non configuré — ajoutez les clés env au serveur
            </p>
          )}
          {connected && targets.length > 0 && (
            <p className="mt-0.5 text-[11px]" style={{ color:"var(--text-muted)" }}>
              {targets.length} compte{targets.length !== 1 ? "s" : ""} · {targets.map(t => t.label).join(", ")}
            </p>
          )}
          {!connected && configured && (
            <p className="mt-0.5 text-[11px]" style={{ color:"var(--text-muted)" }}>Non connecté</p>
          )}
        </div>
        {!configured ? (
          <span className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
            style={{ background:"rgba(239,68,68,.1)", color:"var(--status-error)" }}>
            Configuration requise
          </span>
        ) : connected ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold"
              style={{ color:"var(--status-approved)" }}>
              <Check size={13} /> Connecté
            </span>
            <button type="button" onClick={() => onDisconnect(p.id)}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:scale-110"
              style={{ background:"rgba(239,68,68,.1)", border:"none", cursor:"pointer", color:"var(--status-error)" }}
              title="Déconnecter">
              <Trash2 size={12} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => onConnect(p.id)} disabled={isPending}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all hover:-translate-y-px disabled:opacity-60"
            style={{ background: p.color, border:"none", cursor: isPending ? "default" : "pointer",
              boxShadow:`0 4px 10px ${p.color}40` }}>
            {isPending ? <><Loader2 size={11} className="animate-spin"/> Connexion…</> : "Connecter"}
          </button>
        )}
      </div>

      {/* comptes publiables */}
      {connected && targets.length > 0 && (
        <div className="px-4 py-3" style={{ borderTop:`1px solid ${p.color}20` }}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
            Comptes de publication
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
            ? "Aucune Page trouvée. Assurez-vous d'administrer au moins une Page FB, puis reconnectez."
            : p.id === "instagram"
            ? "Aucun compte IG Pro trouvé. Liez un compte IG Pro à une Page FB que vous gérez, puis reconnectez."
            : "Connecté, mais aucun compte publiable détecté."}
        </div>
      )}
    </div>
  );
}

/* ─── Backend API keys editor ────────────────────────────────────────────
   Lives in backend/content/runtime_settings.json. Overrides infra/.env
   at runtime — no container restart needed. Secrets come back masked
   (abcd••••WXYZ); typing a new value replaces, empty clears the override
   so the env default kicks back in. PATCH only sends fields the user
   touched so an empty-but-untouched secret doesn't clobber a set key. */
function BackendKeysSection() {
  const dispatch = useDispatch();
  const [keys, setKeys] = useState({});
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const GROUPS = [
    {
      title: "LLM (text generation)",
      ids: ["AI_API_KEY", "AI_MODEL", "AI_MODEL_FAST", "AI_MODEL_PREMIUM"],
    },
    {
      title: "AI image generation",
      ids: ["AI_IMAGE_API_KEY", "AI_IMAGE_API_BASE_URL", "AI_IMAGE_MODEL"],
    },
    {
      title: "AI video generation",
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
      title: "Telegram",
      ids: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_DEFAULT_CHAT_ID"],
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

  useEffect(() => { reload(); }, [reload]);

  async function handleSave() {
    if (Object.keys(edits).length === 0) return;
    setSaving(true);
    try {
      const data = await patchBackendKeys(edits);
      setKeys(data?.keys || {});
      setEdits({});
      dispatch(addNotification({
        message: "Backend keys updated. Active immediately for new calls.",
        type: "success",
      }));
    } catch (err) {
      dispatch(addNotification({
        message: `Couldn't save keys: ${err.message || err}`,
        type: "error",
      }));
    } finally {
      setSaving(false);
    }
  }

  const dirty = Object.keys(edits).length > 0;

  if (loading) {
    return <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading…</p>;
  }

  return (
    <div>
      <div className="mb-4 rounded-xl p-3.5 text-xs leading-relaxed"
        style={{ background:"rgba(29,63,190,.07)", border:"1px solid rgba(29,63,190,.2)", color:"var(--text-secondary)" }}>
        <strong style={{ color:"var(--text-primary)" }}>Saved to the backend.</strong>{" "}
        Overrides infra/.env at runtime — no container restart needed. Empty an
        override to fall back to whatever's in env. Secrets are masked.
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
                  {entry.set && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-normal"
                      style={{ color: "var(--status-approved)" }}>
                      <Check size={10} />
                      {isSecret ? entry.masked : "set"}
                    </span>
                  )}
                </span>
                <input
                  className={inputField}
                  type={isSecret ? "password" : "text"}
                  value={isSecret ? editValue : (id in edits ? editValue : entry.value)}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [id]: e.target.value }))}
                  placeholder={
                    isSecret
                      ? (entry.set ? "Type a new value to replace…" : "Not set")
                      : "Empty = use env default"
                  }
                  autoComplete="off"
                />
              </label>
            );
          })}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`${btnPrimary} inline-flex items-center gap-2`}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save changes
          {dirty && <span className="text-[10px] opacity-80">({Object.keys(edits).length})</span>}
        </button>
        {dirty && (
          <button type="button" onClick={() => setEdits({})} className={`${btnGhost} text-xs`}>
            Discard
          </button>
        )}
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className={`${btnGhost} text-xs inline-flex items-center gap-1 ml-auto`}
        >
          <RefreshCw size={12} /> Reload
        </button>
      </div>
    </div>
  );
}

/* ─── Composant principal ────────────────────────────────────────────────*/
export default function SettingsView() {
  const dispatch = useDispatch();
  const [s,               setS]               = useState(null);
  const [connections,     setConnections]     = useState(null);
  const [pendingProvider, setPendingProvider] = useState(null);
  const [refreshing,      setRefreshing]      = useState(false);
  const [telegramStatus,  setTelegramStatus]  = useState(null);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [onglet,          setOnglet]          = useState("plateformes");

  useEffect(() => { setS(loadSettings()); }, []);

  const actualiserConnexions = useCallback(async ({ force = false } = {}) => {
    setRefreshing(true);
    try {
      const data = await fetchConnections({ force });
      setConnections(data?.providers || {});
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedConnections();
    if (cached?.providers) setConnections(cached.providers);
    actualiserConnexions();
  }, [actualiserConnexions]);

  useEffect(() => {
    fetchTelegramStatus()
      .then((d) => setTelegramStatus(d))
      .catch(() => setTelegramStatus({
        configured:false, default_chat_configured:false, webhook_secret_configured:false,
      }));
  }, []);

  if (s === null) return null;

  const update = (key, value) => setS((p) => ({ ...p, [key]: value }));

  const handleConnect = async (platformId) => {
    const providerId = PLATFORM_TO_PROVIDER[platformId];
    if (!providerId) return;
    setPendingProvider(providerId);
    try {
      await startConnect(providerId);
      dispatch(addNotification({ message:`${platformId} connecté.`, type:"success" }));
      invalidateConnectionsCache();
      await actualiserConnexions({ force: true });
    } catch (err) {
      dispatch(addNotification({ message:`Connexion échouée : ${err.message||"erreur inconnue"}`, type:"error" }));
    } finally {
      setPendingProvider(null);
    }
  };

  const handleDisconnect = async (platformId) => {
    const providerId = PLATFORM_TO_PROVIDER[platformId];
    if (!providerId) return;
    if (!confirm(`Déconnecter ${platformId} ? Les tokens enregistrés seront supprimés.`)) return;
    try {
      await oauthDisconnect(providerId);
      dispatch(addNotification({ message:`${platformId} déconnecté.`, type:"info" }));
      await actualiserConnexions({ force: true });
    } catch (err) {
      dispatch(addNotification({ message:`Déconnexion échouée : ${err.message||"inconnu"}`, type:"error" }));
    }
  };

  const handleSave = () => {
    saveSettings(s);
    dispatch(addNotification({ message:"Paramètres enregistrés sur cet appareil.", type:"success" }));
  };

  const handlePairTelegram = () => {
    if (!telegramStatus?.configured) {
      dispatch(addNotification({ message:"Le token du bot Telegram n'est pas encore configuré.", type:"error" }));
      return;
    }
    if (!s.telegramChatId) {
      dispatch(addNotification({ message:"Entrez votre ID de chat Telegram.", type:"error" }));
      return;
    }
    saveSettings(s);
    dispatch(addNotification({ message:"ID de chat Telegram enregistré pour les validations.", type:"info" }));
  };

  const handleTestTelegram = async () => {
    if (!telegramStatus?.configured) {
      dispatch(addNotification({ message:"Le token du bot Telegram n'est pas configuré.", type:"error" }));
      return;
    }
    setTestingTelegram(true);
    try {
      const result = await sendTelegramTest(s.telegramChatId || null);
      dispatch(addNotification({ message:`Message test envoyé au chat ${result.chat_id}.`, type:"success" }));
    } catch (err) {
      dispatch(addNotification({ message:`Test échoué : ${err.message}`, type:"error" }));
    } finally {
      setTestingTelegram(false);
    }
  };

  const connectéCount  = Object.values(connections || {}).filter((c) => c.connected).length;
  const totalProviders = Object.keys(connections || {}).length;

  const ONGLETS = [
    { id:"plateformes", label:"Plateformes",    icon:Plug,     badge: connectéCount > 0 ? `${connectéCount}/${totalProviders}` : null },
    { id:"fuseau",      label:"Fuseau horaire", icon:Clock                                                                             },
    { id:"ia",          label:"Clés IA",        icon:KeyRound                                                                          },
    { id:"telegram",    label:"Telegram",       icon:Send,     badge: telegramStatus?.configured ? "ok" : null                        },
    { id:"marque",      label:"Kit Marque",     icon:Palette                                                                           },
  ];

  return (
    <div className="h-full overflow-y-auto" style={{ background:"var(--bg-primary)", padding:"24px" }}>

      {/* ═ EN-TÊTE ══════════════════════════════════════════════════════ */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold" style={{ color:"var(--text-primary)" }}>Paramètres</h1>
          <p className="mt-0.5 text-xs" style={{ color:"var(--text-muted)" }}>
            Gérez les plateformes, les clés API, le fuseau horaire et l'identité de marque.
          </p>
        </div>
        <button type="button" onClick={handleSave}
          className={`${btnPrimary} inline-flex items-center gap-2`}>
          <Settings size={14} /> Tout enregistrer
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
          title="Plateformes connectées"
          badge={
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color:"var(--text-muted)" }}>
                {connections === null
                  ? "Chargement…"
                  : `${connectéCount} / ${totalProviders} connectée${connectéCount!==1?"s":""}`}
              </span>
              <button type="button" onClick={() => actualiserConnexions({ force: true })}
                disabled={refreshing}
                className={`${btnGhost} inline-flex items-center gap-1 text-[11px]`}
                style={{ padding:"3px 8px" }}>
                <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
                Actualiser
              </button>
            </div>
          }
        >
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
        </Section>
      )}

      {/* ═ FUSEAU HORAIRE ═══════════════════════════════════════════════ */}
      {onglet === "fuseau" && (
        <Section icon={Clock} title="Fuseau horaire de planification">
          <p className="mb-5 text-xs leading-relaxed" style={{ color:"var(--text-muted)" }}>
            Définit ce que signifie «&nbsp;09h00&nbsp;» lorsque vous planifiez un post.
            Configurez-le sur le fuseau de l'audience cible de la marque, pour qu'un collaborateur
            en déplacement ou derrière un VPN ne publie pas accidentellement à 03h00.
          </p>
          <FuseauHoraire value={s.scheduleTimezone} onChange={(v) => update("scheduleTimezone", v)} />
        </Section>
      )}

      {/* ═ CLÉS IA ══════════════════════════════════════════════════════ */}
      {onglet === "ia" && (
        <Section icon={KeyRound} title="Backend API keys">
          <BackendKeysSection />
        </Section>
      )}

      {/* ═ TELEGRAM ═════════════════════════════════════════════════════ */}
      {onglet === "telegram" && (
        <Section icon={Send} title="Bot de validation Telegram">
          {/* indicateurs de statut */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {[
              { label:"Token du bot",      on: telegramStatus?.configured },
              { label:"Chat par défaut",   on: telegramStatus?.default_chat_configured },
              { label:"Secret webhook",    on: telegramStatus?.webhook_secret_configured },
            ].map(({ label, on }) => (
              <div key={label} className="rounded-xl px-3 py-3 text-center"
                style={{
                  background: on ? "rgba(34,197,94,.08)"  : "rgba(239,68,68,.06)",
                  border: `1px solid ${on ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.15)"}`,
                }}>
                <span className="mx-auto mb-1.5 block h-2 w-2 rounded-full"
                  style={{ background: on ? "var(--status-approved)" : "var(--status-error)" }} />
                <p className="text-[11px] font-semibold"
                  style={{ color: on ? "var(--status-approved)" : "var(--status-error)" }}>
                  {label}
                </p>
                <p className="text-[10px] font-black"
                  style={{ color: on ? "var(--status-approved)" : "var(--status-error)" }}>
                  {on ? "OK" : "MANQUANT"}
                </p>
              </div>
            ))}
          </div>

          <Champ label="Note sur le token du bot" name="telegramBotToken" value={s.telegramBotToken}
            onChange={update} placeholder="123456:ABC-DEF…" type="password"
            hint="Note uniquement — le vrai token est sur le serveur et ne transite pas par le navigateur." />
          <Champ label="Votre ID de chat Telegram" name="telegramChatId" value={s.telegramChatId}
            onChange={update} placeholder="ex. 84217734" />

          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" onClick={handlePairTelegram}
              className={`${btnPrimary} text-sm`}>
              Associer le bot
            </button>
            <button type="button" onClick={handleTestTelegram}
              disabled={testingTelegram || !telegramStatus?.configured}
              className={`${btnSecondary} text-sm inline-flex items-center gap-2`}>
              {testingTelegram
                ? <><Loader2 size={13} className="animate-spin"/> Envoi…</>
                : "Envoyer un message test"}
            </button>
          </div>
        </Section>
      )}

      {/* ═ KIT MARQUE ═══════════════════════════════════════════════════ */}
      {onglet === "marque" && (
        <Section icon={Palette} title="Kit Marque">
          <p className="mb-5 text-xs leading-relaxed" style={{ color:"var(--text-muted)" }}>
            Ces valeurs sont injectées dans chaque prompt IA pour que le contenu généré corresponde à l'identité de votre marque.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <Champ label="Nom de la marque" name="brandName" value={s.brandName}
              onChange={update} placeholder="DATALIA" />
            <div className="mb-4">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
                Couleur principale
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
              <Champ label="Ton de communication" name="brandToneOfVoice" value={s.brandToneOfVoice}
                onChange={update} placeholder="Confiant, bienveillant, concis"
                hint="Décrivez comment la marque s'exprime — injecté tel quel dans les prompts de génération." />
            </div>
          </div>
        </Section>
      )}

      {/* bouton bas de page */}
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={handleSave}
          className={`${btnPrimary} inline-flex items-center gap-2`}>
          <Settings size={14} /> Enregistrer tous les paramètres
        </button>
      </div>

    </div>
  );
}
