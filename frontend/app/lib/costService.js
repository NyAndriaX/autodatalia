import { apiFetch } from "./apiClient";

// One-stop fetch for the dashboard. Returns { totals, by_workflow, by_tier,
// by_model, by_user } already parsed from the API response.
export async function fetchCostSummary(period = "30d") {
  return apiFetch(`/costs/summary?period=${encodeURIComponent(period)}`);
}

