"use client";

import { useSelector } from "react-redux";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import CreationEditor from "./components/views/CreationEditor";
import PlaceholderView from "./components/views/PlaceholderView";

export default function Home() {
  const { sidebarCollapsed, activeView } = useSelector((state) => state.ui);

  const renderView = () => {
    switch (activeView) {
      case "creation":
        return <CreationEditor />;
      case "calendar":
      case "library":
      case "analytics":
      case "settings":
        return <PlaceholderView viewId={activeView} />;
      default:
        return <CreationEditor />;
    }
  };

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar />
      <Topbar />

      {/* Main Content Area */}
      <main
        className="transition-all duration-300 overflow-hidden"
        style={{
          marginLeft: sidebarCollapsed ? "72px" : "260px",
          marginTop: "var(--topbar-height)",
          height: "calc(100vh - var(--topbar-height))",
        }}
      >
        {renderView()}
      </main>
    </div>
  );
}
