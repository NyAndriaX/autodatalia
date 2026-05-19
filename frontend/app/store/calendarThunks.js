import {
  addScheduledPost,
  reschedulePost,
  removeScheduledPost,
} from "./calendarSlice";
import { addNotification } from "./uiSlice";
import { webhookService } from "../lib/webhookService";

/**
 * Schedule a new post on `date` (YYYY-MM-DD).
 * Optimistic: the post appears immediately; the n8n webhook is best-effort
 * with a local fallback — same pattern as editorThunks.
 */
export function schedulePostThunk({ post, date }) {
  return async (dispatch) => {
    const scheduled = { ...post, scheduledDate: date, status: post.status ?? "draft" };
    dispatch(addScheduledPost(scheduled));
    try {
      await webhookService.schedulePost(scheduled);
      dispatch(addNotification({ message: "Post scheduled.", type: "success" }));
    } catch {
      dispatch(
        addNotification({
          message: "Scheduled locally (webhook offline).",
          type: "info",
        })
      );
    }
  };
}

/** Move an existing scheduled post to a new day (drag-and-drop). */
export function reschedulePostThunk({ id, date }) {
  return async (dispatch, getState) => {
    dispatch(reschedulePost({ id, date }));
    const post = getState().calendar.scheduledPosts.find((p) => p.id === id);
    try {
      await webhookService.schedulePost(post);
      dispatch(addNotification({ message: "Post rescheduled.", type: "success" }));
    } catch {
      dispatch(
        addNotification({
          message: "Rescheduled locally (webhook offline).",
          type: "info",
        })
      );
    }
  };
}

/** Cancel a scheduled post (removes it from the calendar). */
export function cancelScheduleThunk(id) {
  return async (dispatch) => {
    dispatch(removeScheduledPost(id));
    dispatch(
      addNotification({ message: "Schedule cancelled.", type: "info" })
    );
  };
}
