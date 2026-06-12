import { authStart, authSuccess, authError, authLogout } from "./authSlice";
import { addNotification, clearNotifications } from "./uiSlice";
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

export function loginThunk(credentials) {
  return async (dispatch) => {
    dispatch(authStart("authenticating"));
    try {
      const user = await authService.login(credentials);
      if (!user) {
        dispatch(authError("Sign-in failed"));
        dispatch(addNotification({ message: "Sign-in failed.", type: "error" }));
        return;
      }
      dispatch(authSuccess(user));
      dispatch(addNotification({ message: `Signed in as ${user?.name}.`, type: "success" }));
    } catch (err) {
      dispatch(authError(err.message ?? "Sign-in failed"));
      dispatch(addNotification({ message: "Sign-in failed.", type: "error" }));
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
      dispatch(clearNotifications());
      dispatch(authLogout());
      dispatch(addNotification({ message: "Signed out.", type: "info" }));
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
        dispatch(addNotification({ message: "Registration failed.", type: "error" }));
        return;
      }
      dispatch(authSuccess(user));
      dispatch(addNotification({ message: `Account created, welcome ${user?.name}!`, type: "success" }));
    } catch (err) {
      dispatch(authError(err.message ?? "Registration failed"));
      dispatch(addNotification({ message: "Registration failed.", type: "error" }));
    }
  };
}
