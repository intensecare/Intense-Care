/**
 * 2Factor.in HTTP API client (server-only).
 *
 * Flow (official docs / Postman collection:
 * https://documenter.getpostman.com/view/301893/TWDamFGh):
 *
 *  1. Send OTP — AUTOGEN: 2Factor generates the code and delivers it through
 *     their PRE-APPROVED DLT OTP template + shared sender, which is what makes
 *     delivery reliable in India without your own DLT registration:
 *        GET https://2factor.in/API/V1/{API_KEY}/SMS/{PHONE}/AUTOGEN
 *        -> { "Status": "Success", "Details": "<session_id>" }
 *
 *  2. Verify OTP — against the session:
 *        GET https://2factor.in/API/V1/{API_KEY}/SMS/VERIFY/{session_id}/{otp}
 *        -> { "Status": "Success", "Details": "OTP Matched" }
 *
 * The API key is read exclusively from TWOFACTOR_API_KEY and never logged.
 * When TWOFACTOR_API_KEY is absent the client reports `configured: false` so
 * callers fail safe — no virtual "sent" states.
 */

const BASE = "https://2factor.in/API/V1";
const TIMEOUT_MS = 10_000;

export interface TwoFactorResult {
  ok: boolean;
  sessionId?: string;
  matched?: boolean;
  raw?: unknown;
  error?: string;
}

function apiKey(): string | null {
  const key = process.env.TWOFACTOR_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

export function isTwoFactorConfigured(): boolean {
  return apiKey() !== null;
}

/** Normalizes any Indian phone format to the 10-digit subscriber number 2Factor expects. */
export function toSubscriberNumber(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

async function callJson(url: string): Promise<TwoFactorResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.json().catch(() => null);
    // 2Factor signals business outcomes ("OTP Mismatch", "Session Expired",
    // "Invalid SessionId") as HTTP 400 with a JSON body — these are ANSWERS,
    // not transport failures. Parse them so callers can distinguish a wrong
    // code from a dead session from a genuine network problem.
    if (!res.ok) {
      const status = (body as { Status?: string } | null)?.Status;
      if (status === "Error" && body) {
        return { ok: true, raw: body, error: (body as { Details?: string }).Details };
      }
      return { ok: false, error: `2factor_http_${res.status}`, raw: body };
    }
    return { ok: true, raw: body };
  } catch (err) {
    const message = err instanceof Error ? err.message : "network_error";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Triggers a provider-generated OTP to the phone via the pre-approved DLT
 * template (AUTOGEN). Returns the session id used for verification.
 */
export async function sendOtpAutogen(phone: string): Promise<TwoFactorResult> {
  const key = apiKey();
  const subscriber = toSubscriberNumber(phone);
  if (!key || !subscriber) {
    return { ok: false, error: !key ? "provider_not_configured" : "invalid_phone" };
  }

  const url = `${BASE}/${key}/SMS/${subscriber}/AUTOGEN`;
  const result = await callJson(url);

  if (result.ok) {
    const raw = result.raw as { Status?: string; Details?: string } | null;
    if (raw?.Status !== "Success" || !raw.Details) {
      return { ok: false, error: raw?.Status || "provider_error", raw };
    }
    return { ok: true, sessionId: raw.Details };
  }
  return result;
}

/**
 * Verifies the code the customer submitted against the AUTOGEN session.
 * matched=true only on {"Status":"Success","Details":"OTP Matched"}.
 *
 * 2Factor answers a wrong code with HTTP 400 {"Status":"Error",
 * "Details":"OTP Mismatch"} — that is a definitive "no", surfaced as
 * matched=false so the caller burns one attempt. "Session Expired" or an
 * unknown session is a dead challenge: matched=false plus a sessionError
 * flag so the caller can tell the user to request a fresh OTP instead of
 * retrying the same one.
 */
export async function verifyOtpSession(
  sessionId: string,
  otp: string
): Promise<TwoFactorResult & { sessionError?: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "provider_not_configured" };

  const url = `${BASE}/${key}/SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(otp)}`;
  const result = await callJson(url);

  if (result.ok) {
    const raw = result.raw as { Status?: string; Details?: string } | null;
    const details = raw?.Details || "";
    const matched = raw?.Status === "Success" && /otp\s*matched/i.test(details);
    const sessionDead =
      /no entry exists|invalid session|session expired|session id/i.test(details) && !matched;
    return { ok: true, matched, sessionError: sessionDead ? details : undefined, raw };
  }
  return result;
}
