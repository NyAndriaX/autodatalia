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
import { submitValidation } from "../lib/validationService";
import { loadSettings } from "../lib/settingsStorage";
import { getScheduleTimezone } from "../lib/timezone";

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
    const hasUploading = () => getState().editor.currentPost.media.some((m) => m.status === "uploading");
    if (hasUploading()) {
      let attempts = 0;
      while (hasUploading() && attempts < 10) {
        await new Promise((r) => setTimeout(r, 500));
        attempts++;
      }
    }

    // Re-read after the wait
    const currentPostRefreshed = getState().editor.currentPost;
    const firstImage = currentPostRefreshed.media.find(
      (m) => m.kind === "image" && m.status === "uploaded" && m.filename
    );

    const args = {
      // The post content doubles as the brief for the AI (an empty content is
      // fine — the backend supplies a default brief).
      prompt: currentPostRefreshed.content,
      platforms: currentPostRefreshed.platforms,
      tone: currentPostRefreshed.tone || null,
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
  return async (dispatch, getState) => {
    const { currentPost } = getState().editor;
    try {
      const localSettings = loadSettings();
      const resp = await submitValidation({
        content: currentPost.content,
        platforms: currentPost.platforms,
        scheduledDate: currentPost.scheduledDate || undefined,
        timezone: getScheduleTimezone(),
        media: currentPost.media || [],
        ratios: currentPost.ratios || undefined,
        tiktok: currentPost.tiktok || undefined,
        chat_id: localSettings.telegramChatId || undefined,
      });
      dispatch(setStatus(resp?.status || "pending"));
      dispatch(
        addNotification({
          message: `Submitted for Telegram validation${resp?.chat_id ? ` (${resp.chat_id})` : ""}.`,
          type: "success",
        })
      );
    } catch (err) {
      dispatch(setStatus("error"));
      dispatch(
        addNotification({
          message: `Validation submit failed: ${err.message || "unknown error"}`,
          type: "error",
        })
      );
    }
  };
}

export function publishNowThunk() {
  return async (dispatch, getState) => {
    const cooldownUntil = getState().ui.publishCooldownUntil || 0;
    const now = Date.now();

    // Frontend cooldown guard — purely a UX nicety; backend has its own
    // guard, but this gives the user a clear message without a round-trip.
    if (now < cooldownUntil) {
      const wait = Math.ceil((cooldownUntil - now) / 1000);
      dispatch(addNotification({ message: `Wait ${wait}s before publishing again.`, type: "error" }));
      return;
    }

    // Wait for any in-flight uploads before publishing — sending a publish
    // request while a video is still uploading guarantees a "requires_media"
    // failure on TikTok/IG. Poll the store for up to 60s; if uploads are
    // still pending after that, bail with a clear message instead of firing
    // a doomed publish call.
    const isUploadDone = () => {
      const st = getState().editor.currentPost;
      return !(st.media || []).some((m) => m.status === "uploading");
    };
    if (!isUploadDone()) {
      dispatch(
        addNotification({
          message: "Waiting for upload + transcode to finish before publishing…",
          type: "info",
        })
      );
      // Backend transcodes videos to H.264/AAC MP4 on upload — a 5-min
      // input at veryfast preset is ~90s on a modern CPU. Give it 5 min
      // before giving up (covers the worst realistic short-form video).
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline && !isUploadDone()) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!isUploadDone()) {
        dispatch(setStatus("error"));
        dispatch(
          addNotification({
            message: "Upload + transcode didn't finish in 5min. Check the file and retry.",
            type: "error",
          })
        );
        return;
      }
    }

    // Re-read currentPost AFTER the upload-wait so we pick up the now-
    // populated remoteUrl on each uploaded media item.
    const { currentPost } = getState().editor;

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
    // Zernio targets come back from /oauth/connections tagged with the
    // datalia-facing `platform` + provider:"zernio"; the backend routes them
    // through the unified API. A platform is only "skipped" when NEITHER a
    // direct account nor a Zernio account is connected for it.
    const zernioTargets = providers?.zernio?.targets || [];
    for (const platform of enabled) {
      const picker = TARGETS_FOR_PLATFORM[platform];
      const direct = picker ? picker(providers) : [];
      const zern = zernioTargets.filter((t) => t.platform === platform);
      if (direct.length === 0 && zern.length === 0) {
        skipped.push(platform);
        continue;
      }
      for (const t of direct) {
        targets.push({ platform, id: t.id, label: t.label });
      }
      for (const t of zern) {
        targets.push({ platform, id: t.id, label: t.label, provider: "zernio" });
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

    // Pick all successfully-uploaded media items' public URLs.
    const uploadedMedias = (currentPost.media || []).filter(
      (m) => m.status === "uploaded" && m.remoteUrl
    );
    const mediaUrls = uploadedMedias.map((m) => m.remoteUrl);
    const mediaUrl = mediaUrls.length > 0 ? mediaUrls[0] : null;
    const mediaKind = uploadedMedias.length > 0 ? uploadedMedias[0].kind : null;
    // Tag every target with the actual media kind and include all media URLs.
    if (mediaKind) {
      for (const t of targets) {
        t.media_kind = mediaKind;
        t.media_urls = mediaUrls;
      }
    }

    // If the user has media in the post but NONE of it actually uploaded
    // successfully, refuse to publish. The previous behaviour silently
    // posted text-only to platforms that accept it (FB) and reported
    // `requires_media` for the rest — confusing because the editor showed
    // the video preview the whole time (rendered from the local blob URL).
    const hasMediaItems = (currentPost.media || []).length > 0;
    const platformsNeedingMedia = targets.some(
      (t) => t.platform === "instagram" || t.platform === "tiktok"
    );
    if (hasMediaItems && !mediaUrl) {
      const broken = (currentPost.media || []).filter(
        (m) => m.status !== "uploaded" || !m.remoteUrl
      );
      const why =
        broken.find((b) => b.error)?.error ||
        (broken.some((b) => b.status === "uploading")
          ? "upload still in progress"
          : "upload didn't complete");
      dispatch(setStatus("error"));
      dispatch(
        addNotification({
          message: `Can't publish: ${why}. Remove the failed file and re-add it.`,
          type: "error",
        })
      );
      return;
    }
    if (platformsNeedingMedia && !mediaUrl) {
      dispatch(setStatus("error"));
      dispatch(
        addNotification({
          message:
            "Instagram and TikTok need a media file. Add an image or video before publishing.",
          type: "error",
        })
      );
      return;
    }
    // (media_kind for every target is set above — old IG-only loop removed)

    // TikTok compose flags — only forward when TikTok is actually in
    // the publish set. The backend treats `tiktok` as optional and
    // applies safe defaults when omitted.
    const tiktokOpts = targets.some((t) => t.platform === "tiktok")
      ? {
          privacy_level: currentPost.tiktok?.privacy_level || "SELF_ONLY",
          disclose_video_branded: !!currentPost.tiktok?.disclose_video_branded,
          disclose_video_your_brand: !!currentPost.tiktok?.disclose_video_your_brand,
          music_confirmed: !!currentPost.tiktok?.music_confirmed,
          // Direct-post writes straight to the user's profile (no inbox
          // draft). Requires `video.publish` in the OAuth scopes — set
          // TIKTOK_SCOPES on the backend and reconnect TikTok.
          audit_mode: currentPost.tiktok?.audit_mode || "direct",
        }
      : null;

    let results;
    try {
      const resp = await publishToTargets({
        content: currentPost.content,
        mediaUrl,
        mediaUrls,
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
