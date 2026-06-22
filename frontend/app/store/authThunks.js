import { authStart, authSuccess, authError, authLogout } from "./authSlice";
import { addNotification, clearNotifications } from "./uiSlice";
import { resetEditor } from "./editorSlice";
import { authService } from "../lib/authService";

export function restoreSessionThunk() {
  return async (dispatch) => {
    dispatch(authStart("restoring"));
    try {
      const user = await authService.restore();
      dispatch(authSuccess(user));
    } catch {
      // No session / corrupt storage is the normal state for a visitor.
      // Land on idle instead of surfacing an error banner to someone who
      // never tried to sign in.
      dispatch(authSuccess(null));
    }
  };
}

// Quiet re-fetch of /auth/me — refreshes the user's role + permissions (e.g.
// after an admin changed their role) WITHOUT the "restoring" status flicker.
// Keeps the current session on a transient failure.
export function refreshUserThunk() {
  return async (dispatch) => {
    try {
      const user = await authService.restore();
      if (user) dispatch(authSuccess(user));
    } catch {
      /* keep current session */
    }
  };
}

export function loginThunk(credentials) {
  return async (dispatch) => {
    dispatch(authStart("authenticating"));
    try {
      const user = await authService.login(credentials);
      if (!user) {
        dispatch(authError("Sign-in failed"));
        dispatch(addNotification({ messageKey: "signInFailed", type: "error" }));
        return;
      }
      dispatch(authSuccess(user));
      dispatch(addNotification({ messageKey: "signedInAs", messageParams: { name: user?.name }, type: "success" }));
    } catch (err) {
      dispatch(authError(err.message ?? "Sign-in failed"));
      dispatch(addNotification({ messageKey: "signInFailed", type: "error" }));
    }
  };
}

export function logoutThunk() {
  return async (dispatch) => {
    try {
      await authService.logout();
    } finally {
      // Wipe in-memory notifications so the next session doesn't inherit
      // a stale "publish succeeded" banner from someone else's flow.
      dispatch(resetEditor());
      dispatch(clearNotifications());
      dispatch(authLogout());
      dispatch(addNotification({ messageKey: "signedOut", type: "info" }));
    }
  };
}

export function registerThunk(credentials) {
  return async (dispatch) => {
    dispatch(authStart("authenticating"));
    try {
      const user = await authService.register(credentials);
      if (!user) {
        dispatch(authError("Registration failed"));
        dispatch(addNotification({ messageKey: "registrationFailed", type: "error" }));
        return;
      }
      dispatch(authSuccess(user));
      dispatch(addNotification({ messageKey: "accountCreated", messageParams: { name: user?.name }, type: "success" }));
    } catch (err) {
      dispatch(authError(err.message ?? "Registration failed"));
      dispatch(addNotification({ messageKey: "registrationFailed", type: "error" }));
    }
  };
}
