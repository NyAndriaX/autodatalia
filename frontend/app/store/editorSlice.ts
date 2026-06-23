// @ts-nocheck
import { createSlice } from "@reduxjs/toolkit";

// A blank editor post. Used for the initial state AND by resetEditor (New post),
// so "New post" always starts clean. `draftId` is the id of the draft/post being
// edited (null = fresh) — saveDraftThunk uses it to UPDATE in place instead of
// creating a new draft each save.
function freshPost() {
  return {
    draftId: null,
    content: "",
    platforms: { facebook: true, instagram: true, tiktok: false, linkedin: false },
    // Tone: AI generation context; null = let the model pick.
    tone: null,
    // Per-platform aspect ratios; empty falls back to each platform's default.
    ratios: {},
    status: "draft", // "draft" | "pending" | "approved" | "published" | "error"
    scheduledDate: null,
    time: null,
    media: [],
    // TikTok compose flags — the audit requires all four be exposed before publish.
    tiktok: {
      privacy_level: "SELF_ONLY",
      disclose_video_branded: false,
      disclose_video_your_brand: false,
      music_confirmed: false,
    },
  };
}

function freshAi() {
  return {
    isGenerating: false,
    isApplyingAction: false,
    variants: [],
    selectedVariant: null,
    error: null,
  };
}

const initialState = {
  currentPost: freshPost(),
  aiGeneration: freshAi(),
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
        draftId: p.id || null,
        content: p.content || "",
        platforms:
          p.platforms && Object.keys(p.platforms).length
            ? p.platforms
            : state.currentPost.platforms,
        ratios: p.ratios || {},
        status: p.status || "draft",
        scheduledDate: p.scheduledDate || null,
        time: p.time || null,
        media: Array.isArray(p.media) ? p.media : [],
        tiktok: { ...state.currentPost.tiktok, ...(p.tiktok || {}) },
      };
    },
    // Set/clear the id of the draft being edited (saveDraftThunk sets it after
    // first persist so subsequent saves update the same draft).
    setDraftId: (state, action) => {
      state.currentPost.draftId = action.payload || null;
    },
    hydrateEditorState: (state, action) => {
      const next = action.payload || {};
      const post = next.currentPost || {};
      const ai = next.aiGeneration || {};
      state.currentPost = {
        ...freshPost(),
        ...post,
        platforms:
          post.platforms && typeof post.platforms === "object"
            ? { ...freshPost().platforms, ...post.platforms }
            : freshPost().platforms,
        ratios:
          post.ratios && typeof post.ratios === "object" ? post.ratios : {},
        media: Array.isArray(post.media) ? post.media : [],
        tiktok: { ...freshPost().tiktok, ...(post.tiktok || {}) },
      };
      state.aiGeneration = {
        ...freshAi(),
        ...ai,
        isGenerating: false,
        isApplyingAction: false,
        variants: Array.isArray(ai.variants) ? ai.variants : [],
        selectedVariant:
          typeof ai.selectedVariant === "number" ? ai.selectedVariant : null,
      };
    },
    // Reset the editor to a blank post — wired to the "New post" button so a
    // fresh post never inherits a previous draft's id/content.
    resetEditor: (state) => {
      state.currentPost = freshPost();
      state.aiGeneration = freshAi();
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
  setDraftId,
  hydrateEditorState,
  resetEditor,
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
