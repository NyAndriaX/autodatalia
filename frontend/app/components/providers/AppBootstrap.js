"use client";

import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setTheme } from "../../store/uiSlice";
import { restoreSessionThunk } from "../../store/authThunks";
import { loadMessagesThunk } from "../../store/searchThunks";
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
  const didInit = useRef(false);

  // One-time hydration.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    dispatch(setTheme(getStoredThemePref()));
    dispatch(restoreSessionThunk());
    dispatch(loadMessagesThunk());
  }, [dispatch]);

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
