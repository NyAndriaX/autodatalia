/**
 * Classes Tailwind centralisées — remplace les anciennes classes CSS personnalisées.
 * Utilise les tokens définis dans globals.css via var().
 */

/* ─── Boutons ─────────────────────────────────────────────────────────*/
export const btnPrimary =
  "inline-flex items-center justify-center rounded-[10px] border-0 px-5 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-200 bg-[image:var(--accent-gradient)] shadow-[var(--shadow-sm)] hover:shadow-[var(--accent-glow)] hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none";

export const btnSecondary =
  "inline-flex items-center justify-center rounded-[10px] border px-5 py-2.5 text-sm font-medium cursor-pointer transition-all duration-200 bg-[var(--bg-card)] text-[var(--text-primary)] border-[var(--border-default)] hover:bg-[var(--bg-secondary)] hover:border-[var(--border-hover)] disabled:opacity-50 disabled:cursor-not-allowed";

export const btnGhost =
  "inline-flex items-center justify-center rounded-[8px] border-0 px-3 py-2 text-sm font-medium cursor-pointer transition-all duration-200 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed";

/* ─── Champs de formulaire ────────────────────────────────────────────*/
export const inputField =
  "w-full rounded-[10px] border px-3.5 py-2.5 text-sm outline-none transition-all duration-200 bg-[var(--bg-secondary)] border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:bg-[var(--bg-card)] focus:shadow-[0_0_0_3px_rgba(91,91,214,0.14)]";

/* ─── Cartes ──────────────────────────────────────────────────────────*/
export const card =
  "rounded-[16px] border transition-all duration-200 bg-[var(--bg-card)] border-[var(--border-default)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-sm)]";

export const glassCard =
  "rounded-[16px] border backdrop-blur-xl bg-[var(--glass-bg)] border-[var(--glass-border)]";

/* ─── Badges de statut ────────────────────────────────────────────────*/
const badgeBase =
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold leading-tight";

export const badgeDraft    = `${badgeBase} bg-[rgba(107,114,128,0.12)] text-[var(--status-draft)]`;
export const badgePending  = `${badgeBase} bg-[rgba(217,119,6,0.12)]   text-[var(--status-pending)]`;
export const badgeApproved = `${badgeBase} bg-[rgba(5,150,105,0.12)]   text-[var(--status-approved)]`;
export const badgeError    = `${badgeBase} bg-[rgba(220,38,38,0.12)]   text-[var(--status-error)]`;
export const badgeAwaiting = `${badgeBase} bg-[rgba(124,58,237,0.12)]  text-[var(--status-awaiting)]`;
export const badgeRejected = `${badgeBase} bg-[rgba(156,163,175,0.15)] text-[var(--status-rejected)]`;

/* ─── Tags de plateforme ──────────────────────────────────────────────*/
const platformTagBase =
  "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11px] font-semibold";

export const platformFacebook = `${platformTagBase} bg-[rgba(24,119,242,0.12)]  text-[#1877F2]`;
export const platformInstagram = `${platformTagBase} bg-[rgba(225,48,108,0.12)]  text-[#E1306C]`;
export const platformTiktok   = `${platformTagBase} bg-[rgba(1,1,1,0.10)]       text-[var(--platform-tiktok-fg)]`;
export const platformLinkedin = `${platformTagBase} bg-[rgba(10,102,194,0.12)]  text-[#0A66C2]`;

/* ─── Animation d'entrée ──────────────────────────────────────────────*/
export const fadeIn = "motion-safe:animate-[fadeIn_0.35s_ease_forwards]";
