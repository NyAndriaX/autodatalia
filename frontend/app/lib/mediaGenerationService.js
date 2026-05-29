import { apiFetch } from "./apiClient";

function makeMediaItem(data) {
  const kind = data?.kind || "image";
  const now = Date.now();
  return {
    id: `gen_${now}_${kind}`,
    name: data?.filename || `generated-${kind}`,
    kind,
    mime: kind === "video" ? "video/mp4" : "image/png",
    size: 0,
    previewUrl: data?.url || null,
    remoteUrl: data?.url || null,
    filename: data?.filename || null,
    status: "uploaded",
    provider: data?.provider || "backend",
    generated: true,
  };
}

export async function generateImageAsset({ prompt, ratio = "1:1" }) {
  const data = await apiFetch("/media/generate/image", {
    method: "POST",
    body: JSON.stringify({ prompt, ratio }),
  });
  return { data, mediaItem: makeMediaItem(data) };
}

// Backend /media/generate/video defaults to async_mode=true, returning a
// VideoJob ({id, status:'queued', ...}) instead of GeneratedMediaResponse.
// We poll /video-jobs/{id} until the job reaches a terminal state, then
// map output_url/output_filename onto the shape makeMediaItem expects.
// async_mode:false isn't safe behind the public HTTPS proxy (ngrok/
// Cloudflare ~60s edge timeout, video gens routinely 30-90s).
const VIDEO_JOB_POLL_INTERVAL_MS = 3000;
const VIDEO_JOB_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateVideoAsset({
  prompt,
  ratio = "9:16",
  durationSeconds = 6,
}) {
  const job = await apiFetch("/media/generate/video", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      ratio,
      duration_seconds: durationSeconds,
    }),
  });
  if (!job?.id) {
    throw new Error("Video generation did not return a job id.");
  }

  const startedAt = Date.now();
  let current = job;
  while (current?.status !== "succeeded") {
    if (
      current?.status === "failed" ||
      current?.status === "cancelled"
    ) {
      throw new Error(
        current?.error || `Video generation ${current?.status || "failed"}.`
      );
    }
    if (Date.now() - startedAt > VIDEO_JOB_POLL_TIMEOUT_MS) {
      throw new Error("Video generation timed out.");
    }
    await sleep(VIDEO_JOB_POLL_INTERVAL_MS);
    current = await apiFetch(`/video-jobs/${job.id}`);
  }

  const data = {
    url: current.output_url,
    filename: current.output_filename,
    kind: "video",
    provider: current.provider,
  };
  return { data, mediaItem: makeMediaItem(data) };
}
