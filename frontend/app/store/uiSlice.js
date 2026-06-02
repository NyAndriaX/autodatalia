import { createSlice } from "@reduxjs/toolkit";

// Bounded log of recent AI calls — keeps the slice small while still
// giving the analytics view enough history for a meaningful chart.
const AI_CALL_RING_SIZE = 50;

const initialState = {
  sidebarCollapsed: false,
  mobileNavOpen: false, // off-canvas sidebar drawer on small screens
  activeView: "dashboard", // "dashboard" | "creation" | "automation" | "calendar" | "library" | "videos" | "analytics" | "credits" | "settings"
  notifications: [], // local in-app events (pushed by thunks)
  searchQuery: "",
  // "light" | "dark" | "system" — the *preference*; resolved value lives on <html>
  theme: "system",
  // UI language. "en" is the fallback; "fr" is the second shipped bundle.
  // The I18nProvider hydrates this from localStorage / navigator.language
  // on first client render.
  locale: "en",
  // "unknown" | "online" | "offline"
  connectivity: { backend: "unknown" },
  // Service-fed search (searchThunks)
  search: {
    results: [],
    status: "idle", // "idle" | "loading" | "done" | "error"
  },
  // Service-fed message/activity feed (searchThunks)
  messages: {
    items: [],
    status: "idle", // "idle" | "loading" | "done" | "error"
  },
  // Session AI spend meter — only real (non-cached) calls add to this.
  // `recentCalls` is a bounded ring of per-call records so the Analytics
  // view can render real bars/tables; older entries are dropped after
  // AI_CALL_RING_SIZE so the slice stays small in memory. `cacheHits`
  // counts requests served by the local memoization cache (zero-token
  // wins), so we can show real "tokens saved" stats.
  aiUsage: { totalTokens: 0, calls: 0, cacheHits: 0, recentCalls: [] },
  // Publish-side spam guards: a frontend cooldown so the button locks
  // for a few seconds after each publish, and a 1h ring of recent
  // content hashes so the confirm modal can warn about duplicates
  // before the backend rejects them.
  publishCooldownUntil: 0,        // ms epoch
  recentPublishes: [],            // [{ hash, ts }] — pruned to last hour
};

const PUBLISH_HISTORY_WINDOW_MS = 60 * 60 * 1000;

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setSidebarCollapsed: (state, action) => {
      state.sidebarCollapsed = action.payload;
    },
    toggleMobileNav: (state) => {
      state.mobileNavOpen = !state.mobileNavOpen;
    },
    setMobileNav: (state, action) => {
      state.mobileNavOpen = action.payload;
    },
    setActiveView: (state, action) => {
      state.activeView = action.payload;
      state.mobileNavOpen = false; // close drawer on navigation
    },
    addNotification: (state, action) => {
      // Publishing fans out across N platforms and dispatches one
      // addNotification per result — those land in the same millisecond,
      // so a plain `Date.now()` id collides and React warns about duplicate
      // keys in the bell feed. A monotonic counter on top of the timestamp
      // keeps the id roughly time-ordered but guaranteed unique.
      state._notifSeq = (state._notifSeq || 0) + 1;
      state.notifications.unshift({
        id: `n-${Date.now()}-${state._notifSeq}`,
        ...action.payload,
        read: false,
        timestamp: new Date().toISOString(),
      });
    },
    markNotificationRead: (state, action) => {
      const notif = state.notifications.find((n) => n.id === action.payload);
      if (notif) notif.read = true;
    },
    /* Bulk mark-as-read — used when the bell dropdown opens so the user
       doesn't have to click each row to drop the unread badge. Without
       this, post-publish notifications (which carry a permalink URL)
       were "unskippable": the only way to mark them read was to click,
       which opened the link in a new tab. */
    markAllNotificationsRead: (state) => {
      for (const n of state.notifications) n.read = true;
    },
    clearNotifications: (state) => {
      state.notifications = [];
    },
    setSearchQuery: (state, action) => {
      state.searchQuery = action.payload;
    },
    setSearchStatus: (state, action) => {
      state.search.status = action.payload;
    },
    setSearchResults: (state, action) => {
      state.search.results = action.payload;
      state.search.status = "done";
    },
    clearSearch: (state) => {
      state.searchQuery = "";
      state.search.results = [];
      state.search.status = "idle";
    },
    setMessagesStatus: (state, action) => {
      state.messages.status = action.payload;
    },
    setMessages: (state, action) => {
      // Polled refreshes would otherwise clobber the local `read` flag every
      // 30s. Merge by id: preserve `read` for items the user already saw,
      // and let new server entries default to unread. Order tracks the
      // server response (newest-first).
      const previousRead = new Set(
        state.messages.items.filter((m) => m.read).map((m) => m.id)
      );
      state.messages.items = (action.payload || []).map((m) => ({
        ...m,
        read: m.read || previousRead.has(m.id),
      }));
      state.messages.status = "done";
    },
    markMessageRead: (state, action) => {
      const msg = state.messages.items.find((m) => m.id === action.payload);
      if (msg) msg.read = true;
    },
    markAllMessagesRead: (state) => {
      for (const m of state.messages.items) m.read = true;
    },
    setConnectivity: (state, action) => {
      state.connectivity = { ...state.connectivity, ...action.payload };
    },
    setTheme: (state, action) => {
      state.theme = action.payload; // "light" | "dark" | "system"
    },
    setLocale: (state, action) => {
      state.locale = action.payload || "en"; // "en" | "fr"
    },
    addTokenUsage: (state, action) => {
      state.aiUsage.totalTokens += action.payload || 0;
      state.aiUsage.calls += 1;
    },
    recordCacheHit: (state) => {
      state.aiUsage.cacheHits += 1;
    },
    recordAiCall: (state, action) => {
      // payload: { kind, model, variants, promptTokens, completionTokens,
      //            totalTokens } — `at` is stamped here so consumers don't
      // need to remember to add it.
      state.aiUsage.recentCalls.unshift({
        at: Date.now(),
        kind: action.payload?.kind || "generate",
        model: action.payload?.model || "llm-router",
        variants: action.payload?.variants || 1,
        promptTokens: action.payload?.promptTokens || 0,
        completionTokens: action.payload?.completionTokens || 0,
        totalTokens: action.payload?.totalTokens || 0,
      });
      if (state.aiUsage.recentCalls.length > AI_CALL_RING_SIZE) {
        state.aiUsage.recentCalls.length = AI_CALL_RING_SIZE;
      }
    },
    resetTokenUsage: (state) => {
      state.aiUsage = { totalTokens: 0, calls: 0, cacheHits: 0, recentCalls: [] };
    },
    setPublishCooldownUntil: (state, action) => {
      state.publishCooldownUntil = action.payload || 0;
    },
    recordPublishHash: (state, action) => {
      const now = Date.now();
      state.recentPublishes = state.recentPublishes.filter(
        (p) => now - p.ts < PUBLISH_HISTORY_WINDOW_MS
      );
      state.recentPublishes.push({ hash: action.payload, ts: now });
    },
  },
});

export const {
  toggleSidebar,
  setSidebarCollapsed,
  toggleMobileNav,
  setMobileNav,
  setActiveView,
  addNotification,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotifications,
  setSearchQuery,
  setSearchStatus,
  setSearchResults,
  clearSearch,
  setMessagesStatus,
  setMessages,
  markMessageRead,
  markAllMessagesRead,
  setConnectivity,
  setTheme,
  setLocale,
  addTokenUsage,
  recordCacheHit,
  recordAiCall,
  resetTokenUsage,
  setPublishCooldownUntil,
  recordPublishHash,
} = uiSlice.actions;

export default uiSlice.reducer;
