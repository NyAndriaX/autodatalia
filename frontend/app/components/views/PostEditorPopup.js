"use client";
import { btnPrimary, btnSecondary, btnGhost, inputField, card, glassCard, fadeIn, badgeDraft } from "../../lib/uiClasses";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
  X,
  Trash2,
  Upload,
  Film,
  ImagePlus,
  Sparkles,
  Heart,
  MessageCircle,
  Share2,
  Hash,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  PLATFORMS,
  PLATFORM_MAP,
  STATUS_META,
  RATIOS_BY_PLATFORM,
  parseRatio,
  activePlatformIds,
} from "../../lib/platforms";
import { isoDateKey, parseDateKey, startOfToday } from "../../lib/dateUtils";
import { addNotification, addTokenUsage, recordCacheHit } from "../../store/uiSlice";
import TikTokOptionsPanel from "./TikTokOptionsPanel";
import {
  ACCEPTED_TYPES,
  toMediaItem,
  uploadToBackend,
  validateFile,
  revokeMediaItem,
} from "../../lib/uploadService";
import { generateContent } from "../../lib/aiService";
import {
  generateImageAsset,
  generateVideoAsset,
} from "../../lib/mediaGenerationService";
import { getScheduleTimezone } from "../../lib/timezone";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";
import RatioPicker from "./RatioPicker";

/**
 * Buffer-style edit popup opened from the calendar. Splits the dialog into:
 *  - left  : editable post fields (content, media, platforms, schedule, status)
 *  - right : platform-tabbed live preview that re-renders on every change
 *
 * For *creating* new posts the calendar still uses the compact ScheduleModal;
 * this richer popup is reserved for editing existing scheduled posts where
 * "see what it will look like" matters.
 */
export default function PostEditorPopup({ post, onClose, onSave, onDelete }) {
  const dispatch = useDispatch();
  const [content, setContent] = useState(post.content ?? "");
  const [platforms, setPlatforms] = useState(
    post.platforms ?? { facebook: true }
  );
  const [date, setDate] = useState(
    post.scheduledDate ?? isoDateKey(startOfToday())
  );
  const [time, setTime] = useState(post.time ?? "09:00");
  const [media, setMedia] = useState(post.media ?? []);
  // Per-platform aspect ratio map. Seeded from the persisted post so the
  // crop the scheduler will apply is the same one the user sees in this
  // dialog; missing entries default server-side via RATIOS_BY_PLATFORM.
  const [ratios, setRatios] = useState(post.ratios ?? {});
  // Status is derived/auto-set at save time rather than user-picked — see
  // handleSave below. The header badge below still reads from `post.status`
  // so the user can see what the current persisted status is.

  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const activeIds = useMemo(() => activePlatformIds(platforms), [platforms]);
  const [tabIdx, setTabIdx] = useState(0);
  const safeTabIdx = Math.min(tabIdx, Math.max(0, activeIds.length - 1));

  // Track previewUrls *this popup* created so we can revoke them on close.
  // Media that came in via `post.media` keeps its own lifecycle (the upload
  // service or store owns it), so we don't blanket-revoke everything.
  const ownedPreviewIds = useRef(new Set());

  useEffect(() => {
    const owned = ownedPreviewIds.current;
    return () => {
      for (const m of media) if (owned.has(m.id)) revokeMediaItem(m);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlatform = (id) =>
    setPlatforms((p) => ({ ...p, [id]: !p[id] }));

  const removeMedia = (id) => {
    setMedia((list) => {
      const target = list.find((m) => m.id === id);
      if (target && ownedPreviewIds.current.has(id)) revokeMediaItem(target);
      ownedPreviewIds.current.delete(id);
      return list.filter((m) => m.id !== id);
    });
  };

  const updateMedia = (id, patch) =>
    setMedia((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  // Picker → uploadService dance, identical to ScheduleModal's. Before this
  // wiring, picking a file added a descriptor-only entry the scheduler
  // couldn't fire and the preview pane couldn't load — the broken-image
  // icon in the CEO's screenshot was exactly this bug.
  const ingestFile = async (file, expectedKind) => {
    const err = validateFile(file);
    if (err) {
      dispatch(addNotification({ message: `${file.name}: ${err}`, type: "error" }));
      return;
    }
    const item = toMediaItem(file);
    ownedPreviewIds.current.add(item.id);
    setMedia((list) => [...list, item]);
    updateMedia(item.id, { status: "uploading" });
    const result = await uploadToBackend(file);
    updateMedia(item.id, result);
    if (result.status !== "uploaded") {
      dispatch(
        addNotification({
          message: `${file.name} couldn't be uploaded — the scheduler will fire this post without media.`,
          type: "error",
        })
      );
    }
  };

  const handlePickedFile = async (e, kind) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await ingestFile(file, kind);
  };
  const onPickImageFile = (e) => handlePickedFile(e, "image");
  const onPickVideoFile = (e) => handlePickedFile(e, "video");

  const hashtagCount = (content.match(/#\w+/g) || []).length;
  const hasPending = media.some((m) => m.status === "uploading");

  // ─── AI generation (local to the popup) ──────────────────────────
  // Calls the same /generate endpoint CreationEditor uses, with the same
  // context shape — including the uploaded image so the vision model can
  // describe it instead of writing blind. Result lands in the popup's
  // local content state so opening this popup never clobbers an in-flight
  // editor draft.
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingMediaKind, setGeneratingMediaKind] = useState(null);
  const onGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      // First successfully-uploaded image's server-side filename — the
      // backend routes through a vision model when this is set, so the
      // generated caption can actually describe what's in the picture.
      // Local-only previews (no remoteUrl) are skipped because the model
      // can't fetch them.
      const firstImage = media.find(
        (m) => m.kind === "image" && m.status === "uploaded" && m.filename
      );
      // Whether the user is calling this as an explicit Regenerate (content
      // already set) — force-bypass the cache so the second click actually
      // produces something new instead of silently returning the cached
      // result that made the button feel dead.
      const force = !!content.trim();
      const { variants, usage, cached } = await generateContent({
        prompt: content,
        platforms,
        variants: 1,
        image: firstImage?.filename || null,
        force,
      });
      const text = variants?.[0]?.text;
      if (text) setContent(text);
      if (cached) {
        dispatch(recordCacheHit());
        dispatch(addNotification({ message: "Reused last generation — no tokens spent.", type: "info" }));
      } else if (usage?.total_tokens > 0) {
        dispatch(addTokenUsage(usage.total_tokens));
      }
    } catch (err) {
      dispatch(addNotification({
        message: `Generation failed: ${err.message || "unknown error"}`,
        type: "error",
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  // Status auto-flow: draft + future date → scheduled. Published / error
  // stay as-is (the scheduler manages those). The manual Status dropdown
  // has been removed — "I'm editing a post on the calendar" implies intent
  // to schedule, not to leave as a draft.
  const computeNextStatus = () => {
    const current = post.status || "draft";
    if (current === "published" || current === "error") return current;
    const todayKey = isoDateKey(startOfToday());
    const hasFutureSchedule = date && date >= todayKey;
    return hasFutureSchedule ? "scheduled" : "draft";
  };

  const handleGenerateMedia = async (kind) => {
    const prompt = content.trim();
    if (!prompt) {
      dispatch(
        addNotification({
          message: `Enter a prompt before generating a ${kind}.`,
          type: "error",
        })
      );
      return;
    }
    setGeneratingMediaKind(kind);
    try {
      const ratio =
        Object.values(ratios || {})[0] || (kind === "video" ? "9:16" : "1:1");
      const result =
        kind === "video"
          ? await generateVideoAsset({ prompt, ratio })
          : await generateImageAsset({ prompt, ratio });
      setMedia((list) => [...list, result.mediaItem]);
      dispatch(
        addNotification({
          message: `${kind === "video" ? "Video" : "Image"} generated via ${result.data?.provider || "backend"}.`,
          type: "success",
        })
      );
    } catch (err) {
      dispatch(
        addNotification({
          message: `${kind === "video" ? "Video" : "Image"} generation failed: ${err.message || "unknown error"}`,
          type: "error",
        })
      );
    } finally {
      setGeneratingMediaKind(null);
    }
  };

  const handleSave = () => {
    onSave({
      content: content.trim(),
      platforms,
      scheduledDate: date,
      time,
      // Preserve the post's existing IANA timezone when edits don't change
      // it; otherwise stamp it with the team-configured scheduling zone.
      // Without this, PATCHes dropped tz and the scheduler defaulted to
      // UTC, firing posts 1–2h off. getScheduleTimezone() respects the
      // Settings override so this stays correct even when the operator
      // is on a non-local clock or behind a VPN.
      timezone: post.timezone || getScheduleTimezone(),
      media,
      // Per-platform crop choices — when empty the backend falls back to
      // RATIOS_BY_PLATFORM defaults, so we only need to send what the
      // user touched.
      ratios: Object.keys(ratios).length ? ratios : undefined,
      status: computeNextStatus(),
    });
  };

  // Status the header badge shows — preview the auto-computed next status
  // while editing so the user knows what Save will land on.
  const nextStatus = computeNextStatus();
  const status = nextStatus;

  const activeTabPlatform = activeIds[safeTabIdx]
    ? PLATFORM_MAP[activeIds[safeTabIdx]]
    : null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${fadeIn}`}
      style={{ background: "rgba(15, 23, 42, 0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{
          maxWidth: 960,
          maxHeight: "92vh",
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-default)" }}
        >
          <div className="flex items-center gap-2">
            <h3
              className="text-base font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              Edit post
            </h3>
            <span
              className={STATUS_META[status]?.badgeClass || badgeDraft}
              style={{ fontSize: 10 }}
            >
              {STATUS_META[status]?.label || status}
            </span>
          </div>
          <button
            onClick={onClose}
            className={`${btnGhost}`}
            style={{ padding: 6 }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — split layout */}
        <div
          className="flex-1 grid"
          style={{
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            minHeight: 0,
            /* overflow visible on the grid so each column manages its
               own scroll independently. The previous overflow-hidden
               was clipping the left pane's scrollbar, making publish
               results and the delete button unreachable. */
            overflow: "visible",
          }}
        >
          {/* LEFT — editor */}
          <div
            className="overflow-y-auto p-5"
            style={{
              borderRight: "1px solid var(--border-default)",
              minHeight: 0, /* required for grid child scroll */
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-tertiary)" }}
              >
                Content
              </label>
              <button
                type="button"
                onClick={onGenerate}
                disabled={isGenerating}
                className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors"
                style={{
                  background: "rgba(99, 102, 241, 0.10)",
                  color: "var(--accent-primary)",
                  border: "1px solid rgba(99, 102, 241, 0.25)",
                  opacity: isGenerating ? 0.6 : 1,
                  cursor: isGenerating ? "not-allowed" : "pointer",
                }}
                title={
                  content.trim()
                    ? "Generate a new draft based on the current content"
                    : "Generate a draft from the selected platforms"
                }
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={11} />
                    {content.trim() ? "Regenerate" : "Generate with AI"}
                  </>
                )}
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className={`${inputField}`}
              style={{ resize: "vertical", marginBottom: 16 }}
              placeholder="What do you want to post? Or click Generate with AI."
            />

            <label
              className="text-xs font-semibold uppercase tracking-wider mb-1.5 block"
              style={{ color: "var(--text-tertiary)" }}
            >
              Media
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                onClick={() => imageInputRef.current?.click()}
                className={`${btnSecondary} text-xs inline-flex items-center gap-1.5`}
              >
                <Upload size={13} /> Image
              </button>
              <button
                onClick={() => videoInputRef.current?.click()}
                className={`${btnSecondary} text-xs inline-flex items-center gap-1.5`}
              >
                <Film size={13} /> Video
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={() => handleGenerateMedia("image")}
                disabled={!!generatingMediaKind}
                className={`${btnSecondary} text-xs inline-flex items-center gap-1.5`}
                title="Generate an image from the current prompt"
              >
                {generatingMediaKind === "image" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}{" "}
                AI image
              </button>
              <button
                onClick={() => handleGenerateMedia("video")}
                disabled={!!generatingMediaKind}
                className={`${btnSecondary} text-xs inline-flex items-center gap-1.5`}
                title="Generate a motion video from the current prompt"
              >
                {generatingMediaKind === "video" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Film size={13} />
                )}{" "}
                AI video
              </button>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept={ACCEPTED_TYPES.filter((t) => t.startsWith("image/")).join(",")}
              className="hidden"
              onChange={onPickImageFile}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept={ACCEPTED_TYPES.filter((t) => t.startsWith("video/")).join(",")}
              className="hidden"
              onChange={onPickVideoFile}
            />
            {media.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-4">
                {media.map((m) => {
                  const statusIcon =
                    m.status === "uploading" ? (
                      <Loader2
                        size={11}
                        className="animate-spin"
                        style={{ color: "var(--accent-primary)" }}
                      />
                    ) : m.status === "uploaded" ? (
                      <CheckCircle2
                        size={11}
                        style={{ color: "var(--status-approved)" }}
                      />
                    ) : m.status === "local" || !m.remoteUrl ? (
                      <AlertCircle
                        size={11}
                        style={{ color: "var(--status-pending)" }}
                      />
                    ) : null;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs"
                      style={{
                        background: "var(--bg-secondary)",
                        color: "var(--text-secondary)",
                      }}
                      title={
                        m.status === "uploaded"
                          ? "Ready — will be sent at publish time"
                          : m.status === "uploading"
                          ? "Uploading…"
                          : "Local-only preview — won't reach the platform"
                      }
                    >
                      {m.kind === "video" ? (
                        <Film size={13} />
                      ) : (
                        <ImagePlus size={13} />
                      )}
                      <span className="flex-1 truncate">{m.name}</span>
                      {statusIcon}
                      <button
                        onClick={() => removeMedia(m.id)}
                        style={{ color: "var(--text-muted)" }}
                        aria-label="Remove media"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {media.length === 0 && <div style={{ marginBottom: 16 }} />}

            <label
              className="text-xs font-semibold uppercase tracking-wider mb-1.5 block"
              style={{ color: "var(--text-tertiary)" }}
            >
              Platforms
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {PLATFORMS.map((p) => {
                const Icon = p.icon;
                const on = !!platforms[p.id];
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePlatform(p.id)}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-all inline-flex items-center gap-1.5"
                    style={{
                      background: on
                        ? "rgba(99, 102, 241, 0.12)"
                        : "transparent",
                      border: `1px solid ${
                        on ? "var(--border-active)" : "var(--border-default)"
                      }`,
                      color: on
                        ? "var(--text-primary)"
                        : "var(--text-muted)",
                    }}
                  >
                    <Icon size={12} style={{ color: p.color }} />
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Per-platform aspect ratio — same picker the editor uses.
                Only shown for currently-enabled platforms; the chosen
                ratios are sent in handleSave below and the scheduler
                crops accordingly when the post fires. */}
            {activeIds.length > 0 && (
              <>
                <label
                  className="text-xs font-semibold uppercase tracking-wider mb-1.5 block"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Aspect ratio
                </label>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {activeIds.map((id) => {
                    const p = PLATFORM_MAP[id];
                    if (!p) return null;
                    const Icon = p.icon;
                    return (
                      <div key={id} className="inline-flex items-center gap-1.5">
                        <Icon size={12} style={{ color: p.color }} aria-hidden="true" />
                        <RatioPicker
                          platform={p}
                          value={ratios[id]}
                          onChange={(next) =>
                            setRatios((r) => ({ ...r, [id]: next }))
                          }
                          compact
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {platforms.tiktok && (
              <div className="mb-4">
                <TikTokOptionsPanel />
              </div>
            )}

            <label
              className="text-xs font-semibold uppercase tracking-wider mb-1.5 block"
              style={{ color: "var(--text-tertiary)" }}
            >
              Schedule
            </label>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <DatePicker
                value={date}
                onChange={setDate}
                minKey={isoDateKey(startOfToday())}
              />
              <TimePicker value={time} onChange={setTime} />
            </div>

            {/* Status used to be a manual dropdown, which produced the
                "saved as Draft by accident → scheduler ignores it" bug the
                user reported. Status is now auto-computed at save time:
                - published / error  → stays (the scheduler owns these)
                - draft + future date → flips to scheduled on Save
                - draft + past date   → stays draft (un-fireable)
                The badge below previews what Save will land on. */}
            <div
              className="px-3 py-2 rounded-lg text-xs flex items-center gap-2"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-default)",
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ color: "var(--text-muted)" }}>Saving as</span>
              <span
                className={STATUS_META[status]?.badgeClass || badgeDraft}
                style={{ fontSize: 10 }}
              >
                {STATUS_META[status]?.label || status}
              </span>
              {status === "scheduled" && (
                <span
                  className="ml-auto text-[10px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  fires at {time} on {date}
                </span>
              )}
            </div>

            {/* Publish results — the scheduler writes one row per target
                once the post fires. Same content the bell menu shows, kept
                here so users can revisit the outcome days later. */}
            {Array.isArray(post.publish_results) && post.publish_results.length > 0 && (
              <div className="mt-5">
                <label
                  className="text-xs font-semibold uppercase tracking-wider mb-1.5 block"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Publish results
                </label>
                <ul className="flex flex-col gap-1.5">
                  {post.publish_results.map((r, idx) => {
                    const ok = !!r.ok;
                    const Icon = ok ? CheckCircle2 : AlertCircle;
                    const label = r.target_label || r.target_id || "?";
                    const platform = r.platform || "?";
                    return (
                      <li
                        key={`${platform}-${r.target_id || idx}`}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs"
                        style={{
                          background: "var(--bg-secondary)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <Icon
                          size={13}
                          style={{
                            color: ok
                              ? "var(--status-approved)"
                              : "var(--status-error)",
                          }}
                        />
                        <span className="flex-1 truncate">
                          <span className="font-medium">{label}</span>
                          <span className="opacity-70"> · {platform}</span>
                          {!ok && r.error && (
                            <span
                              className="block text-[10px] mt-0.5"
                              style={{ color: "var(--status-error)" }}
                            >
                              {r.error}
                            </span>
                          )}
                        </span>
                        {ok && r.permalink_url && (
                          <a
                            href={r.permalink_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px]"
                            style={{ color: "var(--accent-primary)" }}
                            title="Open the live post in a new tab"
                          >
                            View <ExternalLink size={10} />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {post.error && (
                  <p
                    className="text-[11px] mt-2"
                    style={{ color: "var(--status-error)" }}
                  >
                    {post.error}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — preview */}
          <div
            className="overflow-y-auto p-5"
            style={{ background: "var(--bg-secondary)" }}
          >
            {activeIds.length === 0 ? (
              <div
                className="h-full flex flex-col items-center justify-center text-center gap-2"
                style={{ color: "var(--text-muted)" }}
              >
                <Sparkles size={28} className="opacity-40" />
                <p className="text-sm">No platform selected</p>
                <p className="text-xs">Toggle a platform on the left to preview</p>
              </div>
            ) : (
              <>
                {/* Platform tabs */}
                <div
                  role="tablist"
                  aria-label="Platform previews"
                  className="flex items-center gap-1 mb-3"
                >
                  {activeIds.map((id, idx) => {
                    const p = PLATFORM_MAP[id];
                    const Icon = p.icon;
                    const isActive = idx === safeTabIdx;
                    return (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setTabIdx(idx)}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                        style={{
                          background: isActive
                            ? "var(--bg-card)"
                            : "transparent",
                          border: `1px solid ${
                            isActive ? "var(--border-active)" : "transparent"
                          }`,
                          color: isActive
                            ? "var(--text-primary)"
                            : "var(--text-muted)",
                        }}
                      >
                        <Icon size={12} style={{ color: p.color }} />
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                {activeTabPlatform && (
                  <PostMiniPreview
                    platform={activeTabPlatform}
                    // Selected ratio from the picker so the preview
                    // visually reflects the user's choice. Falls back to
                    // the platform default when the user hasn't picked.
                    ratio={
                      ratios[activeTabPlatform.id] ||
                      RATIOS_BY_PLATFORM[activeTabPlatform.id]?.defaultRatio ||
                      "1:1"
                    }
                    content={content}
                    media={media}
                    hashtagCount={hashtagCount}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderTop: "1px solid var(--border-default)" }}
        >
          <button
            onClick={() => onDelete?.(post.id)}
            className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
            style={{
              color: "var(--status-error)",
              background: "transparent",
              border: "1px solid transparent",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(239,68,68,0.08)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <Trash2 size={13} /> Delete
          </button>
          <div className="flex items-center gap-2">
            <button className={`${btnSecondary} text-sm`} onClick={onClose}>
              Cancel
            </button>
            <button
              className={`${btnPrimary} text-sm`}
              onClick={handleSave}
              disabled={hasPending}
              title={
                hasPending
                  ? "Waiting for media to finish uploading…"
                  : undefined
              }
            >
              {hasPending ? "Uploading…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Compact platform preview — same visual idea as the editor's PlatformPreview
   but sized to live inside a 480-pixel-wide modal panel. Renders the post
   with platform-appropriate aspect ratio, char/hashtag limits, and chrome.
   ─────────────────────────────────────────────────────────────────────── */
function PostMiniPreview({ platform, content, media, hashtagCount, ratio }) {
  const [mediaIdx, setMediaIdx] = useState(0);
  const Icon = platform.icon;
  // Caller supplies the active ratio; fall back to the platform default
  // when called without one so the component is still usable elsewhere.
  const effectiveRatio = ratio || RATIOS_BY_PLATFORM[platform.id]?.defaultRatio || "1:1";
  const aspectRatio = effectiveRatio.replace(":", " / ");
  const numericRatio = parseRatio(effectiveRatio);
  const charPercent = Math.min(
    (content.length / platform.maxChars) * 100,
    100
  );
  const hashOverLimit = hashtagCount > platform.maxHashtags;
  const charOverLimit = content.length > platform.maxChars;
  const avatarBg = platform.id === "tiktok" ? "#0f172a" : platform.color;
  const effectiveMedia = media.slice(0, 10);
  const currentIdx = Math.min(mediaIdx, Math.max(0, effectiveMedia.length - 1));
  const hero = effectiveMedia[currentIdx];

  return (
    <article
      className="overflow-hidden rounded-2xl"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--border-default)" }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
          style={{ background: avatarBg }}
        >
          DT
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-xs font-semibold truncate"
            style={{ color: "var(--text-primary)" }}
          >
            datalia_official
          </p>
          <p
            className="text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {platform.label} · scheduled
          </p>
        </div>
        <Icon size={14} style={{ color: platform.color }} />
      </div>

      {/* Media area */}
      <div
        className="relative flex items-center justify-center"
        style={{
          width: "100%",
          aspectRatio,
          maxHeight: 320,
          background: hero
            ? "var(--bg-elevated)"
            : "linear-gradient(135deg, var(--bg-tertiary), var(--bg-elevated))",
        }}
      >
        {hero ? (
          hero.kind === "video" ? (
            <video
              src={hero.remoteUrl || hero.previewUrl}
              className="w-full h-full object-cover"
              muted
              loop
              playsInline
              autoPlay
              onError={(e) => {
                if (hero.previewUrl && e.currentTarget.src !== hero.previewUrl) {
                  e.currentTarget.src = hero.previewUrl;
                }
              }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hero.remoteUrl || hero.previewUrl}
              alt={hero.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                if (hero.previewUrl && e.currentTarget.src !== hero.previewUrl) {
                  e.currentTarget.src = hero.previewUrl;
                }
              }}
            />
          )
        ) : (
          <div
            className="px-4 text-center"
            style={{ color: "var(--text-muted)" }}
          >
            <Icon
              size={28}
              className="mx-auto mb-1 opacity-30"
              style={{ color: platform.color }}
            />
            <p className="text-[11px]">
              {effectiveRatio} {numericRatio < 0.7 ? "Vertical" : numericRatio > 1.1 ? "Landscape" : "Square"}
            </p>
          </div>
        )}
        {effectiveMedia.length > 1 && (
          <>
            <span
              className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white z-10"
              style={{ background: "rgba(0,0,0,0.6)" }}
            >
              {currentIdx + 1} / {effectiveMedia.length}
            </span>
            {currentIdx > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setMediaIdx(i => i - 1); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center bg-black/50 text-white hover:bg-black/70 transition-colors z-10"
                aria-label="Previous media"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
            )}
            {currentIdx < effectiveMedia.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setMediaIdx(i => i + 1); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center bg-black/50 text-white hover:bg-black/70 transition-colors z-10"
                aria-label="Next media"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            )}
          </>
        )}
      </div>

      {/* Body text */}
      <div className="px-3 py-2.5">
        <p
          className="text-xs leading-relaxed whitespace-pre-line"
          style={{
            color: content
              ? "var(--text-secondary)"
              : "var(--text-muted)",
            fontStyle: content ? "normal" : "italic",
            maxHeight: 92,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 4,
          }}
        >
          {content || "Your post content will appear here…"}
        </p>
      </div>

      {/* Engagement chrome (visual realism) */}
      <div
        className="flex items-center gap-4 px-3 py-1.5"
        style={{
          color: "var(--text-muted)",
          borderTop: "1px solid var(--border-default)",
        }}
        aria-hidden="true"
      >
        <Heart size={13} />
        <MessageCircle size={13} />
        <Share2 size={13} />
      </div>

      {/* Stats bar */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          borderTop: "1px solid var(--border-default)",
          background: "var(--bg-secondary)",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ width: 56, background: "var(--bg-elevated)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${charPercent}%`,
                background: charOverLimit
                  ? "var(--status-error)"
                  : charPercent > 80
                  ? "var(--status-pending)"
                  : "var(--status-approved)",
              }}
            />
          </div>
          <span
            className="text-[10px]"
            style={{
              color: charOverLimit
                ? "var(--status-error)"
                : "var(--text-muted)",
            }}
          >
            {content.length}/{platform.maxChars}
          </span>
        </div>
        <span
          className="text-[10px] flex items-center gap-1"
          style={{
            color: hashOverLimit
              ? "var(--status-error)"
              : "var(--text-muted)",
          }}
        >
          <Hash size={10} />
          {hashtagCount}/{platform.maxHashtags}
        </span>
      </div>
    </article>
  );
}
