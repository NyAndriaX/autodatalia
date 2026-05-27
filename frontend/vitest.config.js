import { defineConfig } from "vitest/config";

// Minimal Vitest config — uses jsdom so tests can touch window/localStorage,
// and only picks up *.test.js files under app/ so it never accidentally runs
// Next.js artefacts.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["app/**/*.test.{js,jsx}"],
    css: false,
  },
});
