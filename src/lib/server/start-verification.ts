import { prisma } from "./prisma";
import { resolveQrToken, rateLimit } from "./qr-service";
import { START_MODE_INFO, type StartMode, type StartVerificationSettings } from "@/lib/start-verification";

/**
 * Server-side check for the job-start ("I'm here") step. The mode comes from
 * the database (company default or the job's own setting) — never from the
 * request. GPS is compared with the SAVED job/property location; a QR proves
 * presence only if the server resolves it to THIS job's customer link.
 */

export interface ArrivalInput {
  lat?: number;
  lng?: number;
  accuracy?: number;
  qrToken?: string;
  bypassReason?: string;
}

export type QrResult = "VALID" | "INVALID" | "OTHER_JOB" | "MISSING" | "NOT_REQUIRED";

export interface StartCheck {
  ok: boolean;
  /** Machine-readable reason, for the app to show the right retry. */
  code?: "GPS_MISSING" | "GPS_INACCURATE" | "GPS_TOO_FAR" | "NO_SAVED_LOCATION" | "QR_MISSING" | "QR_INVALID" | "QR_OTHER_JOB" | "QR_RATE_LIMITED" | "OVERRIDE_NOT_ALLOWED" | "OVERRIDE_REASON";
  error?: string;
  status?: number;
  result: "PASSED" | "FAILED" | "OVERRIDE";
  verification?: StartMode | "ADMIN_OVERRIDE";
  distanceM: number | null;
  qrResult: QrResult;
}

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function checkJobStart(input: {
  job: { id: string; locationLat: number | null; locationLng: number | null; property?: { lat: number | null; lng: number | null } | null };
  mode: StartMode;
  settings: StartVerificationSettings;
  arrival: ArrivalInput;
  /** Field Manager on their own job (true) or Admin acting from the office (false). */
  fieldUser: boolean;
  userId: string;
}): Promise<StartCheck> {
  const { job, mode, settings, arrival, fieldUser } = input;
  const base = { distanceM: null as number | null, qrResult: "NOT_REQUIRED" as QrResult };

  // Admin starting the job from the office is always an override, whatever the mode — with a reason.
  if (!fieldUser) {
    const reason = arrival.bypassReason?.trim() ?? "";
    if (reason.length < 5) return { ...base, ok: false, result: "FAILED", status: 400, code: "OVERRIDE_REASON", error: "Give a reason for starting this job on the Field Manager's behalf (at least 5 characters)." };
    return { ...base, ok: true, result: "OVERRIDE", verification: "ADMIN_OVERRIDE" };
  }
  // A Field Manager can never skip the check by giving a reason.
  if (arrival.bypassReason) return { ...base, ok: false, result: "FAILED", status: 403, code: "OVERRIDE_NOT_ALLOWED", error: "Only Admin can override job start verification. Call the office if you can't verify." };

  if (mode === "DIRECT") return { ...base, ok: true, result: "PASSED", verification: "DIRECT" };

  const problems: { code: StartCheck["code"]; error: string }[] = [];
  let distanceM: number | null = null;
  let qrResult: QrResult = "NOT_REQUIRED";

  if (mode === "GPS" || mode === "QR_GPS") {
    const targetLat = job.locationLat ?? job.property?.lat ?? null;
    const targetLng = job.locationLng ?? job.property?.lng ?? null;
    const hasCoords = typeof arrival.lat === "number" && typeof arrival.lng === "number";
    if (targetLat === null || targetLng === null) {
      problems.push({ code: "NO_SAVED_LOCATION", error: "This job has no saved location to check against. Ask the office to set the job's map location." });
    } else if (!hasCoords) {
      problems.push({ code: "GPS_MISSING", error: "We couldn't get your location. Turn on location (GPS) for this browser, step outside if you can, and try again." });
    } else {
      distanceM = Math.round(distanceMeters(arrival.lat!, arrival.lng!, targetLat, targetLng));
      if (typeof arrival.accuracy !== "number" || arrival.accuracy > settings.maxAccuracyMeters) {
        problems.push({ code: "GPS_INACCURATE", error: `Your GPS signal isn't accurate enough${typeof arrival.accuracy === "number" ? ` (±${Math.round(arrival.accuracy)} m; needs ±${settings.maxAccuracyMeters} m or better)` : ""}. Wait a few seconds in the open and try again.` });
      } else if (distanceM > settings.maxDistanceMeters) {
        problems.push({ code: "GPS_TOO_FAR", error: `You appear to be ${distanceM} m from the job location (allowed: ${settings.maxDistanceMeters} m). Move closer and try again.` });
      }
    }
  }

  if (mode === "QR" || mode === "QR_GPS") {
    if (!arrival.qrToken) {
      qrResult = "MISSING";
      problems.push({ code: "QR_MISSING", error: "Scan the customer's QR code for this job." });
    } else if (!rateLimit(`start-qr:${input.userId}`, 20, 10 * 60 * 1000).ok) {
      qrResult = "INVALID";
      problems.push({ code: "QR_RATE_LIMITED", error: "Too many QR attempts. Wait a few minutes and try again." });
    } else {
      const resolved = await resolveQrToken(arrival.qrToken);
      if (!resolved.ok) {
        qrResult = "INVALID";
        problems.push({ code: "QR_INVALID", error: "That QR code isn't valid (it may be old or cancelled). Ask the customer for the QR of this booking." });
      } else if (resolved.data.tokenRow.purpose !== "CUSTOMER_JOB" || resolved.data.job.id !== job.id) {
        qrResult = "OTHER_JOB";
        problems.push({ code: "QR_OTHER_JOB", error: "That QR code belongs to a different job. Scan the QR for this booking." });
      } else {
        qrResult = "VALID";
      }
    }
  }

  if (problems.length) {
    return { ok: false, result: "FAILED", status: 409, code: problems[0].code, error: problems.map((p) => p.error).join(" "), distanceM, qrResult };
  }
  return { ok: true, result: "PASSED", verification: mode, distanceM, qrResult };
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
  if (check.distanceM !== null) bits.push(`GPS ${check.distanceM} m from the job`);
  if (check.qrResult === "VALID") bits.push("QR scanned");
  return mode === "DIRECT" ? " (direct start — no location check)" : ` (verified: ${bits.join(" + ")})`;
}
