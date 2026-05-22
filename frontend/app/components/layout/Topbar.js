"use client";

import { useState, useMemo, useEffect, useRef, useSyncExternalStore } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  markNotificationRead,
  markAllNotificationsRead,
  clearNotifications,
  markMessageRead,
  markAllMessagesRead,
  setConnectivity,
  setTheme,
  setActiveView,
  clearSearch,
  toggleMobileNav,
} from "../../store/uiSlice";
import { searchThunk } from "../../store/searchThunks";
import { logoutThunk } from "../../store/authThunks";
import { apiHealthCheck } from "../../lib/apiClient";
import { useIsMobile } from "../../lib/useIsMobile";
import {
  Search,
  Bell,
  MessageSquare,
  ChevronDown,
  Command,
  X,
  LogOut,
  Settings,
  User,
  Sun,
  Moon,
  FileText,
  Image as ImageIcon,
  Loader2,
  Menu,
  Coins,
  ExternalLink,
} from "lucide-react";

const VIEW_TITLES = {
  dashboard: "Dashboard",
  creation: "Creation & Editor",
  calendar: "Calendar & Scheduling",
  library: "Media & Templates",
  analytics: "Analytics & API Costs",
  credits: "Credits & Billing",
  settings: "Settings & Integrations",
};

const CONNECTIVITY_DOT = {
  online: "var(--status-approved)",
  offline: "var(--status-error)",
  unknown: "var(--text-muted)",
};

const RESULT_ICON = { post: FileText, template: FileText, media: ImageIcon };

// Where each result type takes you when clicked (until a real deep-link /
// item loader exists, navigating to the owning view is the honest behaviour).
const RESULT_VIEW = { post: "creation", template: "creation", media: "library" };

// SSR-safe subscription to the OS colour-scheme (no effect / no setState).
function subscribeSystemTheme(cb) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const getSystemDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export default function Topbar() {
  const dispatch = useDispatch();
  const { activeView, notifications, searchQuery, sidebarCollapsed, connectivity, theme, search, messages, aiUsage } =
    useSelector((state) => state.ui);
  const authUser = useSelector((state) => state.auth.user);
  const isMobile = useIsMobile();

  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchView, setSearchView] = useState(activeView);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const notifRef = useRef(null);
  const userMenuRef = useRef(null);
  const searchRef = useRef(null);

  // Resolve the active theme: explicit pref wins; "system" follows the OS via
  // a useSyncExternalStore subscription (SSR snapshot = light, no mismatch).
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemDark,
    () => false
  );
  const resolved =
    theme === "dark" ? "dark" : theme === "light" ? "light" : systemDark ? "dark" : "light";

  // Merge local notifications + service message feed into one sorted list.
  const feed = useMemo(() => {
    const a = notifications.map((n) => ({ ...n, source: "notification" }));
    const b = messages.items.map((m) => ({ ...m, source: "message" }));
    return [...a, ...b].sort(
      (x, y) => new Date(y.timestamp) - new Date(x.timestamp)
    );
  }, [notifications, messages.items]);

  const unreadCount = useMemo(() => feed.filter((f) => !f.read).length, [feed]);

  // Poll backend /health every 30 s for the connectivity indicator.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const status = await apiHealthCheck();
      if (!cancelled) dispatch(setConnectivity({ backend: status ?? "unknown" }));
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [dispatch]);

  // Close menus on outside click.
  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifications(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false);
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowResults(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const backendStatus = connectivity?.backend ?? "unknown";
  const initials = authUser?.initials || "DT";
  const resultsVisible = showResults && searchQuery.trim() && searchView === activeView;

  /* Row click marks the item as read but does NOT auto-open its URL.
     Before: any click opened the URL in a new tab AND marked read, which
     meant the only way to "dismiss" a publish-success notification was
     to click — opening an unwanted tab every time. Now the URL has its
     own click target (the external-link icon) so the row can be marked
     read independently. The auto-mark on bell open also handles the
     "I just want to skip these" case without any click at all. */
  const onFeedItemClick = (item) => {
    if (item.read) return;
    if (item.source === "message") dispatch(markMessageRead(item.id));
    else dispatch(markNotificationRead(item.id));
  };

  /* When the bell opens, every visible notification + message gets
     marked as read in bulk. Matches the Slack / Linear / Notion
     pattern: opening the inbox = seen. The visual "newness" tint on
     each row stays for the current open since React renders synchronously
     before the reducer runs; next open they all read as plain. */
  useEffect(() => {
    if (!showNotifications) return;
    dispatch(markAllNotificationsRead());
    dispatch(markAllMessagesRead());
  }, [showNotifications, dispatch]);

  // Clicking a search result navigates to the owning view, then resets search.
  const onResultClick = (r) => {
    dispatch(setActiveView(RESULT_VIEW[r.type] || "creation"));
    dispatch(clearSearch());
    setShowResults(false);
    setMobileSearchOpen(false);
  };

  // Focus the field when the mobile search overlay opens.
  useEffect(() => {
    if (mobileSearchOpen) {
      document.getElementById("global-search")?.focus();
    }
  }, [mobileSearchOpen]);

  const toggleTheme = () => dispatch(setTheme(resolved === "dark" ? "light" : "dark"));

  // Shared search UI — rendered inline on desktop, in a full-width overlay on
  // mobile (so the search bar never disappears, just collapses to an icon).
  const searchPanel = (
    <div className="relative">
      <div
        className="relative flex items-center rounded-lg transition-all duration-200"
        style={{
          background: searchFocused ? "var(--bg-tertiary)" : "var(--bg-secondary)",
          border: searchFocused ? "1px solid var(--accent-primary)" : "1px solid var(--border-default)",
          boxShadow: searchFocused ? "0 0 0 3px rgba(59, 130, 246, 0.12)" : "none",
        }}
      >
        <Search size={16} className="ml-3" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <input
          id="global-search"
          type="text"
          placeholder="Search posts, templates, media..."
          value={searchQuery}
          onChange={(e) => {
            setSearchView(activeView);
            dispatch(searchThunk(e.target.value));
            setShowResults(Boolean(e.target.value.trim()));
          }}
          onFocus={() => {
            setSearchFocused(true);
            setSearchView(activeView);
            if (searchQuery.trim()) setShowResults(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowResults(false);
              setMobileSearchOpen(false);
              e.currentTarget.blur();
            }
          }}
          onBlur={() => setSearchFocused(false)}
          className="flex-1 bg-transparent border-none outline-none px-3 py-2.5 pr-2 text-sm"
          style={{ color: "var(--text-primary)", outline: "none" }}
          aria-label="Global search"
          autoComplete="off"
          spellCheck={false}
        />
        {searchQuery && (
          <button
            type="button"
            className="mr-2 rounded-md p-1 transition-colors duration-200"
            style={{ color: "var(--text-muted)" }}
            onClick={() => {
              dispatch(clearSearch());
              setShowResults(false);
            }}
            aria-label="Clear search"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
        <div
          className="flex items-center gap-1 mr-3 px-2 py-1 rounded text-xs"
          style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border-default)" }}
          aria-hidden="true"
        >
          <Command size={11} />
          <span>K</span>
        </div>
      </div>

      {/* Results dropdown */}
      {resultsVisible && (
        <div
          className="absolute left-0 right-0 top-full mt-3 overflow-hidden rounded-2xl animate-fade-in"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-hover)",
            boxShadow: "var(--shadow-dropdown)",
          }}
        >
          <div
            className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{
              color: "var(--text-tertiary)",
              borderBottom: "1px solid var(--border-default)",
              background: "var(--bg-elevated)",
            }}
          >
            Search results
          </div>
          {search.status === "loading" ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={14} className="animate-spin" /> Searching…
            </div>
          ) : search.results.length === 0 ? (
            <div className="px-4 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
              No results for “{searchQuery}”
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {search.results.map((r) => {
                const Icon = RESULT_ICON[r.type] || FileText;
                return (
                  <li key={r.id}>
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-[var(--bg-card-hover)]"
                      onClick={() => onResultClick(r)}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <Icon size={15} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate" style={{ color: "var(--text-primary)" }}>{r.title}</span>
                        <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{r.subtitle}</span>
                      </span>
                      <span className="badge badge-draft capitalize">{r.type}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  return (
    <header
      id="topbar"
      className="fixed top-0 right-0 z-40 flex items-center justify-between transition-all duration-300"
      style={{
        left: isMobile ? 0 : sidebarCollapsed ? "72px" : "260px",
        paddingLeft: isMobile ? "0.75rem" : "1.5rem",
        paddingRight: isMobile ? "0.75rem" : "1.5rem",
        height: "var(--topbar-height)",
        background: "var(--glass-bg)",
        backdropFilter: "var(--glass-blur)",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      {/* Left: hamburger (mobile) + View Title */}
      <div className="flex items-center gap-3 min-w-0">
        {isMobile && (
          <button
            id="mobile-nav-toggle"
            className="btn-ghost shrink-0"
            style={{ padding: 6 }}
            onClick={() => dispatch(toggleMobileNav())}
            aria-label="Open navigation menu"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        )}
        <h2
          className="text-lg font-semibold truncate"
          style={{ color: "var(--text-primary)" }}
        >
          {VIEW_TITLES[activeView] || "Dashboard"}
        </h2>
      </div>

      {/* Center: Search — desktop inline; on mobile it collapses to an
          icon that opens a full-width overlay (never just disappears). */}
      {!isMobile && (
        <div className="relative z-[55] flex-1 max-w-lg mx-8" ref={searchRef}>
          {searchPanel}
        </div>
      )}

      {isMobile && mobileSearchOpen && (
        <div
          ref={searchRef}
          className="absolute left-0 right-0 z-[60] flex items-center gap-2 px-3"
          style={{
            top: 0,
            height: "var(--topbar-height)",
            background: "var(--glass-bg)",
            backdropFilter: "var(--glass-blur)",
          }}
        >
          <div className="relative flex-1">{searchPanel}</div>
          <button
            className="btn-ghost shrink-0"
            style={{ padding: 6 }}
            onClick={() => setMobileSearchOpen(false)}
            aria-label="Close search"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Mobile: open the search overlay */}
        {isMobile && !mobileSearchOpen && (
          <button
            id="mobile-search-toggle"
            className="btn-ghost"
            onClick={() => setMobileSearchOpen(true)}
            aria-label="Open search"
          >
            <Search size={18} aria-hidden="true" />
          </button>
        )}

        {/* Session AI spend meter — only real (non-cached) calls add to it */}
        {!isMobile && aiUsage?.totalTokens > 0 && (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-default)",
              color: "var(--text-tertiary)",
            }}
            title={`${aiUsage.totalTokens.toLocaleString()} tokens across ${aiUsage.calls} AI call${aiUsage.calls !== 1 ? "s" : ""} this session`}
          >
            <Coins size={13} aria-hidden="true" style={{ color: "var(--status-pending)" }} />
            {aiUsage.totalTokens.toLocaleString()}
          </span>
        )}

        {/* Theme toggle */}
        <button
          id="theme-toggle"
          className="btn-ghost"
          onClick={toggleTheme}
          title={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
          aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
        >
          {resolved === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>

        {/* Backend / Telegram status */}
        <button
          id="telegram-status"
          className="btn-ghost flex items-center gap-2"
          title={`Backend status: ${backendStatus}`}
          aria-label={`Backend status: ${backendStatus}`}
        >
          <MessageSquare size={18} aria-hidden="true" />
          <span
            className="w-2 h-2 rounded-full transition-colors duration-500"
            style={{ background: CONNECTIVITY_DOT[backendStatus] }}
            aria-hidden="true"
          />
        </button>

        {/* Notifications / messages */}
        <div className="relative" ref={notifRef}>
          <button
            id="notifications-btn"
            className="btn-ghost relative"
            onClick={() => setShowNotifications((v) => !v)}
            aria-haspopup="true"
            aria-expanded={showNotifications}
            aria-label={unreadCount > 0 ? `${unreadCount} unread messages` : "Messages"}
          >
            <Bell size={18} aria-hidden="true" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] font-bold"
                style={{ background: "var(--status-error)" }}
                aria-hidden="true"
              >
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div
              className="absolute right-0 top-full mt-2 w-80 rounded-xl animate-fade-in overflow-hidden"
              role="menu"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-dropdown)" }}
            >
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Messages</span>
                <div className="flex items-center gap-2">
                  {notifications.length > 0 && (
                    <button
                      className="text-xs btn-ghost py-1 px-2"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => dispatch(clearNotifications())}
                    >
                      Clear local
                    </button>
                  )}
                  <button onClick={() => setShowNotifications(false)} className="btn-ghost p-1" aria-label="Close messages">
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {feed.length === 0 ? (
                <div className="py-5 px-4 text-center">
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>No messages yet</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                    Notifications will appear here
                  </p>
                </div>
              ) : (
                <ul className="max-h-72 overflow-y-auto">
                  {feed.map((item) => (
                    <li
                      key={`${item.source}-${item.id}`}
                      className="flex items-start gap-3 px-4 py-3 cursor-pointer"
                      style={{
                        background: item.read ? "transparent" : "rgba(59,130,246,0.06)",
                        borderBottom: "1px solid var(--border-default)",
                      }}
                      onClick={() => onFeedItemClick(item)}
                      role="menuitem"
                    >
                      <span
                        className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: item.read ? "var(--text-muted)" : "var(--accent-primary)" }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs flex items-center gap-1" style={{ color: "var(--text-primary)" }}>
                          <span className="flex-1">{item.message}</span>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 inline-flex items-center justify-center rounded p-0.5"
                              style={{ color: "var(--accent-primary)" }}
                              aria-label="Open the live post in a new tab"
                              title="Open the live post in a new tab"
                            >
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {new Date(item.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="w-px h-6 mx-1" style={{ background: "var(--border-default)" }} aria-hidden="true" />

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            id="user-menu"
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all duration-200"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => setShowUserMenu((v) => !v)}
            aria-haspopup="true"
            aria-expanded={showUserMenu}
            aria-label="User menu"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ background: "var(--accent-gradient)" }}
              aria-hidden="true"
            >
              {initials}
            </div>
            <ChevronDown size={14} aria-hidden="true" />
          </button>

          {showUserMenu && (
            <div
              className="absolute right-0 top-full mt-2 w-52 rounded-xl animate-fade-in overflow-hidden"
              role="menu"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-dropdown)" }}
            >
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {authUser?.name || "Guest"}
                </p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {authUser?.email || "Not signed in"}
                </p>
              </div>
              <ul className="py-1">
                {[
                  { icon: User, label: "Profile", action: () => dispatch(setActiveView("settings")) },
                  { icon: Settings, label: "Settings", action: () => dispatch(setActiveView("settings")) },
                ].map(({ icon: Icon, label, action }) => (
                  <li key={label}>
                    <button
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left btn-ghost"
                      style={{ color: "var(--text-secondary)" }}
                      role="menuitem"
                      onClick={() => {
                        action();
                        setShowUserMenu(false);
                      }}
                    >
                      <Icon size={14} aria-hidden="true" />
                      {label}
                    </button>
                  </li>
                ))}
                <li style={{ borderTop: "1px solid var(--border-default)" }}>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left btn-ghost"
                    style={{ color: "var(--status-error)" }}
                    role="menuitem"
                    onClick={() => {
                      dispatch(logoutThunk());
                      setShowUserMenu(false);
                    }}
                  >
                    <LogOut size={14} aria-hidden="true" />
                    Sign Out
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
