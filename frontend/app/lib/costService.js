import { apiFetch } from "./apiClient";

// One-stop fetch for the dashboard. Returns { totals, by_workflow, by_tier,
// by_model, by_user } already parsed from the API response.
export async function fetchCostSummary(period = "30d") {
  return apiFetch(`/costs/summary?period=${encodeURIComponent(period)}`);
}

// Recent per-call log entries (for the Analytics detail view).
export async function fetchCostLog(limit = 200) {
  return apiFetch(`/costs/log?limit=${encodeURIComponent(limit)}`);
}
