import { apiFetch } from "./apiClient";

export async function submitValidation(payload) {
  return apiFetch("/validation/submit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchTelegramStatus() {
  return apiFetch("/telegram/status");
}

export async function sendTelegramTest(chatId) {
  const qs = chatId ? `?chat_id=${encodeURIComponent(chatId)}` : "";
  return apiFetch(`/telegram/test${qs}`, { method: "POST" });
}
