import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { resolveQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { recordActivity } from "@/lib/server/activity";
import { logger } from "@/lib/server/logger";
import { uploadJobPhoto, validateImagePayload } from "@/lib/server/cloudinary";
import { checkWorkCompletionGate, onWorkCompleted, getCustomerVerifyLink, startRework, completeRework } from "@/lib/server/workflow-service";
import { notifyCustomerArrived } from "@/lib/server/notify";
import { mintQrToken } from "@/lib/server/qr-service";

/**
 * /manager/job/{token} API — §10–§16, §19, §27, §30.
 *
 * Purpose scope: MANAGER_JOB only. The assigned manager/staff workflow:
 *   [NAVIGATE] → [ARRIVED + GPS] → [REQUEST CONFIRMATION] → checklist →
 *   camera photos → [COMPLETE WORK] (gated) → rework loop.
 * GPS distance is computed server-side from the property coordinates stored
 * on the job's property; the geofence radius is env-configurable; a bypass
 * ALWAYS requires an explicit reason and is loudly audited (§11).
 */

function fail(error: string, status: number, kind?: string) {
  return NextResponse.json({ success: false, error, ...(kind ? { kind } : {}) }, { status });
}

const EARTH_RADIUS_M = 6371000;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function geofenceRadiusMeters(): number {
  const raw = process.env.GEOFENCE_RADIUS_METERS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed)) return 200; // configurable geofence, default 200 m
  return Math.min(5000, Math.max(50, parsed));
}

/** GET — the manager's single-job payload. */
export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`mjob:${clientIp(request)}`, 90, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const resolved = await resolveQrToken(params.token, "MANAGER_JOB");
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { job } = resolved.data;

    const [checklist, photos, reworkTasks, jobRow, gate] = await Promise.all([
      prisma.jobChecklistItem.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } }),
      prisma.jobPhoto.findMany({ where: { jobId: job.id }, orderBy: { uploadedAt: "asc" } }),
      prisma.reworkTask.findMany({ where: { jobId: job.id, status: { not: "completed" } }, orderBy: { createdAt: "asc" } }),
      prisma.job.findUnique({
        where: { id: job.id },
        select: {
          arrivedAt: true,
          startedAt: true,
          completedAt: true,
          arrivalVerification: true,
          arrivalDistanceM: true,
          arrivalBypassReason: true,
          customerConfirmedAt: true,
          notes: true,
          assignedStaffIds: true,
        },
      }),
      checkWorkCompletionGate(job.id),
    ]);

    const team = jobRow?.assignedStaffIds.length
      ? (await prisma.user.findMany({ where: { id: { in: jobRow.assignedStaffIds } }, select: { name: true } })).map((u) => u.name)
      : [];

    return NextResponse.json({
      success: true,
      data: {
        job: {
          id: job.id,
          status: job.status,
          serviceName: (await prisma.service.findUnique({ where: { id: job.serviceId }, select: { name: true } }))?.name ?? "Service",
          scheduledDate: job.scheduledDate,
          scheduledTimeSlot: job.scheduledTimeSlot,
          customerName: job.customerName,
          customerPhone: job.customerPhone, // manager scope: contact is operational
          arrivedAt: jobRow?.arrivedAt?.toISOString() ?? null,
          startedAt: jobRow?.startedAt?.toISOString() ?? null,
          completedAt: jobRow?.completedAt?.toISOString() ?? null,
          arrivalVerification: jobRow?.arrivalVerification ?? null,
          arrivalDistanceM: jobRow?.arrivalDistanceM ?? null,
          customerConfirmedAt: jobRow?.customerConfirmedAt?.toISOString() ?? null,
          hasPendingRework: reworkTasks.length > 0,
        },
        property: { title: job.propertyName, address: job.propertyAddress },
        team,
        internalNotes: jobRow?.notes ?? null,
        checklist: checklist.map((c) => ({
          id: c.id,
          area: c.area,
          task: c.task,
          critical: c.critical,
          status: c.status,
          skippedReason: c.skippedReason,
        })),
        photos: photos.map((p) => ({
          id: p.id,
          area: p.area,
          photoType: p.photoType,
          url: `/api/secure-photo/${p.id}?t=${encodeURIComponent(params.token)}`,
          thumbnailUrl: p.thumbnailUrl,
          caption: p.caption,
          uploadedAt: p.uploadedAt.toISOString(),
        })),
        rework: reworkTasks.map((r) => ({
          id: r.id,
          instructions: r.instructions,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
        completionGate: gate,
      },
    });
  } catch (err) {
    logger.error("manager.job.get.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Failed to load the job.", 500);
  }
}

const ArriveSchema = z.object({
  action: z.literal("arrive"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000).optional(),
  bypassReason: z.string().max(500).optional(),
});

const PhotoSchema = z.object({
  action: z.literal("photo"),
  area: z.string().min(1).max(80),
  photoType: z.enum(["before", "after"]),
  image: z.string().min(64),
  caption: z.string().max(300).optional(),
});

const ChecklistSchema = z.object({
  action: z.literal("checklist"),
  itemId: z.string().min(1).max(64),
  status: z.enum(["pending", "completed", "skipped", "issue"]),
  skippedReason: z.string().max(300).optional(),
  issueNotes: z.string().max(500).optional(),
});

const CompleteSchema = z.object({ action: z.literal("complete"), notes: z.string().max(2000).optional() });
const StartSchema = z.object({ action: z.literal("start") });
const RequestConfirmSchema = z.object({ action: z.literal("request-confirmation") });
const StartReworkSchema = z.object({ action: z.literal("start-rework") });
const CompleteReworkSchema = z.object({
  action: z.literal("complete-rework"),
  notes: z.string().max(1000).default(""),
});

export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`mjob-post:${clientIp(request)}`, 40, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";

    const resolved = await resolveQrToken(params.token, "MANAGER_JOB");
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { tokenRow, job } = resolved.data;
    const jobRow = await prisma.job.findUnique({
      where: { id: job.id },
      select: { status: true, assignedStaffIds: true, arrivedAt: true, propertyId: true },
    });
    if (!jobRow) return fail("Job not found.", 404);

    const actor = { id: `qr:${tokenRow.id}`, name: "Field Manager", role: "manager-link" };

    /* ---------------- §11 ARRIVED + GPS ---------------- */
    if (action === "arrive") {
      const parsed = ArriveSchema.safeParse(body);
      if (!parsed.success) return fail("GPS coordinates are required to mark arrival.", 400);
      if (!["ASSIGNED"].includes(jobRow.status)) {
        // §30 idempotency
        if (["ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS"].includes(jobRow.status)) {
          return NextResponse.json({ success: true, data: { alreadyArrived: true, status: jobRow.status } });
        }
        return fail(`Arrival applies from ASSIGNED (current: ${jobRow.status}).`, 409);
      }

      const property = await prisma.property.findUnique({ where: { id: jobRow.propertyId } });
      if (!property) return fail("Property record missing — cannot verify location.", 409);

      const propertyHasCoords =
        typeof property.lat === "number" &&
        typeof property.lng === "number" &&
        !(property.lat === 0 && property.lng === 0);

      const distance =
        propertyHasCoords && property.lat !== null && property.lng !== null
          ? haversineMeters(parsed.data.lat, parsed.data.lng, property.lat, property.lng)
          : null;
      const radius = geofenceRadiusMeters();
      const within = distance !== null && distance <= radius;
      const bypassing = !within || distance === null;
      const bypassReason = bypassing ? (parsed.data.bypassReason || "").trim() : "";

      if (bypassing && !bypassReason) {
        return fail(
          distance === null
            ? "Property coordinates are not configured — an explicit reason is required to confirm arrival."
            : `You appear to be ${Math.round(distance)} m away from the service location (allowed: ${radius} m). An explicit reason is required to continue.`,
          422,
          "outside_geofence"
        );
      }

      const now = new Date();
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "ARRIVED",
          arrivedAt: now,
          arrivalLat: parsed.data.lat,
          arrivalLng: parsed.data.lng,
          arrivalAccuracy: parsed.data.accuracy ?? null,
          arrivalVerification: within ? "gps" : "manual",
          arrivalDistanceM: distance,
          arrivalBypassReason: bypassing ? bypassReason : null,
          updatedAt: now,
        },
      });

      await recordActivity({
        jobId: job.id,
        type: "STATUS_CHANGED",
        message: within
          ? `Manager arrived — GPS VERIFIED ✓ (${Math.round(distance ?? 0)} m from property, fence ${radius} m)`
          : `Manager arrived — GPS BYPASS recorded (${distance === null ? "no property coordinates" : `${Math.round(distance)} m away`}): ${bypassReason}`,
        actor,
      });

      // Mint the customer verification token and notify "team has arrived".
      const minted = await mintQrToken(job.id, "CUSTOMER_VERIFICATION", { name: "manager-link" });
      if (minted.success) {
        void notifyCustomerArrived(job.id, minted.data.linkUrl).catch(() => {});
      }
      return NextResponse.json({
        success: true,
        data: {
          status: "ARRIVED",
          verified: within,
          distanceM: distance === null ? null : Math.round(distance),
          radiusM: radius,
        },
      });
    }

    /* ---------------- §12 REQUEST CUSTOMER CONFIRMATION ---------------- */
    if (action === "request-confirmation") {
      if (jobRow.status !== "ARRIVED") return fail("Confirmation can be requested only after arrival.", 409);
      const minted = await mintQrToken(job.id, "CUSTOMER_VERIFICATION", { name: "manager-link" });
      if (!minted.success) return fail(minted.failure.message, 429);
      void notifyCustomerArrived(job.id, minted.data.linkUrl).catch(() => {});
      await recordActivity({
        jobId: job.id,
        type: "OTP_SENT",
        message: "Customer confirmation requested — secure link sent",
        actor,
      });
      return NextResponse.json({ success: true, data: { sent: true, linkUrl: minted.data.linkUrl } });
    }

    /* ---------------- §15 CAMERA PHOTO UPLOAD ---------------- */
    if (action === "photo") {
      const parsed = PhotoSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid photo payload.", 400);
      const valid = validateImagePayload(parsed.data.image);
      if (!valid.ok) return fail(valid.error, 400);
      if (!["ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS", "REWORK_IN_PROGRESS"].includes(jobRow.status)) {
        return fail(`Photos cannot be uploaded at stage ${jobRow.status}.`, 409);
      }
      const upload = await uploadJobPhoto(parsed.data.image, job.id, parsed.data.photoType);
      if (!upload.ok) {
        return fail(upload.error, upload.error.includes("not configured") ? 503 : 502);
      }
      const photo = await prisma.jobPhoto.create({
        data: {
          jobId: job.id,
          area: parsed.data.area.trim(),
          photoType: parsed.data.photoType,
          cloudinaryPublicId: upload.data.publicId,
          photoUrl: upload.data.url,
          thumbnailUrl: upload.data.thumbnailUrl,
          bytes: upload.data.bytes,
          width: upload.data.width,
          height: upload.data.height,
          format: upload.data.format,
          caption: parsed.data.caption?.trim() || null,
          uploadedByUserId: actor.id,
          uploadedByName: "Field Manager (secure link)",
        },
      });
      await recordActivity({
        jobId: job.id,
        type: "PHOTO_UPLOADED",
        message: `${parsed.data.photoType === "before" ? "Before" : "After"} photo uploaded for ${parsed.data.area.trim()} (manager link)`,
        actor,
      });
      return NextResponse.json(
        { success: true, data: { id: photo.id, url: `/api/secure-photo/${photo.id}?t=${encodeURIComponent(params.token)}` } },
        { status: 201 }
      );
    }

    /* ---------------- §14 CHECKLIST TICK ---------------- */
    if (action === "checklist") {
      const parsed = ChecklistSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid checklist payload.", 400);
      const item = await prisma.jobChecklistItem.findUnique({ where: { id: parsed.data.itemId } });
      if (!item || item.jobId !== job.id) return fail("Checklist item not found on this job.", 404);
      await prisma.jobChecklistItem.update({
        where: { id: item.id },
        data: {
          status: parsed.data.status,
          skippedReason: parsed.data.skippedReason ?? null,
          issueNotes: parsed.data.issueNotes ?? null,
          completedBy: parsed.data.status === "completed" ? "Field Manager (secure link)" : null,
          completedAt: parsed.data.status === "completed" ? new Date() : null,
        },
      });
      if (parsed.data.status === "completed") {
        await recordActivity({
          jobId: job.id,
          type: "CHECKLIST_UPDATED",
          message: `Checklist item completed [${item.area}]: ${item.task}`,
          actor,
        });
      }
      return NextResponse.json({ success: true, data: { id: item.id, status: parsed.data.status } });
    }

    /* ---------------- §7/§12 START (after customer confirmation) ------- */
    if (action === "start") {
      const parsed = StartSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);
      if (jobRow.status === "IN_PROGRESS") {
        return NextResponse.json({ success: true, data: { alreadyStarted: true, status: "IN_PROGRESS" } });
      }
      if (jobRow.status !== "CUSTOMER_VERIFIED") {
        return fail(`Work starts after customer confirmation (current: ${jobRow.status}).`, 409);
      }
      const now = new Date();
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "IN_PROGRESS", startedAt: now, updatedAt: now },
      });
      await recordActivity({
        jobId: job.id,
        type: "STATUS_CHANGED",
        message: "Work started via manager link",
        actor,
      });
      return NextResponse.json({ success: true, data: { status: "IN_PROGRESS" } });
    }

    /* ---------------- §16 COMPLETE WORK (gated) ---------------- */
    if (action === "complete") {
      if (jobRow.status !== "IN_PROGRESS") {
        if (jobRow.status === "WORK_COMPLETED") {
          return NextResponse.json({ success: true, data: { alreadyCompleted: true, status: "WORK_COMPLETED" } });
        }
        return fail(`Work completion applies from IN_PROGRESS (current: ${jobRow.status}).`, 409);
      }
      const gate = await checkWorkCompletionGate(job.id);
      if (!gate.ok) {
        return fail(`Cannot complete work yet: ${gate.missing.join("; ")}.`, 422, "gate_failed");
      }
      const now = new Date();
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "WORK_COMPLETED", completedAt: now, updatedAt: now },
      });
      await recordActivity({
        jobId: job.id,
        type: "STATUS_CHANGED",
        message: "Work completed via manager link — submitted for QC audit",
        actor,
      });
      void onWorkCompleted(job.id, { name: "manager-link" }).catch(() => {});
      return NextResponse.json({ success: true, data: { status: "WORK_COMPLETED" } });
    }

    /* ---------------- §19 REWORK START / COMPLETE ---------------- */
    if (action === "start-rework") {
      const res = await startRework(job.id, { name: "Field Manager (secure link)" });
      if (!res.ok) return fail(res.message, 409);
      return NextResponse.json({ success: true, data: { already: res.already, status: "REWORK_IN_PROGRESS" } });
    }
    if (action === "complete-rework") {
      const parsed = CompleteReworkSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid rework payload.", 400);
      const res = await completeRework(job.id, parsed.data.notes, {
        id: actor.id,
        name: actor.name,
        role: actor.role,
      });
      if (!res.ok) return fail(res.message, 409);
      return NextResponse.json({ success: true, data: { status: "REWORK_COMPLETED" } });
    }

    /* ---------------- share customer link ---------------- */
    if (action === "share-customer-link") {
      const link = await getCustomerVerifyLink(job.id, { name: "manager-link" });
      return NextResponse.json({ success: true, data: { linkUrl: link?.linkUrl ?? null } });
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    logger.error("manager.job.post.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Action failed due to a server error.", 500);
  }
}
