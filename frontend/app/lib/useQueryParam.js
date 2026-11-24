"use client";

import { useSyncExternalStore } from "react";

// The query string never changes while these pages are mounted, so there is
// nothing to subscribe to.
const subscribe = () => () => {};

/**
 * Read one URL query parameter on the client.
 *
 * Unlike `useSearchParams`, this needs no <Suspense> boundary to survive
 * `next build` static prerendering, and unlike reading `window.location` in an
 * effect it doesn't trigger an extra setState render. The server snapshot is
 * "" so prerendered HTML is stable; the real value is picked up on hydration.
 */
export function useQueryParam(name) {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name) || "",
    () => ""
  );
}
