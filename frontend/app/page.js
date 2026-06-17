"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import {
  Form,
  Input,
  Button,
  Alert,
  Tabs,
  Typography,
  Divider,
  Spin,
} from "antd";
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  ArrowRightOutlined,
  BulbOutlined,
  CalendarOutlined,
  BarChartOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  SunOutlined,
  MoonOutlined,
} from "@ant-design/icons";
import { config } from "./lib/config";
import { loginThunk, registerThunk } from "./store/authThunks";
import { clearAuthError } from "./store/authSlice";
import { setTheme } from "./store/uiSlice";

const { Title, Text, Paragraph } = Typography;

/* ── SSR-safe theme store ── */
function subscribeSystemTheme(cb) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const getSystemDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const policyBase = config.apiBaseUrl || "";
const hasLegalLinks = Boolean(policyBase);

const FEATURES = [
  {
    icon: ThunderboltOutlined,
    title: "AI-powered copywriting",
    desc: "Three caption variants in under 2 seconds, hashtags included.",
    color: "#60a5fa",
  },
  {
    icon: GlobalOutlined,
    title: "Publish to all platforms",
    desc: "Facebook, Instagram, TikTok, LinkedIn — one click, parallel publish.",
    color: "#a78bfa",
  },
  {
    icon: CalendarOutlined,
    title: "Smart scheduling",
    desc: "Drag onto the calendar. The scheduler fires on time, always.",
    color: "#34d399",
  },
  {
    icon: BarChartOutlined,
    title: "Real-time analytics",
    desc: "Reach, engagement, AI cost — in one honest dashboard.",
    color: "#fbbf24",
  },
];

const PLATFORMS = [
  { name: "Facebook", color: "#1877F2", letter: "f" },
  { name: "Instagram", color: "url(#ig-grad)", letter: "Ig" },
  { name: "TikTok", color: "#010101", letter: "Tk" },
  { name: "LinkedIn", color: "#0A66C2", letter: "in" },
];

const STATS = [
  { value: "4", label: "Platforms" },
  { value: "<2s", label: "AI Draft" },
  { value: "60d", label: "Token lifetime" },
];

/* ══════════════════════════════════════
   MAIN EXPORT
══════════════════════════════════════ */
export default function AuthPage() {
  const router = useRouter();
  const user = useSelector((s) => s.auth.user);
  const authStatus = useSelector((s) => s.auth.status);
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
  const isDark = resolved === "dark";

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  if (user || authStatus === "restoring") {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isDark ? "#0a0f1e" : "#f0f4f8",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen max-w-full min-w-0 flex-col overflow-x-hidden md:h-screen md:flex-row"
      style={{
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* ── LEFT BRAND PANEL ── */}
      <BrandPanel isDark={isDark} />

      {/* ── RIGHT AUTH PANEL ── */}
      <AuthPanel
        isDark={isDark}
        dispatch={dispatch}
        resolved={resolved}
      />
    </div>
  );
}

/* ══════════════════════════════════════
   LEFT — Brand panel
   ══════════════════════════════════════ */
function BrandPanel({ isDark }) {
  return (
    <div
      style={{
        background: "linear-gradient(145deg, #0b1638 0%, #1d3fbe 60%, #3b5be3 100%)",
        position: "relative",
        minWidth: 0,
        overflowX: "hidden",
        overflowY: "auto",
        flexDirection: "column",
        color: "#fff",
      }}
      className="hidden p-6 md:flex md:basis-[48%] md:shrink md:grow-0 md:min-w-0 md:p-8 lg:basis-[52%] lg:p-12"
    >
      {/* Decorative blobs */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -120,
          right: -120,
          width: 480,
          height: 480,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,91,227,0.35) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: -80,
          left: -80,
          width: 360,
          height: 360,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(220,38,38,0.2) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      {/* Subtle grid overlay */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          pointerEvents: "none",
        }}
      />

      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 36, position: "relative", zIndex: 1 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "rgba(255,255,255,0.15)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <Image
            src="/logo.png"
            alt="Datalia"
            width={32}
            height={28}
            style={{ objectFit: "contain" }}
          />
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "0.08em", color: "#fff" }}>
            DATALIA
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", letterSpacing: "0.04em" }}>
            Marketing Automation
          </div>
        </div>
      </div>

      {/* Main copy */}
      <div style={{ flex: 1, position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 100,
            padding: "4px 14px",
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.85)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 20,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
          AI-Powered Platform
        </div>

        <h1
          className="text-3xl lg:text-[40px]"
          style={{
            fontWeight: 800,
            lineHeight: 1.15,
            color: "#fff",
            margin: "0 0 16px",
            letterSpacing: "-0.02em",
          }}
        >
          Post less.{" "}
          <span
            style={{
              background: "linear-gradient(90deg, #93c5fd, #c4b5fd)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Grow more.
          </span>
        </h1>

        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.65,
            color: "rgba(255,255,255,0.65)",
            margin: "0 0 24px",
            maxWidth: 380,
          }}
        >
          Datalia drafts your captions, crops for every platform, and schedules across
          Facebook, Instagram, TikTok and LinkedIn — from one composer.
        </p>

        {/* Feature list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    color: f.color,
                    fontSize: 16,
                  }}
                >
                  <Icon />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: "#fff", marginBottom: 2 }}>
                    {f.title}
                  </div>
                  <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.45 }}>
                    {f.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Platform chips */}
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>
            Connected networks
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {PLATFORMS.map((p) => (
              <div
                key={p.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: typeof p.color === "string" && p.color.startsWith("url") ? "#e1306c" : p.color,
                    display: "inline-block",
                  }}
                />
                {p.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom stats */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          paddingTop: 24,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          marginTop: 24,
        }}
      >
        {STATS.map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", lineHeight: 1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   RIGHT — Auth panel
   ══════════════════════════════════════ */
function AuthPanel({ isDark, dispatch, resolved }) {
  const authStatus = useSelector((s) => s.auth.status);
  const authError = useSelector((s) => s.auth.error);
  const [activeTab, setActiveTab] = useState("login");
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();

  const isLoading = authStatus === "authenticating";

  const handleTabChange = useCallback(
    (key) => {
      setActiveTab(key);
      if (authError) dispatch(clearAuthError());
    },
    [authError, dispatch]
  );

  const handleLogin = (values) => {
    dispatch(loginThunk({ email: values.email.trim(), password: values.password }));
  };

  const handleRegister = (values) => {
    dispatch(
      registerThunk({
        email: values.email.trim(),
        password: values.password,
        name: values.name.trim(),
      })
    );
  };

  const bg = isDark ? "#0d1526" : "#f8faff";
  const cardBg = isDark ? "#111827" : "#ffffff";
  const textPrimary = isDark ? "#f1f5f9" : "#0f172a";
  const textMuted = isDark ? "#94a3b8" : "#64748b";

  return (
    <div
      className="h-full w-full min-w-0 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6 md:px-8"
      style={{
        flex: 1,
        minWidth: 0,
        background: bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // `safe center` keeps the block centered when it fits, but top-aligns it
        // when the (taller) Create Account form overflows — otherwise plain
        // `center` clips the header above the scroll area and it's unreachable.
        justifyContent: "safe center",
        position: "relative",
      }}
    >
      {/* Theme toggle */}
      <button
        onClick={() => dispatch(setTheme(resolved === "dark" ? "light" : "dark"))}
        aria-label="Toggle theme"
        className="!top-3 !right-3 sm:!top-6 sm:!right-6"
        style={{
          position: "absolute",
          width: 36,
          height: 36,
          borderRadius: 8,
          border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: textMuted,
          fontSize: 16,
          transition: "all 0.2s",
        }}
      >
        {isDark ? <SunOutlined /> : <MoonOutlined />}
      </button>

      <div style={{ width: "100%", maxWidth: 420, minWidth: 0 }}>
        {/* Card header */}
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <Title
            level={2}
            className="!text-2xl sm:!text-[28px]"
            style={{
              margin: 0,
              fontWeight: 800,
              color: textPrimary,
              letterSpacing: "-0.02em",
            }}
          >
            {activeTab === "login" ? "Welcome back" : "Create account"}
          </Title>
          <Text style={{ color: textMuted, fontSize: 14, display: "block", marginTop: 8 }}>
            {activeTab === "login"
              ? "Sign in to your Datalia workspace"
              : "Join your Datalia marketing workspace"}
          </Text>
        </div>

        {/* Auth card */}
        <div
          className="p-5 sm:p-8"
          style={{
            background: cardBg,
            borderRadius: 16,
            boxShadow: isDark
              ? "0 4px 40px rgba(0,0,0,0.5)"
              : "0 4px 40px rgba(29,63,190,0.08), 0 1px 4px rgba(0,0,0,0.06)",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(29,63,190,0.08)"}`,
          }}
        >
          {/* Tabs */}
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            centered
            items={[
              { key: "login", label: "Sign In" },
              { key: "register", label: "Create Account" },
            ]}
            style={{ marginBottom: 24 }}
          />

          {/* Error alert */}
          {authError && (
            <Alert
              type="error"
              message={authError}
              showIcon
              style={{ marginBottom: 20, borderRadius: 8 }}
            />
          )}

          {/* Login form */}
          {activeTab === "login" && (
            <Form
              form={loginForm}
              layout="vertical"
              onFinish={handleLogin}
              requiredMark={false}
              size="large"
            >
              <Form.Item
                name="email"
                label={<span style={{ color: textPrimary, fontSize: 13, fontWeight: 500 }}>Email address</span>}
                rules={[
                  { required: true, message: "Please enter your email" },
                  { type: "email", message: "Please enter a valid email" },
                ]}
              >
                <Input
                  prefix={<MailOutlined style={{ color: textMuted }} />}
                  placeholder="you@datalia.app"
                  disabled={isLoading}
                  autoComplete="email"
                  style={{ borderRadius: 8, height: 44 }}
                />
              </Form.Item>

              <Form.Item
                name="password"
                label={<span style={{ color: textPrimary, fontSize: 13, fontWeight: 500 }}>Password</span>}
                rules={[{ required: true, message: "Please enter your password" }]}
                style={{ marginBottom: 24 }}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: textMuted }} />}
                  placeholder="Your password"
                  disabled={isLoading}
                  autoComplete="current-password"
                  style={{ borderRadius: 8, height: 44 }}
                />
              </Form.Item>

              <div style={{ textAlign: "right", marginTop: -12, marginBottom: 16 }}>
                <a
                  href="/forgot-password"
                  style={{ color: "#1d3fbe", fontSize: 13, fontWeight: 500 }}
                >
                  Forgot password?
                </a>
              </div>

              <Button
                type="primary"
                htmlType="submit"
                loading={isLoading}
                block
                size="large"
                icon={!isLoading ? <ArrowRightOutlined /> : null}
                iconPlacement="end"
                style={{
                  height: 46,
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 15,
                  background: "linear-gradient(135deg, #1d3fbe, #3b5be3)",
                  border: "none",
                  boxShadow: "0 4px 16px rgba(29,63,190,0.35)",
                }}
              >
                {isLoading ? "Signing in…" : "Sign In"}
              </Button>
            </Form>
          )}

          {/* Register form */}
          {activeTab === "register" && (
            <Form
              form={registerForm}
              layout="vertical"
              onFinish={handleRegister}
              requiredMark={false}
              size="large"
            >
              <Form.Item
                name="name"
                label={<span style={{ color: textPrimary, fontSize: 13, fontWeight: 500 }}>Full name</span>}
                rules={[{ required: true, message: "Please enter your name" }]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: textMuted }} />}
                  placeholder="Your full name"
                  disabled={isLoading}
                  autoComplete="name"
                  style={{ borderRadius: 8, height: 44 }}
                />
              </Form.Item>

              <Form.Item
                name="email"
                label={<span style={{ color: textPrimary, fontSize: 13, fontWeight: 500 }}>Email address</span>}
                rules={[
                  { required: true, message: "Please enter your email" },
                  { type: "email", message: "Please enter a valid email" },
                ]}
              >
                <Input
                  prefix={<MailOutlined style={{ color: textMuted }} />}
                  placeholder="you@datalia.app"
                  disabled={isLoading}
                  autoComplete="email"
                  style={{ borderRadius: 8, height: 44 }}
                />
              </Form.Item>

              <Form.Item
                name="password"
                label={<span style={{ color: textPrimary, fontSize: 13, fontWeight: 500 }}>Password</span>}
                rules={[
                  { required: true, message: "Please enter a password" },
                  { min: 6, message: "Password must be at least 6 characters" },
                ]}
                style={{ marginBottom: 24 }}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: textMuted }} />}
                  placeholder="At least 6 characters"
                  disabled={isLoading}
                  autoComplete="new-password"
                  style={{ borderRadius: 8, height: 44 }}
                />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                loading={isLoading}
                block
                size="large"
                icon={!isLoading ? <ArrowRightOutlined /> : null}
                iconPlacement="end"
                style={{
                  height: 46,
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 15,
                  background: "linear-gradient(135deg, #1d3fbe, #3b5be3)",
                  border: "none",
                  boxShadow: "0 4px 16px rgba(29,63,190,0.35)",
                }}
              >
                {isLoading ? "Creating account…" : "Create Account"}
              </Button>
            </Form>
          )}
        </div>

        {/* Legal */}
        {hasLegalLinks && (
          <Text
            style={{
              display: "block",
              textAlign: "center",
              marginTop: 20,
              color: textMuted,
              fontSize: 12,
            }}
          >
            By continuing, you agree to our{" "}
            <a
              href={`${policyBase}/terms`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1d3fbe" }}
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href={`${policyBase}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1d3fbe" }}
            >
              Privacy Policy
            </a>
            .
          </Text>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            marginTop: hasLegalLinks ? 12 : 24,
          }}
        >
          <Text style={{ color: textMuted, fontSize: 12 }}>
            © {new Date().getFullYear()} Datalia. All rights reserved.
          </Text>
        </div>
      </div>
    </div>
  );
}
