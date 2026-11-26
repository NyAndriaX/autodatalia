import { beforeEach, describe, expect, it, vi } from "vitest";

const createPost = vi.fn();
const patchPost = vi.fn();

vi.mock("../../lib/postsService", () => ({
  fetchPosts: vi.fn(),
  createPost: (...args) => createPost(...args),
  patchPost: (...args) => patchPost(...args),
  deletePost: vi.fn(),
}));
vi.mock("../../lib/timezone", () => ({ getScheduleTimezone: () => "Africa/Nairobi" }));

const { schedulePostThunk } = await import("../calendarThunks");

function run(thunk) {
  const dispatch = vi.fn((action) => (typeof action === "function" ? action(dispatch, getState) : action));
  const getState = () => ({ ui: { locale: "fr" }, calendar: { scheduledPosts: [] } });
  return thunk(dispatch, getState);
}

describe("schedulePostThunk", () => {
  beforeEach(() => {
    createPost.mockReset();
    patchPost.mockReset();
    createPost.mockImplementation(async (post) => ({ ...post, id: "srv-1" }));
  });

  it("persists a scheduled post with status 'scheduled' (the server only fires that)", async () => {
    const saved = await run(
      schedulePostThunk({
        post: { content: "Hello", platforms: { facebook: true }, time: "10:00", status: "scheduled" },
        date: "2026-12-01",
      })
    );
    expect(createPost).toHaveBeenCalledTimes(1);
    const sent = createPost.mock.calls[0][0];
    expect(sent.status).toBe("scheduled");
    expect(sent.scheduledDate).toBe("2026-12-01");
    expect(sent.timezone).toBe("Africa/Nairobi");
    expect(saved.id).toBe("srv-1");
  });

  it("keeps an undated save as a draft when no status is given", async () => {
    await run(schedulePostThunk({ post: { content: "Draft" }, date: "2026-12-01" }));
    expect(createPost.mock.calls[0][0].status).toBe("draft");
  });
});
