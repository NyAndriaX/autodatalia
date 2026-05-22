"use client";

import { useSelector, useDispatch } from "react-redux";
import { setMobileNav } from "./store/uiSlice";
import { useIsMobile } from "./lib/useIsMobile";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import CreationEditor from "./components/views/CreationEditor";
import CalendarView from "./components/views/CalendarView";
import MediaLibraryView from "./components/views/MediaLibraryView";
import AnalyticsView from "./components/views/AnalyticsView";
import SettingsView from "./components/views/SettingsView";
import DashboardView from "./components/views/DashboardView";
import CreditsView from "./components/views/CreditsView";

export default function Home() {
  const dispatch = useDispatch();
  const { sidebarCollapsed, activeView, mobileNavOpen } = useSelector(
    (state) => state.ui
  );
  const isMobile = useIsMobile();

  const renderView = () => {
    switch (activeView) {
      case "dashboard":
        return <DashboardView />;
      case "creation":
        return <CreationEditor />;
      case "calendar":
        return <CalendarView />;
      case "library":
        return <MediaLibraryView />;
      case "analytics":
        return <AnalyticsView />;
      case "credits":
        return <CreditsView />;
      case "settings":
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  const contentOffset = isMobile ? 0 : sidebarCollapsed ? 72 : 260;

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar />
      <Topbar />

      {/* Dim backdrop behind the mobile drawer */}
      {isMobile && mobileNavOpen && (
        <div
          className="fixed inset-0 z-[45] animate-fade-in"
          style={{ background: "rgba(15, 23, 42, 0.5)" }}
          onClick={() => dispatch(setMobileNav(false))}
          aria-hidden="true"
        />
      )}

      {/* Main Content Area */}
      <main
        className="transition-all duration-300 overflow-hidden"
        style={{
          marginLeft: contentOffset,
          marginTop: "var(--topbar-height)",
          height: "calc(100vh - var(--topbar-height))",
        }}
      >
        {renderView()}
      </main>
    </div>
  );
}
