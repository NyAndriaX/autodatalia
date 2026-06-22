const KEY_PREFIX = "datalia.editor.workspace.";

function keyFor(workspaceId) {
  return `${KEY_PREFIX}${workspaceId}`;
}

function sanitizeCurrentPost(post = {}) {
  return {
    draftId: post.draftId || null,
    content: typeof post.content === "string" ? post.content : "",
    platforms: post.platforms && typeof post.platforms === "object" ? post.platforms : undefined,
    tone: post.tone || null,
    ratios: post.ratios && typeof post.ratios === "object" ? post.ratios : {},
    status: typeof post.status === "string" ? post.status : "draft",
    scheduledDate: post.scheduledDate || null,
    time: post.time || null,
    media: Array.isArray(post.media) ? post.media : [],
    tiktok: post.tiktok && typeof post.tiktok === "object" ? post.tiktok : {},
  };
}

function sanitizeAiGeneration(ai = {}) {
  return {
    isGenerating: false,
    isApplyingAction: false,
    variants: Array.isArray(ai.variants) ? ai.variants : [],
    selectedVariant:
      typeof ai.selectedVariant === "number" ? ai.selectedVariant : null,
    error: typeof ai.error === "string" ? ai.error : null,
  };
}

export function loadEditorState(workspaceId) {
  if (typeof window === "undefined" || !workspaceId) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      currentPost: sanitizeCurrentPost(parsed?.currentPost),
      aiGeneration: sanitizeAiGeneration(parsed?.aiGeneration),
    };
  } catch {
    return null;
  }
}

export function saveEditorState(workspaceId, editor) {
  if (typeof window === "undefined" || !workspaceId || !editor) return;
  try {
    const payload = {
      currentPost: sanitizeCurrentPost(editor.currentPost),
      aiGeneration: sanitizeAiGeneration(editor.aiGeneration),
    };
    window.localStorage.setItem(keyFor(workspaceId), JSON.stringify(payload));
  } catch {
    /* quota / privacy mode */
  }
}
