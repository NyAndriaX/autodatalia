import { config } from "./config";

async function postToWebhook(url, payload) {
  if (!url) return { local: true };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook error ${res.status}`);
  return res.json().catch(() => ({}));
}

export const webhookService = {
  saveDraft: (post) => postToWebhook(config.n8nSaveDraftUrl, post),
  submitForValidation: (post) => postToWebhook(config.n8nSubmitValidationUrl, post),
  publishNow: (post) => postToWebhook(config.n8nPublishUrl, post),
  schedulePost: (post) => postToWebhook(config.n8nScheduleUrl, post),
};
