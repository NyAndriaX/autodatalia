"use client";

import { useSelector, useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { toggleSidebar, setActiveView } from "../../store/uiSlice";
import { useIsMobile } from "../../lib/useIsMobile";
import {
  Sparkles,
  CalendarDays,
  Image as ImageIcon,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  LayoutDashboard,
  Coins,
  Bot,
  Film,
} from "lucide-react";

// Stable nav order — labels are resolved through useTranslations() at
// render time so locale switches update the sidebar instantly.
const NAV_ITEMS = [
  { id: "dashboard", icon: LayoutDashboard },
  { id: "creation", icon: Sparkles },
  { id: "automation", icon: Bot },
  { id: "calendar", icon: CalendarDays },
  { id: "library", icon: ImageIcon },
  { id: "videos", icon: Film },
  { id: "analytics", icon: BarChart3 },
  { id: "credits", icon: Coins },
  { id: "settings", icon: Settings },
];

export default function Sidebar() {
  const dispatch = useDispatch();
  const t = useTranslations("sidebar");
  const tCommon = useTranslations("common");
  const { sidebarCollapsed, activeView, mobileNavOpen } = useSelector(
    (state) => state.ui
  );
  const isMobile = useIsMobile();
  // Map nav ids to translation keys so we can render both label and
  // sub-description from the messages bundle.
  const labelFor = (id) => (id === "settings" ? tCommon("settings") : t(id));
  const descFor = (id) =>
    id === "settings" ? t("settingsDesc") : t(`${id}Desc`);
  // On mobile the sidebar is a full off-canvas drawer (never the icon-only
  // collapsed state); on desktop it keeps the collapse behaviour.
  const collapsed = isMobile ? false : sidebarCollapsed;

  return (
    <aside
      id="sidebar-nav"
      className="fixed left-0 top-0 h-full z-50 flex flex-col transition-all duration-300 ease-in-out"
      style={{
        width: collapsed ? "72px" : "260px",
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border-default)",
        transform:
          isMobile && !mobileNavOpen ? "translateX(-100%)" : "translateX(0)",
        boxShadow: isMobile && mobileNavOpen ? "var(--shadow-dropdown)" : "none",
      }}
    >
      {/* Logo Section */}
      <div
        className="flex items-center gap-3 px-4 shrink-0"
        style={{
          height: "var(--topbar-height)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 36,
            height: 36,
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-gradient)",
          }}
        >
          <Zap size={20} color="white" />
        </div>
        {!collapsed && (
          <div className="animate-fade-in overflow-hidden">
            <h1
              className="font-bold text-base leading-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {tCommon("appName")}
            </h1>
            <p
              className="text-xs leading-tight"
              style={{ color: "var(--text-tertiary)" }}
            >
              {tCommon("appTagline")}
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 flex flex-col gap-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          const Icon = item.icon;
          const label = labelFor(item.id);
          const description = descFor(item.id);

          return (
            <button
              key={item.id}
              id={`nav-${item.id}`}
              onClick={() => dispatch(setActiveView(item.id))}
              className="group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 w-full text-left"
              style={{
                background: isActive
                  ? "rgba(99, 102, 241, 0.12)"
                  : "transparent",
                color: isActive
                  ? "var(--accent-primary-hover)"
                  : "var(--text-secondary)",
              }}
              title={collapsed ? label : undefined}
            >
              {/* Active indicator */}
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
                  style={{
                    width: 3,
                    height: 24,
                    background: "var(--accent-primary)",
                  }}
                />
              )}

              <Icon
                size={20}
                className="shrink-0 transition-colors duration-200"
                style={{
                  color: isActive
                    ? "var(--accent-primary-hover)"
                    : undefined,
                }}
              />

              {!collapsed && (
                <div className="overflow-hidden animate-fade-in">
                  <span className="text-sm font-medium block leading-tight">
                    {label}
                  </span>
                  <span
                    className="text-xs block leading-tight"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {description}
                  </span>
                </div>
              )}

              {/* Hover tooltip when collapsed */}
              {collapsed && (
                <div
                  className="absolute left-full ml-3 px-3 py-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 whitespace-nowrap z-[60]"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-hover)",
                    color: "var(--text-primary)",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                  }}
                >
                  {label}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div
        className="px-3 py-3 shrink-0"
        style={{ borderTop: "1px solid var(--border-default)" }}
      >
        {/* Collapse Toggle — desktop only (mobile uses the drawer) */}
        {!isMobile && (
          <button
            id="sidebar-toggle"
            onClick={() => dispatch(toggleSidebar())}
            className="flex items-center justify-center w-full py-2 rounded-lg transition-all duration-200"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
            }}
          >
            {collapsed ? (
              <ChevronRight size={18} />
            ) : (
              <ChevronLeft size={18} />
            )}
            {!collapsed && (
              <span className="ml-2 text-xs font-medium">{t("collapse")}</span>
            )}
          </button>
        )}

        {/* User avatar */}
        {!collapsed && (
          <div
            className="flex items-center gap-3 mt-3 px-3 py-2.5 rounded-lg animate-fade-in"
            style={{ background: "var(--bg-tertiary)" }}
          >
            <div
              className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
              style={{ background: "var(--accent-gradient)" }}
            >
              DT
            </div>
            <div className="overflow-hidden">
              <p
                className="text-sm font-medium leading-tight truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {t("team")}
              </p>
              <p
                className="text-xs leading-tight truncate"
                style={{ color: "var(--text-muted)" }}
              >
                {t("admin")}
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
