import { authStart, authSuccess, authError, authLogout } from "./authSlice";
import { addNotification } from "./uiSlice";
import { authService } from "../lib/authService";

export function restoreSessionThunk() {
  return async (dispatch) => {
    dispatch(authStart("restoring"));
    try {
      const user = await authService.restore();
      dispatch(authSuccess(user));
    } catch (err) {
      dispatch(authError(err.message ?? "Could not restore session"));
    }
  };
}

export function loginThunk(credentials) {
  return async (dispatch) => {
    dispatch(authStart("authenticating"));
    try {
      const user = await authService.login(credentials);
      dispatch(authSuccess(user));
      dispatch(addNotification({ message: `Signed in as ${user.name}.`, type: "success" }));
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
      dispatch(authLogout());
      dispatch(addNotification({ message: "Signed out.", type: "info" }));
    }
  };
}
