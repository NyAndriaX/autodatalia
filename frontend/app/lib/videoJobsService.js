import { apiFetch } from "./apiClient";

// Kick off a new generation. Returns the queued VideoJob row.
export async function createVideoJob({
  prompt,
  ratio = "9:16",
  durationSeconds = 6,
  imageFilename = null,
  provider = null,
  falModel = null,
  quality = null,
  mode = null,
} = {}) {
  return apiFetch("/media/generate/video", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      ratio,
      duration_seconds: durationSeconds,
      image_filename: imageFilename,
      provider,
      fal_model: falModel,
      quality,
      mode,
      async_mode: true,
    }),
  });
}

// List the available fal.ai video models + the active default. The
// backend returns ``{models: [...], default: "..."}`` so the picker
// can preselect the active one.
export async function listVideoModels() {
  try {
    return await apiFetch("/video-models");
  } catch {
    return { models: [], default: null };
  }
}

export async function listVideoJobs() {
  const data = await apiFetch("/video-jobs");
  return data?.jobs || [];
}

export async function getVideoJob(jobId) {
  return apiFetch(`/video-jobs/${encodeURIComponent(jobId)}`);
}

export async function deleteVideoJob(jobId) {
  return apiFetch(`/video-jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}
