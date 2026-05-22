import { createSlice } from "@reduxjs/toolkit";
import { PLATFORMS, STATUSES } from "../lib/platforms";

const allTrue = (keys) =>
  keys.reduce((acc, k) => ((acc[k] = true), acc), {});

const initialState = {
  // Locally-held scheduled posts. Each: { id, content, platforms,
  // status, scheduledDate (YYYY-MM-DD) }.
  scheduledPosts: [],
  view: "month", // "month" | "week"
  // YYYY-MM-DD of the focused date. Null until the view mounts and
  // dispatches goToToday() — avoids a server/client hydration mismatch
  // from calling new Date() in module-level initial state.
  cursor: null,
  filters: {
    platforms: allTrue(PLATFORMS.map((p) => p.id)),
    statuses: allTrue(STATUSES),
  },
  // Idempotent guard so the demo seed only ever runs once.
  seeded: false,
};

let autoId = 1;
const nextId = () => `cal-${Date.now()}-${autoId++}`;

const calendarSlice = createSlice({
  name: "calendar",
  initialState,
  reducers: {
    setCalendarView: (state, action) => {
      state.view = action.payload;
    },
    setCursor: (state, action) => {
      state.cursor = action.payload; // YYYY-MM-DD
    },
    goToToday: (state) => {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      state.cursor = `${d.getFullYear()}-${m}-${day}`;
    },
    addScheduledPost: (state, action) => {
      const p = action.payload;
      state.scheduledPosts.push({
        id: p.id ?? nextId(),
        content: p.content ?? "",
        platforms: p.platforms ?? {},
        status: p.status ?? "draft",
        scheduledDate: p.scheduledDate,
        time: p.time ?? null,
        // Metadata only (kind/source/name) — no File/Blob, stays serializable.
        media: p.media ?? [],
      });
    },
    reschedulePost: (state, action) => {
      const { id, date } = action.payload;
      const post = state.scheduledPosts.find((p) => p.id === id);
      if (post) post.scheduledDate = date;
    },
    updateScheduledPost: (state, action) => {
      // Partial update — undefined values are ignored so callers can patch
      // a subset without clobbering the rest. Mirrors the backend PATCH.
      const { id, patch } = action.payload;
      const post = state.scheduledPosts.find((p) => p.id === id);
      if (!post) return;
      Object.entries(patch || {}).forEach(([key, value]) => {
        if (value === undefined) return;
        post[key] = value;
      });
    },
    removeScheduledPost: (state, action) => {
      state.scheduledPosts = state.scheduledPosts.filter(
        (p) => p.id !== action.payload
      );
    },
    togglePlatformFilter: (state, action) => {
      const id = action.payload;
      state.filters.platforms[id] = !state.filters.platforms[id];
    },
    toggleStatusFilter: (state, action) => {
      const id = action.payload;
      state.filters.statuses[id] = !state.filters.statuses[id];
    },
    // Restore from localStorage; marks seeded so the demo seed won't run
    // on top of the user's persisted posts.
    hydrateScheduledPosts: (state, action) => {
      state.scheduledPosts = action.payload;
      state.seeded = true;
    },
    seedScheduledPosts: (state, action) => {
      if (state.seeded) return;
      state.scheduledPosts.push(
        ...action.payload.map((p) => ({
          id: p.id ?? nextId(),
          content: p.content ?? "",
          platforms: p.platforms ?? {},
          status: p.status ?? "draft",
          scheduledDate: p.scheduledDate,
          time: p.time ?? null,
          media: p.media ?? [],
        }))
      );
      state.seeded = true;
    },
  },
});

export const {
  setCalendarView,
  setCursor,
  goToToday,
  hydrateScheduledPosts,
  addScheduledPost,
  reschedulePost,
  updateScheduledPost,
  removeScheduledPost,
  togglePlatformFilter,
  toggleStatusFilter,
  seedScheduledPosts,
} = calendarSlice.actions;

export default calendarSlice.reducer;
