"use client";

import { useSelector, useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { toggleSidebar, setActiveView, setMobileNav } from "../../store/uiSlice";
import { useIsMobile } from "../../lib/useIsMobile";
import { Tooltip, Avatar, Badge } from "antd";
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
  PlusOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { hasPermission } from "../../lib/permissions";

export default function Sidebar() {
  const dispatch = useDispatch();
  const { sidebarCollapsed, activeView, mobileNavOpen } = useSelector((s) => s.ui);
  const user    = useSelector((s) => s.auth.user);
  const isMobile = useIsMobile();
  const collapsed = isMobile ? false : sidebarCollapsed;

  const t = useTranslations("nav");
  const tSidebar = useTranslations("sidebar");
  const tCommon = useTranslations("common");
  const tCreation = useTranslations("creation");

  // Items may carry a `perm`; the section is shown only with the items the
  // caller's workspace role grants. "Équipe & Accès" labels are literal (the
  // i18n bundles can adopt them later) so a missing key never breaks the nav.
  const RAW_NAV_SECTIONS = [
    {
      title: t("sectionContent"),
      items: [
        { key: "dashboard", icon: <DashboardOutlined />, label: tSidebar("dashboard") },
        { key: "creation",  icon: <EditOutlined />,      label: tCreation("title")    },
        { key: "calendar",  icon: <CalendarOutlined />,  label: tSidebar("calendar")  },
        { key: "library",   icon: <PictureOutlined />,   label: tSidebar("library")   },
      ],
    },
    {
      title: t("sectionAutomation"),
      items: [
        { key: "automation", icon: <RobotOutlined />,       label: tSidebar("automation"), badge: "NEW" },
        { key: "videos",     icon: <VideoCameraOutlined />, label: tSidebar("videos"),     badge: "NEW" },
      ],
    },
    {
      title: t("sectionPerformance"),
      items: [
        { key: "analytics", icon: <BarChartOutlined />,  label: tSidebar("analytics") },
        { key: "credits",   icon: <CreditCardOutlined />,label: tSidebar("credits")   },
      ],
    },
    {
      title: "Équipe & Accès",
      items: [
        { key: "members", icon: <TeamOutlined />,                label: "Utilisateurs",       perm: "members.read" },
        { key: "roles",   icon: <SafetyCertificateOutlined />,   label: "Rôles & permissions", perm: "roles.read"   },
      ],
    },
    {
      title: t("sectionAccount"),
      items: [
        { key: "settings", icon: <SettingOutlined />, label: tCommon("settings") },
      ],
    },
  ];

  // Drop items the role doesn't grant, then drop now-empty sections.
  const NAV_SECTIONS = RAW_NAV_SECTIONS
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => !it.perm || hasPermission(user, it.perm)),
    }))
    .filter((s) => s.items.length > 0);

  const NAV_ITEMS_FLAT = NAV_SECTIONS.flatMap((s) => s.items);

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "DT";

  const ACCENT = "var(--accent-primary)";

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
        background: "var(--bg-card)",
        borderRight: "1px solid var(--border-default)",
        transform: isMobile && !mobileNavOpen ? "translateX(-100%)" : "translateX(0)",
        boxShadow: isMobile && mobileNavOpen ? "var(--shadow-lg)" : "none",
      }}
    >
      {/* ── Logo ──────────────────────────────────────────────────── */}
      <div style={{
        height: "var(--topbar-height)",
        display: "flex",
        alignItems: "center",
        padding: collapsed ? "0 14px" : "0 18px",
        borderBottom: "1px solid var(--border-default)",
        gap: 11,
        overflow: "hidden",
        flexShrink: 0,
      }}>
        <div style={{
          width: 34, height: 34,
          borderRadius: 10,
          background: "var(--accent-gradient)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "var(--accent-glow)",
        }}>
          <ThunderboltOutlined style={{ color: "#fff", fontSize: 15 }} />
        </div>
        {!collapsed && (
          <div style={{ overflow: "hidden" }}>
            <div style={{
              fontFamily: "var(--font-display, 'Plus Jakarta Sans'), sans-serif",
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: "0.10em",
              color: "var(--text-primary)",
              lineHeight: 1.2,
            }}>
              {tCommon("appName")}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
              {t("marketingAutomation")}
            </div>
          </div>
        )}
      </div>

      {/* ── Bouton Nouveau post ──────────────────────────────────── */}
      <div style={{ padding: collapsed ? "10px 8px 0" : "10px 10px 0", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => {
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
            borderRadius: 10,
            border: "none",
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
            cursor: "pointer",
            transition: "all 0.2s",
            background: "var(--accent-gradient)",
            boxShadow: "var(--accent-glow)",
            padding: collapsed ? "10px" : "10px 16px 10px",
            marginBottom: collapsed ? 0 : 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
        >
          <PlusOutlined style={{ fontSize: 15 }} />
          {!collapsed && <span>{t("newPost")}</span>}
        </button>
      </div>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "6px 0" }}>
        {collapsed ? (
          /* Mode réduit : icônes avec tooltips */
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 8px" }}>
            {NAV_ITEMS_FLAT.map((item) => {
              const isActive = activeView === item.key;
              return (
                <Tooltip key={item.key} title={item.label} placement="right">
                  <button
                    onClick={() => dispatch(setActiveView(item.key))}
                    style={{
                      width: "100%", height: 38,
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isActive ? `rgba(91,91,214,0.12)` : "transparent",
                      color: isActive ? ACCENT : "var(--text-tertiary)",
                      fontSize: 15,
                      transition: "all 0.15s",
                      position: "relative",
                    }}
                  >
                    {isActive && (
                      <span style={{
                        position: "absolute", left: 0,
                        top: "50%", transform: "translateY(-50%)",
                        width: 3, height: 18,
                        borderRadius: "0 3px 3px 0",
                        background: ACCENT,
                      }} />
                    )}
                    {item.badge ? (
                      <Badge count={item.badge} size="small"
                        style={{ fontSize: 8, lineHeight: "12px", height: 12, minWidth: 24, padding: "0 3px" }}>
                        {item.icon}
                      </Badge>
                    ) : item.icon}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          /* Mode développé : sections groupées */
          <nav aria-label={t("mainNavigation")}>
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} style={{ marginBottom: 4 }}>
                <p style={{
                  margin: 0,
                  padding: "14px 18px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.10em",
                  color: "var(--text-muted)",
                }}>
                  {section.title}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0 8px" }}>
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
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "none",
                          cursor: "pointer",
                          fontSize: 13.5,
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? ACCENT : "var(--text-secondary)",
                          background: isActive ? "rgba(91,91,214,0.10)" : "transparent",
                          transition: "all 0.15s",
                          textAlign: "left",
                          position: "relative",
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.background = "var(--bg-secondary)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {isActive && (
                          <span style={{
                            position: "absolute", left: 0,
                            top: "50%", transform: "translateY(-50%)",
                            width: 3, height: 16,
                            borderRadius: "0 3px 3px 0",
                            background: ACCENT,
                          }} />
                        )}
                        <span style={{ fontSize: 15, width: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {item.badge ? (
                            <Badge count={item.badge} size="small"
                              style={{ fontSize: 8, lineHeight: "12px", height: 12, minWidth: 24, padding: "0 3px" }}>
                              {item.icon}
                            </Badge>
                          ) : item.icon}
                        </span>
                        {item.label}
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
      <div style={{ borderTop: "1px solid var(--border-default)", padding: "10px 8px", flexShrink: 0 }}>
        {/* Bouton collapse — bureau uniquement */}
        {!isMobile && (
          <button
            id="sidebar-toggle"
            onClick={() => dispatch(toggleSidebar())}
            title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
            style={{
              width: "100%", height: 34,
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              color: "var(--text-tertiary)",
              fontSize: 13,
              transition: "all 0.15s",
              marginBottom: 8,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-secondary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
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
            background: "var(--bg-secondary)",
          }}>
            <Avatar size={30} style={{
              background: "var(--accent-gradient)",
              fontWeight: 700, fontSize: 11, flexShrink: 0,
            }}>
              {initials}
            </Avatar>
            <div style={{ overflow: "hidden", flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {user?.name || tSidebar("team")}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {user?.email ? user.email.split("@")[0] : tSidebar("admin")}
              </div>
            </div>
            <Badge status="success" title={t("online")} />
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Tooltip title={user?.name || tSidebar("team")} placement="right">
              <Avatar size={30} style={{
                background: "var(--accent-gradient)",
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
