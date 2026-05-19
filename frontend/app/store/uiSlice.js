import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  sidebarCollapsed: false,
  mobileNavOpen: false, // off-canvas sidebar drawer on small screens
  activeView: "creation", // "creation" | "calendar" | "library" | "analytics" | "settings"
  notifications: [], // local in-app events (pushed by thunks)
  searchQuery: "",
  commandPaletteOpen: false,
  // "light" | "dark" | "system" — the *preference*; resolved value lives on <html>
  theme: "system",
  // "unknown" | "online" | "offline"
  connectivity: { backend: "unknown" },
  // Service-fed search (searchThunks)
  search: {
    results: [],
    status: "idle", // "idle" | "loading" | "done" | "error"
  },
  // Service-fed message/activity feed (messagesThunks)
  messages: {
    items: [],
    status: "idle", // "idle" | "loading" | "done" | "error"
  },
  // Session AI spend meter — only real (non-cached) calls add to this.
  aiUsage: { totalTokens: 0, calls: 0 },
};

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
      state.notifications.unshift({
        id: Date.now(),
        ...action.payload,
        read: false,
        timestamp: new Date().toISOString(),
      });
    },
    markNotificationRead: (state, action) => {
      const notif = state.notifications.find((n) => n.id === action.payload);
      if (notif) notif.read = true;
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
      state.messages.items = action.payload;
      state.messages.status = "done";
    },
    markMessageRead: (state, action) => {
      const msg = state.messages.items.find((m) => m.id === action.payload);
      if (msg) msg.read = true;
    },
    toggleCommandPalette: (state) => {
      state.commandPaletteOpen = !state.commandPaletteOpen;
    },
    setConnectivity: (state, action) => {
      state.connectivity = { ...state.connectivity, ...action.payload };
    },
    setTheme: (state, action) => {
      state.theme = action.payload; // "light" | "dark" | "system"
    },
    addTokenUsage: (state, action) => {
      state.aiUsage.totalTokens += action.payload || 0;
      state.aiUsage.calls += 1;
    },
    resetTokenUsage: (state) => {
      state.aiUsage = { totalTokens: 0, calls: 0 };
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
  clearNotifications,
  setSearchQuery,
  setSearchStatus,
  setSearchResults,
  clearSearch,
  setMessagesStatus,
  setMessages,
  markMessageRead,
  toggleCommandPalette,
  setConnectivity,
  setTheme,
  addTokenUsage,
  resetTokenUsage,
} = uiSlice.actions;

export default uiSlice.reducer;
