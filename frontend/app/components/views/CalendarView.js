"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Pencil,
  CalendarDays,
  CalendarRange,
  Film,
  ImagePlus,
  ExternalLink,
} from "lucide-react";
import ScheduleModal from "./ScheduleModal";
import PostEditorPopup from "./PostEditorPopup";
import { useIsMobile } from "../../lib/useIsMobile";
import {
  setCalendarView,
  setCursor,
  goToToday,
  seedScheduledPosts,
  togglePlatformFilter,
  toggleStatusFilter,
} from "../../store/calendarSlice";
import {
  schedulePostThunk,
  reschedulePostThunk,
  cancelScheduleThunk,
  updatePostThunk,
} from "../../store/calendarThunks";
import {
  PLATFORMS,
  PLATFORM_MAP,
  STATUSES,
  STATUS_META,
  STATUS_LABEL_KEYS,
  activePlatformIds,
} from "../../lib/platforms";
import {
  isoDateKey,
  startOfToday,
  parseDateKey,
  addMonths,
  addWeeks,
  addDays,
  buildMonthMatrix,
  getWeekDays,
  formatMonthLabel,
  formatWeekLabel,
  weekdayHeaders,
} from "../../lib/dateUtils";

// Density bumped from 3 → 5 so the calendar earns its real estate. Users
// can scroll inside a cell when there's more, but at 3 chips/day a busy
// week had "+X more" everywhere and the calendar lost its purpose.
const MAX_CHIPS_PER_DAY = 5;
const DND_MIME = "application/x-datalia-post";

/* ——— Demo seed: a few posts around today so the view is alive offline ——— */
function buildSeed() {
  const base = startOfToday();
  const at = (delta) => isoDateKey(addDays(base, delta));
  return [
    { content: "🌞 Summer sale launch — 20% off all plans this week!", platforms: { facebook: true, instagram: true }, status: "approved", scheduledDate: at(0) },
    { content: "Did you know? 73% of marketers automate their posting.", platforms: { linkedin: true }, status: "pending", scheduledDate: at(2) },
    { content: "Behind the scenes of our product shoot 🎬", platforms: { instagram: true, tiktok: true }, status: "draft", scheduledDate: at(2) },
    { content: "New feature drop: AI captions are here.", platforms: { facebook: true, linkedin: true }, status: "published", scheduledDate: at(-3) },
    { content: "Weekend tip thread 🧵 — scheduling like a pro.", platforms: { tiktok: true }, status: "draft", scheduledDate: at(5) },
    { content: "Customer story: how Acme grew 3x with DATALIA.", platforms: { linkedin: true, facebook: true }, status: "error", scheduledDate: at(9) },
  ];
}

/* ——— A single scheduled-post chip (draggable + editable + cancellable) ——— */
function PostChip({ post, onEdit, onCancel, compact }) {
  const t = useTranslations("calendar");
  const activeIds = activePlatformIds(post.platforms);
  const primary = activeIds[0] ? PLATFORM_MAP[activeIds[0]] : null;
  const status = STATUS_META[post.status] ?? STATUS_META.draft;
  // First successful publish on a fired post (the scheduler writes results
  // back to the post via PATCH). The chip surfaces this as an external-link
  // icon so the user can jump to the live post without opening the editor.
  const firstPermalink = Array.isArray(post.publish_results)
    ? post.publish_results.find((r) => r?.ok && r?.permalink_url)?.permalink_url
    : null;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, post.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit(post);
      }}
      className="group/chip flex items-center gap-1.5 rounded-md cursor-grab active:cursor-grabbing"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        borderLeft: `3px solid ${primary ? primary.color : "var(--accent-primary)"}`,
        padding: compact ? "3px 6px" : "5px 8px",
      }}
      title={`${status.label} • ${activeIds
        .map((id) => PLATFORM_MAP[id].label)
        .join(", ") || "No platform"} • Double-click to edit`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: status.colorVar }}
      />
      {post.media?.length > 0 &&
        (post.media.some((m) => m.kind === "video") ? (
          <Film size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        ) : (
          <ImagePlus size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        ))}
      <span
        className="flex-1 truncate"
        style={{
          color: "var(--text-secondary)",
          fontSize: compact ? "0.7rem" : "0.75rem",
          lineHeight: 1.3,
        }}
      >
        {post.content || "(empty post)"}
      </span>
      {firstPermalink && (
        <a
          href={firstPermalink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded"
          style={{ color: "var(--accent-primary)" }}
          title={t("openLive") || "Open the live post"}
          aria-label={t("openLive") || "Open the live post"}
        >
          <ExternalLink size={11} />
        </a>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit(post);
        }}
        className="opacity-0 group-hover/chip:opacity-100 transition-opacity shrink-0 rounded"
        style={{ color: "var(--text-muted)" }}
        title={t("editPost") || "Edit post"}
        aria-label={t("editPost") || "Edit post"}
      >
        <Pencil size={11} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCancel(post.id);
        }}
        className="opacity-0 group-hover/chip:opacity-100 transition-opacity shrink-0 rounded"
        style={{ color: "var(--text-muted)" }}
        title={t("cancelSchedule") || "Cancel schedule"}
        aria-label={t("cancelSchedule") || "Cancel schedule"}
      >
        <X size={12} />
      </button>
    </div>
  );
}

/* ——— A day cell: drop target + quick-create affordance ——— */
function DayCell({ day, posts, isWeek, onDropPost, onEdit, onCancel, onQuickCreate, flashToday }) {
  const t = useTranslations("calendar");
  const [isOver, setIsOver] = useState(false);

  const overflow = !isWeek && posts.length > MAX_CHIPS_PER_DAY;
  const shown = overflow ? posts.slice(0, MAX_CHIPS_PER_DAY) : posts;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!isOver) setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const id = e.dataTransfer.getData(DND_MIME);
        if (id) onDropPost(id, day.key);
      }}
      // `flashToday` is bumped each time the user clicks the Today button.
      // Keying the cell on it remounts it, replaying the fade-in animation
      // so the user gets visible confirmation even when already on today.
      key={day.isToday ? `today-${flashToday}` : undefined}
      className={`group/cell flex flex-col gap-1 p-1 transition-colors ${
        day.isToday ? "animate-fade-in" : ""
      }`}
      style={{
        background: isOver
          ? "var(--bg-card-hover)"
          : day.inMonth
          ? "var(--bg-card)"
          : "var(--bg-secondary)",
        border: day.isToday
          ? "2px solid var(--accent-primary)"
          : "1px solid var(--border-default)",
        borderRadius: "var(--radius-sm)",
        height: isWeek ? undefined : "100%",
        minHeight: 0,
        overflow: "hidden",
        flex: isWeek ? "1 1 0" : undefined,
        opacity: day.inMonth ? 1 : 0.5,
      }}
    >
      {/* Compact header row — date number sits flush left, plus button
          flush right. Dropped the previous filled "today circle" chrome
          so the date gets more breathing room without losing the today
          cue (the surrounding 2px accent border already calls it out). */}
      <div className="flex items-center justify-between shrink-0 px-1 pt-0.5">
        <span
          className="text-xs font-bold tabular-nums"
          style={{
            color: day.isToday
              ? "var(--accent-primary)"
              : day.inMonth
              ? "var(--text-secondary)"
              : "var(--text-muted)",
          }}
        >
          {day.date.getDate()}
        </span>
        <button
          onClick={() => onQuickCreate(day.key)}
          // On phones nothing triggers :hover, so the + button needs to be
          // perma-visible there. Keep the hover-fade on pointer devices so
          // the chrome stays calm.
          className="opacity-30 group-hover/cell:opacity-100 transition-opacity rounded"
          style={{ color: "var(--text-muted)" }}
          title={t("addPost")}
          aria-label={t("addPost")}
        >
          <Plus size={13} />
        </button>
      </div>

      <div
        className="flex flex-col gap-0.5 overflow-y-auto px-0.5"
        style={{ flex: "1 1 0", minHeight: 0 }}
      >
        {shown.map((p) => (
          <PostChip
            key={p.id}
            post={p}
            onEdit={onEdit}
            onCancel={onCancel}
            compact={!isWeek}
          />
        ))}
        {overflow && (
          <span
            className="text-xs px-1"
            style={{ color: "var(--text-muted)" }}
          >
            +{posts.length - MAX_CHIPS_PER_DAY} more
          </span>
        )}
      </div>
    </div>
  );
}

/* ——— Filter chips (platforms + statuses) ——— */
function FilterChip({ active, color, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium px-2.5 py-1 rounded-full transition-all"
      style={{
        background: active ? "rgba(99, 102, 241, 0.12)" : "transparent",
        border: `1px solid ${active ? "var(--border-active)" : "var(--border-default)"}`,
        color: active ? "var(--text-primary)" : "var(--text-muted)",
      }}
      title={`Toggle ${label}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: color, opacity: active ? 1 : 0.4 }}
        />
        {label}
      </span>
    </button>
  );
}

export default function CalendarView() {
  const dispatch = useDispatch();
  const t = useTranslations("calendar");
  const tDashboard = useTranslations("dashboard");
  const { scheduledPosts, view, cursor, filters, seeded } = useSelector(
    (s) => s.calendar
  );
  const [quickCreateDate, setQuickCreateDate] = useState(null);
  const [editingPost, setEditingPost] = useState(null);
  // Every "Today" click bumps this counter. Day cells with `isToday`
  // remount when it changes, replaying the fade-in animation so the
  // user gets visual confirmation even when they were already on today.
  const [flashToday, setFlashToday] = useState(0);
  const onTodayClick = useCallback(() => {
    dispatch(goToToday());
    setFlashToday((n) => n + 1);
  }, [dispatch]);
  const isMobile = useIsMobile();
  // Below the 7-col grid's comfortable width, scroll horizontally instead
  // of squashing day cells to unusable widths.
  const gridMinWidth = isMobile ? 720 : undefined;

  // One-time: anchor the cursor on today and seed demo posts (offline-friendly,
  // same philosophy as the aiService / authService mocks).
  useEffect(() => {
    if (!cursor) dispatch(goToToday());
    if (!seeded) dispatch(seedScheduledPosts(buildSeed()));
  }, [cursor, seeded, dispatch]);

  const cursorDate = cursor ? parseDateKey(cursor) : startOfToday();

  const visiblePosts = useMemo(() => {
    return scheduledPosts.filter((p) => {
      if (!filters.statuses[p.status]) return false;
      const ids = activePlatformIds(p.platforms);
      // Keep if it targets at least one platform that's currently shown.
      return ids.length === 0 || ids.some((id) => filters.platforms[id]);
    });
  }, [scheduledPosts, filters]);

  const postsByDay = useMemo(() => {
    const map = {};
    for (const p of visiblePosts) {
      (map[p.scheduledDate] ||= []).push(p);
    }
    return map;
  }, [visiblePosts]);

  const days = useMemo(
    () =>
      view === "month"
        ? buildMonthMatrix(cursorDate).flat()
        : getWeekDays(cursorDate),
    [view, cursorDate]
  );

  const navigate = useCallback(
    (dir) => {
      const next =
        view === "month"
          ? addMonths(cursorDate, dir)
          : addWeeks(cursorDate, dir);
      dispatch(setCursor(isoDateKey(next)));
    },
    [view, cursorDate, dispatch]
  );

  const onDropPost = useCallback(
    (id, dateKey) => dispatch(reschedulePostThunk({ id, date: dateKey })),
    [dispatch]
  );
  const onCancel = useCallback(
    (id) => dispatch(cancelScheduleThunk(id)),
    [dispatch]
  );
  const onEdit = useCallback((post) => setEditingPost(post), []);

  const headers = weekdayHeaders();

  return (
    <div
      className="h-full flex flex-col animate-fade-in"
      style={{ padding: isMobile ? 12 : 20, overflowX: isMobile ? "auto" : undefined }}
    >
      {/* Toolbar — on phones the month label drops to its own row so the
          arrows + view toggle don't end up squeezed against each other. */}
      {isMobile ? (
        <div className="shrink-0 mb-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              className="btn-secondary text-sm"
              style={{ padding: "6px 12px" }}
              onClick={onTodayClick}
            >
              {t("today")}
            </button>
            <div className="flex items-center gap-1">
              <button
                className="btn-ghost"
                style={{ padding: 8 }}
                onClick={() => navigate(-1)}
                aria-label={t("previous")}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="btn-ghost"
                style={{ padding: 8 }}
                onClick={() => navigate(1)}
                aria-label={t("next")}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div
              className="flex items-center gap-1 rounded-lg p-0.5"
              style={{ background: "var(--bg-secondary)" }}
            >
              {[
                { id: "month", label: "M", Icon: CalendarDays, full: t("month") },
                { id: "week", label: "W", Icon: CalendarRange, full: t("week") },
              ].map(({ id, label, Icon, full }) => {
                const on = view === id;
                return (
                  <button
                    key={id}
                    onClick={() => dispatch(setCalendarView(id))}
                    aria-label={full}
                    className="text-sm font-medium px-2.5 py-1 rounded-md inline-flex items-center gap-1"
                    style={{
                      background: on ? "var(--bg-card)" : "transparent",
                      color: on ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <h2
            className="text-base font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            {view === "month"
              ? formatMonthLabel(cursorDate)
              : formatWeekLabel(cursorDate)}
          </h2>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 shrink-0 mb-4">
          <button className="btn-secondary" onClick={onTodayClick}>
            {t("today")}
          </button>
          <div className="flex items-center gap-1">
            <button
              className="btn-ghost"
              style={{ padding: 8 }}
              onClick={() => navigate(-1)}
              aria-label={t("previous")}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="btn-ghost"
              style={{ padding: 8 }}
              onClick={() => navigate(1)}
              aria-label={t("next")}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <h2
            className="text-lg font-bold flex-1"
            style={{ color: "var(--text-primary)" }}
          >
            {view === "month"
              ? formatMonthLabel(cursorDate)
              : formatWeekLabel(cursorDate)}
          </h2>

          <div
            className="flex items-center gap-1 rounded-lg p-1"
            style={{ background: "var(--bg-secondary)" }}
          >
            {[
              { id: "month", label: t("month"), Icon: CalendarDays },
              { id: "week", label: t("week"), Icon: CalendarRange },
            ].map(({ id, label, Icon }) => {
              const on = view === id;
              return (
                <button
                  key={id}
                  onClick={() => dispatch(setCalendarView(id))}
                  className="text-sm font-medium px-3 py-1.5 rounded-md transition-all inline-flex items-center gap-1.5"
                  style={{
                    background: on ? "var(--bg-card)" : "transparent",
                    color: on ? "var(--text-primary)" : "var(--text-muted)",
                    boxShadow: on ? "var(--shadow-dropdown)" : "none",
                  }}
                >
                  <Icon size={15} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters — on phones the section labels eat too much space, so
          the chips run edge-to-edge in a single horizontal scroll row
          (familiar pattern from Apple/Google calendars). */}
      {isMobile ? (
        <div
          className="shrink-0 mb-3"
          style={{
            overflowX: "auto",
            margin: "0 -12px",
            padding: "0 12px",
            // Hide the scrollbar on the chip strip — the chips themselves
            // signal scrollability via the right edge fading off.
            scrollbarWidth: "none",
          }}
        >
          <div
            className="flex items-center gap-2"
            style={{ width: "max-content" }}
          >
            {PLATFORMS.map((p) => (
              <FilterChip
                key={p.id}
                active={filters.platforms[p.id]}
                color={p.color}
                label={p.label}
                onClick={() => dispatch(togglePlatformFilter(p.id))}
              />
            ))}
            <span
              className="w-px h-4 mx-1"
              style={{ background: "var(--border-default)" }}
              aria-hidden="true"
            />
            {STATUSES.map((s) => (
              <FilterChip
                key={s}
                active={filters.statuses[s]}
                color={STATUS_META[s].colorVar}
                label={tDashboard(STATUS_LABEL_KEYS[s] ?? "statusDraft")}
                onClick={() => dispatch(toggleStatusFilter(s))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 shrink-0 mb-4">
          <span
            className="text-xs font-semibold uppercase tracking-wider mr-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("platforms")}
          </span>
          {PLATFORMS.map((p) => (
            <FilterChip
              key={p.id}
              active={filters.platforms[p.id]}
              color={p.color}
              label={p.label}
              onClick={() => dispatch(togglePlatformFilter(p.id))}
            />
          ))}
          <span
            className="text-xs font-semibold uppercase tracking-wider mx-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("status")}
          </span>
          {STATUSES.map((s) => (
            <FilterChip
              key={s}
              active={filters.statuses[s]}
              color={STATUS_META[s].colorVar}
              label={tDashboard(STATUS_LABEL_KEYS[s] ?? "statusDraft")}
              onClick={() => dispatch(toggleStatusFilter(s))}
            />
          ))}
        </div>
      )}

      {/* Weekday header */}
      <div
        className="grid shrink-0 mb-2"
        style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 6, minWidth: gridMinWidth }}
      >
        {headers.map((h) => (
          <div
            key={h}
            className="text-xs font-semibold text-center uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        className="grid flex-1"
        style={{
          gridTemplateColumns: "repeat(7, 1fr)",
          // Month: 6 equal rows that always fill the area (uniform height).
          // Week: a single full-height row of 7 day columns.
          gridTemplateRows: view === "month" ? "repeat(6, 1fr)" : "1fr",
          gap: 6,
          overflowY: view === "month" ? "hidden" : "auto",
          minHeight: 0,
          minWidth: gridMinWidth,
        }}
      >
        {days.map((day) => (
          <DayCell
            key={day.key}
            day={day}
            posts={postsByDay[day.key] || []}
            isWeek={view === "week"}
            onDropPost={onDropPost}
            onEdit={onEdit}
            onCancel={onCancel}
            onQuickCreate={setQuickCreateDate}
            flashToday={flashToday}
          />
        ))}
      </div>

      {quickCreateDate && (
        <ScheduleModal
          initialDate={quickCreateDate}
          onClose={() => setQuickCreateDate(null)}
          onSchedule={(post) => {
            dispatch(schedulePostThunk({ post, date: post.scheduledDate }));
            setQuickCreateDate(null);
          }}
        />
      )}

      {editingPost && (
        <PostEditorPopup
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSave={(patch) => {
            dispatch(updatePostThunk({ id: editingPost.id, patch }));
            setEditingPost(null);
          }}
          onDelete={(id) => {
            dispatch(cancelScheduleThunk(id));
            setEditingPost(null);
          }}
        />
      )}
    </div>
  );
}
