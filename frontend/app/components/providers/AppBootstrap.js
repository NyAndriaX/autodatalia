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

  // Keep <html data-theme> + storage in sync with the preference, and follow
  // the OS when the preference is "system".
  useEffect(() => {
    applyTheme(resolveTheme(theme));
    storeThemePref(theme);

    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(resolveTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}
