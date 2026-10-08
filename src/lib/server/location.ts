/**
 * §1 / §2 / §12 Service location and arrival verification, server-side.
 *
 * ONE location per job — the pin Admin dropped on the map when booking. It is
 * the official service location: the field crew navigates to it, the arrival
 * geofence is measured against it, and (where Admin permits) the customer
 * portal shows it.
 *
 * Arrival can be verified three ways, and the method is always recorded:
 *
 *   gps    — the crew is inside the geofence of the job location.
 *   qr     — GPS was unavailable or inaccurate, so the crew scanned the
 *            customer/property QR on site. Being able to scan THE job QR is
 *            itself proof of presence, so it verifies the arrival.
 *   manual — neither worked; an explicit reason is required and audited.
 *
 * The crew is never BLOCKED from working: QR is the second route and a
 * reasoned manual override is the third. What is never optional is the
 * record of which route was used (§12).
 */

import { z } from "zod";
import { prisma } from "./prisma";
import { hashToken } from "./qr-service";

export const LocationSchema = z.object({
  /** The service address as Admin typed/confirmed it. */
  address: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /** Metres of uncertainty reported by the device, when known. */
  accuracy: z.number().min(0).max(100000).optional(),
  notes: z.string().max(1000).optional(),
});

export type LocationInput = z.infer<typeof LocationSchema>;

/** A coordinate pair is only stored when BOTH halves are present. */
export function hasCoords(loc: Pick<LocationInput, "lat" | "lng">): boolean {
  return typeof loc.lat === "number" && typeof loc.lng === "number";
}

/** How close the crew must be for GPS to verify an arrival, in metres. */
export function geofenceMeters(): number {
  const raw = Number.parseInt(process.env.ARRIVAL_GEOFENCE_METERS || "300", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 300;
}

/** Great-circle distance between two coordinates, in metres. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type VerificationMethod = "gps" | "qr" | "manual";

export const VERIFICATION_LABEL: Record<VerificationMethod, string> = {
  gps: "GPS Verified",
  qr: "QR Verified",
  manual: "Manual Admin Override",
};

/** The arrival payload a field device may send. */
export const ArrivalSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100000).optional(),
  /**
   * §2 The raw token scanned from the customer/property QR. It is the job
   * secure link, so it is never logged and never echoed back.
   */
  qrToken: z.string().min(16).max(400).optional(),
  bypassReason: z.string().min(5).max(300).optional(),
});

export type ArrivalInput = z.infer<typeof ArrivalSchema>;

export interface ArrivalVerdict {
  method: VerificationMethod;
  /** Metres from the job location, when both coordinates were known. */
  distanceM: number | null;
  /** The QR token row that proved presence, when the method is "qr". */
  qrTokenId: string | null;
  /** Why GPS did not verify — surfaced to the field app, not to customers. */
  gpsFailure: "no_device_coords" | "no_job_coords" | "too_far" | null;
}

/**
 * Decides how an arrival was verified. A scanned QR must belong to THIS job
 * and still be live: a token for another job, a revoked token or an expired
 * token proves nothing and is rejected.
 *
 * The lat/lng of the JOB wins over the property when both exist: the job pin
 * is what Admin confirmed for this visit.
 */
export async function verifyArrival(
  job: {
    id: string;
    serviceLat: number | null;
    serviceLng: number | null;
    property?: { lat: number | null; lng: number | null } | null;
  },
  arrival: ArrivalInput
): Promise<ArrivalVerdict> {
  const targetLat = job.serviceLat ?? job.property?.lat ?? null;
  const targetLng = job.serviceLng ?? job.property?.lng ?? null;

  let distanceM: number | null = null;
  let gpsFailure: ArrivalVerdict["gpsFailure"] = null;

  const deviceHasCoords = typeof arrival.lat === "number" && typeof arrival.lng === "number";
  const jobHasCoords = typeof targetLat === "number" && typeof targetLng === "number";

  if (deviceHasCoords && jobHasCoords) {
    distanceM = distanceMeters(arrival.lat!, arrival.lng!, targetLat!, targetLng!);
    // The device accuracy radius counts in the crew favour: a 200 m fix at
    // 150 m accuracy is inside a 300 m geofence.
    if (distanceM <= geofenceMeters() + (arrival.accuracy ?? 0)) {
      return { method: "gps", distanceM, qrTokenId: null, gpsFailure: null };
    }
    gpsFailure = "too_far";
  } else {
    gpsFailure = deviceHasCoords ? "no_job_coords" : "no_device_coords";
  }

  // §2 GPS could not verify — the on-site QR scan is the second route.
  if (arrival.qrToken) {
    const row = await prisma.qrToken.findUnique({
      where: { tokenHash: hashToken(arrival.qrToken) },
      select: { id: true, jobId: true, revokedAt: true, expiresAt: true },
    });
    const live = row && !row.revokedAt && (!row.expiresAt || row.expiresAt.getTime() > Date.now());
    if (live && row!.jobId === job.id) {
      return { method: "qr", distanceM, qrTokenId: row!.id, gpsFailure };
    }
    // A QR that is not this job is a failed verification, not a free pass.
    throw new QrVerificationError(
      row && row.jobId !== job.id
        ? "That QR belongs to a different job. Scan the QR for this service."
        : "That QR is no longer active. Ask the desk to re-send the customer link."
    );
  }

  return { method: "manual", distanceM, qrTokenId: null, gpsFailure };
}

export class QrVerificationError extends Error {
  status = 409;
}

/** The message the field app shows when GPS alone could not verify. */
export function gpsFailureMessage(verdict: ArrivalVerdict): string {
  switch (verdict.gpsFailure) {
    case "too_far":
      return `You appear to be ${Math.round(verdict.distanceM ?? 0)} m from the service location. Move closer, scan the job QR, or give a reason to proceed.`;
    case "no_job_coords":
      return "This job has no location pin yet. Scan the job QR, or give a reason to proceed.";
    default:
      return "We could not get your GPS location. Scan the job QR, or give a reason to proceed.";
  }
}
