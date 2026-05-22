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
    mode: "free", // "free" | "template" | "scratch"
    template: "promo", // active template id when mode === "template"
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
    hashtags: [],
    media: [],
    /* TikTok-specific compose flags. TikTok's audit reviewers verify the
       editor exposes all four of these BEFORE the publish call — they're
       reject-on-sight if missing. We persist them on currentPost so the
       PublishConfirmModal reads/writes one source of truth and the publish
       thunk can forward them to the backend on every fire. */
    tiktok: {
      privacy_level: "PUBLIC_TO_EVERYONE", // forced to SELF_ONLY by TikTok in sandbox anyway
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
  drafts: [],
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
    setMode: (state, action) => {
      state.currentPost.mode = action.payload;
    },
    setTemplate: (state, action) => {
      state.currentPost.template = action.payload;
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
    setScheduledDate: (state, action) => {
      state.currentPost.scheduledDate = action.payload;
    },
    setHashtags: (state, action) => {
      state.currentPost.hashtags = action.payload;
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
    clearMedia: (state) => {
      state.currentPost.media = [];
    },
    reorderMedia: (state, action) => {
      const { from, to } = action.payload;
      const media = state.currentPost.media;
      if (from < 0 || to < 0 || from >= media.length || to >= media.length) return;
      const [moved] = media.splice(from, 1);
      media.splice(to, 0, moved);
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
    resetEditor: () => initialState,
  },
});

export const {
  setContent,
  togglePlatform,
  setMode,
  setTemplate,
  setTone,
  setPlatformRatio,
  setTiktokOptions,
  setStatus,
  setScheduledDate,
  setHashtags,
  addMedia,
  updateMedia,
  removeMedia,
  clearMedia,
  reorderMedia,
  startGeneration,
  setVariants,
  setGenerationError,
  startQuickAction,
  finishQuickAction,
  selectVariant,
  resetEditor,
} = editorSlice.actions;

export default editorSlice.reducer;
