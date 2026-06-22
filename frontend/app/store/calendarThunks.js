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
 * Save/update a post with a chosen `date` (YYYY-MM-DD).
 *
 * Drafts stay drafts until the user explicitly submits them for Telegram
 * validation or publishes them. Existing scheduled posts keep their current
 * status when re-dated. Tags the post with the *team's* configured timezone (or the
 * browser's if no override is set) so the server interprets `time`
 * ("09:00") consistently regardless of which device fired the call. See
 * lib/timezone.getScheduleTimezone for the resolution order.
 *
 * Optimistic: the post appears immediately. On backend failure the post
 * stays in the local store but won't actually be fired by anything.
 */
export function schedulePostThunk({ post, date }) {
  return async (dispatch, getState) => {
    // Dynamic import: timezone.js calls getSetting() (from settingsStorage)
    // which touches window.localStorage; a top-level import would break SSR / Jest.
    const { getScheduleTimezone } = await import("../lib/timezone");
    const locale = getState().ui.locale === "fr" ? "fr" : "en";
    // A real (server) id means we're editing an existing post — a scheduled post
    // or a draft being scheduled — so we UPDATE it in place instead of creating
    // a duplicate. `cal-` ids are our own optimistic placeholders, not real.
    const hasRealId = !!post.id && !String(post.id).startsWith("cal-");
    const nextStatus =
      post.status === "scheduled" || post.status === "awaiting_validation"
        ? post.status
        : post.status || "draft";
    const scheduled = {
      ...post,
      id: post.id ?? `cal-${Date.now()}`,
      scheduledDate: date,
      status: nextStatus,
      timezone: post.timezone || getScheduleTimezone(),
      locale,
    };

    try {
      if (hasRealId) {
        // Replace-or-insert the calendar entry (a draft being scheduled isn't in
        // the calendar yet), then PATCH the existing row.
        dispatch(removeScheduledPost(scheduled.id));
        dispatch(addScheduledPost(scheduled));
        let updated = null;
        try {
          updated = await patchPost(scheduled.id, scheduled);
        } catch (err) {
          if (err?.status !== 404) throw err;
        }
        if (!updated) {
          updated = await createPost(scheduled);
          if (updated?.id && updated.id !== scheduled.id) {
            dispatch(removeScheduledPost(scheduled.id));
            dispatch(addScheduledPost(updated));
          }
        }
        dispatch(
          addNotification({
            messageKey:
              nextStatus === "draft" ? "draftSaved" : "postScheduled",
            type: "success",
          })
        );
        return updated || scheduled;
      }

      dispatch(addScheduledPost(scheduled));
      const persisted = await createPost(scheduled);
      if (persisted) {
        // Reconcile the optimistic entry with the server row: swap our
        // client-generated `cal-` id for the persisted id so reschedule/cancel
        // during the optimistic window hit the backend with an id it knows.
        dispatch(removeScheduledPost(scheduled.id));
        dispatch(addScheduledPost(persisted));
      }
      dispatch(
        addNotification({
          messageKey:
            nextStatus === "draft"
              ? persisted
                ? "draftSaved"
                : "draftSavedLocally"
              : persisted
                ? "postScheduled"
                : "scheduledLocally",
          type: persisted ? "success" : "info",
        })
      );
      return persisted || scheduled;
    } catch (err) {
      dispatch(
        addNotification({
          message: err?.message || "Couldn't save this post.",
          type: "error",
        })
      );
      return null;
    }
  };
}

/** Move an existing scheduled post to a new day (drag-and-drop). */
export function reschedulePostThunk({ id, date }) {
  return async (dispatch) => {
    dispatch(reschedulePost({ id, date }));
    try {
      const updated = await patchPost(id, { scheduledDate: date });
      dispatch(
        addNotification({
          messageKey: updated ? "postRescheduled" : "rescheduledLocally",
          type: updated ? "success" : "info",
        })
      );
    } catch (err) {
      dispatch(
        addNotification({
          message: err?.message || "Couldn't reschedule this post.",
          type: "error",
        })
      );
    }
  };
}

/**
 * Edit an existing scheduled post. Optimistic local patch first, then a
 * backend PATCH.
 */
export function updatePostThunk({ id, patch }) {
  return async (dispatch) => {
    dispatch(updateScheduledPost({ id, patch }));
    try {
      const updated = await patchPost(id, patch);
      dispatch(
        addNotification({
          messageKey: updated ? "postUpdated" : "updatedLocally",
          type: updated ? "success" : "info",
        })
      );
    } catch (err) {
      dispatch(
        addNotification({
          message: err?.message || "Couldn't update this post.",
          type: "error",
        })
      );
    }
  };
}

/** Cancel a scheduled post (removes it from the calendar). */
export function cancelScheduleThunk(id) {
  return async (dispatch) => {
    dispatch(removeScheduledPost(id));
    try {
      const ok = await deletePost(id);
      dispatch(
        addNotification({
          messageKey: ok ? "scheduleCancelled" : "cancelledLocally",
          type: "info",
        })
      );
    } catch (err) {
      dispatch(
        addNotification({
          message: err?.message || "Couldn't cancel this schedule.",
          type: "error",
        })
      );
    }
  };
}
