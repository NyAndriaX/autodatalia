"use client";

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import {
  Sparkles,
  Share2,
  Calendar,
  BarChart3,
  ArrowRight,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Shield,
  Globe,
  Clock,
  ChevronDown,
  Loader2,
  AlertCircle,
  Sun,
  Moon,
  Menu,
  X,
} from "lucide-react";
import { config } from "./lib/config";
import { loginThunk, registerThunk } from "./store/authThunks";
import { clearAuthError } from "./store/authSlice";
import { setTheme } from "./store/uiSlice";
import "./landing.css";

// SSR-safe subscription to the OS colour scheme — mirrors what Topbar
// does, so the landing page's theme toggle reflects what's actually on
// screen rather than just the saved preference.
function subscribeSystemTheme(cb) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const getSystemDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/* ───────── Constants ───────── */
// Privacy + Terms are served by the backend (/privacy, /terms). When the
// frontend uses the Next.js rewrite proxy (apiBaseUrl="/api/backend"), the
// proxy forwards `/api/backend/terms` → backend `/terms`, so the same
// concatenation works in both modes. If apiBaseUrl is empty there is no
// backend reachable and we suppress the legal links rather than 404.
const policyBase = config.apiBaseUrl || "";
const hasLegalLinks = Boolean(policyBase);

// Per-card identity. Palette anchors to the brand (royal blue + red);
// the other two cards use restrained navy/slate tones so the section
// doesn't read as a rainbow swatch. Red is reserved for one card so it
// reads as emphasis, not noise.
const FEATURES = [
  {
    icon: Sparkles,
    title: "AI that writes like you",
    desc: "Three caption variants in under two seconds, with hashtags tuned per platform. Pick the one that sounds like you, ship it.",
    gradient: "linear-gradient(135deg, #1d3fbe 0%, #4866e3 100%)",
    tint: "rgba(29, 63, 190, 0.14)",
  },
  {
    icon: Share2,
    title: "One click, every audience",
    desc: "Facebook, Instagram, TikTok, LinkedIn — published in parallel from one composer. Each platform gets its own crop, automatically.",
    gradient: "linear-gradient(135deg, #15307f 0%, #1d3fbe 100%)",
    tint: "rgba(21, 48, 127, 0.14)",
  },
  {
    icon: Calendar,
    title: "Schedule, then sleep",
    desc: "Drag posts onto the calendar, drop the stress. The scheduler fires on time even when your laptop is closed and the office is dark.",
    gradient: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
    tint: "rgba(220, 38, 38, 0.14)",
  },
  {
    icon: BarChart3,
    title: "Signals, not vanity metrics",
    desc: "Reach, engagement, and growth across every network in one view. No PowerPoint exports — just the data that moves the brand.",
    gradient: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
    tint: "rgba(30, 41, 59, 0.14)",
  },
];

// Tiny stat strip under the hero. Three honest numbers do a lot of
// work — they say "this is a real product" without the bullshit
// roundness of "10x faster" or "infinitely scalable".
const HERO_STATS = [
  { value: "4", label: "networks" },
  { value: "<2s", label: "AI draft" },
  { value: "98 → 0", label: "tokens after cache" },
];

const PLATFORMS = [
  { name: "Facebook", colorClass: "platform-card-icon--facebook", letter: "f" },
  { name: "Instagram", colorClass: "platform-card-icon--instagram", letter: "Ig" },
  { name: "TikTok", colorClass: "platform-card-icon--tiktok", letter: "Tk" },
  { name: "LinkedIn", colorClass: "platform-card-icon--linkedin", letter: "in" },
];

/* ───────── Platform SVG Icons (inline for quality) ───────── */
function FacebookIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78 2.92 2.92 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 3 15.57 6.34 6.34 0 0 0 9.37 22a6.33 6.33 0 0 0 6.37-6.22V9.4a8.16 8.16 0 0 0 4.85 1.58V7.53a4.85 4.85 0 0 1-1-.84z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

const platformIcons = {
  Facebook: FacebookIcon,
  Instagram: InstagramIcon,
  TikTok: TikTokIcon,
  LinkedIn: LinkedInIcon,
};

/* ───────── Intersection Observer hook ───────── */
function useReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, visible];
}

/* ═══════════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════════ */
export default function LandingPage() {
  const router = useRouter();
  const user = useSelector((s) => s.auth.user);
  const authStatus = useSelector((s) => s.auth.status);

  useEffect(() => {
    if (user) {
      router.replace("/dashboard");
    }
  }, [user, router]);

  // Don't flash the marketing page while restoring a saved session or
  // mid-redirect. The bootstrap dispatches `restoreSessionThunk` on mount,
  // so on a hard refresh of an authenticated user this fires before the
  // useEffect above gets a chance to push.
  if (user || authStatus === "restoring") {
    return (
      <div className="landing-page landing-page--loading">
        <Loader2 size={28} className="animate-spin" aria-hidden="true" />
        <span>Loading your dashboard…</span>
      </div>
    );
  }

  return (
    <div className="landing-page">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <PlatformsSection />
      <AuthSection />
      <Footer />
    </div>
  );
}

/* ─────────── How It Works ─────────── */
function HowItWorksSection() {
  const [ref, visible] = useReveal();
  
  const steps = [
    { num: "01", title: "Connect your networks", desc: "Authorize TikTok, Instagram, LinkedIn, and Facebook in a popup window. OAuth tokens stay server-side; nothing leaks to the browser." },
    { num: "02", title: "Draft with AI", desc: "Type a prompt, pick a tone, get three variants tuned per network. Cropped, captioned, hashtagged. Pick one and move on." },
    { num: "03", title: "Hand it the calendar", desc: "Drag posts to a date and time. The in-process scheduler fires on the dot — even when nobody's at a desk." },
  ];

  return (
    <section className="landing-how-it-works" id="how-it-works">
      <div className="section-container section-center">
        <div className="section-label">
          <Clock size={14} /> Workflow
        </div>
        <h2 className="section-title">Three steps. Then it runs itself.</h2>
        <p className="section-subtitle">
          Connect your networks once, draft with AI, hand the calendar to the
          scheduler. After that you mostly just check the analytics.
        </p>

        <div className="how-it-works-grid" ref={ref}>
          {steps.map((step, i) => (
            <div 
              key={step.num} 
              className={`hiw-step${visible ? " is-visible" : ""}`}
              style={{ transitionDelay: visible ? `${i * 150}ms` : "0ms" }}
            >
              <div className="hiw-number">{step.num}</div>
              <h3 className="hiw-title">{step.title}</h3>
              <p className="hiw-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────── Theme toggle (shared by desktop + mobile nav) ─────────── */
function ThemeToggle({ className = "landing-theme-toggle" }) {
  const dispatch = useDispatch();
  const themePref = useSelector((s) => s.ui.theme);
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemDark,
    () => false
  );
  const resolved =
    themePref === "dark"
      ? "dark"
      : themePref === "light"
      ? "light"
      : systemDark
      ? "dark"
      : "light";
  return (
    <button
      type="button"
      className={className}
      onClick={() => dispatch(setTheme(resolved === "dark" ? "light" : "dark"))}
      title={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
    >
      {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/* ─────────── Navbar ─────────── */
function Navbar() {
  const [open, setOpen] = useState(false);

  // Close the mobile sheet on hash-link clicks and on resize past the
  // breakpoint (so a user rotating their phone to landscape doesn't end
  // up with a closed sheet under desktop nav).
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (window.innerWidth > 768) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // Lock body scroll while the mobile sheet is open so the page beneath
  // doesn't bleed through.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const closeAnd = (fn) => () => {
    setOpen(false);
    fn?.();
  };

  return (
    <>
      <nav className="landing-nav">
        <a href="#hero" className="landing-nav-brand" aria-label="Datalia home">
          <span className="landing-nav-logo-mark" aria-hidden="true">
            {/* Intrinsic dimensions match the source (535 × 466) so Next.js
                Image picks an aspect-correct optimised variant instead of
                stretching the medallion to a forced 1:1. */}
            <Image
              src="/logo.png"
              alt=""
              width={535}
              height={466}
              priority
              className="landing-nav-logo-img"
            />
          </span>
          <span className="landing-nav-logo">DATALIA</span>
        </a>

        {/* Desktop links */}
        <div className="landing-nav-links">
          <a href="#features" className="landing-nav-link">Features</a>
          <a href="#how-it-works" className="landing-nav-link">How it Works</a>
          <a href="#platforms" className="landing-nav-link">Platforms</a>
          <a href="#auth" className="landing-nav-link">Sign In</a>
          <ThemeToggle />
          <a href="#auth" className="cta-primary cta-primary--compact">
            Get Started
          </a>
        </div>

        {/* Mobile cluster: theme + hamburger */}
        <div className="landing-nav-mobile">
          <ThemeToggle />
          <button
            type="button"
            className="landing-mobile-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      {/* Mobile drop sheet — slides down from the navbar. Tapping a link
          closes it; tapping the backdrop closes it. */}
      {open && (
        <>
          <button
            type="button"
            className="landing-mobile-backdrop"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="landing-mobile-sheet" role="dialog" aria-modal="true">
            <a href="#features" className="landing-mobile-link" onClick={closeAnd()}>Features</a>
            <a href="#how-it-works" className="landing-mobile-link" onClick={closeAnd()}>How it Works</a>
            <a href="#platforms" className="landing-mobile-link" onClick={closeAnd()}>Platforms</a>
            <a href="#auth" className="landing-mobile-link" onClick={closeAnd()}>Sign In</a>
            <a href="#auth" className="cta-primary cta-primary--compact landing-mobile-cta" onClick={closeAnd()}>
              Get Started <ArrowRight size={16} />
            </a>
          </div>
        </>
      )}
    </>
  );
}

/* ─────────── Hero ─────────── */
function HeroSection() {
  return (
    <section className="landing-hero" id="hero">
      {/* Soft cobalt wash behind everything. Two blobs only — three was
          too "SaaS template", two reads as intentional. */}
      <div className="hero-blobs" aria-hidden="true">
        <div className="hero-blob hero-blob--1" />
        <div className="hero-blob hero-blob--2" />
      </div>

      {/* Blueprint cross-hatch grid — the engineering-precision pattern
          Vercel / Linear popularised. Quieter than the previous dot
          grid and reinforces the "tool, not toy" identity. */}
      <div className="hero-grid" aria-hidden="true" />

      {/* The medallion itself, blown up, drifted off-axis, low opacity.
          Anchors the hero to the brand without us having to lean on a
          flat colour wash. */}
      <div className="hero-medallion" aria-hidden="true">
        {/* Decorative — explicitly NOT priority so it doesn't block
            initial paint. Source is 535 × 466; we pass those intrinsics
            so Next.js Image keeps the aspect, and CSS scales it up to
            the hero size. */}
        <Image
          src="/logo.png"
          alt=""
          width={535}
          height={466}
          className="hero-medallion-img"
        />
      </div>

      <div className="hero-content">
        {/* Red editorial rail. Tiny detail that does a lot of brand work —
            picks up the red accents on the medallion's right edge and
            signals "this isn't another sky-blue SaaS page". */}
        <span className="hero-rail" aria-hidden="true" />

        <div className="hero-badge">
          <span className="hero-badge-tag">NEW</span>
          <span className="hero-badge-pulse" aria-hidden="true" />
          AI scheduling that understands your feed
        </div>

        <h1 className="hero-headline">
          Post less.{" "}
          <span className="gradient-text">Grow more.</span>
        </h1>

        <p className="hero-subtitle">
          Datalia drafts your captions, schedules across every network, and
          fires on time — even when your laptop is closed. Built for marketing
          teams who&apos;d rather be doing the work than the busywork.
        </p>

        <div className="hero-ctas">
          <a href="#auth" className="cta-primary">
            Start free <ArrowRight size={18} />
          </a>
          <a href="#features" className="cta-secondary">
            See how it works <ChevronDown size={18} />
          </a>
        </div>

        <div className="hero-stats" aria-label="Product metrics">
          {HERO_STATS.map((s) => (
            <div className="hero-stat" key={s.label}>
              <span className="hero-stat-value">{s.value}</span>
              <span className="hero-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────── Features ─────────── */
function FeaturesSection() {
  return (
    <section className="landing-features" id="features">
      <div className="section-container section-center">
        <div className="section-label">
          <Sparkles size={14} /> What it does
        </div>
        <h2 className="section-title">A studio that fits in your tab bar.</h2>
        <p className="section-subtitle">
          AI copy, multi-platform publishing, scheduling, and analytics in one
          composer. No tab-switching, no platform whiplash, no Monday-morning catch-up.
        </p>

        <div className="features-grid">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} feature={f} delay={i * 100} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature, delay }) {
  const [ref, visible] = useReveal();
  const Icon = feature.icon;

  return (
    <div
      ref={ref}
      className={`feature-card${visible ? " is-visible" : ""}`}
      style={{
        transitionDelay: visible ? `${delay}ms` : "0ms",
        "--card-tint": feature.tint,
      }}
    >
      {/* The tint at top of the card is what gives each capability its
          own colour identity — without it the four cards read as a
          uniform blue wall. */}
      <div
        className="feature-icon-wrap"
        style={{ background: feature.gradient }}
      >
        <Icon size={24} />
      </div>
      <h3>{feature.title}</h3>
      <p>{feature.desc}</p>
    </div>
  );
}

/* ─────────── Platforms ─────────── */
function PlatformsSection() {
  return (
    <section className="landing-platforms" id="platforms">
      <div className="section-container section-center">
        <div className="section-label">
          <Globe size={14} /> Networks
        </div>
        <h2 className="section-title">Four networks. One composer.</h2>
        <p className="section-subtitle">
          The cropping, the caption length, the ratio — Datalia handles each
          platform&apos;s quirks so you don&apos;t have to.
        </p>

        <div className="platforms-row">
          {PLATFORMS.map((p, i) => (
            <PlatformCard key={p.name} platform={p} delay={i * 100} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformCard({ platform, delay }) {
  const [ref, visible] = useReveal();
  const PlatIcon = platformIcons[platform.name];

  return (
    <div
      ref={ref}
      className={`platform-card${visible ? " is-visible" : ""}`}
      style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}
    >
      <div className={`platform-card-icon ${platform.colorClass}`}>
        {PlatIcon ? <PlatIcon /> : platform.letter}
      </div>
      <span className="platform-card-name">{platform.name}</span>
    </div>
  );
}

/* ─────────── Auth Section ─────────── */
function AuthSection() {
  const dispatch = useDispatch();
  const authStatus = useSelector((s) => s.auth.status);
  const authError = useSelector((s) => s.auth.error);

  const [tab, setTab] = useState("login"); // "login" | "register"
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  const isLoading = authStatus === "authenticating";

  const set = useCallback(
    (key) => (e) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      // Stale "Invalid credentials" banner shouldn't linger while the user
      // is mid-correction. Clear on first edit after an error.
      if (authError) dispatch(clearAuthError());
    },
    [authError, dispatch]
  );

  const switchTab = useCallback(
    (next) => {
      if (next === tab) return;
      setTab(next);
      if (authError) dispatch(clearAuthError());
    },
    [tab, authError, dispatch]
  );

  /* ── Email submit ── */
  const handleSubmit = (e) => {
    e.preventDefault();
    const email = form.email.trim();
    const password = form.password;
    const name = form.name.trim();
    if (tab === "login") {
      dispatch(loginThunk({ email, password }));
    } else {
      dispatch(registerThunk({ email, password, name }));
    }
  };

  return (
    <section className="landing-auth" id="auth">
      <div className="section-container section-center">
        <div className="section-label">
          <Shield size={14} /> Account
        </div>
        <h2 className="section-title">Two fields. One studio.</h2>
        <p className="section-subtitle">
          Email + password. No credit card, no demo dance, no onboarding wizard.
        </p>
      </div>

      <div className="auth-card is-visible">
        {/* Tabs */}
        <div className="auth-tabs">
          <button
            type="button"
            disabled={isLoading}
            className={`auth-tab${tab === "login" ? " auth-tab--active" : ""}`}
            onClick={() => switchTab("login")}
          >
            Sign In
          </button>
          <button
            type="button"
            disabled={isLoading}
            className={`auth-tab${tab === "register" ? " auth-tab--active" : ""}`}
            onClick={() => switchTab("register")}
          >
            Create Account
          </button>
        </div>

        {/* Error banner */}
        {authError && (
          <div className="auth-error" style={{ marginBottom: 16 }} role="alert">
            <AlertCircle size={16} className="shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit}>
          {tab === "register" && (
            <div className="auth-input-group">
              <User size={16} className="auth-input-icon" />
              <input
                className="auth-input"
                type="text"
                placeholder="Full name"
                value={form.name}
                onChange={set("name")}
                required
                disabled={isLoading}
                autoComplete="name"
              />
            </div>
          )}

          <div className="auth-input-group">
            <Mail size={16} className="auth-input-icon" />
            <input
              className="auth-input"
              type="email"
              placeholder="Email address"
              value={form.email}
              onChange={set("email")}
              required
              disabled={isLoading}
              autoComplete="email"
            />
          </div>

          <div className="auth-input-group">
            <Lock size={16} className="auth-input-icon" />
            <input
              className="auth-input"
              type={showPw ? "text" : "password"}
              placeholder="Password"
              value={form.password}
              onChange={set("password")}
              required
              minLength={6}
              disabled={isLoading}
              autoComplete={tab === "login" ? "current-password" : "new-password"}
            />
            <button
              type="button"
              className="auth-toggle-pw"
              disabled={isLoading}
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <button className="auth-submit" type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin shrink-0" />
                <span>Connecting…</span>
              </>
            ) : tab === "login" ? (
              <>
                <span>Sign In</span>
                <ArrowRight size={16} />
              </>
            ) : (
              <>
                <span>Create Account</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Legal links — backend serves /terms and /privacy. Hidden when
            no backend URL is configured (the link would 404 otherwise). */}
        {hasLegalLinks && (
          <p className="auth-legal">
            By signing up, you agree to our{" "}
            <a
              href={`${policyBase}/terms`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href={`${policyBase}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy Policy
            </a>.
          </p>
        )}
      </div>
    </section>
  );
}

/* ─────────── Footer ─────────── */
function Footer() {
  return (
    <footer className="landing-footer">
      <div className="footer-brand-row">
        <Image
          src="/logo.png"
          alt=""
          width={535}
          height={466}
          className="footer-logo-img"
        />
        <div className="footer-brand">DATALIA</div>
      </div>
      <p className="footer-tagline">
        A composer for marketing teams that&apos;d rather ship than schedule meetings.
      </p>

      <div className="footer-links">
        {hasLegalLinks && (
          <>
            <a
              href={`${policyBase}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
            >
              Privacy Policy
            </a>
            <a
              href={`${policyBase}/terms`}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
            >
              Terms of Service
            </a>
          </>
        )}
        <a
          href="mailto:legal@datalia.app"
          className="footer-link"
        >
          Contact
        </a>
      </div>

      <p className="footer-copy">
        © {new Date().getFullYear()} Datalia. All rights reserved.
      </p>
    </footer>
  );
}
