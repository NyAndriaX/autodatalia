import { describe, expect, it, vi } from "vitest";

// Plain function (not vi.fn): vitest's spy tracking reports a rejected
// promise from a mocked implementation as an unhandled error even when the
// code under test catches it.
let publishImpl = async () => ({ results: [] });

vi.mock("../../lib/oauthService", () => ({
  fetchConnections: async () => ({
    providers: {
      meta: { targets: [{ id: "page-1", kind: "facebook_page", label: "Ervel Tech" }] },
    },
  }),
  publishToTargets: (...args) => publishImpl(...args),
}));

const { publishNowThunk } = await import("../editorThunks");

function run(platforms) {
  const actions = [];
  const getState = () => ({
    ui: { locale: "fr", publishCooldownUntil: 0, recentPublishes: [] },
    editor: { currentPost: { content: "Hello", platforms, media: [], ratios: {} } },
  });
  const dispatch = (action) => {
    if (typeof action === "function") return action(dispatch, getState);
    actions.push(action);
    return action;
  };
  return publishNowThunk()(dispatch, getState).then(() => actions);
}

const results = (actions) => actions.filter((a) => a.type === "ui/setPublishResult").map((a) => a.payload);

describe("publish feedback", () => {
  it("shows progress, then per-account results; per-target events stay out of toasts", async () => {
    publishImpl = async () => ({
      results: [{ ok: true, platform: "facebook", target_label: "Ervel Tech", permalink_url: "https://fb.com/p/1" }],
    });
    const actions = await run({ facebook: true, linkedin: true });
    const [progress, done] = results(actions);
    expect(progress).toEqual({ phase: "publishing", platforms: ["facebook"] });
    expect(done.phase).toBe("done");
    expect(done.ok).toHaveLength(1);
    expect(done.skipped).toEqual(["linkedin"]); // no connected account
    const notif = actions.find((a) => a.type === "ui/addNotification" && a.payload.messageKey === "publishedTo");
    expect(notif.payload.toast).toBe(false);
  });

  it("reports a request failure in the dialog", async () => {
    publishImpl = async () => {
      throw new Error("network down");
    };
    const actions = await run({ facebook: true });
    const done = results(actions).at(-1);
    expect(done).toMatchObject({ phase: "done", ok: [], error: "network down" });
  });
});
