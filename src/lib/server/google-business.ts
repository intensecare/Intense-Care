import { logger } from "./logger";

/**
 * Google Business Profile Performance API — aggregate counts (calls, website
 * clicks, direction requests, impressions) for the company's own listing,
 * shown on the Leads dashboard. These are NOT leads: Google never tells us who
 * searched or viewed, so nothing here creates or identifies a lead.
 *
 * Needs an OAuth client authorised by an owner/manager of the listing:
 *   GOOGLE_BP_CLIENT_ID, GOOGLE_BP_CLIENT_SECRET, GOOGLE_BP_REFRESH_TOKEN
 *   (scope https://www.googleapis.com/auth/business.manage) and
 *   GOOGLE_BP_LOCATION_ID ("locations/1234567890").
 */

export const GBP_METRICS = [
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
] as const;
export type GbpMetric = (typeof GBP_METRICS)[number];

export interface GbpSummary {
  configured: boolean;
  from: string;
  to: string;
  totals: Partial<Record<GbpMetric, number>>;
  error?: string;
}

export function gbpConfigured(): boolean {
  return !!(process.env.GOOGLE_BP_CLIENT_ID && process.env.GOOGLE_BP_CLIENT_SECRET && process.env.GOOGLE_BP_REFRESH_TOKEN && process.env.GOOGLE_BP_LOCATION_ID);
}

/** Sums the API's multi-metric time series into one total per metric. */
export function sumGbpResponse(json: unknown): Partial<Record<GbpMetric, number>> {
  const totals: Partial<Record<GbpMetric, number>> = {};
  const outer = (json as { multiDailyMetricTimeSeries?: unknown[] })?.multiDailyMetricTimeSeries ?? [];
  for (const block of outer) {
    for (const series of (block as { dailyMetricTimeSeries?: unknown[] })?.dailyMetricTimeSeries ?? []) {
      const s = series as { dailyMetric?: string; timeSeries?: { datedValues?: { value?: string | number }[] } };
      if (!s.dailyMetric || !(GBP_METRICS as readonly string[]).includes(s.dailyMetric)) continue;
      const sum = (s.timeSeries?.datedValues ?? []).reduce((a, v) => a + (Number(v.value ?? 0) || 0), 0);
      const k = s.dailyMetric as GbpMetric;
      totals[k] = (totals[k] ?? 0) + sum;
    }
  }
  return totals;
}

const cache = new Map<string, { at: number; data: GbpSummary }>();

async function accessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_BP_CLIENT_ID!,
      client_secret: process.env.GOOGLE_BP_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_BP_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const j = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!res.ok || !j?.access_token) throw new Error(`Google sign-in failed (${j?.error ?? res.status}) — re-authorise the Business Profile connection.`);
  return j.access_token;
}

export async function fetchGbpSummary(from: string, to: string): Promise<GbpSummary> {
  if (!gbpConfigured()) return { configured: false, from, to, totals: {} };
  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
  try {
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const qs = new URLSearchParams();
    for (const m of GBP_METRICS) qs.append("dailyMetrics", m);
    Object.entries({ "dailyRange.startDate.year": fy, "dailyRange.startDate.month": fm, "dailyRange.startDate.day": fd, "dailyRange.endDate.year": ty, "dailyRange.endDate.month": tm, "dailyRange.endDate.day": td }).forEach(([k, v]) => qs.set(k, String(v)));
    const loc = process.env.GOOGLE_BP_LOCATION_ID!.replace(/^\/+/, "");
    const res = await fetch(`https://businessprofileperformance.googleapis.com/v1/${loc}:fetchMultiDailyMetricsTimeSeries?${qs}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Google Business Profile returned ${res.status}${(json as { error?: { message?: string } })?.error?.message ? `: ${(json as { error: { message: string } }).error.message}` : ""}`);
    const data: GbpSummary = { configured: true, from, to, totals: sumGbpResponse(json) };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn("gbp.fetch_failed", { error });
    return { configured: true, from, to, totals: {}, error };
  }
}
