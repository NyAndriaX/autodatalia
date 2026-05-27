import { describe, expect, it } from "vitest";
import calendarReducer, {
  addScheduledPost,
  reschedulePost,
  removeScheduledPost,
  togglePlatformFilter,
  toggleStatusFilter,
  hydrateScheduledPosts,
  seedScheduledPosts,
  setCalendarView,
  setCursor,
  goToToday,
} from "../calendarSlice";

function init() {
  return calendarReducer(undefined, { type: "@@INIT" });
}

describe("calendarSlice", () => {
  it("initialises with sensible defaults", () => {
    const state = init();
    expect(state.scheduledPosts).toEqual([]);
    expect(state.view).toBe("month");
    expect(state.cursor).toBeNull();
    expect(state.seeded).toBe(false);
    // All platforms default ON in the filter chips.
    expect(Object.values(state.filters.platforms).every(Boolean)).toBe(true);
  });

  it("adds a post with defaults filled in", () => {
    const state = calendarReducer(
      init(),
      addScheduledPost({ content: "hello", scheduledDate: "2026-06-01" })
    );
    expect(state.scheduledPosts).toHaveLength(1);
    const post = state.scheduledPosts[0];
    expect(post.content).toBe("hello");
    expect(post.scheduledDate).toBe("2026-06-01");
    expect(post.status).toBe("draft");
    expect(post.media).toEqual([]);
    expect(post.id).toBeTruthy();
  });

  it("respects an explicit id when provided", () => {
    const state = calendarReducer(
      init(),
      addScheduledPost({ id: "fixed-id", scheduledDate: "2026-06-01" })
    );
    expect(state.scheduledPosts[0].id).toBe("fixed-id");
  });

  it("reschedules a post to a new date without dropping other fields", () => {
    let state = calendarReducer(
      init(),
      addScheduledPost({ id: "p1", content: "x", scheduledDate: "2026-06-01" })
    );
    state = calendarReducer(state, reschedulePost({ id: "p1", date: "2026-06-15" }));
    expect(state.scheduledPosts[0].scheduledDate).toBe("2026-06-15");
    expect(state.scheduledPosts[0].content).toBe("x");
  });

  it("removes a post by id", () => {
    let state = calendarReducer(
      init(),
      addScheduledPost({ id: "p1", scheduledDate: "2026-06-01" })
    );
    state = calendarReducer(
      state,
      addScheduledPost({ id: "p2", scheduledDate: "2026-06-02" })
    );
    state = calendarReducer(state, removeScheduledPost("p1"));
    expect(state.scheduledPosts.map((p) => p.id)).toEqual(["p2"]);
  });

  it("toggles a platform filter on and off", () => {
    let state = init();
    const wasOn = state.filters.platforms.facebook;
    state = calendarReducer(state, togglePlatformFilter("facebook"));
    expect(state.filters.platforms.facebook).toBe(!wasOn);
    state = calendarReducer(state, togglePlatformFilter("facebook"));
    expect(state.filters.platforms.facebook).toBe(wasOn);
  });

  it("toggles a status filter on and off", () => {
    let state = init();
    const wasOn = state.filters.statuses.draft;
    state = calendarReducer(state, toggleStatusFilter("draft"));
    expect(state.filters.statuses.draft).toBe(!wasOn);
  });

  it("hydrates posts and marks the store as seeded", () => {
    const state = calendarReducer(
      init(),
      hydrateScheduledPosts([
        { id: "h1", scheduledDate: "2026-06-01", content: "a" },
      ])
    );
    expect(state.scheduledPosts).toHaveLength(1);
    expect(state.seeded).toBe(true);
  });

  it("never re-seeds once the store is marked seeded", () => {
    let state = calendarReducer(
      init(),
      hydrateScheduledPosts([{ id: "h1", scheduledDate: "2026-06-01" }])
    );
    state = calendarReducer(
      state,
      seedScheduledPosts([{ scheduledDate: "2026-06-09", content: "demo" }])
    );
    // The demo wasn't added because the store was already hydrated.
    expect(state.scheduledPosts).toHaveLength(1);
    expect(state.scheduledPosts[0].id).toBe("h1");
  });

  it("seedScheduledPosts adds demo data only on a fresh store", () => {
    const state = calendarReducer(
      init(),
      seedScheduledPosts([
        { scheduledDate: "2026-06-09", content: "demo a" },
        { scheduledDate: "2026-06-10", content: "demo b" },
      ])
    );
    expect(state.scheduledPosts).toHaveLength(2);
    expect(state.seeded).toBe(true);
  });

  it("setCalendarView and setCursor update their fields", () => {
    let state = calendarReducer(init(), setCalendarView("week"));
    expect(state.view).toBe("week");
    state = calendarReducer(state, setCursor("2026-06-15"));
    expect(state.cursor).toBe("2026-06-15");
  });

  it("goToToday sets the cursor to today's ISO date", () => {
    const state = calendarReducer(init(), goToToday());
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(state.cursor).toBe(expected);
  });
});
