import { configureStore } from "@reduxjs/toolkit";
import editorReducer from "./editorSlice";
import uiReducer from "./uiSlice";
import authReducer from "./authSlice";
import calendarReducer from "./calendarSlice";

export const store = configureStore({
  reducer: {
    editor: editorReducer,
    ui: uiReducer,
    auth: authReducer,
    calendar: calendarReducer,
  },
  middleware: (getDefaultMiddleware) =>
    // Media items can carry File/Blob preview URLs; skip serializable checks
    // for those non-serializable references kept only for the live preview.
    getDefaultMiddleware({
      serializableCheck: {
        ignoredPaths: ["editor.currentPost.media"],
        ignoredActions: ["editor/addMedia"],
      },
    }),
});
