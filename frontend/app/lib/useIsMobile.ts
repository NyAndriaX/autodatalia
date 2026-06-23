// @ts-nocheck
"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 768px)";

function subscribe(cb) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;
// SSR snapshot: assume desktop so server markup is stable (no hydration flash
// on desktop; mobile corrects on first client tick).
const getServerSnapshot = () => false;

/** True when the viewport is phone/tablet sized (≤ 768px). */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
