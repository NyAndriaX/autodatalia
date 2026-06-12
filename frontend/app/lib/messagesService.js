import { apiFetch } from "./apiClient";
import { config } from "./config";

// Seed feed — in production this is the Telegram-validation / webhook activity
// stream. Shape is stable so the UI doesn't change when the backend lands.
const SEED = [
  {
    id: "msg_1",
    kind: "validation",
    message: "Post “Summer launch teaser” is awaiting Telegram approval.",
    read: false,
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    id: "msg_2",
    kind: "publish",
    message: "“Q3 results recap” was published to LinkedIn.",
    read: false,
    timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: "msg_3",
    kind: "system",
    message: "Connected the OpenRouter LLM Router successfully.",
    read: true,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
];

// Fetch the activity/message feed.
// Swap this one function's body when the backend exposes /messages.
export async function fetchMessages() {
  if (!config.apiBaseUrl) {
    return new Promise((r) => setTimeout(() => r(SEED), 300));
  }
  try {
    const data = await apiFetch("/messages");
    if (!Array.isArray(data?.items)) throw new Error("bad shape");
    return data.items;
  } catch {
    // A real fetch error (401/500/bad shape) — don't fabricate notifications.
    // SEED is only for the unconfigured-backend case handled above.
    return [];
  }
}
