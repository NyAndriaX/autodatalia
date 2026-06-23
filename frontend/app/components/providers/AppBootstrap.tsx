"use client";

import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setLocale, setTheme } from "../../store/uiSlice";
import { hydrateScheduledPosts } from "../../store/calendarSlice";
import { hydrateEditorState } from "../../store/editorSlice";
import { restoreSessionThunk, refreshUserThunk } from "../../store/authThunks";
import { loadMessagesThunk } from "../../store/searchThunks";
import { loadScheduledPostsThunk } from "../../store/calendarThunks";
import { loadScheduledPosts, saveScheduledPosts } from "../../lib/calendarStorage";
import { loadEditorState, saveEditorState } from "../../lib/editorWorkspaceStorage";
import {
  getStoredThemePref,
  storeThemePref,
  resolveTheme,
  applyTheme,
} from "../../lib/theme";
import { loadWorkspaceLocale, saveWorkspaceLocale } from "../../lib/workspaceLocaleStorage";

// Flip the theme with a smooth, compositor-driven crossfade where supported
// (View Transitions API); otherwise apply it instantly (no per-element lag).
function applyThemeAnimated(next) {
  if (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function"
  ) {
    document.startViewTransition(() => applyTheme(next));
  } else {
    applyTheme(next);
  }
}

// Client-only bootstrap: runs once to hydrate Redux from persisted state and
// kick off background loads. Renders nothing.
export default function AppBootstrap() {
  const dispatch = useDispatch<any>();
  const theme = useSelector((s: any) => s.ui.theme);
  const locale = useSelector((s: any) => s.ui.locale);
  const scheduledPosts = useSelector((s: any) => s.calendar.scheduledPosts);
  const editor = useSelector((s: any) => s.editor);
  const activeWorkspaceId = useSelector((s: any) => s.auth.user?.workspace?.id);
  const didInit = useRef(false);
  const hydratedWorkspaceRef = useRef(null);
  const skipNextEditorSaveRef = useRef(null);
  const skipNextLocaleSaveRef = useRef(null);

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

  useEffect(() => {
    if (!didInit.current || !activeWorkspaceId) {
      hydratedWorkspaceRef.current = null;
      skipNextEditorSaveRef.current = null;
      skipNextLocaleSaveRef.current = null;
      return;
    }
    if (hydratedWorkspaceRef.current === activeWorkspaceId) return;
    skipNextEditorSaveRef.current = activeWorkspaceId;
    skipNextLocaleSaveRef.current = activeWorkspaceId;
    hydratedWorkspaceRef.current = activeWorkspaceId;
    dispatch(
      hydrateEditorState(loadEditorState(activeWorkspaceId) || undefined)
    );
    dispatch(
      setLocale(loadWorkspaceLocale(activeWorkspaceId, locale))
    );
  }, [activeWorkspaceId, dispatch, locale]);

  useEffect(() => {
    if (!didInit.current || !activeWorkspaceId) return;
    if (skipNextEditorSaveRef.current === activeWorkspaceId) {
      skipNextEditorSaveRef.current = null;
      return;
    }
    saveEditorState(activeWorkspaceId, editor);
  }, [activeWorkspaceId, editor]);

  useEffect(() => {
    if (!didInit.current || !activeWorkspaceId) return;
    if (skipNextLocaleSaveRef.current === activeWorkspaceId) {
      skipNextLocaleSaveRef.current = null;
      return;
    }
    saveWorkspaceLocale(activeWorkspaceId, locale);
  }, [activeWorkspaceId, locale]);

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
      // Pick up role/permission changes an admin made to this account.
      dispatch(refreshUserThunk());
    }, 30_000);
    return () => clearInterval(id);
  }, [dispatch]);

  // Keep <html data-theme> + storage in sync with the preference, and follow
  // the OS when the preference is "system".
  //
  // Animate the flip with the View Transitions API: the browser crossfades a
  // snapshot of the whole page on the compositor, so it stays smooth no matter
  // how many widgets are mounted. Browsers without it just flip instantly.
  const lastApplied = useRef(null);
  useEffect(() => {
    const next = resolveTheme(theme);
    const prev = lastApplied.current;
    lastApplied.current = next;
    if (prev && prev !== next) {
      applyThemeAnimated(next);
    } else {
      applyTheme(next); // first paint — no animation
    }
    storeThemePref(theme);

    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = resolveTheme("system");
      if (resolved !== lastApplied.current) {
        lastApplied.current = resolved;
        applyThemeAnimated(resolved);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}
