// Stable identity key for "is this the same post?" — used by both the
// frontend duplicate warning and the backend cooldown guard. Cheap on
// purpose: we don't need cryptographic strength, just a unique-enough
// fingerprint of (content + media URL).

export function publishHashKey(content, mediaUrl) {
  return `${(content || "").trim()}|${mediaUrl || ""}`;
}
