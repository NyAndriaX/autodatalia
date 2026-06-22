/**
 * Shared platform + status metadata.
 *
 * Mirrors the inline PLATFORMS in components/views/CreationEditor.js and the
 * --platform-* / --status-* tokens in globals.css. The calendar reads from
 * here so colors stay in one place; CreationEditor keeps its own copy for
 * now (consolidating it is a tracked follow-up).
 */

// Real brand glyphs (via react-icons) — lucide ships only generic outline
// marks and has no TikTok icon at all, so platform branding previously fell
// back to a generic `Video` play icon for TikTok. These are the actual
// FB/IG/TikTok/LinkedIn logos and inherit `currentColor` like the old lucide
// icons, so existing color styling keeps working.
//
// LinkedIn comes from Font Awesome (fa6): Simple Icons dropped the LinkedIn
// mark over trademark concerns, so the `Si` set still ships FB/IG/TikTok in
// this version but no longer exports `SiLinkedin` (importing it breaks the
// build). FaLinkedin is the real filled LinkedIn logo.
import { SiFacebook, SiInstagram, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa6";
import {
  platformFacebook,
  platformInstagram,
  platformTiktok,
  platformLinkedin,
  badgeDraft,
  badgePending,
  badgeApproved,
  badgeError,
  badgeAwaiting,
  badgeRejected,
} from "./uiClasses";

// `color` values are kept as the raw brand hex (TikTok uses a theme var for
// readable foreground) so callers that build alpha shades by string-concat
// (e.g. `${color}18`) keep working — single source of truth for both the
// editor and the calendar.
export const PLATFORMS = [
  {
    id: "facebook",
    label: "Facebook",
    icon: SiFacebook,
    color: "#1877F2",
    className: platformFacebook,
    maxChars: 63206,
    maxHashtags: 30,
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: SiInstagram,
    color: "#E1306C",
    className: platformInstagram,
    maxChars: 2200,
    maxHashtags: 30,
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: SiTiktok,
    // Hex (not the CSS var) so callers that build alpha shades via
    // string concat — e.g. `${p.color}40` for a translucent border —
    // produce valid CSS. Using `var(--…)` here breaks every such use
    // site (the connection card border, platform pills, etc.).
    color: "#EE1D52",
    className: platformTiktok,
    maxChars: 2200,
    maxHashtags: 5,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: FaLinkedin,
    color: "#0A66C2",
    className: platformLinkedin,
    maxChars: 3000,
    maxHashtags: 5,
  },
];

export const PLATFORM_MAP = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p])
);

/**
 * Aspect-ratio options surfaced to the user *per platform*. Encoded as
 * "W:H" strings so callers can either `split(":")` for math or feed them
 * straight to CSS `aspect-ratio`.
 *
 * Sourced from each platform's published media specs (Meta business help,
 * TikTok creator center, LinkedIn help). Spec drift is real — re-verify
 * against the help-center URLs before a release that changes ratios.
 *
 * `defaultRatio` is the "do what most creators do" pick — that's the one
 * pre-selected when an empty post is opened. `options` is the small set
 * of *commonly used* ratios per platform — not every theoretical one, so
 * the picker stays scannable.
 */
export const RATIOS_BY_PLATFORM = {
  facebook: {
    defaultRatio: "1:1",
    options: [
      { value: "1:1", label: "Square (1:1)", hint: "Feed post" },
      { value: "4:5", label: "Tall (4:5)", hint: "Max-height feed" },
      { value: "1.91:1", label: "Landscape (1.91:1)", hint: "Link share" },
      { value: "9:16", label: "Vertical (9:16)", hint: "Stories / Reels" },
    ],
  },
  instagram: {
    defaultRatio: "4:5",
    options: [
      { value: "4:5", label: "Tall (4:5)", hint: "Feed photo" },
      { value: "1:1", label: "Square (1:1)", hint: "Carousel / legacy feed" },
      { value: "1.91:1", label: "Landscape (1.91:1)", hint: "Min feed ratio" },
      { value: "9:16", label: "Vertical (9:16)", hint: "Reels / Stories" },
    ],
  },
  tiktok: {
    defaultRatio: "9:16",
    options: [
      { value: "9:16", label: "Vertical (9:16)", hint: "Full-screen feed" },
      { value: "1:1", label: "Square (1:1)", hint: "Carousel / Cross-post" },
      { value: "4:5", label: "Tall (4:5)", hint: "Carousel photo" },
      { value: "16:9", label: "Landscape (16:9)", hint: "Video only" },
    ],
  },
  linkedin: {
    defaultRatio: "1.91:1",
    options: [
      { value: "1.91:1", label: "Landscape (1.91:1)", hint: "Article / link share" },
      { value: "1:1", label: "Square (1:1)", hint: "Carousel / mobile post" },
      { value: "4:5", label: "Tall (4:5)", hint: "Max-height feed" },
      { value: "9:16", label: "Vertical (9:16)", hint: "Vertical video" },
    ],
  },
};

/** "W:H" → numeric ratio used for CSS aspect-ratio and frame width math. */
export function parseRatio(value) {
  const [w, h] = String(value).split(":").map(Number);
  if (!w || !h) return 1;
  return w / h;
}

/**
 * Pixel-width budget for a preview *card* given a platform's chosen ratio.
 * Vertical ratios get a narrower frame (so they don't blow past the panel
 * height); landscape ratios get the wider frame they need to stay readable.
 */
export function previewFrameWidth(ratioValue) {
  const r = parseRatio(ratioValue);
  if (r < 0.7) return 252; // 9:16 etc.
  if (r < 1.05) return 330; // 1:1
  if (r < 1.5) return 360; // 4:5 / 1.91:1
  return 376; // 16:9 wider
}

/**
 * Tone options offered to the user as a single picker on the editor. The
 * tone is forwarded to the AI as generation context (rather than being a
 * local string transform), so adding/removing entries here changes the
 * prompt that the LLM Router sees.
 */
export const TONES = [
  { id: "professional", label: "Professional", hint: "Polished, on-brand" },
  { id: "casual", label: "Casual", hint: "Conversational, light" },
  { id: "playful", label: "Playful", hint: "Fun, emoji-friendly" },
  { id: "bold", label: "Bold", hint: "Punchy, action-driven" },
  { id: "informative", label: "Informative", hint: "Educational, factual" },
  { id: "inspirational", label: "Inspirational", hint: "Uplifting, story-led" },
];

/** Active platform ids from a currentPost.platforms-shaped object. */
export function activePlatformIds(platforms) {
  return PLATFORMS.filter((p) => platforms?.[p.id]).map((p) => p.id);
}

/**
 * Post statuses. `badgeClass` + `colorVar` reuse the existing
 * badge classes from uiClasses.js and --status-* tokens in globals.css.
 */
export const STATUSES = [
  "draft",
  "scheduled",
  "pending",
  "awaiting_validation",
  "approved",
  "rejected",
  "cancelled",
  "published",
  "error",
];

export const STATUS_META = {
  draft: { label: "Draft", badgeClass: badgeDraft, colorVar: "var(--status-draft)" },
  scheduled: { label: "Scheduled", badgeClass: badgePending, colorVar: "var(--status-pending)" },
  pending: { label: "Pending", badgeClass: badgePending, colorVar: "var(--status-pending)" },
  awaiting_validation: { label: "Awaiting Telegram", badgeClass: badgeAwaiting, colorVar: "var(--status-awaiting)" },
  approved: { label: "Approved", badgeClass: badgeApproved, colorVar: "var(--status-approved)" },
  rejected: { label: "Rejected", badgeClass: badgeRejected, colorVar: "var(--status-rejected)" },
  cancelled: { label: "Cancelled", badgeClass: badgeRejected, colorVar: "var(--status-rejected)" },
  published: { label: "Published", badgeClass: badgeApproved, colorVar: "var(--status-published)" },
  error: { label: "Error", badgeClass: badgeError, colorVar: "var(--status-error)" },
};

/**
 * Translation-key map for status labels. Callers should prefer rendering
 * `tDashboard(STATUS_LABEL_KEYS[status] ?? "statusDraft")` over reading
 * STATUS_META[status].label (which is English-only).
 */
export const STATUS_LABEL_KEYS = {
  draft: "statusDraft",
  scheduled: "statusScheduled",
  pending: "statusPending",
  awaiting_validation: "statusAwaitingValidation",
  approved: "statusApproved",
  rejected: "statusRejected",
  cancelled: "statusCancelled",
  published: "statusPublished",
  error: "statusError",
};
