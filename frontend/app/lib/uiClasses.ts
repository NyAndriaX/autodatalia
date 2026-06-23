// @ts-nocheck
/**
 * Classes Tailwind centralisées — remplace les anciennes classes CSS personnalisées.
 * Utilise les tokens définis dans globals.css via var().
 */

/* ─── Boutons ─────────────────────────────────────────────────────────*/
export const btnPrimary =
  "inline-flex items-center justify-center rounded-[8px] border-0 px-4 py-2.5 text-sm font-semibold text-white cursor-pointer transition-all duration-150 bg-[#2563eb] shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:bg-[#1d4ed8] active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none";

export const btnSecondary =
  "inline-flex items-center justify-center rounded-[8px] border px-4 py-2.5 text-sm font-semibold cursor-pointer transition-all duration-150 bg-white text-[#0f172a] border-[#e2e8f0] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-[#f8fafc] hover:border-[#cbd5e1] disabled:opacity-50 disabled:cursor-not-allowed";

export const btnGhost =
  "inline-flex items-center justify-center rounded-[8px] border-0 px-3 py-2 text-sm font-semibold cursor-pointer transition-all duration-150 bg-transparent text-[#475569] hover:bg-[#f8fafc] hover:text-[#0f172a] disabled:opacity-50 disabled:cursor-not-allowed";

export const btnSoft =
  "inline-flex items-center justify-center rounded-[8px] border px-4 py-2.5 text-sm font-semibold cursor-pointer transition-all duration-150 bg-[#eff6ff] text-[#2563eb] border-transparent hover:bg-white hover:border-[#bfdbfe] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none";

/* ─── Champs de formulaire ────────────────────────────────────────────*/
export const inputField =
  "w-full rounded-[8px] border px-3 py-2 text-sm outline-none transition-all duration-150 bg-white border-[#dbe3ef] text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#2563eb] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]";

/* ─── Cartes ──────────────────────────────────────────────────────────*/
export const card =
  "rounded-[12px] border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all duration-150 hover:border-[#cbd5e1] hover:shadow-[0_8px_24px_-4px_rgba(15,23,42,0.10)]";

export const cardInteractive =
  "rounded-[12px] border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#cbd5e1] hover:shadow-[0_8px_24px_-4px_rgba(15,23,42,0.10)]";

export const panelCard =
  "rounded-[12px] border border-[#e2e8f0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]";

export const glassCard =
  "rounded-[12px] border border-[#e2e8f0] bg-white/90 shadow-[0_1px_3px_rgba(15,23,42,0.04)] backdrop-blur-xl";

export const pageSurface =
  "h-full overflow-y-auto bg-[#f6f8fb]";

export const pageContainer =
  "mx-auto flex w-full max-w-[1600px] flex-col px-4 py-4 sm:px-5 lg:px-6";

/* Gradient hero banner — like the screenshots.
   The `page-hero-gradient` class overrides all var(--text-*) tokens inside
   to white, so every child component automatically renders in white without
   individual changes to the views. */
export const pageHero =
  "page-hero-gradient relative mb-6 flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-[14px] bg-[linear-gradient(135deg,#1e3a8a_0%,#2563eb_55%,#4f46e5_100%)] px-6 py-[22px] shadow-none";

export const pageHeroTitle =
  "text-[22px] font-bold tracking-[-0.02em] text-white";

export const pageHeroSubtitle =
  "mt-1 max-w-3xl text-[13px] leading-relaxed text-white/80";

export const sectionEyebrow =
  "text-[10px] font-bold uppercase tracking-[0.10em] text-[#94a3b8]";

export const sectionTitle =
  "text-sm font-bold text-[#0f172a]";

export const mutedText =
  "text-xs leading-relaxed text-[#64748b]";

export const iconTile =
  "flex shrink-0 items-center justify-center rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] shadow-none";

export const shellAction =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-md)] border border-transparent px-2.5 text-sm font-semibold text-[var(--text-secondary)] transition-all duration-200 hover:border-[var(--border-default)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]";

export const navSectionLabel =
  "px-3 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]";

export const navItem =
  "group relative flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm font-semibold transition-all duration-150 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]";

export const navItemActive =
  "bg-[var(--accent-soft)] text-[var(--accent-primary)] shadow-[inset_0_0_0_1px_var(--accent-soft)]";

export const navIcon =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--text-primary)]";

export const navIconActive =
  "bg-[var(--bg-card)] text-[var(--accent-primary)] shadow-[var(--shadow-xs)]";

export const settingsNavItem =
  "flex w-full items-center gap-2 rounded-[10px] border border-transparent px-2.5 py-2 text-left text-sm transition-all duration-150 hover:bg-[var(--bg-secondary)]";

export const settingsNavItemActive =
  "border-[rgba(29,63,190,0.12)] bg-[rgba(29,63,190,0.08)] text-[var(--accent-primary)]";

export const emptyState =
  "rounded-[var(--radius-xl)] border border-dashed border-[var(--border-default)] bg-[var(--bg-soft)] p-8 text-center";

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
