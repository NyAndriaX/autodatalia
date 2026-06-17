import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  currentPost: {
    content: "",
    platforms: {
      facebook: true,
      instagram: true,
      tiktok: false,
      linkedin: false,
    },
    /* Tone is sent to the AI as generation context — null means "let the
       model pick". The dropdown defaults to the value last used. */
    tone: null,
    /* Per-platform aspect ratio chosen for the preview frame. Keyed by
       platform id; missing keys fall back to the platform's defaultRatio
       (see RATIOS_BY_PLATFORM). Empty by default so the editor displays
       each platform's recommended ratio without the user having to choose. */
    ratios: {},
    status: "draft", // "draft" | "pending" | "approved" | "published" | "error"
    scheduledDate: null,
    media: [],
    /* TikTok-specific compose flags. TikTok's audit reviewers verify the
       editor exposes all four of these BEFORE the publish call — they're
       reject-on-sight if missing. We persist them on currentPost so the
       PublishConfirmModal reads/writes one source of truth and the publish
       thunk can forward them to the backend on every fire. */
    tiktok: {
      privacy_level: "SELF_ONLY", // forced to SELF_ONLY by TikTok in sandbox anyway
      disclose_video_branded: false,       // "Disclose branded content"
      disclose_video_your_brand: false,    // "Your brand"
      music_confirmed: false,              // gate — Publish disabled until ticked
    },
  },
  aiGeneration: {
    isGenerating: false,
    isApplyingAction: false,
    variants: [],
    selectedVariant: null,
    error: null,
  },
};

const editorSlice = createSlice({
  name: "editor",
  initialState,
  reducers: {
    setContent: (state, action) => {
      state.currentPost.content = action.payload;
    },
    togglePlatform: (state, action) => {
      const platform = action.payload;
      state.currentPost.platforms[platform] = !state.currentPost.platforms[platform];
    },
    setTone: (state, action) => {
      state.currentPost.tone = action.payload || null;
    },
    setPlatformRatio: (state, action) => {
      const { platform, ratio } = action.payload;
      if (!platform) return;
      state.currentPost.ratios[platform] = ratio;
    },
    /* Partial update for the TikTok compose flags. Pass any subset:
       e.g. dispatch(setTiktokOptions({ music_confirmed: true })). */
    setTiktokOptions: (state, action) => {
      const patch = action.payload || {};
      state.currentPost.tiktok = {
        ...(state.currentPost.tiktok || {}),
        ...patch,
      };
    },
    setStatus: (state, action) => {
      state.currentPost.status = action.payload;
    },
    // Hydrate the editor from a saved post (e.g. opening a draft from the
    // Library). Keeps the editor's tiktok defaults for any keys the post omits.
    loadDraft: (state, action) => {
      const p = action.payload || {};
      state.currentPost = {
        ...state.currentPost,
        content: p.content || "",
        platforms:
          p.platforms && Object.keys(p.platforms).length
            ? p.platforms
            : state.currentPost.platforms,
        ratios: p.ratios || {},
        status: p.status || "draft",
        scheduledDate: p.scheduledDate || null,
        media: Array.isArray(p.media) ? p.media : [],
        tiktok: { ...state.currentPost.tiktok, ...(p.tiktok || {}) },
      };
    },
    addMedia: (state, action) => {
      // payload: array of media descriptors (see lib/uploadService)
      state.currentPost.media.push(...action.payload);
    },
    updateMedia: (state, action) => {
      const { id, patch } = action.payload;
      const item = state.currentPost.media.find((m) => m.id === id);
      if (item) Object.assign(item, patch);
    },
    removeMedia: (state, action) => {
      state.currentPost.media = state.currentPost.media.filter(
        (m) => m.id !== action.payload
      );
    },
    // AI generation lifecycle — dispatched by editorThunks
    startGeneration: (state) => {
      state.aiGeneration.isGenerating = true;
      state.aiGeneration.error = null;
      state.aiGeneration.variants = [];
      state.aiGeneration.selectedVariant = null;
    },
    setVariants: (state, action) => {
      state.aiGeneration.variants = action.payload;
      state.aiGeneration.isGenerating = false;
      if (action.payload.length > 0) {
        state.aiGeneration.selectedVariant = 0;
      }
    },
    setGenerationError: (state, action) => {
      state.aiGeneration.error = action.payload;
      state.aiGeneration.isGenerating = false;
    },
    startQuickAction: (state) => {
      state.aiGeneration.isApplyingAction = true;
    },
    finishQuickAction: (state) => {
      state.aiGeneration.isApplyingAction = false;
    },
    selectVariant: (state, action) => {
      state.aiGeneration.selectedVariant = action.payload;
      if (action.payload !== null) {
        state.currentPost.content = state.aiGeneration.variants[action.payload]?.text || "";
      }
    },
  },
});

export const {
  setContent,
  togglePlatform,
  setTone,
  setPlatformRatio,
  setTiktokOptions,
  setStatus,
  loadDraft,
  addMedia,
  updateMedia,
  removeMedia,
  startGeneration,
  setVariants,
  setGenerationError,
  startQuickAction,
  finishQuickAction,
  selectVariant,
} = editorSlice.actions;

export default editorSlice.reducer;
