/*
 * No-flash theme bootstrap.
 *
 * Loaded as a static file via <Script src="/no-flash-theme.js"
 * strategy="beforeInteractive"> from app/layout.js so Next.js hoists it
 * outside the React tree. That avoids React 19's "Encountered a script
 * tag while rendering React component" warning that fires for any
 * inline <script>/<Script> rendered through JSX (including in <head>).
 *
 * Reads the persisted preference (light/dark/system) and sets
 * document.documentElement.dataset.theme accordingly, before first paint.
 *
 * MUST mirror THEME_STORAGE_KEY in lib/theme.js — keep them in sync if
 * either side changes.
 */
(function () {
  try {
    var k = "datalia-theme";
    var p = localStorage.getItem(k);
    if (p !== "light" && p !== "dark" && p !== "system") p = "system";
    var dark =
      p === "dark" ||
      (p === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
