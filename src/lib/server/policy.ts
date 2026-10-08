/**
 * Server-side policy values shared by the workflow and link flows.
 *
 * Values resolve from environment variables with safe, documented defaults.
 */

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const linkPolicy = {
  /** Maximum token mints per job per rolling hour (anti-link-pumping). */
  maxMintsPerJobPerHour: () => intFromEnv("QR_MAX_MINTS_PER_JOB_PER_HOUR", 5, 1, 20),
} as const;

/**
 * Public origin used in customer-facing links (secure verification/approval
 * links, statements).
 *
 * Resolution order:
 *  1. APP_BASE_URL env — deliberate override, recommended in production so
 *     links minted from local/preview environments still point at the
 *     deployed domain customers can actually reach.
 *  2. The request's own origin (browser origin on same-origin calls —
 *     correct in every environment, local and deployed).
 *  3. Vercel-provided deployment domains (VERCEL_PROJECT_PRODUCTION_URL /
 *     VERCEL_URL are injected automatically on Vercel).
 *  4. localhost — development only. In production a link is NEVER built on
 *     localhost: without APP_BASE_URL (or a request / Vercel origin) this
 *     throws so a broken link is never sent to a customer.
 */
export function resolveBaseUrl(requestOrigin: string | null): string {
  const configured = process.env.APP_BASE_URL;
  if (configured && /^https?:\/\//.test(configured)) return configured.replace(/\/$/, "");
  if (requestOrigin && /^https?:\/\//.test(requestOrigin)) {
    return requestOrigin.replace(/\/$/, "");
  }
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProduction && !vercelProduction.startsWith("localhost")) {
    return `https://${vercelProduction.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL is not set. Set it to the public https:// address customers open (e.g. https://your-domain.com).");
  }
  return "http://localhost:3000";
}

/**
 * Ops dispatch cutoff (server-authoritative). Tomorrow's jobs become visible
 * to the Ops Manager at/after this local time on the previous day.
 * The client-facing SystemSettings field remains operational/display config;
 * the API enforces this environment value (default 20:00 = 8:00 PM).
 */
export function dispatchCutoffTime(): string {
  const raw = process.env.NEXT_DAY_DISPATCH_TIME || "20:00";
  return /^\d{2}:\d{2}$/.test(raw) ? raw : "20:00";
}
