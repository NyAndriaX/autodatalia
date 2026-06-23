// @ts-nocheck
import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  user: null,
  // "idle" | "restoring" | "authenticating" | "authenticated" | "error"
  status: "idle",
  error: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    authStart: (state, action) => {
      state.status = action.payload || "authenticating";
      state.error = null;
    },
    authSuccess: (state, action) => {
      state.user = action.payload;
      state.status = action.payload ? "authenticated" : "idle";
      state.error = null;
    },
    authError: (state, action) => {
      state.status = "error";
      state.error = action.payload;
    },
    authLogout: (state) => {
      state.user = null;
      state.status = "idle";
      state.error = null;
    },
    clearAuthError: (state) => {
      state.error = null;
      if (state.status === "error") state.status = "idle";
    },
  },
});

export const { authStart, authSuccess, authError, authLogout, clearAuthError } =
  authSlice.actions;

export default authSlice.reducer;
