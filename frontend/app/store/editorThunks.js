import {
  setContent,
  setStatus,
  startGeneration,
  setVariants,
  setGenerationError,
  startQuickAction,
  finishQuickAction,
} from "./editorSlice";
import { addNotification, addTokenUsage } from "./uiSlice";
import { generateContent, applyQuickAction, isGenerationCached } from "../lib/aiService";
import { webhookService } from "../lib/webhookService";

// One variant by default (cheapest). `count` > 1 generates alternatives on
// demand. `force = true` is the only way to pay for a fresh generation; a
// normal click reuses the memoized result when nothing meaningful changed.
export function generateContentThunk(force = false, count = 1) {
  return async (dispatch, getState) => {
    const { currentPost, aiGeneration } = getState().editor;

    // In-flight guard: ignore button spam while a call is running.
    if (aiGeneration.isGenerating || aiGeneration.isApplyingAction) return;

    const args = {
      prompt: currentPost.content,
      platforms: currentPost.platforms,
      template: currentPost.template,
      variants: count,
    };

    // Unchanged request + we already have variants → reuse, don't re-prompt.
    if (!force && isGenerationCached(args) && aiGeneration.variants.length > 0) {
      dispatch(
        addNotification({
          message: "Reusing last generation — no tokens spent.",
          type: "info",
        })
      );
      return;
    }

    dispatch(startGeneration());
    try {
      const { variants, usage, cached } = await generateContent({ ...args, force });
      dispatch(setVariants(variants));
      if (variants.length > 0) dispatch(setContent(variants[0].text));
      if (!cached && usage?.total_tokens > 0) {
        dispatch(addTokenUsage(usage.total_tokens));
      }
    } catch (err) {
      dispatch(setGenerationError(err.message ?? "Generation failed"));
    }
  };
}

export function applyQuickActionThunk(action) {
  return async (dispatch, getState) => {
    const { currentPost, aiGeneration } = getState().editor;
    if (!currentPost.content.trim()) return;
    // In-flight guard: one transform at a time, ignore spam.
    if (aiGeneration.isApplyingAction || aiGeneration.isGenerating) return;
    dispatch(startQuickAction());
    try {
      const result = await applyQuickAction(currentPost.content, action);
      dispatch(setContent(result));
    } finally {
      dispatch(finishQuickAction());
    }
  };
}

export function saveDraftThunk() {
  return async (dispatch, getState) => {
    const { currentPost } = getState().editor;
    try {
      await webhookService.saveDraft(currentPost);
      dispatch(setStatus("draft"));
      dispatch(addNotification({ message: "Draft saved.", type: "success" }));
    } catch {
      dispatch(setStatus("draft"));
      dispatch(addNotification({ message: "Draft saved locally (webhook offline).", type: "info" }));
    }
  };
}

export function submitForValidationThunk() {
  return async (dispatch, getState) => {
    const { currentPost } = getState().editor;
    try {
      await webhookService.submitForValidation(currentPost);
    } catch {
      // webhook offline — status still updates
    }
    dispatch(setStatus("pending"));
    dispatch(addNotification({ message: "Submitted for Telegram validation.", type: "success" }));
  };
}

export function publishNowThunk() {
  return async (dispatch, getState) => {
    const { currentPost } = getState().editor;
    try {
      await webhookService.publishNow(currentPost);
      dispatch(setStatus("published"));
      dispatch(addNotification({ message: "Post published!", type: "success" }));
    } catch {
      dispatch(setStatus("error"));
      dispatch(addNotification({ message: "Publish failed — webhook offline.", type: "error" }));
    }
  };
}
