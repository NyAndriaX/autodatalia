"use client";

import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setTheme } from "../../store/uiSlice";
import { hydrateScheduledPosts } from "../../store/calendarSlice";
import { restoreSessionThunk } from "../../store/authThunks";
import { loadMessagesThunk } from "../../store/searchThunks";
import { loadScheduledPostsThunk } from "../../store/calendarThunks";
import { loadScheduledPosts, saveScheduledPosts } from "../../lib/calendarStorage";
import {
  getStoredThemePref,
  storeThemePref,
  resolveTheme,
  applyTheme,
} from "../../lib/theme";

// Client-only bootstrap: runs once to hydrate Redux from persisted state and
// kick off background loads. Renders nothing.
export default function AppBootstrap() {
  const dispatch = useDispatch();
  const theme = useSelector((s) => s.ui.theme);
  const scheduledPosts = useSelector((s) => s.calendar.scheduledPosts);
  const didInit = useRef(false);

  // One-time hydration. Backend is the source of truth; localStorage is the
  // offline fallback. If the backend has no posts, we let the CalendarView
  // demo seed run by *not* dispatching hydrate (the reducer would mark the
  // store as seeded and suppress the demo).
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    dispatch(setTheme(getStoredThemePref()));
    dispatch(restoreSessionThunk());
    dispatch(loadMessagesThunk());
    (async () => {
      const fromBackend = await dispatch(loadScheduledPostsThunk());
      if (fromBackend) return;
      const storedPosts = loadScheduledPosts();
      if (storedPosts && storedPosts.length > 0) {
        dispatch(hydrateScheduledPosts(storedPosts));
      }
    })();
  }, [dispatch]);

  // Persist scheduled posts whenever they change (after first init tick).
  useEffect(() => {
    if (!didInit.current) return;
    saveScheduledPosts(scheduledPosts);
  }, [scheduledPosts]);

  // Poll /posts and /messages every 30 s so the calendar reflects scheduler
  // activity (status flips to "published"/"error") and the bell picks up
  // publish events fired from the backend without a page reload. Same
  // cadence as the existing health probe in Topbar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = setInterval(() => {
      // refresh: true so empty server responses still hydrate (otherwise
      // a scheduler-deleted post would never disappear from the store).
      dispatch(loadScheduledPostsThunk({ refresh: true }));
      dispatch(loadMessagesThunk());
    }, 30_000);
    return () => clearInterval(id);
  }, [dispatch]);

  // Keep <html data-theme> + storage in sync with the preference, and follow
  // the OS when the preference is "system".
  //
  // The `data-theme-transitioning` flag is set for a brief window around
  // every theme flip so the global CSS rule in globals.css can transition
  // colors on every element synchronously — without it the body transition
  // raced the inline-styled surfaces and the user saw a segment-by-segment
  // wipe.
  const lastApplied = useRef(null);
  useEffect(() => {
    const next = resolveTheme(theme);
    const prev = lastApplied.current;
    lastApplied.current = next;
    if (prev && prev !== next && typeof document !== "undefined") {
      const html = document.documentElement;
      html.dataset.themeTransitioning = "true";
      const t = window.setTimeout(() => {
        delete html.dataset.themeTransitioning;
      }, 260);
      applyTheme(next);
      storeThemePref(theme);
      return () => window.clearTimeout(t);
    }
    applyTheme(next);
    storeThemePref(theme);

    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = resolveTheme("system");
      if (resolved !== lastApplied.current) {
        document.documentElement.dataset.themeTransitioning = "true";
        window.setTimeout(() => {
          delete document.documentElement.dataset.themeTransitioning;
        }, 260);
        lastApplied.current = resolved;
      }
      applyTheme(resolved);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}
