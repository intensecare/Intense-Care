import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { fetchGbpSummary } from "@/lib/server/google-business";
import { todayIST } from "@/lib/leads";

/**
 * GET /api/leads/google-metrics?from&to — Google Business Profile performance
 * totals for the period (default: last 30 days). Aggregate counts only; they
 * never create leads. `configured: false` when the connection isn't set up.
 */
export async function GET(request: Request) {
  try {
    await requirePermission("leads.view");
    const url = new URL(request.url);
    const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    // Google's data lags ~3 days; the API refuses future dates.
    const to = isDay(url.searchParams.get("to")) ? url.searchParams.get("to")! : todayIST(Date.now() - 86400000);
    const from = isDay(url.searchParams.get("from")) ? url.searchParams.get("from")! : todayIST(Date.now() - 31 * 86400000);
    return ok(await fetchGbpSummary(from, to));
  } catch (err) {
    return errorResponse(err, "leads.google_metrics.route_error");
  }
}
