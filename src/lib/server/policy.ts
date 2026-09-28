/**
 * Server-side security policy for OTP + SMS flows.
 *
 * Values resolve from environment variables with safe, documented defaults.
 * The ERP's client-side Settings page remains operational configuration for
 * display/ops purposes; the server enforces its own environment-driven limits
 * so a tampered client cannot weaken security.
 */

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const otpPolicy = {
  /** OTP validity window in minutes. */
  expiryMinutes: () => intFromEnv("OTP_EXPIRY_MINUTES", 10, 1, 60),
  /** Max verification attempts per OTP before the challenge locks. */
  maxAttempts: () => intFromEnv("OTP_MAX_ATTEMPTS", 5, 1, 10),
  /** Cooldown between OTP sends to the same job, in seconds. */
  resendCooldownSeconds: () => intFromEnv("OTP_RESEND_COOLDOWN_SECONDS", 60, 10, 600),
  /** Maximum OTP sends per job per rolling hour. */
  maxSendsPerJobPerHour: () => intFromEnv("OTP_MAX_SENDS_PER_JOB_PER_HOUR", 5, 1, 20),
  /** Maximum OTP sends per destination phone per rolling hour (anti-SMS-pumping). */
  maxSendsPerPhonePerHour: () => intFromEnv("OTP_MAX_SENDS_PER_PHONE_PER_HOUR", 10, 1, 50),
} as const;

export const invitePolicy = {
  /** Portal handover link validity in days (resend mints a fresh link). */
  expiryDays: () => intFromEnv("PORTAL_LINK_EXPIRY_DAYS", 30, 1, 365),
} as const;

/** Public origin used in SMS links; falls back to the request origin. */
export function resolveBaseUrl(requestOrigin: string | null): string {
  const configured = process.env.APP_BASE_URL;
  if (configured && configured.startsWith("http")) return configured.replace(/\/$/, "");
  if (requestOrigin && /^https?:\/\//.test(requestOrigin)) {
    return requestOrigin.replace(/\/$/, "");
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
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw : "20:00";
}
