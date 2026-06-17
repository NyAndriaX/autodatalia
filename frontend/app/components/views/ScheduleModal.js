"use client";
import { btnPrimary, btnSecondary, btnGhost, inputField, glassCard, fadeIn } from "../../lib/uiClasses";

import { useState, useRef, useEffect } from "react";
import { useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import {
  X,
  Upload,
  Film,
  ImagePlus,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { PLATFORMS } from "../../lib/platforms";
import { isoDateKey, startOfToday, parseDateKey } from "../../lib/dateUtils";
import { addNotification, addTokenUsage, recordCacheHit, setActiveView } from "../../store/uiSlice";
import {
  ACCEPTED_TYPES,
  toMediaItem,
  uploadToBackend,
  validateFile,
  revokeMediaItem,
} from "../../lib/uploadService";
import { generateContent } from "../../lib/aiService";
import { generateImageAsset } from "../../lib/mediaGenerationService";
import TikTokOptionsPanel from "./TikTokOptionsPanel";
import { getScheduleTimezone } from "../../lib/timezone";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";
import RatioPicker from "./RatioPicker";

const MEDIA_SOURCES = [
  { id: "upload-image", kind: "image", source: "upload", labelKey: "uploadImage", icon: Upload },
  { id: "upload-video", kind: "video", source: "upload", labelKey: "uploadVideo", icon: Film },
  { id: "ai-image", kind: "image", source: "ai", labelKey: "generateImage", icon: ImagePlus },
  { id: "ai-video", kind: "video", source: "ai", labelKey: "generateVideo", icon: Sparkles },
];

/**
 * Shared scheduling dialog used by both the calendar (quick-create on a day)
 * and the editor ("Schedule…"). `onSchedule` receives a post object that
 * already includes `scheduledDate` so callers just forward it to the thunk.
 */
export default function ScheduleModal({
  initialDate = null,
  initialContent = "",
  initialPlatforms,
  initialTime = "09:00",
  initialMedia = [],
  // Per-platform aspect ratio map ({facebook: "1:1", ...}). Forwarded
  // verbatim to onSchedule so the backend can crop correctly when the
  // scheduler fires the post — without this, the ratio picked in the
  // editor would be lost the moment the user clicked Schedule.
  initialRatios = null,
  initialTikTok = null,
  // When true (the Create wizard already has content / media / platforms set),
  // render ONLY the calendar + time instead of the full re-editor. CEO ask:
  // the planning step should be just a calendar.
  calendarOnly = false,
  title,
  submitLabel,
  onClose,
  onSchedule,
}) {
  const dispatch = useDispatch();
  const t = useTranslations("scheduleModal");
  const tCommon = useTranslations("common");
  const tCreation = useTranslations("creation");
  const resolvedTitle = title ?? t("title");
  const resolvedSubmitLabel = submitLabel ?? tCommon("schedule");
  const [content, setContent] = useState(initialContent);
  const [platforms, setPlatforms] = useState(
    initialPlatforms ?? { facebook: true, instagram: true }
  );
  const [date, setDate] = useState(initialDate ?? isoDateKey(startOfToday()));
  const [time, setTime] = useState(initialTime ?? "09:00");
  // Carries uploaded items from the editor (status: "uploaded" + remoteUrl)
  // straight through, and any newly-picked files get the same shape — see
  // updateMedia below for the optimistic add → upload → swap dance. Without
  // this the scheduler would fire text-only because no remoteUrl is set.
  const [media, setMedia] = useState(initialMedia ?? []);
  // Per-platform aspect ratio map ({facebook: "1:1", instagram: "4:5", …}).
  // Seeded from initialRatios (whatever the editor was using) so reopening
  // a Schedule flow preserves the user's framing choices.
  const [ratios, setRatios] = useState(initialRatios || {});
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);

  // Track which previewUrls *this modal* created so closing the modal can
  // revoke them. Items pulled in via initialMedia (created by MediaUploader)
  // stay alive — that uploader owns its own cleanup on unmount.
  // Keyed by id → media item so cleanup never has to read the latest
  // `media` state (which a stale-closure useEffect could miss).
  const ownedItems = useRef(new Map());

  useEffect(() => {
    const owned = ownedItems.current;
    return () => {
      for (const m of owned.values()) {
        revokeMediaItem(m);
      }
    };
  }, []);

  const toggle = (id) => setPlatforms((p) => ({ ...p, [id]: !p[id] }));
  const removeMedia = (id) => {
    setMedia((list) => {
      const target = list.find((m) => m.id === id);
      if (target && ownedItems.current.has(id)) revokeMediaItem(target);
      ownedItems.current.delete(id);
      return list.filter((m) => m.id !== id);
    });
  };

  const updateMedia = (id, patch) =>
    setMedia((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const ingestFile = async (file, expectedKind) => {
    const err = validateFile(file);
    if (err) {
      dispatch(addNotification({ message: `${file.name}: ${err}`, type: "error" }));
      return;
    }
    const item = toMediaItem(file);
    if (expectedKind && item.kind !== expectedKind) {
      // User clicked "Upload Video" then picked a still image (or vice-versa);
      // accept it but note the mismatch — nicer than silently swapping kind.
      dispatch(
        addNotification({
          message: `${file.name} was added as ${item.kind} (not ${expectedKind}).`,
          type: "info",
        })
      );
    }
    ownedItems.current.set(item.id, item);
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

  const onChooseSource = (s) => {
    if (s.source === "upload") {
      (s.kind === "image" ? imageInputRef : videoInputRef).current?.click();
    } else {
      // AI generation isn't wired to a real model yet — flagging it loudly
      // is better than dropping a placeholder the scheduler can't fire.
      dispatch(
        addNotification({
          message: `AI ${s.kind} generation isn't wired yet — upload a file from your device for now.`,
          type: "info",
        })
      );
    }
  };

  const hasPending = media.some((m) => m.status === "uploading");

  // ─── AI generation (local) ───────────────────────────────────────
  // Same /generate endpoint the editor uses, with the same context — the
  // uploaded image's filename so the vision model can describe it, and
  // force: true on explicit Regenerate so the second click actually
  // produces new text instead of returning a cached result.
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingMediaKind, setGeneratingMediaKind] = useState(null);
  const onGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const firstImage = media.find(
        (m) => m.kind === "image" && m.status === "uploaded" && m.filename
      );
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

  const dayLabel = parseDateKey(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

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
    const ratio =
      Object.values(ratios || {})[0] || (kind === "video" ? "9:16" : "1:1");

    if (kind === "video") {
      // Video generation is async on the backend (60s+ render). Hand off
      // to VideoJobsView which already polls /video-jobs/{id} until done —
      // the suggested `async_mode: false` shortcut would just time out
      // behind ngrok/Cloudflare's ~60s edge timeout. Same pattern as
      // CreationEditor.
      const uploadedImage = media.find(
        (m) => m.kind === "image" && m.status === "uploaded" && m.remoteUrl
      );
      const prefill = {
        prompt,
        ratio,
        mode: uploadedImage ? "image" : "text",
        referenceImage: uploadedImage
          ? { filename: uploadedImage.filename, url: uploadedImage.remoteUrl }
          : null,
      };
      try {
        sessionStorage.setItem(
          "datalia.videoJobs.prefill",
          JSON.stringify(prefill)
        );
      } catch {
        /* private mode — proceed without prefill */
      }
      onClose?.();
      dispatch(setActiveView("videos"));
      return;
    }

    setGeneratingMediaKind(kind);
    try {
      const result = await generateImageAsset({ prompt, ratio });
      setMedia((list) => [...list, result.mediaItem]);
      dispatch(
        addNotification({
          message: `Image generated via ${result.data?.provider || "backend"}.`,
          type: "success",
        })
      );
    } catch (err) {
      dispatch(
        addNotification({
          message: `Image generation failed: ${err.message || "unknown error"}`,
          type: "error",
        })
      );
    } finally {
      setGeneratingMediaKind(null);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${fadeIn}`}
      style={{ background: "rgba(15, 23, 42, 0.45)" }}
      onClick={onClose}
    >
      <div
        className={`${glassCard} w-full max-w-md p-4 sm:p-5`}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          maxHeight: "90vh",
          maxWidth: "min(28rem, 95vw)",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            {resolvedTitle}
          </h3>
          <button onClick={onClose} className={`${btnGhost}`} style={{ padding: 6 }} aria-label={tCommon("close")}>
            <X size={16} />
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          {dayLabel}
        </p>

        {!calendarOnly && (
        <>
        <div className="flex items-center justify-between mb-1.5">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("contentLabel")}
          </span>
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
                ? t("regenerateTitle")
                : t("generateFromPlatformsTitle")
            }
          >
            {isGenerating ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                {tCreation("generating")}
              </>
            ) : (
              <>
                <Sparkles size={11} />
                {content.trim() ? tCreation("regenerate") : t("generateWithAi")}
              </>
            )}
          </button>
        </div>
        <textarea
          autoFocus
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("contentPlaceholder")}
          rows={3}
          className={`${inputField}`}
          style={{ resize: "none", marginBottom: 14 }}
        />

        {/* Media source chooser */}
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
          {t("media")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {MEDIA_SOURCES.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => onChooseSource(s)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all min-w-0"
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-secondary)",
                }}
                title={s.source === "ai" ? t("generateWithAi") : t("pickFromDevice")}
              >
                <Icon size={14} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                <span className="truncate">{t(s.labelKey)}</span>
                {s.source === "ai" && (
                  <Sparkles size={11} style={{ color: "var(--status-pending)", marginLeft: "auto", flexShrink: 0 }} />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => handleGenerateMedia("image")}
            disabled={!!generatingMediaKind}
            className={`${btnSecondary} text-xs inline-flex items-center gap-1.5`}
          >
            {generatingMediaKind === "image" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}{" "}
            {tCreation("aiImageBtn")}
          </button>
          <button
            type="button"
            onClick={() => handleGenerateMedia("video")}
            disabled={!!generatingMediaKind}
            className={`${btnSecondary} text-xs inline-flex items-center gap-1.5`}
          >
            {generatingMediaKind === "video" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Film size={13} />
            )}{" "}
            {tCreation("aiVideoBtn")}
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
              // Status drives the right-hand icon: spinner while uploading,
              // green check when ready (the scheduler will use remoteUrl),
              // red warning when the upload failed (post will fire text-only).
              const statusIcon =
                m.status === "uploading" ? (
                  <Loader2 size={11} className="animate-spin" style={{ color: "var(--accent-primary)" }} />
                ) : m.status === "uploaded" ? (
                  <CheckCircle2 size={11} style={{ color: "var(--status-approved)" }} />
                ) : m.status === "error" || (m.status && m.status !== "local" && !m.remoteUrl) ? (
                  <AlertCircle size={11} style={{ color: "var(--status-error)" }} />
                ) : null;
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs"
                  style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                >
                  {m.kind === "video" ? <Film size={13} /> : <ImagePlus size={13} />}
                  <span className="flex-1 truncate">{m.name}</span>
                  {statusIcon}
                  <button onClick={() => removeMedia(m.id)} style={{ color: "var(--text-muted)" }} aria-label={t("removeMedia")}>
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Platforms */}
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
          {tCreation("platforms")}
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {PLATFORMS.map((p) => {
            const Icon = p.icon;
            const on = !!platforms[p.id];
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all inline-flex items-center gap-1.5"
                style={{
                  background: on ? "rgba(99, 102, 241, 0.12)" : "transparent",
                  border: `1px solid ${on ? "var(--border-active)" : "var(--border-default)"}`,
                  color: on ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                <Icon size={13} style={{ color: p.color }} />
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Per-platform aspect ratio — only shown for enabled platforms so
            the form doesn't grow when nothing's selected. Same picker the
            editor uses; the resulting `ratios` map is fed to the backend
            so the scheduler crops correctly per destination. */}
        {PLATFORMS.some((p) => platforms[p.id]) && (
          <>
            <p
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              {t("aspectRatio")}
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {PLATFORMS.filter((p) => platforms[p.id]).map((p) => {
                const Icon = p.icon;
                return (
                  <div key={p.id} className="inline-flex items-center gap-1.5">
                    <Icon size={12} style={{ color: p.color }} aria-hidden="true" />
                    <RatioPicker
                      platform={p}
                      value={ratios[p.id]}
                      onChange={(next) =>
                        setRatios((r) => ({ ...r, [p.id]: next }))
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
        </>
        )}

        {/* Date + time — custom calendar popover for the date so the modal
            doesn't pop the OS-native date dialog (which looks foreign and
            varies wildly across browsers). */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <DatePicker
            value={date}
            onChange={setDate}
            minKey={isoDateKey(startOfToday())}
          />
          <TimePicker value={time} onChange={setTime} />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button className={`${btnSecondary}`} onClick={onClose}>
            {tCommon("cancel")}
          </button>
          <button
            className={`${btnPrimary}`}
            disabled={hasPending}
            title={hasPending ? t("waitingForUpload") : undefined}
            onClick={() =>
              onSchedule({
                content: content.trim(),
                platforms,
                scheduledDate: date,
                time,
                // Stamp the team-configured scheduling timezone (falls
                // back to the browser TZ if unset). VPNs don't change
                // this — Intl reads OS settings, not IP geolocation —
                // but a misconfigured laptop / traveller would; the
                // Settings override is what protects against that.
                timezone: getScheduleTimezone(),
                media,
                // Send the user's current per-platform ratio map (empty
                // entries fall back to RATIOS_BY_PLATFORM defaults server-
                // side, so we don't need to pre-fill anything here).
                ratios: Object.keys(ratios).length ? ratios : undefined,
                tiktok: initialTikTok,
              })
            }
          >
            {hasPending ? tCommon("uploading") : resolvedSubmitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
