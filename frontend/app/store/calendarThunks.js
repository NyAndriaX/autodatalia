import {
  addScheduledPost,
  hydrateScheduledPosts,
  removeScheduledPost,
  reschedulePost,
} from "./calendarSlice";
import { addNotification } from "./uiSlice";
import { webhookService } from "../lib/webhookService";
import {
  createPost,
  deletePost,
  fetchPosts,
  patchPost,
} from "../lib/postsService";

/**
 * Hydrate the calendar from the backend on app boot.
 * Returns true if any posts were loaded (non-empty), so AppBootstrap can
 * decide whether the demo seed should still run.
 */
export function loadScheduledPostsThunk() {
  return async (dispatch) => {
    const remote = await fetchPosts();
    if (Array.isArray(remote) && remote.length > 0) {
      dispatch(hydrateScheduledPosts(remote));
      return true;
    }
    return false;
  };
}

/**
 * Schedule a new post on `date` (YYYY-MM-DD).
 * Optimistic: the post appears immediately. The backend POST + n8n webhook
 * are best-effort; on failure the post stays in the local store.
 */
export function schedulePostThunk({ post, date }) {
  return async (dispatch) => {
    const scheduled = { ...post, scheduledDate: date, status: post.status ?? "draft" };
    dispatch(addScheduledPost(scheduled));
    const persisted = await createPost(scheduled);
    // Fire the n8n webhook in parallel (separate concern from persistence).
    webhookService
      .schedulePost(persisted ?? scheduled)
      .catch(() => {});
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
  return async (dispatch, getState) => {
    dispatch(reschedulePost({ id, date }));
    const post = getState().calendar.scheduledPosts.find((p) => p.id === id);
    const updated = await patchPost(id, { scheduledDate: date });
    webhookService.schedulePost(updated ?? post).catch(() => {});
    dispatch(
      addNotification({
        message: updated ? "Post rescheduled." : "Rescheduled locally (backend offline).",
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
