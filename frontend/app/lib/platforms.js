/**
 * Shared platform + status metadata.
 *
 * Mirrors the inline PLATFORMS in components/views/CreationEditor.js and the
 * --platform-* / --status-* tokens in globals.css. The calendar reads from
 * here so colors stay in one place; CreationEditor keeps its own copy for
 * now (consolidating it is a tracked follow-up).
 */

import { Facebook, Instagram, Linkedin, Video } from "lucide-react";

// `color` values are kept as the raw brand hex (TikTok uses a theme var for
// readable foreground) so callers that build alpha shades by string-concat
// (e.g. `${color}18`) keep working — single source of truth for both the
// editor and the calendar.
export const PLATFORMS = [
  {
    id: "facebook",
    label: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    className: "platform-facebook",
    maxChars: 63206,
    maxHashtags: 30,
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: Instagram,
    color: "#E1306C",
    className: "platform-instagram",
    maxChars: 2200,
    maxHashtags: 30,
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: Video,
    color: "var(--platform-tiktok-fg)",
    className: "platform-tiktok",
    maxChars: 2200,
    maxHashtags: 5,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: Linkedin,
    color: "#0A66C2",
    className: "platform-linkedin",
    maxChars: 3000,
    maxHashtags: 5,
  },
];

export const PLATFORM_MAP = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p])
);

/** Active platform ids from a currentPost.platforms-shaped object. */
export function activePlatformIds(platforms) {
  return PLATFORMS.filter((p) => platforms?.[p.id]).map((p) => p.id);
}

/**
 * Post statuses. `badgeClass` + `colorVar` reuse the existing
 * .badge-* utility classes and --status-* CSS variables in globals.css.
 */
export const STATUSES = ["draft", "pending", "approved", "published", "error"];

export const STATUS_META = {
  draft: { label: "Draft", badgeClass: "badge-draft", colorVar: "var(--status-draft)" },
  pending: { label: "Pending", badgeClass: "badge-pending", colorVar: "var(--status-pending)" },
  approved: { label: "Approved", badgeClass: "badge-approved", colorVar: "var(--status-approved)" },
  published: { label: "Published", badgeClass: "badge-approved", colorVar: "var(--status-published)" },
  error: { label: "Error", badgeClass: "badge-error", colorVar: "var(--status-error)" },
};
