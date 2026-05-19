"use client";

import { useSelector, useDispatch } from "react-redux";
import { setContent, togglePlatform, setMode, setTemplate } from "../../store/editorSlice";
import {
  generateContentThunk,
  applyQuickActionThunk,
  saveDraftThunk,
  submitForValidationThunk,
  publishNowThunk,
} from "../../store/editorThunks";
import {
  Sparkles,
  ArrowDownToLine,
  ArrowUpFromLine,
  Palette,
  Send,
  Save,
  MessageSquare,
  Zap,
  Hash,
  FileText,
  PenLine,
  Facebook,
  Instagram,
  Linkedin,
  Video,
  Loader2,
  Check,
  Type,
  Smile,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
} from "lucide-react";
import { useState, useMemo, useRef, useCallback } from "react";
import MediaUploader from "./MediaUploader";

/* ——— Platform Config ——— */
const PLATFORMS = [
  { id: "facebook", label: "Facebook", icon: Facebook, color: "#1877F2", maxChars: 63206, maxHashtags: 30, className: "platform-facebook" },
  { id: "instagram", label: "Instagram", icon: Instagram, color: "#E1306C", maxChars: 2200, maxHashtags: 30, className: "platform-instagram" },
  { id: "tiktok", label: "TikTok", icon: Video, color: "var(--platform-tiktok-fg)", maxChars: 2200, maxHashtags: 5, className: "platform-tiktok" },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, color: "#0A66C2", maxChars: 3000, maxHashtags: 5, className: "platform-linkedin" },
];

const MODES = [
  { id: "free", label: "Free Prompt", icon: PenLine, description: "Write freely with AI assistance" },
  { id: "template", label: "From Template", icon: FileText, description: "Use a brand template" },
  { id: "scratch", label: "From Scratch", icon: Type, description: "Start with a blank canvas" },
];

const QUICK_ACTIONS = [
  { id: "shorten", label: "Shorten", icon: ArrowDownToLine },
  { id: "expand", label: "Expand", icon: ArrowUpFromLine },
  { id: "tone-casual", label: "Casual Tone", icon: Smile },
  { id: "tone-pro", label: "Professional", icon: Palette },
];

const TEMPLATES = [
  { id: "promo", label: "Summer Promo Template (Default)" },
  { id: "edu", label: 'Educational "Did you know?"' },
  { id: "news", label: "Company News & Updates" },
];

export default function CreationEditor() {
  const dispatch = useDispatch();
  const { currentPost, aiGeneration } = useSelector((state) => state.editor);
  const [currentPreviewIdx, setCurrentPreviewIdx] = useState(0);

  const activePlatforms = useMemo(
    () => PLATFORMS.filter((p) => currentPost.platforms[p.id]),
    [currentPost.platforms]
  );
  const safePreviewIdx = Math.min(currentPreviewIdx, Math.max(0, activePlatforms.length - 1));

  /* Touch-swipe support for mobile preview navigation */
  const touchStartRef = useRef(null);
  const onPreviewTouchStart = useCallback((e) => {
    touchStartRef.current = e.touches[0].clientX;
  }, []);
  const onPreviewTouchEnd = useCallback(
    (e) => {
      if (touchStartRef.current === null) return;
      const diff = touchStartRef.current - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) {
        setCurrentPreviewIdx((prev) => {
          const max = activePlatforms.length - 1;
          if (diff > 0 && prev < max) return prev + 1;
          if (diff < 0 && prev > 0) return prev - 1;
          return prev;
        });
      }
      touchStartRef.current = null;
    },
    [activePlatforms.length]
  );

  const contentLength = currentPost.content.length;
  const hashtagCount = useMemo(
    () => (currentPost.content.match(/#\w+/g) || []).length,
    [currentPost.content]
  );

  const isBusy = aiGeneration.isGenerating || aiGeneration.isApplyingAction;

  return (
    <div
      className="flex h-full min-h-0 animate-fade-in"
      style={{ gap: "1px", background: "var(--border-default)" }}
    >
      {/* ═══ LEFT PANEL — Input & Controls ═══ */}
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        style={{ background: "var(--bg-primary)" }}
      >
        {/* Mode Selector */}
        <div className="px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border-default)" }}>
          <div className="flex gap-2" role="tablist" aria-label="Creation mode">
            {MODES.map((mode) => {
              const isActive = currentPost.mode === mode.id;
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  id={`mode-${mode.id}`}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => dispatch(setMode(mode.id))}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                  style={{
                    background: isActive ? "rgba(99, 102, 241, 0.12)" : "var(--bg-tertiary)",
                    color: isActive ? "var(--accent-primary-hover)" : "var(--text-secondary)",
                    border: isActive ? "1px solid rgba(99, 102, 241, 0.3)" : "1px solid var(--border-default)",
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Platform Toggles */}
        <div className="px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border-default)" }}>
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: "var(--text-tertiary)" }}
            id="platform-label"
          >
            Target Platforms
          </p>
          <div className="flex gap-2 flex-wrap" role="group" aria-labelledby="platform-label">
            {PLATFORMS.map((platform) => {
              const isActive = currentPost.platforms[platform.id];
              const Icon = platform.icon;
              return (
                <button
                  key={platform.id}
                  id={`platform-toggle-${platform.id}`}
                  aria-pressed={isActive}
                  onClick={() => dispatch(togglePlatform(platform.id))}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                  style={{
                    background: isActive ? `${platform.color}18` : "var(--bg-tertiary)",
                    color: isActive ? platform.color : "var(--text-muted)",
                    border: isActive ? `1px solid ${platform.color}40` : "1px solid var(--border-default)",
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  {platform.label}
                  {isActive && <Check size={14} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Editor Area */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">

          {/* Template selector — only visible in template mode */}
          {currentPost.mode === "template" && (
            <div className="mb-4 animate-fade-in">
              <label
                htmlFor="template-select"
                className="text-xs font-semibold uppercase tracking-wider mb-2 block"
                style={{ color: "var(--text-tertiary)" }}
              >
                Selected Brand Template
              </label>
              <select
                id="template-select"
                className="input-field cursor-pointer"
                value={currentPost.template}
                onChange={(e) => dispatch(setTemplate(e.target.value))}
              >
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <p className="text-[11px] mt-2" style={{ color: "var(--accent-primary)" }}>
                ℹ️ The selected template will be passed to the AI as context.
              </p>
            </div>
          )}

          {/* Text editor */}
          <div className="relative">
            <label htmlFor="content-editor" className="sr-only">Post content</label>
            <textarea
              id="content-editor"
              value={currentPost.content}
              onChange={(e) => dispatch(setContent(e.target.value))}
              placeholder={
                currentPost.mode === "free"
                  ? "Describe what you want to post… AI will generate your content."
                  : currentPost.mode === "template"
                  ? "Add any specific remarks, variables, or instructions for the AI here..."
                  : "Write your post from scratch here…"
              }
              className="w-full min-h-[260px] resize-none rounded-xl p-5 text-base leading-relaxed"
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "inherit",
              }}
            />

            {/* Character & hashtag counters */}
            <div
              className="flex items-center gap-4 mt-3"
              style={{ color: "var(--text-muted)" }}
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="flex items-center gap-1.5 text-xs">
                <Type size={12} aria-hidden="true" />
                {contentLength} chars
              </span>
              <span className="flex items-center gap-1.5 text-xs">
                <Hash size={12} aria-hidden="true" />
                {hashtagCount} hashtags
              </span>
              {activePlatforms.map((p) => {
                const over = contentLength > p.maxChars;
                return (
                  <span
                    key={p.id}
                    className="text-xs"
                    style={{ color: over ? "var(--status-error)" : undefined }}
                    aria-label={`${p.label}: ${contentLength} of ${p.maxChars} characters`}
                  >
                    {p.label}: {contentLength}/{p.maxChars}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Media upload */}
          <div className="mt-6">
            <MediaUploader />
          </div>

          {/* Quick AI Actions */}
          <div className="mt-5">
            <p
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "var(--text-tertiary)" }}
              id="quick-actions-label"
            >
              Quick AI Actions
            </p>
            <div className="flex gap-2 flex-wrap" role="group" aria-labelledby="quick-actions-label">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    id={`quick-action-${action.id}`}
                    className="btn-secondary flex items-center gap-2 text-xs"
                    disabled={isBusy || !currentPost.content.trim()}
                    onClick={() => dispatch(applyQuickActionThunk(action.id))}
                    aria-label={`${action.label} — transform content`}
                  >
                    {aiGeneration.isApplyingAction ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Icon size={14} aria-hidden="true" />
                    )}
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generate Button */}
          <div className="mt-6">
            <button
              id="generate-ai-btn"
              onClick={() => dispatch(generateContentThunk())}
              disabled={aiGeneration.isGenerating}
              aria-busy={aiGeneration.isGenerating}
              className="btn-primary flex items-center justify-center gap-2 w-full py-3 text-base"
              style={{
                opacity: aiGeneration.isGenerating ? 0.7 : 1,
                cursor: aiGeneration.isGenerating ? "not-allowed" : "pointer",
              }}
            >
              {aiGeneration.isGenerating ? (
                <>
                  <Loader2 size={20} className="animate-spin" aria-hidden="true" />
                  Generating via LLM Router...
                </>
              ) : (
                <>
                  <Sparkles size={20} aria-hidden="true" />
                  Generate via AI
                </>
              )}
            </button>
            <p className="text-xs text-center mt-2" style={{ color: "var(--text-muted)" }}>
              Triggers Python FastAPI → LLM Router (falls back to local mock if offline)
            </p>
            {aiGeneration.error && (
              <p className="text-xs text-center mt-1" style={{ color: "var(--status-error)" }} role="alert">
                {aiGeneration.error}
              </p>
            )}
          </div>
        </div>

        {/* Action Footer */}
        <div
          className="px-6 py-4 shrink-0 flex flex-wrap items-center gap-3"
          style={{ borderTop: "1px solid var(--border-default)", background: "var(--bg-secondary)" }}
        >
          <button
            id="save-draft-btn"
            className="btn-secondary flex items-center gap-2"
            onClick={() => dispatch(saveDraftThunk())}
            aria-label="Save post as draft"
          >
            <Save size={16} aria-hidden="true" />
            Save as Draft
          </button>
          <button
            id="submit-telegram-btn"
            className="btn-secondary flex items-center gap-2"
            onClick={() => dispatch(submitForValidationThunk())}
            aria-label="Submit post for human validation via Telegram"
          >
            <MessageSquare size={16} aria-hidden="true" />
            Submit for Validation
          </button>
          <div className="flex-1" />
          <button
            id="publish-now-btn"
            className="btn-primary flex items-center gap-2"
            onClick={() => dispatch(publishNowThunk())}
            aria-label="Publish post now"
          >
            <Send size={16} aria-hidden="true" />
            Publish Now
          </button>
        </div>
      </div>

      {/* ═══ RIGHT PANEL — Live Multi-Platform Preview ═══ */}
      <div
        className="relative z-10 flex w-[430px] min-w-[390px] shrink-0 flex-col overflow-hidden"
        style={{
          background: "var(--bg-elevated)",
          boxShadow: "inset 1px 0 0 var(--border-default), -18px 0 40px rgba(15, 23, 42, 0.08)",
        }}
        aria-label="Live post preview"
      >
        <div
          className="px-5 py-4 shrink-0 flex items-center justify-between"
          style={{
            borderBottom: "1px solid var(--border-default)",
            background: "linear-gradient(180deg, rgba(59,130,246,0.07), rgba(59,130,246,0))",
          }}
        >
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Live Preview
            </h3>
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
              Updates live as you type
            </p>
          </div>
          <span className="badge badge-draft">
            {activePlatforms.length} platform{activePlatforms.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Platform navigation tabs */}
        {activePlatforms.length > 1 && (
          <div
            className="px-4 py-2 shrink-0 flex gap-1 overflow-x-auto"
            style={{ borderBottom: "1px solid var(--border-default)" }}
            role="tablist"
            aria-label="Platform previews"
          >
            {activePlatforms.map((p, idx) => {
              const Icon = p.icon;
              const isActive = idx === safePreviewIdx;
              return (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Preview ${p.label}`}
                  onClick={() => setCurrentPreviewIdx(idx)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 whitespace-nowrap"
                  style={{
                    background: isActive ? `${p.color}15` : "transparent",
                    color: isActive ? p.color : "var(--text-muted)",
                    border: isActive ? `1px solid ${p.color}30` : "1px solid transparent",
                  }}
                >
                  <Icon size={14} aria-hidden="true" />
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

        <div
          className="flex-1 min-h-0 overflow-y-auto px-5 py-5"
          onTouchStart={onPreviewTouchStart}
          onTouchEnd={onPreviewTouchEnd}
        >
          {activePlatforms.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center h-full text-center"
              style={{ color: "var(--text-muted)" }}
            >
              <Zap size={40} className="mb-3 opacity-30" aria-hidden="true" />
              <p className="text-sm">No platforms selected</p>
              <p className="text-xs mt-1">Toggle platforms on the left to preview</p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              {activePlatforms.map((platform, idx) => {
                if (idx !== safePreviewIdx) return null;
                return (
                  <div key={platform.id} className="w-full max-w-[360px] animate-fade-in">
                    <PlatformPreview
                      platform={platform}
                      content={currentPost.content}
                      hashtagCount={hashtagCount}
                      media={currentPost.media}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ——— Platform Preview Card ——— */
function PlatformPreview({ platform, content, hashtagCount, media = [] }) {
  const Icon = platform.icon;
  const charPercent = Math.min((content.length / platform.maxChars) * 100, 100);
  const hashOverLimit = hashtagCount > platform.maxHashtags;
  const charOverLimit = content.length > platform.maxChars;
  const isVertical = platform.id === "tiktok";
  const isSquare = platform.id === "instagram";
  const aspectRatio = isVertical ? "9 / 16" : isSquare ? "1 / 1" : "16 / 9";
  const maxHeight = isVertical ? 320 : isSquare ? 260 : 210;

  // TikTok's brand color is a theme var (readable text), so use a fixed dark
  // chip as the avatar background to keep white initials legible.
  const avatarBg = platform.id === "tiktok" ? "#0f172a" : platform.color;
  const hero = media[0];

  return (
    <article
      className="overflow-hidden rounded-[28px] transition-all duration-200 animate-fade-in"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 28px 48px rgba(15, 23, 42, 0.16)",
      }}
      aria-label={`${platform.label} post preview`}
    >
      {/* Platform header */}
      <div
        className="flex items-center gap-2 px-4 py-3.5"
        style={{ borderBottom: "1px solid var(--border-default)" }}
      >
        <Icon size={16} style={{ color: platform.color }} aria-hidden="true" />
        <span className="text-sm font-semibold" style={{ color: platform.color }}>
          {platform.label}
        </span>
        <div className="flex-1" />
        <span className={`platform-tag ${platform.className}`}>Preview</span>
      </div>

      {/* Media — real uploads, or an empty-state placeholder */}
      <div
        className="relative flex items-center justify-center"
        style={{
          aspectRatio,
          maxHeight,
          background: hero
            ? "var(--bg-elevated)"
            : "linear-gradient(135deg, var(--bg-tertiary), var(--bg-elevated))",
        }}
      >
        {hero ? (
          <>
            {hero.kind === "video" ? (
              <video
                src={hero.previewUrl}
                className="w-full h-full object-cover"
                muted
                loop
                playsInline
                autoPlay
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hero.previewUrl} alt={hero.name} className="w-full h-full object-cover" />
            )}
            {media.length > 1 && (
              <span
                className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                style={{ background: "rgba(0,0,0,0.6)" }}
              >
                1 / {media.length}
              </span>
            )}
          </>
        ) : (
          <div className="px-6 text-center" style={{ color: "var(--text-muted)" }}>
            <Icon size={32} className="mx-auto mb-2 opacity-30" style={{ color: platform.color }} aria-hidden="true" />
            <p className="text-xs">{isVertical ? "9:16 Vertical" : isSquare ? "1:1 Square" : "16:9 Landscape"}</p>
            <p className="text-xs mt-0.5 opacity-60">Upload media on the left to preview</p>
          </div>
        )}
      </div>

      {/* Content preview */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
            style={{ background: avatarBg }}
            aria-hidden="true"
          >
            DT
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>datalia_official</p>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Just now</p>
          </div>
        </div>
        <p
          className="text-xs leading-relaxed whitespace-pre-line"
          style={{
            color: content ? "var(--text-secondary)" : "var(--text-muted)",
            fontStyle: content ? "normal" : "italic",
            maxHeight: 120,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 5,
          }}
        >
          {content || "Your post content will appear here…"}
        </p>
      </div>

      {/* Engagement chrome (visual realism) */}
      <div
        className="flex items-center gap-4 px-4 py-2"
        style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-default)" }}
        aria-hidden="true"
      >
        <Heart size={15} />
        <MessageCircle size={15} />
        <Share2 size={15} />
        <div className="flex-1" />
        {(platform.id === "instagram" || platform.id === "facebook") && <Bookmark size={15} />}
      </div>

      {/* Stats bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderTop: "1px solid var(--border-default)", background: "var(--bg-secondary)" }}
      >
        <div className="flex items-center gap-2">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ width: 60, background: "var(--bg-elevated)" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              role="progressbar"
              aria-valuenow={content.length}
              aria-valuemax={platform.maxChars}
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
            style={{ color: charOverLimit ? "var(--status-error)" : "var(--text-muted)" }}
          >
            {content.length}/{platform.maxChars}
          </span>
        </div>
        <span
          className="text-[10px] flex items-center gap-1"
          style={{ color: hashOverLimit ? "var(--status-error)" : "var(--text-muted)" }}
          aria-label={`${hashtagCount} of ${platform.maxHashtags} hashtags`}
        >
          <Hash size={10} aria-hidden="true" />
          {hashtagCount}/{platform.maxHashtags}
        </span>
      </div>
    </article>
  );
}
