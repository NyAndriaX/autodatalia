// @ts-nocheck
import { apiFetch } from "./apiClient";
import { getScheduleTimezone } from "./timezone";

// Sensible defaults for a brand-new rule so the form opens populated. The
// CEO requirements mention the four objectives + a tone, so we seed with
// the most common combo (daily 10:00 informative photo).
export const DEFAULT_AUTOMATION_RULE = {
  name: "",
  active: true,
  content_type: "photo",
  template_id: null,
  num_media: { mode: "fixed", count: 1, min: 2, max: 4 },
  domain: "",
  target_audience: "",
  tone: "",
  objective: "informative",
  description_style: "",
  extra_brief: "",
  schedule: {
    frequency: "daily",
    times: ["10:00"],
    weekdays: null,
    month_days: null,
    timezone: "",
  },
  validation_lead_minutes: 30,
  validation_chat_id: null,
  platforms: { facebook: true, instagram: false, tiktok: false, linkedin: false },
  ratios: null,
  tiktok: null,
};

export function buildDefaultAutomationRule(overrides: any = {}) {
  const schedule = {
    ...DEFAULT_AUTOMATION_RULE.schedule,
    timezone: getScheduleTimezone(),
    ...(overrides.schedule || {}),
  };
  return {
    ...DEFAULT_AUTOMATION_RULE,
    ...overrides,
    num_media: {
      ...DEFAULT_AUTOMATION_RULE.num_media,
      ...(overrides.num_media || {}),
    },
    schedule,
    platforms: {
      ...DEFAULT_AUTOMATION_RULE.platforms,
      ...(overrides.platforms || {}),
    },
  };
}

function normalizeAutomationRule(rule: any) {
  const timezone = (rule?.schedule?.timezone || "").trim() || getScheduleTimezone();
  return {
    ...rule,
    schedule: {
      ...DEFAULT_AUTOMATION_RULE.schedule,
      ...(rule?.schedule || {}),
      timezone,
    },
  };
}

export async function listAutomationRules() {
  const data = await apiFetch("/automation-rules");
  return data?.rules || [];
}

export async function createAutomationRule(rule: any) {
  return apiFetch("/automation-rules", {
    method: "POST",
    body: JSON.stringify(normalizeAutomationRule(rule)),
  });
}

export async function updateAutomationRule(id: any, rule: any) {
  return apiFetch(`/automation-rules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(normalizeAutomationRule(rule)),
  });
}

export async function deleteAutomationRule(id: any) {
  return apiFetch(`/automation-rules/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
