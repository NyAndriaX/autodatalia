import {
  addScheduledPost,
  hydrateScheduledPosts,
  removeScheduledPost,
  reschedulePost,
  updateScheduledPost,
} from "./calendarSlice";
import { addNotification } from "./uiSlice";
import {
  createPost,
  deletePost,
  fetchPosts,
  patchPost,
} from "../lib/postsService";

/**
 * Hydrate the calendar from the backend.
 *
 * `refresh: false` (boot mode, default): only hydrate when the server has
 * posts, so an empty backend lets CalendarView's demo seed run.
 * `refresh: true` (polled refresh): always hydrate when the fetch succeeds
 * — including with an empty array — so that scheduler-driven status flips
 * and remote deletions reach the store.
 *
 * Returns true if any posts were loaded (non-empty); callers at boot still
 * use this to decide whether to fall back to localStorage.
 */
export function loadScheduledPostsThunk({ refresh = false } = {}) {
  return async (dispatch) => {
    const remote = await fetchPosts();
    if (!Array.isArray(remote)) return false; // fetch failed — don't clobber
    if (refresh || remote.length > 0) {
      dispatch(hydrateScheduledPosts(remote));
    }
    return remote.length > 0;
  };
}

/**
 * Schedule a new post on `date` (YYYY-MM-DD).
 *
 * Sets `status: "scheduled"` so the backend scheduler picks it up at fire
 * time — without this it would persist as a "draft" and never auto-publish.
 * Tags the post with the browser's IANA timezone so the server interprets
 * `time` ("09:00") in the user's local time, not UTC.
 *
 * Optimistic: the post appears immediately. On backend failure the post
 * stays in the local store but won't actually be fired by anything.
 */
export function schedulePostThunk({ post, date }) {
  return async (dispatch) => {
    const tz =
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "UTC";
    const scheduled = {
      ...post,
      scheduledDate: date,
      status: post.status === "draft" ? "scheduled" : post.status ?? "scheduled",
      timezone: post.timezone || tz,
    };
    dispatch(addScheduledPost(scheduled));
    const persisted = await createPost(scheduled);
    dispatch(
      addNotification({
        message: persisted ? "Post scheduled." : "Scheduled locally (backend offline).",
        type: persisted ? "success" : "info",
      })
    );
  };
}

/** Move an existing scheduled post to a new day (drag-and-drop). */
export function reschedulePostThunk({ id, date }) {
  return async (dispatch) => {
    dispatch(reschedulePost({ id, date }));
    const updated = await patchPost(id, { scheduledDate: date });
    dispatch(
      addNotification({
        message: updated ? "Post rescheduled." : "Rescheduled locally (backend offline).",
        type: updated ? "success" : "info",
      })
    );
  };
}

/**
 * Edit an existing scheduled post. Optimistic local patch first, then a
 * backend PATCH.
 */
export function updatePostThunk({ id, patch }) {
  return async (dispatch) => {
    dispatch(updateScheduledPost({ id, patch }));
    const updated = await patchPost(id, patch);
    dispatch(
      addNotification({
        message: updated ? "Post updated." : "Updated locally (backend offline).",
        type: updated ? "success" : "info",
      })
    );
  };
}

/** Cancel a scheduled post (removes it from the calendar). */
export function cancelScheduleThunk(id) {
  return async (dispatch) => {
    dispatch(removeScheduledPost(id));
    const ok = await deletePost(id);
    dispatch(
      addNotification({
        message: ok ? "Schedule cancelled." : "Cancelled locally (backend offline).",
        type: "info",
      })
    );
  };
}
