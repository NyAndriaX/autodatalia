"use client";

import { fadeIn } from "../lib/uiClasses";

import { usePathname, useRouter } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { setMobileNav, setActiveView } from "../store/uiSlice";
import { useEffect, useMemo, useRef } from "react";
import { hasPermission } from "../lib/permissions";
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
import ImageStudioView from "../components/views/ImageStudioView";
import MembersView from "../components/views/MembersView";
import RolesView from "../components/views/RolesView";
import {
  dashboardViewPermission,
  dashboardViewFromPathname,
  pathForDashboardView,
} from "./viewRoutes";

const VIEW_COMPONENTS = {
  dashboard: DashboardView,
  creation: CreationEditor,
  automation: AutomationView,
  calendar: CalendarView,
  library: MediaLibraryView,
  videos: VideoJobsView,
  image: ImageStudioView,
  analytics: AnalyticsView,
  credits: CreditsView,
  settings: SettingsView,
  members: MembersView,
  roles: RolesView,
};

export default function DashboardShell() {
  const dispatch = useDispatch<any>();
  const { user, status: authStatus } = useSelector((state: any) => state.auth);
  const { sidebarCollapsed, activeView, mobileNavOpen } = useSelector(
    (state: any) => state.ui
  );
  const isMobile = useIsMobile();
  const router = useRouter();
  const pathname = usePathname();
  const pathView = useMemo(
    () => dashboardViewFromPathname(pathname) || "dashboard",
    [pathname]
  );
  const pendingPathSyncRef = useRef(null);
  const activeViewRef = useRef(activeView);

  useEffect(() => {
    if (!user && authStatus !== "restoring" && authStatus !== "authenticating") {
      router.replace("/");
    }
  }, [user, authStatus, router]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  // Keep the visible section and browser URL in sync. Path changes win first:
  // direct links and browser back/forward update Redux. This effect only reacts
  // to URL changes, so a sidebar click cannot be mistaken for stale URL state.
  useEffect(() => {
    if (activeViewRef.current === pathView) return;
    pendingPathSyncRef.current = pathView;
    dispatch(setActiveView(pathView));
  }, [pathView, dispatch]);

  useEffect(() => {
    if (pendingPathSyncRef.current) {
      if (pendingPathSyncRef.current === activeView) {
        pendingPathSyncRef.current = null;
      }
      return;
    }

    const nextPath = pathForDashboardView(activeView);
    if (nextPath !== pathname) router.push(nextPath);
  }, [activeView, pathname, router]);

  // If the active view needs a permission the current workspace's role doesn't
  // grant (e.g. after switching to a workspace where you're only a member),
  // fall back to the dashboard instead of showing an empty/forbidden screen.
  useEffect(() => {
    const needed = dashboardViewPermission(activeView);
    if (user && needed && !hasPermission(user, needed)) {
      dispatch(setActiveView("dashboard"));
    }
  }, [user, activeView, dispatch]);

  if (!user) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-400">
        <span className="animate-pulse">Loading dashboard...</span>
      </div>
    );
  }

  const ActiveComponent = VIEW_COMPONENTS[activeView] || DashboardView;

  const contentOffset = isMobile
    ? 0
    : sidebarCollapsed
      ? "var(--sidebar-collapsed)"
      : "var(--sidebar-width)";

  return (
    <div className="h-screen overflow-hidden bg-(--bg-primary)">
      <Sidebar />
      <Topbar />

      {isMobile && mobileNavOpen && (
        <div
          className={`fixed inset-0 z-45 ${fadeIn}`}
          style={{ background: "rgba(15, 23, 42, 0.5)" }}
          onClick={() => dispatch(setMobileNav(false))}
          aria-hidden="true"
        />
      )}

      <main
        className="transition-all duration-300 overflow-hidden"
        style={{
          marginLeft: contentOffset,
          marginTop: "var(--topbar-height)",
          height: "calc(100vh - var(--topbar-height))",
        }}
      >
        <div key={user?.workspace?.id ?? "ws"} style={{ height: "100%" }}>
          <ActiveComponent />
        </div>
      </main>
    </div>
  );
}
