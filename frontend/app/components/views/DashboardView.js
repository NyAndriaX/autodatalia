"use client";

import { useEffect, useMemo, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { fetchConnections } from "../../lib/oauthService";
import {
  Sparkles,
  CalendarDays,
  Send,
  Clock,
  Coins,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Users,
  Heart,
  ExternalLink,
  Image as ImageIcon,
} from "lucide-react";
import { setActiveView } from "../../store/uiSlice";
import {
  PLATFORMS,
  PLATFORM_MAP,
  STATUS_META,
  activePlatformIds,
} from "../../lib/platforms";
import {
  parseDateKey,
  startOfToday,
  isoDateKey,
  addDays,
} from "../../lib/dateUtils";
import { useIsMobile } from "../../lib/useIsMobile";

// Same conversion used in the Credits view — keep these in sync.
const CREDIT_TO_EUR = 0.01;
const TOKEN_TO_CREDIT_PER_1K = 1;

// Locale-independent number formatter so the SSR-rendered HTML matches what
// the client renders after hydration (toLocaleString() varies by locale).
const fmt = (n) =>
  Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Landing dashboard.
 *
 * Everything above the fold is real data now — the previous version had
 * MOCK subscribers / ads / impressions / audience / top-posts that made
 * the CEO's screenshot look like a demo. Sources:
 *
 *   - Credits spent: live ai_usage ring buffer
 *   - Audience per platform: Meta /me/accounts (fan_count for Pages,
 *     followers_count for linked IG Business accounts) — surfaced
 *     through /oauth/connections.targets[].audience
 *   - Published / scheduled / drafts / errors: calendar Redux store
 *   - Recent posts (formerly "Top performing"): the last N posts whose
 *     status flipped to "published" by the manual flow or the scheduler.
 *     Carries the live permalink so the card click-throughs work.
 *
 * Insights-API-dependent metrics (impressions, ad spend) are deliberately
 * NOT rendered — better to show what we have honestly than pad the page
 * with stubs labelled "sample".
 */
export default function DashboardView() {
  const dispatch = useDispatch();
  const t = useTranslations("dashboard");
  const scheduledPosts = useSelector((s) => s.calendar.scheduledPosts);
  const aiUsage = useSelector((s) => s.ui.aiUsage);
  const isMobile = useIsMobile();

  const today = startOfToday();
  const todayKey = isoDateKey(today);

  // Live OAuth state — same source the Settings view uses, so the Dashboard
  // never lies about what's actually wired. Initial state is null so SSR
  // and the first client tick agree (no hydration mismatch on the "live"
  // badge etc.); a useEffect on mount paints from the cache instantly
  // (so the "0 connected" flash is just one tick), then a background
  // fetchConnections refreshes anything older than the TTL.
  const [oauthState, setOauthState] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchConnections().then((d) => {
      if (alive) setOauthState(d?.providers || {});
    });
    return () => {
      alive = false;
    };
  }, []);

  // Locale-formatted date — render only after mount to avoid SSR/client
  // hydration mismatch (server locale ≠ browser locale in some configs).
  const dateLabel = `${WEEKDAY_LONG[today.getDay()]}, ${
    MONTH_LONG[today.getMonth()]
  } ${today.getDate()}`;

  const PLATFORM_TO_PROVIDER = {
    facebook: "meta",
    instagram: "meta",
    tiktok: "tiktok",
    linkedin: "linkedin",
  };
  const PLATFORM_TO_TARGET_KIND = {
    facebook: "facebook_page",
    instagram: "instagram_business",
    tiktok: "tiktok_account",
    linkedin: "linkedin_member",
  };
  const isConnected = (platformId) =>
    !!oauthState?.[PLATFORM_TO_PROVIDER[platformId]]?.connected;

  // ─ Audience per platform (real) ──────────────────────────────────
  // Walk /oauth/connections.providers.*.targets and sum the `audience`
  // numbers Meta hands us. A connected platform with no audience number
  // (Meta still propagating, IG without followers_count) shows up as 0.
  const audience = useMemo(() => {
    const out = PLATFORMS.map((p) => {
      const provider = oauthState?.[PLATFORM_TO_PROVIDER[p.id]];
      const targets = provider?.targets || [];
      const kind = PLATFORM_TO_TARGET_KIND[p.id];
      const matching = targets.filter((t) => t.kind === kind);
      const count = matching.reduce((sum, t) => sum + (t.audience || 0), 0);
      return {
        platform: p.id,
        count,
        connected: !!provider?.connected,
        // accountCount lets the row honestly say "no Pages yet" vs "0 fans"
        accountCount: matching.length,
      };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthState]);

  const totalAudience = audience.reduce((sum, a) => sum + a.count, 0);

  // ─ Calendar-derived stats (real) ──────────────────────────────────
  const stats = useMemo(() => {
    const byStatus = {
      draft: 0,
      scheduled: 0,
      pending: 0,
      approved: 0,
      published: 0,
      error: 0,
    };
    let thisWeek = 0;
    let publishedThisWeek = 0;
    const weekAheadKey = isoDateKey(addDays(today, 7));
    const weekAgoKey = isoDateKey(addDays(today, -7));
    for (const p of scheduledPosts) {
      if (byStatus[p.status] !== undefined) byStatus[p.status] += 1;
      if (
        p.status === "scheduled" &&
        p.scheduledDate >= todayKey &&
        p.scheduledDate <= weekAheadKey
      ) {
        thisWeek += 1;
      }
      if (
        p.status === "published" &&
        p.scheduledDate >= weekAgoKey &&
        p.scheduledDate <= todayKey
      ) {
        publishedThisWeek += 1;
      }
    }
    return { byStatus, thisWeek, publishedThisWeek, total: scheduledPosts.length };
  }, [scheduledPosts, today, todayKey]);

  // ─ Credits → EUR (real, from AI usage) ────────────────────────────
  const creditsSpent = Math.round(
    (aiUsage.totalTokens / 1000) * TOKEN_TO_CREDIT_PER_1K
  );
  const eurSpent = creditsSpent * CREDIT_TO_EUR;

  // ─ Recent published posts (real) ─────────────────────────────────
  // The scheduler patches publish_results onto a Post when it fires; the
  // manual /publish path also writes them. Either way we get a real list
  // ordered by published_at, with at least one permalink for click-through.
  const recentPublished = useMemo(() => {
    return scheduledPosts
      .filter((p) => p.status === "published")
      .sort((a, b) => {
        // published_at sorts when present; otherwise fall back to date
        const pa = a.published_at || 0;
        const pb = b.published_at || 0;
        if (pa !== pb) return pb - pa;
        return (b.scheduledDate || "").localeCompare(a.scheduledDate || "");
      })
      .slice(0, 4)
      .map((p) => {
        const firstHit = (p.publish_results || []).find(
          (r) => r?.ok && r?.permalink_url
        );
        return {
          id: p.id,
          content: p.content,
          platforms: p.platforms || {},
          permalink: firstHit?.permalink_url || null,
          publishedAt: p.published_at || null,
          targetLabel: firstHit?.target_label || null,
        };
      });
  }, [scheduledPosts]);

  // ─ 7-day mini calendar ────────────────────────────────────────────
  const week = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      const key = isoDateKey(date);
      const day = scheduledPosts.filter((p) => p.scheduledDate === key);
      return { date, key, day };
    });
  }, [scheduledPosts, today]);

  const connectedCount = PLATFORMS.filter((p) => isConnected(p.id)).length;

  // Responsive padding — tight on phones so the KPI cards aren't pinched.
  const pagePadding = isMobile ? 12 : 24;

  return (
    <div
      className="h-full overflow-y-auto animate-fade-in"
      style={{ padding: pagePadding }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Hero */}
        <div className="mb-5 md:mb-6">
          <h1
            className="text-xl md:text-2xl font-bold mb-1"
            style={{ color: "var(--text-primary)" }}
          >
            Welcome back
          </h1>
          <p className="text-xs md:text-sm" style={{ color: "var(--text-muted)" }}>
            Today at a glance{dateLabel ? ` — ${dateLabel}` : ""}
          </p>
        </div>

        {/* Top KPIs — all real. Two-up on phones, four-up on desktop. */}
        <div
          className="grid gap-3 mb-5 md:mb-6"
          style={{
            gridTemplateColumns: isMobile
              ? "repeat(2, minmax(0, 1fr))"
              : "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <BigKpi
            icon={Coins}
            label={t("creditsSpent")}
            value={fmt(creditsSpent)}
            sub={`≈ €${eurSpent.toFixed(2)}`}
            accent="var(--accent-primary)"
            onClick={() => dispatch(setActiveView("credits"))}
            live
          />
          <BigKpi
            icon={Users}
            label={t("totalAudience")}
            value={fmt(totalAudience)}
            sub={
              connectedCount > 0
                ? `Across ${connectedCount} connected platform${
                    connectedCount === 1 ? "" : "s"
                  }`
                : "Connect a platform to see real numbers"
            }
            accent="var(--status-approved)"
            onClick={() => dispatch(setActiveView("settings"))}
            live={connectedCount > 0}
          />
          <BigKpi
            icon={CalendarDays}
            label="Scheduled · 7d"
            value={stats.thisWeek}
            sub={`${stats.total} total in calendar`}
            accent="var(--accent-secondary, #6366f1)"
            onClick={() => dispatch(setActiveView("calendar"))}
            live
          />
          <BigKpi
            icon={CheckCircle2}
            label="Published · 7d"
            value={stats.publishedThisWeek}
            sub={`${stats.byStatus.published} all-time`}
            accent="var(--status-approved)"
            onClick={() => dispatch(setActiveView("calendar"))}
            live
          />
        </div>

        {/* Workflow stat row — drilldown counts. Hidden when empty for
            scheduled/published so the row doesn't double up with the KPIs. */}
        <div
          className="grid gap-3 mb-5 md:mb-6"
          style={{
            gridTemplateColumns: isMobile
              ? "repeat(2, minmax(0, 1fr))"
              : "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <SmallKpi
            icon={Clock}
            label={t("pendingApproval")}
            value={stats.byStatus.pending}
            sub={`${stats.byStatus.draft} drafts`}
            tone={stats.byStatus.pending > 0 ? "warn" : undefined}
          />
          <SmallKpi
            icon={Sparkles}
            label={t("aiCacheHits")}
            value={aiUsage.cacheHits}
            sub={`${aiUsage.calls} calls`}
            onClick={() => dispatch(setActiveView("analytics"))}
          />
          <SmallKpi
            icon={Send}
            label={t("drafts")}
            value={stats.byStatus.draft}
            sub="awaiting schedule"
          />
          <SmallKpi
            icon={AlertCircle}
            label={t("errors")}
            value={stats.byStatus.error}
            tone={stats.byStatus.error > 0 ? "error" : undefined}
            onClick={
              stats.byStatus.error > 0
                ? () => dispatch(setActiveView("calendar"))
                : undefined
            }
          />
        </div>

        {/* 7-day calendar preview — scrolls horizontally on phones so the
            day cells stay readable instead of pinched. */}
        <Section
          title="Next 7 days"
          action={
            <button
              className="text-xs inline-flex items-center gap-1"
              style={{ color: "var(--accent-primary)" }}
              onClick={() => dispatch(setActiveView("calendar"))}
            >
              Open calendar <ArrowRight size={12} />
            </button>
          }
        >
          <div
            style={{
              overflowX: isMobile ? "auto" : "visible",
              margin: isMobile ? "0 -6px" : 0,
              padding: isMobile ? "0 6px" : 0,
            }}
          >
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: "repeat(7, 1fr)",
                minWidth: isMobile ? 560 : "auto",
              }}
            >
              {week.map(({ date, key, day }) => {
                const isToday = key === todayKey;
                return (
                  <button
                    key={key}
                    onClick={() => dispatch(setActiveView("calendar"))}
                    className="rounded-lg text-left p-2 transition-colors"
                    style={{
                      background: isToday
                        ? "var(--bg-elevated)"
                        : "var(--bg-secondary)",
                      border: `1px solid ${
                        isToday ? "var(--accent-primary)" : "var(--border-default)"
                      }`,
                      minHeight: 96,
                    }}
                  >
                    <div
                      className="text-[10px] uppercase tracking-wider"
                      style={{
                        color: isToday
                          ? "var(--accent-primary)"
                          : "var(--text-muted)",
                      }}
                    >
                      {WEEKDAY_SHORT[date.getDay()]}
                    </div>
                    <div
                      className="text-lg font-bold leading-tight"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {date.getDate()}
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5">
                      {day.slice(0, 2).map((post) => {
                        const ids = activePlatformIds(post.platforms);
                        const status = STATUS_META[post.status] || STATUS_META.draft;
                        return (
                          <div
                            key={post.id}
                            className="flex items-center gap-1 text-[10px] px-1 py-0.5 rounded"
                            style={{
                              background: "var(--bg-card)",
                              color: "var(--text-secondary)",
                            }}
                            title={post.content}
                          >
                            <span
                              className="w-1 h-1 rounded-full shrink-0"
                              style={{ background: status.colorVar }}
                              aria-hidden="true"
                            />
                            <span className="truncate flex-1">
                              {post.content || "(empty)"}
                            </span>
                            {ids[0] && (
                              <span style={{ color: PLATFORM_MAP[ids[0]].color }}>
                                ·
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {day.length > 2 && (
                        <div
                          className="text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          +{day.length - 2} more
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Section>

        {/* Two-col: Audience (real) + Recent published posts (real) */}
        <div
          className="grid gap-4 mb-4 mt-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
        >
          <Section
            title={t("audienceByPlatform")}
            action={
              <button
                className="text-xs inline-flex items-center gap-1"
                style={{ color: "var(--accent-primary)" }}
                onClick={() => dispatch(setActiveView("settings"))}
              >
                Manage <ArrowRight size={12} />
              </button>
            }
          >
            {totalAudience === 0 && connectedCount === 0 ? (
              <EmptyHint
                icon={Users}
                title={t("noPlatformsConnected")}
                body="Connect Facebook or Instagram in Settings to see real follower counts here."
                cta="Open Settings"
                onCta={() => dispatch(setActiveView("settings"))}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {audience.map((row) => {
                  const p = PLATFORM_MAP[row.platform];
                  const Icon = p.icon;
                  const maxCount = Math.max(
                    1,
                    ...audience.map((r) => r.count)
                  );
                  const pct = (row.count / maxCount) * 100;
                  return (
                    <div key={row.platform} className="flex items-center gap-3">
                      <Icon
                        size={14}
                        style={{ color: p.color, flexShrink: 0, opacity: row.connected ? 1 : 0.4 }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span style={{ color: "var(--text-secondary)" }}>
                            {p.label}
                          </span>
                          <span
                            className="font-semibold tabular-nums"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {row.connected ? (
                              row.accountCount === 0 ? (
                                <span
                                  className="text-[10px]"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  no accounts
                                </span>
                              ) : (
                                fmt(row.count)
                              )
                            ) : (
                              <span
                                className="text-[10px] uppercase tracking-wider"
                                style={{ color: "var(--text-muted)" }}
                              >
                                not connected
                              </span>
                            )}
                          </span>
                        </div>
                        <div
                          className="h-1.5 rounded-full overflow-hidden"
                          style={{ background: "var(--bg-elevated)" }}
                        >
                          <div
                            className="h-full"
                            style={{
                              width: `${pct}%`,
                              background: p.color,
                              opacity: row.connected ? 1 : 0.3,
                              transition: "width .3s",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title={t("recentPublishedPosts")}
            action={
              <button
                className="text-xs inline-flex items-center gap-1"
                style={{ color: "var(--accent-primary)" }}
                onClick={() => dispatch(setActiveView("calendar"))}
              >
                See all <ArrowRight size={12} />
              </button>
            }
          >
            {recentPublished.length === 0 ? (
              <EmptyHint
                icon={Send}
                title={t("nothingPublishedYet")}
                body="Posts you publish manually or via the scheduler show up here with click-through links."
                cta="Create a post"
                onCta={() => dispatch(setActiveView("creation"))}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {recentPublished.map((post) => {
                  const ids = activePlatformIds(post.platforms);
                  const primary = ids[0] ? PLATFORM_MAP[ids[0]] : null;
                  const Icon = primary?.icon || ImageIcon;
                  const card = (
                    <div
                      className="flex items-start gap-2.5 px-3 py-2 rounded-lg"
                      style={{
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-default)",
                      }}
                    >
                      <div
                        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                        style={{ background: "var(--bg-elevated)" }}
                      >
                        <Icon
                          size={14}
                          style={{ color: primary?.color || "var(--text-muted)" }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-xs"
                          style={{
                            color: "var(--text-primary)",
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 2,
                            overflow: "hidden",
                          }}
                        >
                          {post.content || "(empty post)"}
                        </p>
                        <div
                          className="flex items-center gap-2 mt-1 text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {post.targetLabel && (
                            <span className="truncate">{post.targetLabel}</span>
                          )}
                          {post.permalink && (
                            <span
                              className="inline-flex items-center gap-1"
                              style={{ color: "var(--accent-primary)" }}
                            >
                              View <ExternalLink size={10} />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                  return post.permalink ? (
                    <a
                      key={post.id}
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                      style={{ textDecoration: "none" }}
                      title={t("openLivePost")}
                    >
                      {card}
                    </a>
                  ) : (
                    <div key={post.id}>{card}</div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        {/* Connected platforms + AI usage strip */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
        >
          <Section
            title={t("connectedPlatforms")}
            action={
              <button
                className="text-xs inline-flex items-center gap-1"
                style={{ color: "var(--accent-primary)" }}
                onClick={() => dispatch(setActiveView("settings"))}
              >
                Manage <ArrowRight size={12} />
              </button>
            }
          >
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              {connectedCount} / {PLATFORMS.length} connected
            </p>
            <div className="flex flex-col gap-1.5">
              {PLATFORMS.map((p) => {
                const Icon = p.icon;
                const connected = isConnected(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border-default)",
                    }}
                  >
                    <Icon size={15} style={{ color: p.color }} />
                    <span
                      className="text-sm flex-1"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {p.label}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-wider font-semibold"
                      style={{
                        color: connected
                          ? "var(--status-approved)"
                          : "var(--text-muted)",
                      }}
                    >
                      {connected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title={t("aiUsageSession")}
            action={
              <button
                className="text-xs inline-flex items-center gap-1"
                style={{ color: "var(--accent-primary)" }}
                onClick={() => dispatch(setActiveView("analytics"))}
              >
                Analytics <ArrowRight size={12} />
              </button>
            }
          >
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              }}
            >
              <MiniStat
                icon={Sparkles}
                label={t("aiCalls")}
                value={aiUsage.calls}
              />
              <MiniStat
                icon={Coins}
                label={t("tokens")}
                value={fmt(aiUsage.totalTokens)}
              />
              <MiniStat
                icon={Send}
                label={t("cacheHits")}
                value={aiUsage.cacheHits}
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Building blocks ────────────────────────── */

function BigKpi({ icon: Icon, label, value, sub, accent, onClick, live, positive }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="card text-left transition-transform"
      style={{
        padding: 16,
        cursor: onClick ? "pointer" : "default",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        if (onClick) e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${accent}1a`, color: accent }}
        >
          <Icon size={15} />
        </div>
        {live && (
          <span
            className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              background: "rgba(34,197,94,0.10)",
              color: "var(--status-approved)",
            }}
            title="Live data — updates as you use the app"
          >
            live
          </span>
        )}
      </div>
      <p
        className="text-[11px] uppercase tracking-wider mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </p>
      <p
        className="text-xl md:text-2xl font-bold leading-tight tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </p>
      {sub && (
        <p
          className="text-[11px] mt-1"
          style={{
            color:
              positive === true
                ? "var(--status-approved)"
                : positive === false
                ? "var(--status-error)"
                : "var(--text-tertiary)",
          }}
        >
          {sub}
        </p>
      )}
    </button>
  );
}

function SmallKpi({ icon: Icon, label, value, sub, tone, onClick }) {
  const tones = {
    ok: "var(--status-approved)",
    warn: "var(--status-pending)",
    error: "var(--status-error)",
  };
  const accent = tone ? tones[tone] : "var(--accent-primary)";
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="card text-left"
      style={{ padding: 14, cursor: onClick ? "pointer" : "default" }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={13} style={{ color: accent }} />
        <span
          className="text-[11px] uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
      </div>
      <p
        className="text-lg md:text-xl font-bold leading-tight tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </p>
      {sub && (
        <p
          className="text-[10px] mt-0.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          {sub}
        </p>
      )}
    </button>
  );
}

function Section({ title, action, children }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }) {
  return (
    <div
      className="px-3 py-2.5 rounded-lg"
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} style={{ color: "var(--accent-primary)" }} />
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
      </div>
      <p
        className="text-base font-bold leading-tight tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
  );
}

/* Empty-state hint — shown when a section has no real data yet, with a
   single clear path to make it have some. Better than rendering a fake
   row, which is what the previous MOCK approach did. */
function EmptyHint({ icon: Icon, title, body, cta, onCta }) {
  return (
    <div
      className="flex flex-col items-start gap-2 px-3 py-4 rounded-lg"
      style={{
        background: "var(--bg-secondary)",
        border: "1px dashed var(--border-default)",
      }}
    >
      <Icon size={18} style={{ color: "var(--text-muted)" }} />
      <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      <p
        className="text-[11px]"
        style={{ color: "var(--text-muted)", lineHeight: 1.5 }}
      >
        {body}
      </p>
      {cta && (
        <button
          className="text-xs font-medium mt-1 inline-flex items-center gap-1"
          style={{ color: "var(--accent-primary)" }}
          onClick={onCta}
        >
          {cta} <ArrowRight size={11} />
        </button>
      )}
    </div>
  );
}
