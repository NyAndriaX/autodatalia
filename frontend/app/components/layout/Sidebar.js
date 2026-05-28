"use client";

import { useSelector, useDispatch } from "react-redux";
import { toggleSidebar, setActiveView, setMobileNav } from "../../store/uiSlice";
import { useIsMobile } from "../../lib/useIsMobile";
import { Menu, Tooltip, Avatar, Badge } from "antd";
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
} from "@ant-design/icons";

const NAV_ITEMS = [
  {
    key: "dashboard",
    icon: <DashboardOutlined />,
    label: "Dashboard",
    badge: null,
  },
  {
    key: "creation",
    icon: <EditOutlined />,
    label: "Creation & Editor",
    badge: null,
  },
  {
    key: "automation",
    icon: <RobotOutlined />,
    label: "Automation",
    badge: "NEW",
  },
  {
    key: "calendar",
    icon: <CalendarOutlined />,
    label: "Calendar",
    badge: null,
  },
  {
    key: "library",
    icon: <PictureOutlined />,
    label: "Media Library",
    badge: null,
  },
  {
    key: "videos",
    icon: <VideoCameraOutlined />,
    label: "AI Video",
    badge: "NEW",
  },
  {
    key: "analytics",
    icon: <BarChartOutlined />,
    label: "Analytics",
    badge: null,
  },
  {
    key: "credits",
    icon: <CreditCardOutlined />,
    label: "Credits",
    badge: null,
  },
  {
    key: "settings",
    icon: <SettingOutlined />,
    label: "Settings",
    badge: null,
  },
];

export default function Sidebar() {
  const dispatch = useDispatch();
  const { sidebarCollapsed, activeView, mobileNavOpen } = useSelector(
    (state) => state.ui
  );
  const user = useSelector((state) => state.auth.user);
  const isMobile = useIsMobile();
  const collapsed = isMobile ? false : sidebarCollapsed;

  const userInitials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "DT";

  const menuItems = NAV_ITEMS.map((item) => ({
    key: item.key,
    icon: item.badge ? (
      <Badge
        count={item.badge}
        size="small"
        style={{ fontSize: 9, lineHeight: "14px", height: 14, minWidth: 28, padding: "0 4px" }}
      >
        {item.icon}
      </Badge>
    ) : (
      item.icon
    ),
    label: collapsed ? null : item.label,
  }));

  return (
    <aside
      id="sidebar-nav"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        height: "100vh",
        zIndex: 50,
        width: collapsed ? 72 : 240,
        display: "flex",
        flexDirection: "column",
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border-default)",
        transform:
          isMobile && !mobileNavOpen ? "translateX(-100%)" : "translateX(0)",
        boxShadow:
          isMobile && mobileNavOpen
            ? "4px 0 24px rgba(0,0,0,0.15)"
            : "none",
      }}
    >
      {/* Logo */}
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          padding: collapsed ? "0 16px" : "0 20px",
          borderBottom: "1px solid var(--border-default)",
          gap: 12,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            background: "linear-gradient(135deg, #15307f 0%, #1d3fbe 50%, #3b5be3 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 2px 8px rgba(29,63,190,0.4)",
          }}
        >
          <ThunderboltOutlined style={{ color: "#fff", fontSize: 16 }} />
        </div>
        {!collapsed && (
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: "0.08em",
                color: "var(--text-primary)",
                lineHeight: 1.2,
              }}
            >
              DATALIA
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
              }}
            >
              Marketing Automation
            </div>
          </div>
        )}
      </div>

      {/* Navigation menu */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 0" }}>
        {collapsed ? (
          /* Collapsed: icon-only with tooltips */
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 8px" }}>
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.key;
              return (
                <Tooltip key={item.key} title={item.label} placement="right">
                  <button
                    onClick={() => dispatch(setActiveView(item.key))}
                    style={{
                      width: "100%",
                      height: 40,
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isActive
                        ? "rgba(29,63,190,0.12)"
                        : "transparent",
                      color: isActive ? "#1d3fbe" : "var(--text-secondary)",
                      fontSize: 16,
                      transition: "all 0.15s",
                      position: "relative",
                    }}
                  >
                    {isActive && (
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 3,
                          height: 20,
                          borderRadius: "0 3px 3px 0",
                          background: "#1d3fbe",
                        }}
                      />
                    )}
                    {item.badge ? (
                      <Badge
                        count={item.badge}
                        size="small"
                        style={{ fontSize: 9, lineHeight: "14px", height: 14, minWidth: 28, padding: "0 4px" }}
                      >
                        {item.icon}
                      </Badge>
                    ) : (
                      item.icon
                    )}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          /* Expanded: antd Menu */
          <Menu
            mode="inline"
            selectedKeys={[activeView]}
            onClick={({ key }) => {
              dispatch(setActiveView(key));
              if (isMobile) dispatch(setMobileNav(false));
            }}
            items={menuItems}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 13,
            }}
          />
        )}
      </div>

      {/* Bottom section */}
      <div
        style={{
          borderTop: "1px solid var(--border-default)",
          padding: "12px 8px",
          flexShrink: 0,
        }}
      >
        {/* Collapse toggle — desktop only */}
        {!isMobile && (
          <button
            id="sidebar-toggle"
            onClick={() => dispatch(toggleSidebar())}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              width: "100%",
              height: 36,
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--text-secondary)",
              fontSize: 14,
              transition: "all 0.15s",
              marginBottom: 10,
            }}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            {!collapsed && (
              <span style={{ fontSize: 12, fontWeight: 500 }}>Collapse</span>
            )}
          </button>
        )}

        {/* User info */}
        {!collapsed && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 8,
              background: "var(--bg-tertiary)",
            }}
          >
            <Avatar
              size={32}
              style={{
                background: "linear-gradient(135deg, #1d3fbe, #3b5be3)",
                fontWeight: 700,
                fontSize: 12,
                flexShrink: 0,
              }}
            >
              {userInitials}
            </Avatar>
            <div style={{ overflow: "hidden", flex: 1 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {user?.name || "Datalia Team"}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}
              >
                {user?.email ? user.email.split("@")[0] : "Admin"}
              </div>
            </div>
            <Badge
              status="success"
              style={{ flexShrink: 0 }}
              title="Online"
            />
          </div>
        )}

        {/* Collapsed avatar */}
        {collapsed && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Tooltip title={user?.name || "Datalia Team"} placement="right">
              <Avatar
                size={32}
                style={{
                  background: "linear-gradient(135deg, #1d3fbe, #3b5be3)",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {userInitials}
              </Avatar>
            </Tooltip>
          </div>
        )}
      </div>
    </aside>
  );
}
