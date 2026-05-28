"use client";

import { useSelector, useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import TikTokOptionsPanel from "./TikTokOptionsPanel";
import {
  setContent,
  togglePlatform,
  setMode,
  setTemplate,
  setTone,
  setPlatformRatio,
  selectVariant,
  addMedia,
} from "../../store/editorSlice";
import {
  generateContentThunk,
  applyQuickActionThunk,
  saveDraftThunk,
  submitForValidationThunk,
  publishNowThunk,
} from "../../store/editorThunks";
import { addNotification } from "../../store/uiSlice";
import { schedulePostThunk } from "../../store/calendarThunks";
import {
  Sparkles,
  ArrowDownToLine,
  ArrowUpFromLine,
  Send,
  Save,
  MessageSquare,
  Zap,
  Hash,
  FileText,
  PenLine,
  CalendarClock,
  RefreshCw,
  Loader2,
  Check,
  Type,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  ChevronDown,
  Frame,
  MoreHorizontal,
  Film,
} from "lucide-react";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import MediaUploader from "./MediaUploader";
import ScheduleModal from "./ScheduleModal";
import PublishConfirmModal from "./PublishConfirmModal";
import { publishHashKey } from "../../lib/publishHash";
import {
  fetchConnections,
  readCachedConnections,
} from "../../lib/oauthService";
import {
  generateImageAsset,
  generateVideoAsset,
} from "../../lib/mediaGenerationService";
import {
  PLATFORMS,
  RATIOS_BY_PLATFORM,
  TONES,
  parseRatio,
  previewFrameWidth,
} from "../../lib/platforms";
import { useIsMobile } from "../../lib/useIsMobile";

/* Suggested hashtags (skeleton — a contextual AI suggester wires here later,
   plan task HT-T01). */
const SUGGESTED_HASHTAGS = [
  "#marketing", "#socialmedia", "#contentcreation", "#branding",
  "#digitalmarketing", "#growth", "#smallbusiness", "#ai",
  "#automation", "#strategy", "#engagement", "#trending",
];

const MODES = [
  { id: "free", label: "Free Prompt", icon: PenLine, description: "Write freely with AI assistance" },
  { id: "template", label: "From Template", icon: FileText, description: "Use a brand template" },
  { id: "scratch", label: "From Scratch", icon: Type, description: "Start with a blank canvas" },
];

/* Compact transforms — the tone selector handles tone separately, so this
   list is now just the two length actions. */
const QUICK_ACTIONS = [
  { id: "shorten", label: "shorten", icon: ArrowDownToLine },
  { id: "expand", label: "expand", icon: ArrowUpFromLine },
];

const TEMPLATES = [
  { id: "promo", label: "Summer Promo Template (Default)" },
  { id: "edu", label: 'Educational "Did you know?"' },
  { id: "news", label: "Company News & Updates" },
];

/* Resolve "ratio for this platform on this post" using the user's pick
   first, falling back to the platform's recommended default. */
function effectiveRatio(platformId, ratios) {
  return (
    ratios?.[platformId] || RATIOS_BY_PLATFORM[platformId]?.defaultRatio || "1:1"
  );
}

export default function CreationEditor() {
  const dispatch = useDispatch();
  const t = useTranslations("creation");
  const tCommon = useTranslations("common");
  const { currentPost, aiGeneration } = useSelector((state) => state.editor);
  const recentPublishes = useSelector((s) => s.ui.recentPublishes);
  const [currentPreviewIdx, setCurrentPreviewIdx] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showHashtags, setShowHashtags] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [generatingMediaKind, setGeneratingMediaKind] = useState(null);

  // ─── AI media generation (image / video) ──────────────────────────
  // Same backend endpoints the PostEditorPopup and ScheduleModal use;
  // previously missing from the main editor surface.
  const handleGenerateMedia = async (kind) => {
    const prompt = currentPost.content.trim();
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
        Object.values(currentPost.ratios || {})[0] || (kind === "video" ? "9:16" : "1:1");
      const result =
        kind === "video"
          ? await generateVideoAsset({ prompt, ratio })
          : await generateImageAsset({ prompt, ratio });
      dispatch(addMedia([result.mediaItem]));
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

  /* Connected accounts → per-platform creator lookup, so the preview
     card shows the real avatar + handle of the account a post would
     fire to. TikTok specifically requires this on the compose screen
     (reject-on-sight during audit). Initial value lazily pulls the
     cache; useEffect refreshes from the backend. */
  const [creatorByPlatform, setCreatorByPlatform] = useState({});
  useEffect(() => {
    const apply = (providers) => {
      const next = {};
      const meta = providers?.meta?.targets || [];
      const fbPage = meta.find((t) => t.kind === "facebook_page");
      if (fbPage) {
        next.facebook = {
          handle: fbPage.label,
          displayName: fbPage.label,
          avatarUrl: null,
        };
      }
      const ig = meta.find((t) => t.kind === "instagram_business");
      if (ig) {
        next.instagram = {
          handle: ig.label,
          displayName: ig.label,
          avatarUrl: ig.profile_picture_url || null,
        };
      }
      const tt = (providers?.tiktok?.targets || [])[0];
      if (tt) {
        next.tiktok = {
          handle: tt.label,
          displayName: tt.display_name || tt.label,
          avatarUrl: tt.profile_picture_url || null,
        };
      }
      setCreatorByPlatform(next);
    };
    const cached = readCachedConnections();
    if (cached?.providers) apply(cached.providers);
    fetchConnections().then((d) => apply(d?.providers || {}));
  }, []);
  const isMobile = useIsMobile();

  // Rough token estimate so the user sees the cost before paying for it.
  const estTokens = (n) =>
    Math.ceil(currentPost.content.length / 4) + 180 * n;

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
      className={`flex h-full min-h-0 animate-fade-in ${
        isMobile ? "flex-col overflow-y-auto" : ""
      }`}
      style={{ gap: "1px", background: "var(--border-default)" }}
    >
      {/* ═══ LEFT PANEL — Input & Controls ═══ */}
      <div
        className={`flex min-w-0 flex-col ${
          isMobile ? "w-full" : "flex-1 overflow-hidden"
        }`}
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
        <div
          className={`px-6 py-5 ${
            isMobile ? "" : "flex-1 min-h-0 overflow-y-auto"
          }`}
        >

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
            <label htmlFor="content-editor" className="sr-only">{tCommon("loading") && ""}{/* hidden */}Post content</label>
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

          {/* AI Variants — pick between the alternatives the LLM Router
              returned (Redux already holds them; CR-T05 in the plan). */}
          {aiGeneration.variants.length > 0 && (
            <div className="mt-5 animate-fade-in">
              <p
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                AI Variants
              </p>
              <div className="flex gap-2 flex-wrap">
                {aiGeneration.variants.map((v, i) => {
                  const active = aiGeneration.selectedVariant === i;
                  return (
                    <button
                      key={i}
                      onClick={() => dispatch(selectVariant(i))}
                      className="text-left rounded-lg p-3 transition-all"
                      style={{
                        width: 168,
                        background: active ? "rgba(99,102,241,0.10)" : "var(--bg-tertiary)",
                        border: `1px solid ${active ? "var(--border-active)" : "var(--border-default)"}`,
                      }}
                    >
                      <span
                        className="text-[11px] font-semibold block mb-1"
                        style={{ color: active ? "var(--accent-primary)" : "var(--text-tertiary)" }}
                      >
                        Variant {i + 1}
                        {active ? " • selected" : ""}
                      </span>
                      <span
                        className="text-xs block line-clamp-3"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {v.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tone + Transforms — a single row instead of 4 ad-hoc buttons.
              Tone is sent to the AI as generation context (so it shows up
              in the *next* Generate); the two transforms below stay as
              cheap local edits for the current text. */}
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <p
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--text-tertiary)" }}
                id="tone-label"
              >
                Tone
              </p>
              <select
                id="tone-select"
                aria-labelledby="tone-label"
                value={currentPost.tone || ""}
                onChange={(e) => dispatch(setTone(e.target.value || null))}
                className="input-field cursor-pointer"
                title="Sent to the AI on the next Generate"
              >
                <option value="">Auto — let the model choose</option>
                {TONES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} — {t.hint}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    id={`quick-action-${action.id}`}
                    className="btn-secondary flex items-center gap-2 text-xs h-9"
                    disabled={isBusy || !currentPost.content.trim()}
                    onClick={() => dispatch(applyQuickActionThunk(action.id))}
                    aria-label={`${action.label} — transform content`}
                    title={`${action.label} the current content (local, no tokens)`}
                  >
                    {aiGeneration.isApplyingAction ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Icon size={14} aria-hidden="true" />
                    )}
                    {t(action.label)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hashtag suggester — collapsed by default to cut visual noise */}
          <div className="mt-4">
            <button
              onClick={() => setShowHashtags((v) => !v)}
              className="btn-secondary inline-flex items-center gap-2 text-xs"
              aria-expanded={showHashtags}
            >
              <Hash size={14} aria-hidden="true" />
              {showHashtags ? "Hide hashtags" : "Suggest hashtags"}
              <ChevronDown
                size={12}
                aria-hidden="true"
                style={{
                  transform: showHashtags ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s",
                }}
              />
            </button>
            {showHashtags && (
              <div className="flex gap-2 flex-wrap mt-3 animate-fade-in">
                {SUGGESTED_HASHTAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      const c = currentPost.content;
                      const sep = c === "" || c.endsWith(" ") || c.endsWith("\n") ? "" : " ";
                      dispatch(setContent(c + sep + tag));
                    }}
                    className="text-xs px-2.5 py-1 rounded-full transition-all"
                    style={{
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border-default)",
                      color: "var(--accent-primary)",
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Media upload + AI generation */}
          <div className="mt-5">
            <MediaUploader />
            {/* AI image / video generation — same backend the popup uses */}
            <div className="flex gap-2 mt-3">
              <button
                id="generate-ai-image-btn"
                onClick={() => handleGenerateMedia("image")}
                disabled={!!generatingMediaKind}
                className="btn-secondary text-xs inline-flex items-center gap-1.5"
                title={t("aiImage")}
              >
                {generatingMediaKind === "image" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}{" "}
                AI image
              </button>
              <button
                id="generate-ai-video-btn"
                onClick={() => handleGenerateMedia("video")}
                disabled={!!generatingMediaKind}
                className="btn-secondary text-xs inline-flex items-center gap-1.5"
                title={t("aiVideo")}
              >
                {generatingMediaKind === "video" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Film size={13} />
                )}{" "}
                AI video
              </button>
            </div>
          </div>
          
          {currentPost.platforms.tiktok && (
            <div className="mt-4">
              <TikTokOptionsPanel />
            </div>
          )}

          {/* Generate — single primary CTA; secondary controls only appear
              once variants exist, and Regenerate keeps the confirm step so
              accidental clicks don't burn tokens. */}
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
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles size={20} aria-hidden="true" />
                  Generate{currentPost.tone ? ` (${TONES.find((t) => t.id === currentPost.tone)?.label || "tone"})` : ""}
                </>
              )}
            </button>
            <p className="text-[11px] text-center mt-2" style={{ color: "var(--text-muted)" }}>
              Unchanged prompt reuses the last result — no tokens spent.
            </p>
            {aiGeneration.variants.length > 0 && (
              <div className="flex items-center justify-center gap-4 mt-2">
                <button
                  onClick={() => {
                    if (!confirmRegen) {
                      setConfirmRegen(true);
                      setTimeout(() => setConfirmRegen(false), 4000);
                      return;
                    }
                    setConfirmRegen(false);
                    dispatch(generateContentThunk(true, 1));
                  }}
                  disabled={aiGeneration.isGenerating}
                  className="text-xs font-medium inline-flex items-center gap-1"
                  style={{ color: confirmRegen ? "var(--status-pending)" : "var(--accent-primary)" }}
                  title="Force a fresh generation (spends tokens)"
                >
                  <RefreshCw size={12} aria-hidden="true" />
                  {confirmRegen ? `Confirm · ~${estTokens(1)} tokens` : "Regenerate"}
                </button>
                <button
                  onClick={() => dispatch(generateContentThunk(true, 3))}
                  disabled={aiGeneration.isGenerating}
                  className="text-xs font-medium inline-flex items-center gap-1"
                  style={{ color: "var(--accent-primary)" }}
                  title={`Generate 3 alternatives (~${estTokens(3)} tokens)`}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  + Alternatives
                </button>
              </div>
            )}
            {aiGeneration.error && (
              <p className="text-xs text-center mt-1" style={{ color: "var(--status-error)" }} role="alert">
                {aiGeneration.error}
              </p>
            )}
          </div>
        </div>

        {/* Action Footer — collapsed from 4 buttons to a split-publish
            (primary CTA + popover of alternative submit paths) so the
            visual hierarchy points the user at the action they came for. */}
        <div
          className="px-6 py-4 shrink-0 flex flex-wrap items-center gap-3"
          style={{ borderTop: "1px solid var(--border-default)", background: "var(--bg-secondary)" }}
        >
          <button
            id="save-draft-btn"
            className="btn-ghost inline-flex items-center gap-2 text-sm"
            onClick={() => dispatch(saveDraftThunk())}
            aria-label="Save post as draft"
            style={{ color: "var(--text-secondary)" }}
          >
            <Save size={14} aria-hidden="true" />
            Save draft
          </button>
          <div className="flex-1" />
          <SplitPublishButton
            onSchedule={() => setShowSchedule(true)}
            onValidate={() => dispatch(submitForValidationThunk())}
            onPublish={() => setShowPublishConfirm(true)}
          />
        </div>
      </div>

      {/* ═══ RIGHT PANEL — Live Multi-Platform Preview ═══ */}
      <div
        className={`relative z-10 flex shrink-0 flex-col overflow-hidden ${
          isMobile ? "w-full" : "w-[430px] min-w-[390px]"
        }`}
        style={{
          background: "var(--bg-elevated)",
          boxShadow: "inset 1px 0 0 var(--border-default), -18px 0 40px rgba(15, 23, 42, 0.08)",
          minHeight: isMobile ? "70vh" : undefined,
        }}
        aria-label="Live post preview"
      >
        {/* No bulky header — the preview itself owns the panel. The tab
            strip only appears when more than one platform is active; the
            ratio picker floats over the preview (below) so it never eats
            scroll height when a single platform is selected. */}
        {activePlatforms.length > 1 && (
          <div
            className="px-3 py-1.5 shrink-0 flex gap-1 overflow-x-auto"
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
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-200 whitespace-nowrap"
                  style={{
                    background: isActive ? `${p.color}15` : "transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                    border: isActive ? `1px solid ${p.color}30` : "1px solid transparent",
                  }}
                >
                  <Icon size={14} style={{ color: p.color }} aria-hidden="true" />
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

        <div
          className="flex-1 min-h-0 overflow-y-auto px-5 py-5 relative"
          onTouchStart={onPreviewTouchStart}
          onTouchEnd={onPreviewTouchEnd}
        >
          {/* Floating ratio picker — sticks to the top-right of the preview
              viewport so it stays reachable as the user scrolls long captions,
              but doesn't take any flex height (was previously inline in a
              shrink-0 strip, which cropped the preview card on short panes). */}
          {activePlatforms[safePreviewIdx] && (
            <div
              className="sticky top-0 z-20 flex justify-end pointer-events-none"
              style={{ height: 0 }}
            >
              <div className="pointer-events-auto">
                <RatioPicker
                  platform={activePlatforms[safePreviewIdx]}
                  media={currentPost.media}
                  value={effectiveRatio(
                    activePlatforms[safePreviewIdx].id,
                    currentPost.ratios
                  )}
                  onChange={(ratio) =>
                    dispatch(
                      setPlatformRatio({
                        platform: activePlatforms[safePreviewIdx].id,
                        ratio,
                      })
                    )
                  }
                />
              </div>
            </div>
          )}

          {activePlatforms.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center h-full text-center"
              style={{ color: "var(--text-muted)" }}
            >
              <Zap size={40} className="mb-3 opacity-30" aria-hidden="true" />
              <p className="text-sm">{t("noPlatformsSelected") || "No platforms selected"}</p>
              <p className="text-xs mt-1">{t("togglePlatformsHint") || "Toggle platforms on the left to preview"}</p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center">
              {activePlatforms.map((platform, idx) => {
                if (idx !== safePreviewIdx) return null;
                const ratio = effectiveRatio(platform.id, currentPost.ratios);
                const frameWidth = previewFrameWidth(ratio);
                return (
                  <div
                    key={platform.id}
                    className="mx-auto my-auto animate-fade-in"
                    style={{ width: frameWidth, maxWidth: "100%" }}
                  >
                    <PlatformPreview
                      platform={platform}
                      ratio={ratio}
                      content={currentPost.content}
                      hashtagCount={hashtagCount}
                      media={currentPost.media}
                      creator={creatorByPlatform[platform.id]}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showSchedule && (
        <ScheduleModal
          initialContent={currentPost.content}
          initialPlatforms={currentPost.platforms}
          // Forward the editor's already-uploaded media (remoteUrl + status)
          // and ratio picks so the backend scheduler can fire the post with
          // the exact same media URL + crops the manual Publish path uses.
          initialMedia={currentPost.media}
          initialRatios={currentPost.ratios}
          initialTikTok={currentPost.tiktok}
          onClose={() => setShowSchedule(false)}
          onSchedule={(post) => {
            dispatch(schedulePostThunk({ post, date: post.scheduledDate }));
            setShowSchedule(false);
          }}
        />
      )}

      {showPublishConfirm && (() => {
        // Compute the same hash the publish thunk records so the modal can
        // flag duplicate posts before the user fires another publish.
        const uploaded = currentPost.media.find(
          (m) => m.status === "uploaded" && m.remoteUrl
        );
        const hash = publishHashKey(currentPost.content, uploaded?.remoteUrl || null);
        const recentSet = new Set((recentPublishes || []).map((p) => p.hash));
        const enabledPlatforms = Object.entries(currentPost.platforms)
          .filter(([, on]) => on)
          .map(([id]) => id);
        return (
          <PublishConfirmModal
            content={currentPost.content}
            enabledPlatforms={enabledPlatforms}
            contentHash={hash}
            recentPostHashes={recentSet}
            onClose={() => setShowPublishConfirm(false)}
            onConfirm={() => {
              setShowPublishConfirm(false);
              dispatch(publishNowThunk());
            }}
          />
        );
      })()}
    </div>
  );
}

/* ——— Per-platform aspect ratio popover ———
   Each platform accepts different ratios for different placements
   (feed vs reels vs link-share). Rather than picking a single global
   ratio, the user picks per platform — sourced from RATIOS_BY_PLATFORM
   in lib/platforms.js. Closes on outside click / Escape. */
function RatioPicker({ platform, value, onChange, media }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const spec = RATIOS_BY_PLATFORM[platform.id];
  let options = spec?.options || [];

  // Remove unsupported ratios based on media type.
  // TikTok explicitly rejects 16:9 for photo carousels.
  const hasVideo = media?.some((m) => m.kind === "video");
  if (platform.id === "tiktok" && !hasVideo) {
    options = options.filter((o) => o.value !== "16:9");
  }

  useEffect(() => {
    if (!open) return;
    const away = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!options.length) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all backdrop-blur"
        style={{
          /* Slightly translucent so the picker reads as floating over the
             preview card rather than as part of any toolbar. */
          background: "color-mix(in srgb, var(--bg-card) 88%, transparent)",
          border: `1px solid ${open ? "var(--border-active)" : "var(--border-default)"}`,
          color: "var(--text-secondary)",
          boxShadow: "0 4px 12px rgba(15, 23, 42, 0.10)",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Pick the aspect ratio used to preview ${platform.label} posts`}
      >
        <Frame size={12} aria-hidden="true" />
        {value}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1 rounded-xl p-1.5 shadow-lg animate-fade-in"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-dropdown)",
            minWidth: 220,
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            const isDefault = opt.value === spec.defaultRatio;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-xs transition-all"
                style={{
                  background: isSelected ? "rgba(99,102,241,0.12)" : "transparent",
                  color: "var(--text-primary)",
                }}
              >
                <span
                  className="rounded-sm shrink-0"
                  style={{
                    width: 22,
                    height: 22 / parseRatio(opt.value),
                    minHeight: 10,
                    background: isSelected
                      ? "var(--accent-primary)"
                      : "var(--bg-tertiary)",
                    border: "1px solid var(--border-default)",
                  }}
                  aria-hidden="true"
                />
                <span className="flex-1">
                  <span className="block font-medium">{opt.label}</span>
                  <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {opt.hint}
                  </span>
                </span>
                {isDefault && (
                  <span
                    className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{
                      background: "var(--bg-tertiary)",
                      color: "var(--text-muted)",
                    }}
                  >
                    default
                  </span>
                )}
                {isSelected && (
                  <Check size={12} style={{ color: "var(--accent-primary)" }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ——— Split Publish button ———
   Folds Schedule / Submit-for-validation / Save-draft into a single
   chevron menu so the footer surfaces one primary action (Publish now)
   and one ghost (Save draft) — every other path lives in the dropdown.
   Closes on outside click / Escape, mirrors RatioPicker. */
function SplitPublishButton({ onSchedule, onValidate, onPublish }) {
  const t = useTranslations("creation");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        id="publish-now-btn"
        className="btn-primary flex items-center gap-2"
        onClick={onPublish}
        aria-label="Publish post now"
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      >
        <Send size={16} aria-hidden="true" />
        {t("publishNow")}
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More publish options"
        style={{
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          padding: "0 10px",
          borderLeft: "1px solid rgba(255,255,255,0.18)",
        }}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-1 z-30 rounded-xl p-1.5 shadow-lg animate-fade-in"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-dropdown)",
            minWidth: 220,
          }}
        >
          <MenuItem
            icon={CalendarClock}
            label={t("scheduleFor")}
            onClick={() => {
              setOpen(false);
              onSchedule();
            }}
          />
          <MenuItem
            icon={MessageSquare}
            label={t("submitForValidation")}
            sub="Telegram approval flow"
            onClick={() => {
              setOpen(false);
              onValidate();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, sub, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left text-xs transition-all"
      style={{ background: "transparent", color: "var(--text-primary)" }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--bg-tertiary)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon size={14} style={{ color: "var(--accent-primary)" }} />
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        {sub && (
          <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
            {sub}
          </span>
        )}
      </span>
    </button>
  );
}

/* ——— Platform Preview Card ——— */
function PlatformPreview({
  platform,
  ratio = "1:1",
  content,
  hashtagCount,
  media = [],
  creator = null,
}) {
  const t = useTranslations("creation");
  const [mediaIdx, setMediaIdx] = useState(0);
  const Icon = platform.icon;
  const charPercent = Math.min((content.length / platform.maxChars) * 100, 100);
  const hashOverLimit = hashtagCount > platform.maxHashtags;
  const charOverLimit = content.length > platform.maxChars;
  const numericRatio = parseRatio(ratio);
  const isVertical = numericRatio < 0.7;
  const isSquare = numericRatio >= 0.9 && numericRatio <= 1.1;
  const aspectRatio = ratio.replace(":", " / ");

  // TikTok's brand color is a theme var (readable text), so use a fixed dark
  // chip as the avatar background to keep white initials legible.
  const avatarBg = platform.id === "tiktok" ? "#0f172a" : platform.color;
  const effectiveMedia = media.slice(0, 10);
  const currentIdx = Math.min(mediaIdx, Math.max(0, effectiveMedia.length - 1));
  const hero = effectiveMedia[currentIdx];
  // Per-platform creator card: when a connected account exists for this
  // platform, show its real avatar + @handle here. TikTok specifically
  // requires the creator info to appear on the compose screen BEFORE
  // posting — this is one of the audit reviewers' reject-on-sight checks.
  const creatorHandle = creator?.handle || "datalia_official";
  const creatorAvatar = creator?.avatarUrl || null;
  const creatorInitials = (creator?.displayName || "DT")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
      {/* Platform header — text uses the theme primary so it stays readable
          in both light + dark; identity is carried by the icon + the side
          chip rather than brand-colored body text. */}
      <div
        className="flex items-center gap-2 px-4 py-3.5"
        style={{ borderBottom: "1px solid var(--border-default)" }}
      >
        <Icon size={16} style={{ color: platform.color }} aria-hidden="true" />
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {platform.label}
        </span>
        <div className="flex-1" />
        <span className={`platform-tag ${platform.className}`}>Preview</span>
      </div>

      {/* Media — real uploads, or an empty-state placeholder */}
      <div
        className="relative flex items-center justify-center"
        style={{
          width: "100%",
          aspectRatio,
          background: hero
            ? "var(--bg-elevated)"
            : "linear-gradient(135deg, var(--bg-tertiary), var(--bg-elevated))",
        }}
      >
        {hero ? (
          <>
            {hero.kind === "video" ? (
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
          </>
        ) : (
          <div className="px-6 text-center" style={{ color: "var(--text-muted)" }}>
            <Icon size={32} className="mx-auto mb-2 opacity-30" style={{ color: platform.color }} aria-hidden="true" />
            <p className="text-xs">
              {ratio}{" "}
              {isVertical ? "Vertical" : isSquare ? "Square" : "Landscape"}
            </p>
            <p className="text-xs mt-0.5 opacity-60">{t("uploadHint") || "Upload media on the left to preview"}</p>
          </div>
        )}
      </div>

      {/* Content preview */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          {creatorAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={creatorAvatar}
              alt={creatorHandle}
              className="w-7 h-7 rounded-full"
              style={{ objectFit: "cover", background: avatarBg }}
              aria-hidden="true"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
              style={{ background: avatarBg }}
              aria-hidden="true"
            >
              {creatorInitials}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{creatorHandle}</p>
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
