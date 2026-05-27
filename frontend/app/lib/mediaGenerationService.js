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

export async function generateVideoAsset({
  prompt,
  ratio = "9:16",
  durationSeconds = 6,
}) {
  const data = await apiFetch("/media/generate/video", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      ratio,
      duration_seconds: durationSeconds,
    }),
  });
  return { data, mediaItem: makeMediaItem(data) };
}
