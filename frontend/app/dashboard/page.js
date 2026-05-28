"use client";

import { useRouter } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { setMobileNav } from "../store/uiSlice";
import { useEffect } from "react";
import { useIsMobile } from "../lib/useIsMobile";
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import CreationEditor from "../components/views/CreationEditor";
import AutomationView from "../components/views/AutomationView";
import CalendarView from "../components/views/CalendarView";
import MediaLibraryView from "../components/views/MediaLibraryView";
import AnalyticsView from "../components/views/AnalyticsView";
import SettingsView from "../components/views/SettingsView";
import DashboardView from "../components/views/DashboardView";
import CreditsView from "../components/views/CreditsView";
import VideoJobsView from "../components/views/VideoJobsView";

export default function Home() {
  const dispatch = useDispatch();
  const { user, status: authStatus } = useSelector((state) => state.auth);
  const { sidebarCollapsed, activeView, mobileNavOpen } = useSelector(
    (state) => state.ui
  );
  const isMobile = useIsMobile();
  const router = useRouter();

  useEffect(() => {
    if (!user && authStatus !== "restoring" && authStatus !== "authenticating") {
      router.replace("/");
    }
  }, [user, authStatus, router]);

  if (!user) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-400">
        <span className="animate-pulse">Loading dashboard...</span>
      </div>
    );
  }

  const renderView = () => {
    switch (activeView) {
      case "dashboard":
        return <DashboardView />;
      case "creation":
        return <CreationEditor />;
      case "automation":
        return <AutomationView />;
      case "calendar":
        return <CalendarView />;
      case "library":
        return <MediaLibraryView />;
      case "videos":
        return <VideoJobsView />;
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
