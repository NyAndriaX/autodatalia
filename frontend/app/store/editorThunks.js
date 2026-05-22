import {
  setContent,
  setStatus,
  startGeneration,
  setVariants,
  setGenerationError,
  startQuickAction,
  finishQuickAction,
} from "./editorSlice";
import {
  addNotification,
  addTokenUsage,
  recordAiCall,
  recordCacheHit,
  recordPublishHash,
  setPublishCooldownUntil,
} from "./uiSlice";
import { generateContent, applyQuickAction, isGenerationCached } from "../lib/aiService";
import { fetchConnections, publishToTargets } from "../lib/oauthService";
import { publishHashKey } from "../lib/publishHash";

// Frontend-side cooldown after a publish — locks the button so a fast
// second click can't double-post (the backend has the same guard).
const PUBLISH_COOLDOWN_MS = 15 * 1000;

// Match a frontend platform id to the targets the backend exposes under
// /oauth/connections. Meta covers both Facebook Pages and IG accounts,
// distinguished by the `kind` tag on each target.
const TARGETS_FOR_PLATFORM = {
  facebook: (providers) =>
    (providers?.meta?.targets || []).filter((t) => t.kind === "facebook_page"),
  instagram: (providers) =>
    (providers?.meta?.targets || []).filter((t) => t.kind === "instagram_business"),
  tiktok: (providers) => providers?.tiktok?.targets || [],
  linkedin: (providers) => providers?.linkedin?.targets || [],
};

// One variant by default (cheapest). `count` > 1 generates alternatives on
// demand. `force = true` is the only way to pay for a fresh generation; a
// normal click reuses the memoized result when nothing meaningful changed.
export function generateContentThunk(force = false, count = 1) {
  return async (dispatch, getState) => {
    const { currentPost, aiGeneration } = getState().editor;

    // In-flight guard: ignore button spam while a call is running.
    if (aiGeneration.isGenerating || aiGeneration.isApplyingAction) return;

    // Route through a vision model when the user has uploaded an image —
    // only after the upload finished so we pass the server-side filename
    // (the backend resolves it against its content dir). Local-only previews
    // are skipped to avoid paying for an unusable URL.
    const firstImage = currentPost.media.find(
      (m) => m.kind === "image" && m.status === "uploaded" && m.filename
    );

    const args = {
      prompt: currentPost.content,
      platforms: currentPost.platforms,
      template: currentPost.template,
      tone: currentPost.tone || null,
      variants: count,
      image: firstImage?.filename ?? null,
    };

    // Unchanged request + we already have variants → reuse, don't re-prompt.
    if (!force && isGenerationCached(args) && aiGeneration.variants.length > 0) {
      // Log so the analytics view can render real cache-hit stats.
      dispatch(recordCacheHit());
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
      const { variants, usage, model, cached } = await generateContent({ ...args, force });
      dispatch(setVariants(variants));
      if (variants.length > 0) dispatch(setContent(variants[0].text));
      // `cached` here means the aiService memo cache served the call even
      // though our top-level "we already have variants" check missed it
      // (e.g. after a tab switch / hot reload). Count it as a hit too.
      if (cached) dispatch(recordCacheHit());
      if (!cached && usage?.total_tokens > 0) {
        // Keep the running totals AND log a per-call record so the
        // Analytics view can render real bars/tables instead of mocks.
        dispatch(addTokenUsage(usage.total_tokens));
        dispatch(
          recordAiCall({
            kind: "generate",
            model: model || "llm-router",
            variants: count,
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          })
        );
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
  return async (dispatch) => {
    dispatch(setStatus("draft"));
    dispatch(addNotification({ message: "Draft saved.", type: "success" }));
  };
}

export function submitForValidationThunk() {
  return async (dispatch) => {
    dispatch(setStatus("pending"));
    dispatch(addNotification({ message: "Submitted for validation.", type: "success" }));
  };
}

export function publishNowThunk() {
  return async (dispatch, getState) => {
    const state = getState();
    const { currentPost } = state.editor;
    const cooldownUntil = state.ui.publishCooldownUntil || 0;
    const now = Date.now();

    // Frontend cooldown guard — purely a UX nicety; backend has its own
    // guard, but this gives the user a clear message without a round-trip.
    if (now < cooldownUntil) {
      const wait = Math.ceil((cooldownUntil - now) / 1000);
      dispatch(addNotification({ message: `Wait ${wait}s before publishing again.`, type: "error" }));
      return;
    }

    // Build the list of (platform, target_id) pairs from currentPost.platforms
    // crossed with the live connections list. The user's `platforms` toggle
    // says which platforms they enabled; the targets come from whoever is
    // actually OAuth-connected on the backend.
    const enabled = Object.entries(currentPost.platforms)
      .filter(([, on]) => on)
      .map(([id]) => id);
    if (enabled.length === 0) {
      dispatch(addNotification({ message: "No platform selected.", type: "error" }));
      return;
    }

    let providers;
    try {
      const data = await fetchConnections();
      providers = data?.providers || {};
    } catch (err) {
      dispatch(setStatus("error"));
      dispatch(addNotification({ message: `Connections fetch failed: ${err.message}`, type: "error" }));
      return;
    }

    const targets = [];
    const skipped = [];
    for (const platform of enabled) {
      const picker = TARGETS_FOR_PLATFORM[platform];
      const found = picker ? picker(providers) : [];
      if (found.length === 0) {
        skipped.push(platform);
        continue;
      }
      for (const t of found) {
        targets.push({ platform, id: t.id, label: t.label });
      }
    }

    if (targets.length === 0) {
      dispatch(setStatus("error"));
      dispatch(
        addNotification({
          message: `No connected accounts for: ${skipped.join(", ")}. Connect them in Settings.`,
          type: "error",
        })
      );
      return;
    }

    // Pick the first successfully-uploaded media's public URL. Anything
    // still local-only (no remoteUrl) can't be fetched by Meta/IG, so we
    // skip it and let the FB text-only path through.
    const uploadedMedia = currentPost.media.find(
      (m) => m.status === "uploaded" && m.remoteUrl
    );
    const mediaUrl = uploadedMedia?.remoteUrl || null;
    // IG needs to know whether to treat the media as image vs video so the
    // publish step can wait for video processing.
    if (uploadedMedia?.kind === "video") {
      for (const t of targets) {
        if (t.platform === "instagram") t.media_kind = "video";
      }
    }

    // TikTok compose flags — only forward when TikTok is actually in
    // the publish set. The backend treats `tiktok` as optional and
    // applies safe defaults when omitted.
    const tiktokOpts = targets.some((t) => t.platform === "tiktok")
      ? {
          privacy_level: currentPost.tiktok?.privacy_level || "PUBLIC_TO_EVERYONE",
          disclose_video_branded: !!currentPost.tiktok?.disclose_video_branded,
          disclose_video_your_brand: !!currentPost.tiktok?.disclose_video_your_brand,
          music_confirmed: !!currentPost.tiktok?.music_confirmed,
          // Frontend can't know if the audit cleared — backend reads
          // from its own audit state. Default to `inbox` until the
          // env explicitly flips it (TIKTOK_AUDIT_MODE=direct).
          audit_mode: currentPost.tiktok?.audit_mode || "inbox",
        }
      : null;

    let results;
    try {
      const resp = await publishToTargets({
        content: currentPost.content,
        mediaUrl,
        targets,
        ratios: currentPost.ratios,
        tiktok: tiktokOpts,
      });
      results = resp.results || [];
    } catch (err) {
      dispatch(setStatus("error"));
      dispatch(addNotification({ message: `Publish failed: ${err.message}`, type: "error" }));
      return;
    }

    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // Lock the publish button briefly and remember this content so the
    // confirm modal can warn if the user immediately tries to repost.
    if (ok.length > 0) {
      dispatch(setPublishCooldownUntil(Date.now() + PUBLISH_COOLDOWN_MS));
      dispatch(recordPublishHash(publishHashKey(currentPost.content, mediaUrl)));
    }

    for (const r of ok) {
      dispatch(
        addNotification({
          message: `Published to ${r.target_label} (${r.platform}).`,
          type: "success",
          url: r.permalink_url || null,
        })
      );
    }
    for (const r of failed) {
      dispatch(
        addNotification({
          message: `${r.target_label} (${r.platform}) failed: ${r.error || "unknown"}`,
          type: "error",
        })
      );
    }

    dispatch(setStatus(ok.length > 0 ? "published" : "error"));
  };
}
