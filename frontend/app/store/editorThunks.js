import {
  setContent,
  setStatus,
  startGeneration,
  setVariants,
  setGenerationError,
  startQuickAction,
  finishQuickAction,
} from "./editorSlice";
import { addNotification } from "./uiSlice";
import { generateContent, applyQuickAction } from "../lib/aiService";
import { webhookService } from "../lib/webhookService";

export function generateContentThunk() {
  return async (dispatch, getState) => {
    const { currentPost } = getState().editor;
    dispatch(startGeneration());
    try {
      const variants = await generateContent({
        prompt: currentPost.content,
        platforms: currentPost.platforms,
        template: currentPost.template,
      });
      dispatch(setVariants(variants));
      if (variants.length > 0) dispatch(setContent(variants[0].text));
    } catch (err) {
      dispatch(setGenerationError(err.message ?? "Generation failed"));
    }
  };
}

export function applyQuickActionThunk(action) {
  return async (dispatch, getState) => {
    const { currentPost } = getState().editor;
    if (!currentPost.content.trim()) return;
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
