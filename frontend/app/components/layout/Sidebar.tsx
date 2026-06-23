"use client";

import { useSelector, useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { toggleSidebar, setActiveView, setMobileNav } from "../../store/uiSlice";
import { useIsMobile } from "../../lib/useIsMobile";
import { Tooltip, Avatar, Badge } from "antd";
// nav classes are applied inline to use sidebar-specific dark tokens
import {
  DASHBOARD_NAV_SECTIONS,
  DASHBOARD_VIEW_REGISTRY,
} from "../../dashboard/viewRoutes";
import {
  DashboardOutlined,
  EditOutlined,
  RobotOutlined,
  CalendarOutlined,
  PictureOutlined,
  BarChartOutlined,
  CreditCardOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
  FileImageOutlined,
  PlusOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { hasPermission } from "../../lib/permissions";
import { resetEditor } from "../../store/editorSlice";

const ICONS = {
  dashboard: <DashboardOutlined />,
  edit: <EditOutlined />,
  automation: <RobotOutlined />,
  calendar: <CalendarOutlined />,
  library: <PictureOutlined />,
  analytics: <BarChartOutlined />,
  credits: <CreditCardOutlined />,
  settings: <SettingOutlined />,
  video: <VideoCameraOutlined />,
  image: <FileImageOutlined />,
  members: <TeamOutlined />,
  roles: <SafetyCertificateOutlined />,
};

export default function Sidebar() {
  const dispatch = useDispatch<any>();
  const { sidebarCollapsed, activeView, mobileNavOpen } = useSelector((s: any) => s.ui);
  const user    = useSelector((s: any) => s.auth.user);
  const isMobile = useIsMobile();
  const collapsed = isMobile ? false : sidebarCollapsed;

  const t = useTranslations("nav");
  const tSidebar = useTranslations("sidebar");
  const tCommon = useTranslations("common");
  const tCreation = useTranslations("creation");
  const tTeam = useTranslations("team");

  const translateLabel = (label) => {
    if (label.namespace === "creation") return tCreation(label.key);
    if (label.namespace === "team") return tTeam(label.key);
    if (label.namespace === "common") return tCommon(label.key);
    return tSidebar(label.key);
  };

  const RAW_NAV_SECTIONS = DASHBOARD_NAV_SECTIONS.map((section) => ({
    title: t(section.titleKey),
    items: section.views.map((key) => {
      const meta = DASHBOARD_VIEW_REGISTRY[key];
      return {
        key,
        label: translateLabel(meta.label),
        icon: ICONS[meta.icon] || ICONS.dashboard,
        perm: meta.permission,
        hidden: meta.hidden,
        primary: meta.primary,
      };
    }),
  }));

  // Drop items the role doesn't grant, then drop now-empty sections.
  const NAV_SECTIONS = RAW_NAV_SECTIONS
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => !it.hidden && (!it.perm || hasPermission(user, it.perm))),
    }))
    .filter((s) => s.items.length > 0);

  const NAV_ITEMS_FLAT = NAV_SECTIONS.flatMap((s) => s.items);

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "DT";

  const ACCENT = "var(--sidebar-accent)";
  const SB = {
    bg:         "var(--sidebar-bg)",
    border:     "var(--sidebar-border)",
    text:       "var(--sidebar-text)",
    textMuted:  "var(--sidebar-text-muted)",
    textActive: "var(--sidebar-text-active)",
    hover:      "var(--sidebar-bg-hover)",
    active:     "var(--sidebar-bg-active)",
    accent:     "var(--sidebar-accent)",
    label:      "var(--sidebar-section-label)",
  };

  return (
    <aside
      id="sidebar-nav"
      style={{
        position: "fixed",
        left: 0, top: 0,
        height: "100vh",
        zIndex: 50,
        width: collapsed
          ? "var(--sidebar-collapsed)"
          : isMobile
            ? "min(var(--sidebar-width), 85vw)"
            : "var(--sidebar-width)",
        maxWidth: "100vw",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
        background: SB.bg,
        borderRight: `1px solid ${SB.border}`,
        transform: isMobile && !mobileNavOpen ? "translateX(-100%)" : "translateX(0)",
        boxShadow: isMobile && mobileNavOpen ? "0 8px 32px rgba(0,0,0,0.45)" : "none",
      }}
    >
      {/* ── Logo ──────────────────────────────────────────────────── */}
      <div style={{
        height: "var(--topbar-height)",
        display: "flex",
        alignItems: "center",
        padding: collapsed ? "0" : "0 18px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderBottom: `1px solid ${SB.border}`,
        gap: 10,
        overflow: "hidden",
        flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32,
          borderRadius: 9,
          background: "linear-gradient(135deg,#3b82f6 0%,#2563eb 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 0 0 1px rgba(59,130,246,0.3), 0 4px 12px rgba(37,99,235,0.35)",
        }}>
          <ThunderboltOutlined style={{ color: "#fff", fontSize: 15 }} />
        </div>
        {!collapsed && (
          <div style={{ overflow: "hidden" }}>
            <div style={{
              fontFamily: "var(--font-display, 'Plus Jakarta Sans'), sans-serif",
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: "-0.025em",
              color: SB.textActive,
              lineHeight: 1.2,
            }}>
              {tCommon("appName")}
            </div>
            <div style={{ fontSize: 10, color: SB.textMuted, letterSpacing: "0.03em" }}>
              {t("marketingAutomation")}
            </div>
          </div>
        )}
      </div>

      {/* ── Bouton Nouveau post ──────────────────────────────────── */}
      <div style={{ padding: collapsed ? "12px 10px 2px" : "12px 12px 4px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => {
            dispatch(resetEditor());
            dispatch(setActiveView("creation"));
            if (isMobile) dispatch(setMobileNav(false));
          }}
          title={tCreation("title")}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            borderRadius: 8,
            border: "none",
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
            cursor: "pointer",
            transition: "all 0.2s",
            background: "#2563eb",
            boxShadow: "0 1px 2px rgba(15,23,42,0.10)",
            padding: collapsed ? "10px" : "10px 16px",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#1d4ed8"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#2563eb"; }}
        >
          <PlusOutlined style={{ fontSize: 14 }} />
          {!collapsed && <span>{t("newPost")}</span>}
        </button>
      </div>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "4px 0 10px" }}>
        {collapsed ? (
          /* Mode réduit : icônes avec tooltips */
          <div className="flex flex-col gap-0.5 px-2 py-1">
            {NAV_ITEMS_FLAT.map((item) => {
              const isActive = activeView === item.key;
              return (
                <Tooltip key={item.key} title={item.label} placement="right">
                  <button
                    onClick={() => dispatch(setActiveView(item.key))}
                    style={{
                      position: "relative",
                      width: "100%", height: 42,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 16,
                      borderRadius: 8,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isActive ? SB.active : "transparent",
                      color: isActive ? SB.textActive : SB.text,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = SB.hover; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                  >
                    {item.icon}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          /* Mode développé : sections groupées */
          <nav aria-label={t("mainNavigation")}>
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} className="px-2">
                <p style={{
                  padding: "16px 12px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: SB.label,
                  lineHeight: 1.2,
                }}>
                  {section.title}
                </p>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const isActive = activeView === item.key;
                    return (
                      <button
                        key={item.key}
                        onClick={() => {
                          dispatch(setActiveView(item.key));
                          if (isMobile) dispatch(setMobileNav(false));
                        }}
                        style={{
                          position: "relative",
                          display: "flex",
                          width: "100%",
                          alignItems: "center",
                          gap: 10,
                          border: "none",
                          borderRadius: 8,
                          height: 42,
                          lineHeight: "42px",
                          padding: "0 12px",
                          cursor: "pointer",
                          fontSize: 13.5,
                          fontWeight: isActive ? 600 : 500,
                          background: isActive ? SB.active : "transparent",
                          color: isActive ? SB.textActive : SB.text,
                          transition: "all 0.15s",
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = SB.hover; }}
                        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{
                          fontSize: 15,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 20, flexShrink: 0,
                          color: isActive ? "#fff" : SB.textMuted,
                        }}>
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        )}
      </div>

      {/* ── Pied de page ─────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${SB.border}`, padding: "10px 8px", flexShrink: 0 }}>
        {/* Bouton collapse — bureau uniquement */}
        {!isMobile && (
          <button
            id="sidebar-toggle"
            onClick={() => dispatch(toggleSidebar())}
            title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
            style={{
              width: "100%", height: 32,
              border: `1px solid ${SB.border}`,
              borderRadius: 8,
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              color: SB.textMuted,
              fontSize: 13,
              transition: "all 0.15s",
              marginBottom: 8,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = SB.hover; e.currentTarget.style.color = SB.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = SB.textMuted; }}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            {!collapsed && <span style={{ fontSize: 12, fontWeight: 500 }}>{tSidebar("collapse")}</span>}
          </button>
        )}

        {/* Info utilisateur */}
        {!collapsed ? (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "8px 10px",
            borderRadius: 10,
            background: SB.hover,
            border: `1px solid ${SB.border}`,
          }}>
            <Avatar size={30} style={{
              background: "linear-gradient(135deg,#3b82f6 0%,#2563eb 100%)",
              fontWeight: 700, fontSize: 11, flexShrink: 0,
            }}>
              {initials}
            </Avatar>
            <div style={{ overflow: "hidden", flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: SB.textActive, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {user?.name || tSidebar("team")}
              </div>
              <div style={{ fontSize: 10, color: SB.textMuted }}>
                {user?.email ? user.email.split("@")[0] : tSidebar("admin")}
              </div>
            </div>
            <Badge status="success" title={t("online")} />
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Tooltip title={user?.name || tSidebar("team")} placement="right">
              <Avatar size={30} style={{
                background: "linear-gradient(135deg,#3b82f6 0%,#2563eb 100%)",
                fontWeight: 700, fontSize: 11, cursor: "pointer",
              }}>
                {initials}
              </Avatar>
            </Tooltip>
          </div>
        )}
      </div>
    </aside>
  );
}
