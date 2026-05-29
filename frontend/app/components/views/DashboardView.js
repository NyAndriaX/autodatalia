"use client";

import { useEffect, useMemo, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { fetchConnections } from "../../lib/oauthService";
import { setActiveView } from "../../store/uiSlice";
import { PLATFORMS, STATUS_META, activePlatformIds } from "../../lib/platforms";
import { startOfToday, isoDateKey, addDays } from "../../lib/dateUtils";
import { useIsMobile } from "../../lib/useIsMobile";
import {
  TrendingUp, Calendar, Users, Zap, ArrowRight, ExternalLink,
  CheckCircle2, FileText, BarChart2,
  PlusCircle, Bot, Image, AlertCircle, Sparkles,
} from "lucide-react";

/* ─── constantes ─────────────────────────────────────────────────────────*/
const PLATFORM_COLORS = { facebook:"#1877F2", instagram:"#e1306c", tiktok:"#181818", linkedin:"#0A66C2" };

const WEEKDAY_SHORT = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const WEEKDAY_LONG  = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const MONTH_LONG    = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

const PLATFORM_TO_PROVIDER    = { facebook:"meta", instagram:"meta", tiktok:"tiktok", linkedin:"linkedin" };
const PLATFORM_TO_TARGET_KIND = { facebook:"facebook_page", instagram:"instagram_business", tiktok:"tiktok_account", linkedin:"linkedin_member" };

const fmt = (n) => Math.round(Number(n)||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g,"\u202f");

const STATUS_COLORS = {
  published : { bg:"rgba(6,182,212,.15)",  text:"var(--status-published)", dot:"#06b6d4" },
  scheduled : { bg:"rgba(99,102,241,.12)", text:"#6366f1",                 dot:"#6366f1" },
  draft     : { bg:"rgba(100,116,139,.12)",text:"var(--status-draft)",     dot:"#64748b" },
  pending   : { bg:"rgba(245,158,11,.12)", text:"var(--status-pending)",   dot:"#f59e0b" },
  error     : { bg:"rgba(239,68,68,.12)",  text:"var(--status-error)",     dot:"#ef4444" },
  approved  : { bg:"rgba(34,197,94,.12)",  text:"var(--status-approved)",  dot:"#22c55e" },
  awaiting  : { bg:"rgba(168,85,247,.12)", text:"var(--status-awaiting)",  dot:"#a855f7" },
  rejected  : { bg:"rgba(148,163,184,.15)",text:"var(--status-rejected)",  dot:"#94a3b8" },
};

const STATUS_LABELS = {
  published:"Publié", scheduled:"Planifié", draft:"Brouillon",
  pending:"En attente", error:"Erreur", approved:"Approuvé",
  awaiting:"En révision", rejected:"Rejeté",
};

/* ─── sous-composants ────────────────────────────────────────────────────*/
function KpiCard({ icon: Icon, label, value, sub, color, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full text-left"
      style={{ border:"none", background:"none", padding:0, cursor: onClick ? "pointer" : "default" }}>
      <div className="flex flex-col gap-2 rounded-2xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
        style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
        <div className="flex items-center justify-between">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: color + "20", color }}>
            <Icon size={18} />
          </span>
          {onClick && <ArrowRight size={13} style={{ color:"var(--text-muted)" }} />}
        </div>
        <div className="mt-1">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
            {label}
          </p>
          <p className="mt-0.5 text-3xl font-extrabold leading-none tracking-tight" style={{ color:"var(--text-primary)" }}>
            {value}
          </p>
          {sub && <p className="mt-1 text-xs" style={{ color:"var(--text-muted)" }}>{sub}</p>}
        </div>
      </div>
    </button>
  );
}

function PipelineBar({ stats }) {
  const items = [
    { key:"draft",     label:"Brouillons", dot:"#64748b" },
    { key:"pending",   label:"En attente", dot:"#f59e0b" },
    { key:"scheduled", label:"Planifiés",  dot:"#6366f1" },
    { key:"published", label:"Publiés",    dot:"#22c55e" },
    { key:"error",     label:"Erreurs",    dot:"#ef4444" },
  ];
  const total = Math.max(1, items.reduce((s,i) => s + (stats.byStatus[i.key]||0), 0));
  return (
    <div className="rounded-2xl p-5" style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
        Pipeline de contenu
      </p>
      <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ background:"var(--bg-tertiary)" }}>
        {items.map(({ key, dot }) => {
          const pct = ((stats.byStatus[key]||0) / total) * 100;
          return pct > 0 ? (
            <div key={key} style={{ width:`${pct}%`, background:dot, transition:"width .4s ease" }} />
          ) : null;
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {items.map(({ key, label, dot }) => (
          <span key={key} className="flex items-center gap-1.5 text-xs font-medium" style={{ color:"var(--text-secondary)" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
            {label} <strong style={{ color:"var(--text-primary)" }}>{stats.byStatus[key]||0}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function WeekStrip({ week, todayKey, onCalendar }) {
  return (
    <div className="rounded-2xl p-5" style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
          7 prochains jours
        </p>
        <button type="button" onClick={onCalendar}
          className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color:"var(--accent-primary)", border:"none", background:"none", cursor:"pointer" }}>
          Calendrier complet <ArrowRight size={12} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {week.map(({ date, key, day }) => {
          const isToday = key === todayKey;
          const hasPost = day.length > 0;
          return (
            <button key={key} type="button" onClick={onCalendar}
              className="flex flex-col items-center gap-1 rounded-xl py-3 transition-all duration-150 hover:scale-105"
              style={{
                background: isToday ? "var(--accent-primary)" : hasPost ? "var(--bg-secondary)" : "var(--bg-tertiary)",
                border: `1px solid ${isToday ? "transparent" : "var(--border-default)"}`,
                cursor:"pointer",
              }}>
              <span className="text-[9px] font-bold uppercase tracking-wider"
                style={{ color: isToday ? "rgba(255,255,255,.7)" : "var(--text-muted)" }}>
                {WEEKDAY_SHORT[date.getDay()]}
              </span>
              <span className="text-base font-extrabold leading-none"
                style={{ color: isToday ? "#fff" : "var(--text-primary)" }}>
                {date.getDate()}
              </span>
              <div className="flex flex-wrap justify-center gap-0.5">
                {day.slice(0,3).map((p,i) => {
                  const s = STATUS_META[p.status] || STATUS_META.draft;
                  return <span key={i} className="h-1 w-1 rounded-full"
                    style={{ background: isToday ? "rgba(255,255,255,.7)" : s.colorVar }} />;
                })}
                {day.length > 3 && (
                  <span className="text-[8px] font-bold"
                    style={{ color: isToday ? "rgba(255,255,255,.7)" : "var(--text-muted)" }}>
                    +{day.length-3}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AudienceCard({ audience, totalAudience, onManage }) {
  const max = Math.max(1, ...audience.map(r => r.count));
  return (
    <div className="rounded-2xl p-5 h-full flex flex-col" style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
          Audience
        </p>
        <button type="button" onClick={onManage}
          className="text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color:"var(--accent-primary)", border:"none", background:"none", cursor:"pointer" }}>
          Gérer
        </button>
      </div>
      {audience.every(r => !r.connected) ? (
        <div className="flex flex-col items-center justify-center py-6 text-center flex-1">
          <Users size={28} style={{ color:"var(--text-muted)", marginBottom:8 }} />
          <p className="text-sm font-medium" style={{ color:"var(--text-secondary)" }}>Aucune plateforme connectée</p>
          <p className="mt-1 text-xs" style={{ color:"var(--text-muted)" }}>Connectez dans les Paramètres pour voir les abonnés</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 flex-1">
          {audience.map(row => {
            const color = PLATFORM_COLORS[row.platform] || "#64748b";
            const pct   = Math.round((row.count / max) * 100);
            return (
              <div key={row.platform}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-semibold capitalize" style={{ color:"var(--text-secondary)" }}>
                    <span className="flex h-5 w-5 items-center justify-center rounded-md text-[9px] font-black text-white"
                      style={{ background: color }}>
                      {row.platform[0].toUpperCase()}
                    </span>
                    {row.platform}
                    {!row.connected && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                        style={{ background:"rgba(100,116,139,.12)", color:"var(--text-muted)" }}>
                        hors ligne
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-bold tabular-nums" style={{ color:"var(--text-primary)" }}>
                    {fmt(row.count)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background:"var(--bg-tertiary)" }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: row.connected ? `${pct}%` : "0%", background: color }} />
                </div>
              </div>
            );
          })}
          <p className="mt-auto pt-2 text-right text-xs font-bold" style={{ color:"var(--text-muted)" }}>
            {fmt(totalAudience)} abonnés au total
          </p>
        </div>
      )}
    </div>
  );
}

function RecentPost({ post }) {
  const ids = activePlatformIds(post.platforms);
  const statusColor = STATUS_COLORS[post.status] || STATUS_COLORS.draft;
  return (
    <div className="flex items-start gap-3 px-5 py-3.5 transition-all duration-150 hover:bg-[var(--bg-card-hover)]"
      style={{ borderBottom:"1px solid var(--border-default)" }}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black text-white"
        style={{ background: ids.length > 0 ? (PLATFORM_COLORS[ids[0]] || "#64748b") : "#64748b" }}>
        {ids.length > 0 ? ids[0][0].toUpperCase() : "?"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color:"var(--text-primary)" }}>
          {post.content || <span style={{ color:"var(--text-muted)" }}>(sans légende)</span>}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px]" style={{ color:"var(--text-muted)" }}>
          <span>{post.scheduledDate || "—"}</span>
          {ids.slice(0,3).map(pid => (
            <span key={pid} className="h-1.5 w-1.5 rounded-full" style={{ background: PLATFORM_COLORS[pid] }} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
          style={{ background: statusColor.bg, color: statusColor.text }}>
          {STATUS_LABELS[post.status] || post.status}
        </span>
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noopener noreferrer"
            className="rounded p-1 transition-opacity hover:opacity-70"
            style={{ color:"var(--accent-primary)" }}>
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

function ActionCard({ icon: Icon, title, description, color, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-2xl p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)", cursor:"pointer" }}>
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110"
        style={{ background: color + "20", color }}>
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold" style={{ color:"var(--text-primary)" }}>{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color:"var(--text-muted)" }}>{description}</p>
      </div>
      <ArrowRight size={14} className="mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color }} />
    </button>
  );
}

/* ─── composant principal ───────────────────────────────────────────────*/
export default function DashboardView() {
  const dispatch       = useDispatch();
  const scheduledPosts = useSelector((s) => s.calendar.scheduledPosts);
  const aiUsage        = useSelector((s) => s.ui.aiUsage);
  const user           = useSelector((s) => s.auth.user);
  const isMobile       = useIsMobile();

  const today    = startOfToday();
  const todayKey = isoDateKey(today);

  const [oauthState, setOauthState] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchConnections().then((d) => { if (alive) setOauthState(d?.providers || {}); });
    return () => { alive = false; };
  }, []);

  const dateLabel = `${WEEKDAY_LONG[today.getDay()]} ${today.getDate()} ${MONTH_LONG[today.getMonth()]}`;

  const isConnected = (pid) => !!oauthState?.[PLATFORM_TO_PROVIDER[pid]]?.connected;

  const audience = useMemo(() => PLATFORMS.map((p) => {
    const prov    = oauthState?.[PLATFORM_TO_PROVIDER[p.id]];
    const targets = (prov?.targets || []).filter((t) => t.kind === PLATFORM_TO_TARGET_KIND[p.id]);
    return {
      platform: p.id,
      count: targets.reduce((s, t) => s + (t.audience || 0), 0),
      connected: !!prov?.connected,
      accountCount: targets.length,
    };
  }), [oauthState]);

  const totalAudience = audience.reduce((s, a) => s + a.count, 0);

  const stats = useMemo(() => {
    const byStatus = { draft:0, scheduled:0, pending:0, approved:0, published:0, error:0 };
    let thisWeek = 0, publishedThisWeek = 0;
    const weekAheadKey = isoDateKey(addDays(today, 7));
    const weekAgoKey   = isoDateKey(addDays(today, -7));
    for (const p of scheduledPosts) {
      if (byStatus[p.status] !== undefined) byStatus[p.status]++;
      if (p.status === "scheduled" && p.scheduledDate >= todayKey && p.scheduledDate <= weekAheadKey) thisWeek++;
      if (p.status === "published" && p.scheduledDate >= weekAgoKey && p.scheduledDate <= todayKey)  publishedThisWeek++;
    }
    return { byStatus, thisWeek, publishedThisWeek, total: scheduledPosts.length };
  }, [scheduledPosts, today, todayKey]);

  const creditsSpent   = Math.round((aiUsage.totalTokens / 1000));
  const eurSpent       = (creditsSpent * 0.01).toFixed(2);
  const connectedCount = PLATFORMS.filter((p) => isConnected(p.id)).length;

  const recentPublished = useMemo(() => scheduledPosts
    .filter((p) => p.status === "published")
    .sort((a, b) => (b.published_at || 0) - (a.published_at || 0))
    .slice(0, 6)
    .map((p, i) => {
      const hit = (p.publish_results || []).find((r) => r?.ok && r?.permalink_url);
      return {
        key: p.id||i, content: p.content, platforms: p.platforms||{},
        permalink: hit?.permalink_url||null, scheduledDate: p.scheduledDate||null, status: p.status,
      };
    }), [scheduledPosts]);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const key  = isoDateKey(date);
    return { date, key, day: scheduledPosts.filter((p) => p.scheduledDate === key) };
  }), [scheduledPosts, today]);

  const pad = isMobile ? 12 : 24;

  return (
    <div className="h-full overflow-y-auto" style={{ background:"var(--bg-primary)", padding: pad }}>
      {/* pas de maxWidth — pleine largeur du panneau de contenu */}

      {/* ══ EN-TÊTE ═══════════════════════════════════════════════════════ */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
            {dateLabel}
          </p>
          <h1 className="text-2xl font-extrabold leading-tight tracking-tight" style={{ color:"var(--text-primary)" }}>
            {user?.name ? `Bonjour, ${user.name.split(" ")[0]} 👋` : "Bonjour 👋"}
          </h1>
          <p className="mt-1 text-sm" style={{ color:"var(--text-muted)" }}>
            Voici votre tableau de bord marketing du jour.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => dispatch(setActiveView("calendar"))}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:-translate-y-px hover:shadow-md"
            style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)", color:"var(--text-primary)", cursor:"pointer" }}>
            <Calendar size={15} /> Calendrier
          </button>
          <button type="button" onClick={() => dispatch(setActiveView("creation"))}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-px hover:shadow-lg"
            style={{ background:"var(--accent-gradient)", border:"none", cursor:"pointer", boxShadow:"0 4px 14px rgba(29,63,190,.35)" }}>
            <PlusCircle size={15} /> Nouveau post
          </button>
        </div>
      </div>

      {/* ══ ALERTES ═══════════════════════════════════════════════════════ */}
      {connectedCount === 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl p-4"
          style={{ background:"rgba(29,63,190,.08)", border:"1px solid rgba(29,63,190,.25)" }}>
          <Sparkles size={18} style={{ color:"var(--accent-primary)", flexShrink:0, marginTop:1 }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color:"var(--text-primary)" }}>Connectez votre première plateforme</p>
            <p className="mt-0.5 text-xs" style={{ color:"var(--text-muted)" }}>
              Reliez Facebook, Instagram, TikTok ou LinkedIn pour commencer à publier.
            </p>
          </div>
          <button type="button" onClick={() => dispatch(setActiveView("settings"))}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-white"
            style={{ background:"var(--accent-gradient)", border:"none", cursor:"pointer" }}>
            Aller aux paramètres
          </button>
        </div>
      )}
      {stats.byStatus.error > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl p-4"
          style={{ background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.25)" }}>
          <AlertCircle size={18} style={{ color:"var(--status-error)", flexShrink:0, marginTop:1 }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color:"var(--text-primary)" }}>
              {stats.byStatus.error} erreur{stats.byStatus.error > 1 ? "s" : ""} de publication
            </p>
            <p className="mt-0.5 text-xs" style={{ color:"var(--text-muted)" }}>
              Consultez les posts échoués dans la vue Calendrier.
            </p>
          </div>
          <button type="button" onClick={() => dispatch(setActiveView("calendar"))}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background:"rgba(239,68,68,.15)", border:"none", color:"var(--status-error)", cursor:"pointer" }}>
            Voir les erreurs
          </button>
        </div>
      )}

      {/* ══ KPI ══════════════════════════════════════════════════════════ */}
      <div className="mb-5 grid gap-3" style={{ gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)" }}>
        <KpiCard icon={Zap}          label="Crédits utilisés"  value={fmt(creditsSpent)}         sub={`≈ ${eurSpent} € cette session`}         color="#1d3fbe"  onClick={() => dispatch(setActiveView("credits"))} />
        <KpiCard icon={Users}        label="Audience totale"   value={fmt(totalAudience)}         sub={`${connectedCount} plateforme${connectedCount!==1?"s":""} connectée${connectedCount!==1?"s":""}`} color="#22c55e" onClick={() => dispatch(setActiveView("settings"))} />
        <KpiCard icon={Calendar}     label="Planifiés · 7 j"   value={stats.thisWeek}             sub={`${stats.total} post${stats.total!==1?"s":""} au total`}                     color="#6366f1"  onClick={() => dispatch(setActiveView("calendar"))} />
        <KpiCard icon={CheckCircle2} label="Publiés · 7 j"     value={stats.publishedThisWeek}    sub={`${stats.byStatus.published} publié${stats.byStatus.published!==1?"s":""} au total`} color="#06b6d4" onClick={() => dispatch(setActiveView("calendar"))} />
      </div>

      {/* ══ PIPELINE + CALENDRIER + AUDIENCE ════════════════════════════ */}
      <div className="mb-5 grid gap-4" style={{ gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr" }}>
        <div className="flex flex-col gap-4">
          <PipelineBar stats={stats} />
          <WeekStrip week={week} todayKey={todayKey} onCalendar={() => dispatch(setActiveView("calendar"))} />
        </div>
        <AudienceCard
          audience={audience}
          totalAudience={totalAudience}
          onManage={() => dispatch(setActiveView("settings"))}
        />
      </div>

      {/* ══ POSTS RÉCENTS ════════════════════════════════════════════════ */}
      <div className="mb-5 overflow-hidden rounded-2xl" style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom:"1px solid var(--border-default)" }}>
          <div className="flex items-center gap-2">
            <TrendingUp size={16} style={{ color:"var(--accent-primary)" }} />
            <p className="text-sm font-bold" style={{ color:"var(--text-primary)" }}>Posts publiés récemment</p>
          </div>
          <button type="button" onClick={() => dispatch(setActiveView("calendar"))}
            className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-70"
            style={{ color:"var(--accent-primary)", border:"none", background:"none", cursor:"pointer" }}>
            Voir tout <ArrowRight size={12} />
          </button>
        </div>
        {recentPublished.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <FileText size={32} style={{ color:"var(--text-muted)", marginBottom:10 }} />
            <p className="text-sm font-medium" style={{ color:"var(--text-secondary)" }}>Aucun post publié</p>
            <p className="mt-1 text-xs" style={{ color:"var(--text-muted)" }}>Créez et publiez un post pour le voir ici.</p>
            <button type="button" onClick={() => dispatch(setActiveView("creation"))}
              className="mt-4 flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
              style={{ background:"var(--accent-gradient)", border:"none", cursor:"pointer" }}>
              <PlusCircle size={14} /> Créer le premier post
            </button>
          </div>
        ) : (
          recentPublished.map((p) => <RecentPost key={p.key} post={p} />)
        )}
      </div>

      {/* ══ ACTIONS RAPIDES ══════════════════════════════════════════════ */}
      <div>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
          Actions rapides
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)" }}>
          <ActionCard icon={PlusCircle} title="Créer un post"       description="Rédigez avec l'IA, ajoutez un média, publiez."  color="#1d3fbe" onClick={() => dispatch(setActiveView("creation"))} />
          <ActionCard icon={Bot}        title="Automatisations"     description="Règles IA planifiées qui publient pour vous."    color="#7c3aed" onClick={() => dispatch(setActiveView("automation"))} />
          <ActionCard icon={Image}      title="Médiathèque"         description="Gérez et importez tous vos fichiers."            color="#0891b2" onClick={() => dispatch(setActiveView("library"))} />
          <ActionCard icon={BarChart2}  title="Analytiques"         description="Coûts IA, cache, métriques de publication."      color="#059669" onClick={() => dispatch(setActiveView("analytics"))} />
        </div>
      </div>

    </div>
  );
}
