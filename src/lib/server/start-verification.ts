import { prisma } from "./prisma";
import { resolveQrToken, rateLimit } from "./qr-service";
import { START_MODE_INFO, modeNeedsGps, modeNeedsQr, type StartMode, type StartVerificationSettings } from "@/lib/start-verification";
import { distanceMeters, resolveServiceLocation } from "@/lib/location";

/**
 * Server-side check for the job-start ("I'm here") step. The mode comes from
 * the database (company default or the job's own setting) — never from the
 * request. GPS is compared with the SAVED job/property location (never
 * replaced by the device's reading); a QR proves presence only if the server
 * resolves it to THIS job's customer link.
 *
 * Browser GPS is an estimate the device reports, not tamper-proof proof of
 * presence — GPS_QR adds the customer's QR for stronger assurance, and every
 * attempt is logged for audit.
 */

export { distanceMeters };

export interface ArrivalInput {
  lat?: number;
  lng?: number;
  accuracy?: number;
  qrToken?: string;
  bypassReason?: string;
}

export type QrResult = "VALID" | "INVALID" | "EXPIRED" | "REVOKED" | "OTHER_JOB" | "OTHER_PROPERTY" | "MISSING" | "RATE_LIMITED" | "NOT_REQUIRED";
export type GpsResult = "PASSED" | "FAILED" | "NOT_REQUIRED";

export type StartCode =
  | "GPS_MISSING"
  | "GPS_INACCURATE"
  | "GPS_TOO_FAR"
  | "NO_SAVED_LOCATION"
  | "QR_MISSING"
  | "QR_INVALID"
  | "QR_EXPIRED"
  | "QR_REVOKED"
  | "QR_OTHER_JOB"
  | "QR_OTHER_PROPERTY"
  | "QR_RATE_LIMITED"
  | "OVERRIDE_NOT_ALLOWED"
  | "OVERRIDE_REASON";

export interface StartCheck {
  ok: boolean;
  /** Machine-readable reason (the first problem), for the app to show the right retry. */
  code?: StartCode;
  error?: string;
  status?: number;
  result: "PASSED" | "FAILED" | "OVERRIDE";
  verification?: StartMode | "ADMIN_OVERRIDE";
  distanceM: number | null;
  qrResult: QrResult;
  gpsResult: GpsResult;
  /** Separate messages so the app can show the GPS and QR results side by side. */
  gpsMessage?: string;
  qrMessage?: string;
  gpsCheckedAt: Date | null;
  qrCheckedAt: Date | null;
  qrTokenId: string | null;
  target: { lat: number; lng: number; source: "JOB" | "PROPERTY" } | null;
}

/** A scanned QR may carry the whole link; only the last path segment is the token. */
export function tokenFromScan(raw: string): string {
  const t = raw.trim();
  try {
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t);
      return u.pathname.split("/").filter(Boolean).pop() ?? "";
    }
  } catch {
    /* not a URL */
  }
  return t;
}

type JobForStart = {
  id: string;
  propertyId: string;
  locationLat: number | null;
  locationLng: number | null;
  locationAddress?: string | null;
  locationSource?: string | null;
  property?: { lat: number | null; lng: number | null } | null;
};

export async function checkJobStart(input: {
  job: JobForStart;
  mode: StartMode;
  settings: StartVerificationSettings;
  arrival: ArrivalInput;
  /** Field Manager on their own job (true) or Admin acting from the office (false). */
  fieldUser: boolean;
  userId: string;
}): Promise<StartCheck> {
  const { job, mode, settings, arrival, fieldUser } = input;
  const where = resolveServiceLocation(job, job.property);
  const target = where.lat !== null && where.lng !== null && where.source ? { lat: where.lat, lng: where.lng, source: where.source } : null;
  const base = { distanceM: null as number | null, qrResult: "NOT_REQUIRED" as QrResult, gpsResult: "NOT_REQUIRED" as GpsResult, gpsCheckedAt: null, qrCheckedAt: null, qrTokenId: null, target };

  // Admin starting the job from the office is always an override, whatever the mode — with a reason.
  if (!fieldUser) {
    const reason = arrival.bypassReason?.trim() ?? "";
    if (reason.length < 5) return { ...base, ok: false, result: "FAILED", status: 400, code: "OVERRIDE_REASON", error: "Give a reason for starting this job on the Field Manager's behalf (at least 5 characters)." };
    return { ...base, ok: true, result: "OVERRIDE", verification: "ADMIN_OVERRIDE" };
  }
  // A Field Manager can never skip the check by giving a reason.
  if (arrival.bypassReason) return { ...base, ok: false, result: "FAILED", status: 403, code: "OVERRIDE_NOT_ALLOWED", error: "Only Admin can override job start verification. Call the office if you can't verify." };

  if (mode === "DIRECT") return { ...base, ok: true, result: "PASSED", verification: "DIRECT" };

  const problems: { code: StartCode; error: string }[] = [];
  let distanceM: number | null = null;
  let gpsResult: GpsResult = "NOT_REQUIRED";
  let qrResult: QrResult = "NOT_REQUIRED";
  let gpsMessage: string | undefined;
  let qrMessage: string | undefined;
  let gpsCheckedAt: Date | null = null;
  let qrCheckedAt: Date | null = null;
  let qrTokenId: string | null = null;

  if (modeNeedsGps(mode)) {
    gpsCheckedAt = new Date();
    const hasDevice = typeof arrival.lat === "number" && typeof arrival.lng === "number";
    let problem: { code: StartCode; error: string } | null = null;
    if (!target) {
      problem = { code: "NO_SAVED_LOCATION", error: "This job has no saved map location to check against. Ask the office to set the property's pin." };
    } else if (!hasDevice) {
      problem = { code: "GPS_MISSING", error: "We couldn't get your location. Turn on location (GPS) for this browser and try again." };
    } else {
      distanceM = Math.round(distanceMeters(arrival.lat!, arrival.lng!, target.lat, target.lng));
      if (typeof arrival.accuracy !== "number" || arrival.accuracy > settings.maxAccuracyMeters) {
        problem = { code: "GPS_INACCURATE", error: `Your GPS signal isn't accurate enough${typeof arrival.accuracy === "number" ? ` (±${Math.round(arrival.accuracy)} m; needs ±${settings.maxAccuracyMeters} m or better)` : ""}. Wait a few seconds in the open and try again.` };
      } else if (distanceM > settings.maxDistanceMeters) {
        problem = { code: "GPS_TOO_FAR", error: `You appear to be ${distanceM} m from the job location (allowed: ${settings.maxDistanceMeters} m). Move closer and try again.` };
      }
    }
    gpsResult = problem ? "FAILED" : "PASSED";
    gpsMessage = problem ? problem.error : `GPS verified — ${distanceM} m from the job location (±${Math.round(arrival.accuracy ?? 0)} m).`;
    if (problem) problems.push(problem);
  }

  if (modeNeedsQr(mode)) {
    qrCheckedAt = new Date();
    let problem: { code: StartCode; error: string } | null = null;
    const raw = arrival.qrToken ? tokenFromScan(arrival.qrToken) : "";
    if (!raw) {
      qrResult = "MISSING";
      problem = { code: "QR_MISSING", error: "Scan the customer's QR code for this job." };
    } else if (!rateLimit(`start-qr:${input.userId}`, 20, 10 * 60 * 1000).ok) {
      qrResult = "RATE_LIMITED";
      problem = { code: "QR_RATE_LIMITED", error: "Too many QR attempts. Wait a few minutes and try again." };
    } else {
      const resolved = await resolveQrToken(raw);
      if (!resolved.ok) {
        const k = resolved.failure.kind;
        qrResult = k === "expired" ? "EXPIRED" : k === "revoked" ? "REVOKED" : "INVALID";
        problem =
          k === "expired"
            ? { code: "QR_EXPIRED", error: "That QR code has expired. Ask the office to re-send the customer's QR for this booking." }
            : k === "revoked"
            ? { code: "QR_REVOKED", error: "That QR code was cancelled and replaced. Ask the customer to show the latest QR for this booking." }
            : { code: "QR_INVALID", error: "That QR code isn't a valid Intense Care job QR. Scan the customer's QR for this booking." };
      } else {
        qrTokenId = resolved.data.tokenRow.id;
        if (resolved.data.job.propertyId !== job.propertyId) {
          qrResult = "OTHER_PROPERTY";
          problem = { code: "QR_OTHER_PROPERTY", error: "That QR code belongs to a different property. Scan the QR for this booking at this property." };
        } else if (resolved.data.tokenRow.purpose !== "CUSTOMER_JOB" || resolved.data.job.id !== job.id) {
          qrResult = "OTHER_JOB";
          problem = { code: "QR_OTHER_JOB", error: "That QR code is for another booking at this property. Scan the QR for this job." };
        } else {
          qrResult = "VALID";
        }
      }
    }
    qrMessage = problem ? problem.error : "QR verified — it belongs to this job.";
    if (problem) problems.push(problem);
  }

  const common = { distanceM, qrResult, gpsResult, gpsMessage, qrMessage, gpsCheckedAt, qrCheckedAt, qrTokenId, target };
  if (problems.length) {
    return { ...common, ok: false, result: "FAILED", status: 409, code: problems[0].code, error: problems.map((p) => p.error).join(" ") };
  }
  return { ...common, ok: true, result: "PASSED", verification: mode };
}

/** Append one attempt to the verification log (best effort — never blocks the request). */
export async function logStartAttempt(row: {
  jobId: string;
  user: { id: string; name: string; role: string };
  mode: StartMode;
  check: StartCheck;
  arrival: ArrivalInput;
  statusBefore: string;
  statusAfter: string;
  failureReason?: string | null;
}) {
  try {
    await prisma.jobStartVerification.create({
      data: {
        jobId: row.jobId,
        userId: row.user.id,
        userName: row.user.name,
        userRole: row.user.role,
        mode: row.mode,
        result: row.check.result,
        failureReason: row.failureReason ?? (row.check.ok ? null : row.check.error?.slice(0, 500) ?? null),
        lat: row.arrival.lat ?? null,
        lng: row.arrival.lng ?? null,
        accuracy: row.arrival.accuracy ?? null,
        distanceM: row.check.distanceM,
        qrResult: row.check.qrResult,
        gpsResult: row.check.gpsResult,
        gpsCheckedAt: row.check.gpsCheckedAt,
        qrCheckedAt: row.check.qrCheckedAt,
        qrTokenId: row.check.qrTokenId,
        targetLat: row.check.target?.lat ?? null,
        targetLng: row.check.target?.lng ?? null,
        targetSource: row.check.target?.source ?? null,
        overrideReason: row.check.result === "OVERRIDE" ? row.arrival.bypassReason?.trim().slice(0, 300) ?? null : null,
        statusBefore: row.statusBefore,
        statusAfter: row.statusAfter,
      },
    });
  } catch {
    /* logging must never break the job flow */
  }
}

export function startSummary(check: StartCheck, mode: StartMode, reason?: string | null): string {
  if (check.result === "OVERRIDE") return ` (Admin override — ${START_MODE_INFO[mode].label} not used: ${reason})`;
  const bits: string[] = [];
  if (check.gpsResult === "PASSED") bits.push(`GPS ${check.distanceM} m from the job`);
  if (check.qrResult === "VALID") bits.push("QR scanned");
  return mode === "DIRECT" ? " (direct start — no GPS or QR)" : ` (verified: ${bits.join(" + ")})`;
}
