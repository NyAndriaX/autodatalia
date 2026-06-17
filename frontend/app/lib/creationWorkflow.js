import { Share2, FileText, Image, Send } from "lucide-react";

export const CREATION_STEPS = [
  { id: "platforms", label: "Platforms", hint: "Pick targets", icon: Share2 },
  { id: "media", label: "Media", hint: "Add visuals", icon: Image },
  { id: "content", label: "Content", hint: "Write & generate", icon: FileText },
  { id: "publish", label: "Publish", hint: "Review & go live", icon: Send },
];

/**
 * Derive workflow step state from the current editor post.
 */
export function deriveCreationWorkflow(post) {
  const hasPlatforms = Object.values(post.platforms || {}).some(Boolean);
  const hasContent = Boolean((post.content || "").trim());
  const hasMedia = (post.media || []).some(
    (m) => m.status === "uploaded" || m.previewUrl || m.remoteUrl
  );
  const readyToPublish = hasPlatforms && hasContent;

  const completedIds = [];
  if (hasPlatforms) completedIds.push("platforms");
  if (hasMedia) completedIds.push("media");
  if (hasContent) completedIds.push("content");
  if (readyToPublish) completedIds.push("publish");

  let currentId = "platforms";
  if (!hasPlatforms) currentId = "platforms";
  else if (!hasMedia) currentId = "media";
  else if (!hasContent) currentId = "content";
  else currentId = "publish";

  const progressPct = Math.round((completedIds.length / CREATION_STEPS.length) * 100);

  return { completedIds, currentId, progressPct, readyToPublish, hasMedia };
}
