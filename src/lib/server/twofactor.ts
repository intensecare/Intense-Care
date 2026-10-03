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
 *
 * Modes (set TWOFACTOR_OTP_TEMPLATE to switch off the shared route):
 *  - "autogen" (default): code generated + verified by 2Factor sessions,
 *    delivered through 2Factor's SHARED pre-approved DLT template. Observed
 *    live on this account: the provider accepts the send and returns a live
 *    session, but the handset never receives the SMS (shared-template route
 *    silently swallowing delivery) — hence the two escape hatches below.
 *  - "autogen_template" (TWOFACTOR_OTP_TEMPLATE set): provider still generates
 *    and verifies the code, but delivery goes through YOUR DLT-registered
 *    template + sender id via the official variant
 *    /SMS/{phone}/AUTOGEN/{template_name} (2Factor KB "Creating Custom OTP
 *    Templates"). Session VERIFY flow is unchanged.
 *  - "template" (TWOFACTOR_OTP_TEMPLATE set AND TWOFACTOR_OTP_LOCAL_CODE=1):
 *    6-digit code generated LOCALLY, delivered through YOUR DLT-registered
 *    template (POST /ADDON_SERVICES/SEND/TSMS with TemplateName + VAR1) and
 *    verified locally against a SHA-256 hash. No provider session involved.
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

/**
 * Dev/test escape hatch: with OTP_DEV_MODE=1 the code is generated locally and
 * returned in the API response — no SMS is sent, no provider is contacted.
 * Intended for local development and staging ONLY. NEVER set this in
 * production: any signed-in lead worker could read the customer OTP from the
 * network tab and verify jobs without the customer's phone.
 */
export function isOtpDevMode(): boolean {
  return process.env.OTP_DEV_MODE?.trim() === "1";
}

// --- Delivery mode (AUTOGEN vs own DLT template) ---------------------------

export type OtpSendMode = "autogen" | "autogen_template" | "template";

/**
 * THREEFACTOR_OTP_TEMPLATE switches off the broken shared route:
 *  - unset                      -> "autogen" (shared DLT template)
 *  - set                        -> "autogen_template" (own DLT template,
 *                                  provider still generates + verifies)
 *  - set + TWOFACTOR_OTP_LOCAL_CODE=1 -> "template" (fully local code path)
 */
export function otpSendMode(): OtpSendMode {
  const tpl = process.env.TWOFACTOR_OTP_TEMPLATE?.trim();
 if (!tpl) return "autogen";
  return process.env.TWOFACTOR_OTP_LOCAL_CODE?.trim() === "1" ? "template" : "autogen_template";
}

export function otpTemplateName(): string | null {
  const tpl = process.env.TWOFACTOR_OTP_TEMPLATE?.trim();
  return tpl ? tpl : null;
}

/** DLT sender id; 2Factor's shared sender is the default. */
function otpSenderId(): string {
  return process.env.TWOFACTOR_SENDER_ID?.trim() || "TFCTOR";
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
 * Live account credit balances (read-only probe — never sends an SMS).
 * Endpoints verified live: GET {key}/BAL/SMS and
 * GET {key}/ADDON_SERVICES/BAL/TRANSACTIONAL_SMS (see hanut/2factor-node).
 */
export interface TwoFactorBalance {
  configured: boolean;
  ok?: boolean;
  otpSmsCredits?: string | null;
  transactionalSmsCredits?: string | null;
  error?: string;
  /** Active OTP delivery mode — surfaced in the Settings health card. */
  mode: OtpSendMode;
}

export async function getTwoFactorBalance(): Promise<TwoFactorBalance> {
  const key = apiKey();
  if (!key) return { configured: false, mode: otpSendMode() };

  const [otp, tsms] = await Promise.all([
    callJson(`${BASE}/${key}/BAL/SMS`),
    callJson(`${BASE}/${key}/ADDON_SERVICES/BAL/TRANSACTIONAL_SMS`),
  ]);

  const readDetail = (r: TwoFactorResult): string | null => {
    const raw = r.raw as { Status?: string; Details?: string } | null;
    return r.ok && raw?.Status === "Success" ? raw.Details ?? null : null;
  };

  if (!otp.ok && !tsms.ok) {
    return {
      configured: true,
      ok: false,
      mode: otpSendMode(),
      error: otp.error || tsms.error || "balance_probe_failed",
    };
  }
  return {
    configured: true,
    ok: true,
    mode: otpSendMode(),
    otpSmsCredits: readDetail(otp),
    transactionalSmsCredits: readDetail(tsms),
  };
}

/**
 * Template-mode send: delivers a LOCALLY-generated code through the account's
 * own DLT-registered template (form-encoded TSMS endpoint, same shape as
 * hanut/2factor-node sendTemplate: From / To / TemplateName / VAR1…). The
 * returned `sessionId` is the provider MESSAGE id — there is no verify
 * session; template-mode codes are verified locally (see otp-service).
 */
export async function sendOtpTemplate(phone: string, code: string): Promise<TwoFactorResult> {
  const key = apiKey();
  const subscriber = toSubscriberNumber(phone);
  const template = otpTemplateName();
  if (!key || !subscriber || !template) {
    return {
      ok: false,
      error: !key ? "provider_not_configured" : !template ? "otp_template_not_configured" : "invalid_phone",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${key}/ADDON_SERVICES/SEND/TSMS`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: otpSenderId(),
        To: subscriber,
        TemplateName: template,
        VAR1: code,
      }).toString(),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as { Status?: string; Details?: string } | null;
    if (res.ok && body?.Status === "Success" && body.Details) {
      return { ok: true, sessionId: body.Details, raw: body };
    }
    if (body?.Status === "Error") {
      return { ok: false, error: body.Details || "provider_error", raw: body };
    }
    return { ok: false, error: `2factor_http_${res.status}`, raw: body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Triggers a provider-generated OTP to the phone. Default route is AUTOGEN
 * (2Factor's shared pre-approved DLT template); pass a DLT template name to
 * use the official AUTOGEN/{template} variant, which delivers the SAME
 * provider-generated code through YOUR registered template + sender while
 * keeping the session VERIFY flow unchanged.
 */
export async function sendOtpAutogen(
  phone: string,
  templateName?: string | null
): Promise<TwoFactorResult> {
  const key = apiKey();
  const subscriber = toSubscriberNumber(phone);
  if (!key || !subscriber) {
    return { ok: false, error: !key ? "provider_not_configured" : "invalid_phone" };
  }

  const url = templateName
    ? `${BASE}/${key}/SMS/${subscriber}/AUTOGEN/${encodeURIComponent(templateName)}`
    : `${BASE}/${key}/SMS/${subscriber}/AUTOGEN`;
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
