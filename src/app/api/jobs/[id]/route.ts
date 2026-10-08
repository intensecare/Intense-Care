import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireUser, authorizeJob, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { validateTransition, JOB_STATUS_CONFIG } from "@/lib/state-machine";
import type { Job } from "@/lib/types";
import { serializeJob, withStaffNames, fail } from "@/lib/server/serialize";
import { projectJob } from "@/lib/server/projections";
import { recordActivity } from "@/lib/server/activity";
import { recordAudit } from "@/lib/server/audit";
import { syncJobEvent, cancelJobEvent } from "@/lib/server/google-calendar";
import {
  ArrivalSchema,
  LocationSchema,
  QrVerificationError,
  VERIFICATION_LABEL,
  gpsFailureMessage,
  hasCoords,
  verifyArrival,
} from "@/lib/server/location";
import { normalizeVisibility, DEFAULT_CUSTOMER_VISIBILITY, hiddenCount } from "@/lib/visibility";
import { getSystemSettings } from "@/lib/server/settings";
import { ASSIGNABLE_ROLES, can, scopeOf, type JobStatus } from "@/lib/rbac";
import type { SessionUser } from "@/lib/server/session";

const JOB_INCLUDE = {
  customer: { select: { name: true, phone: true } },
  property: { select: { title: true, address: true } },
  service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
  serviceLines: { orderBy: { position: "asc" as const } },
} as const;

async function respondWithJob(user: SessionUser, id: string, status = 200) {
  const full = await prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE });
  if (!full) return fail("Job not found.", 404);
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return NextResponse.json({ success: true, data: projectJob(user, withStaffNames(serializeJob(full), names)) }, { status });
}

/** GET /api/jobs/[id] — one job, inside the caller's `jobs.view` scope. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await authorizeJob(params.id, "jobs.view");
    return respondWithJob(user, params.id);
  } catch (err) {
    return errorResponse(err, "jobs.get_one.route_error");
  }
}

const PatchSchema = z.object({
  status: z.string().min(1).max(32).optional(),
  assignedStaffIds: z.array(z.string().min(1).max(64)).max(20).optional(),
  assignedManagerId: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).optional(),
  /** A note written FOR the customer, subject to visibility (desk only). */
  customerNotes: z.string().max(2000).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledTimeSlot: z.string().max(80).optional(),
  arrival: ArrivalSchema.optional(),
  /** §1 Re-point the official service location (Admin). */
  location: LocationSchema.optional(),
  /** §6 Change what the customer may see for this job (Admin). */
  customerVisibility: z.record(z.string(), z.boolean()).optional(),
  /** Super Admin override of the state machine — must carry a reason (audited). */
  override: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * PATCH /api/jobs/[id] — the ONLY write path for a job's lifecycle:
 *   assignment  (jobs.assign)      crew + field manager
 *   reschedule  (jobs.reschedule)  date / time window
 *   location    (jobs.update)      the official service location + pin
 *   visibility  (jobs.update)      what the customer may see
 *   work notes  (jobs.update)      ASSIGNED scope may change notes only
 *   status      (transition permission from TRANSITION_PERMISSION)
 * Every branch resolves permission + scope through the central matrix; the
 * state machine is validated server-side for every role.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("Invalid job update payload.", 400);
    const body = parsed.data;

    /* -------------------------------------------------------- assignment */
    if (Array.isArray(body.assignedStaffIds) || body.assignedManagerId !== undefined) {
      const { user, job: existing } = await authorizeJob(id, "jobs.assign");
      const ids = Array.from(new Set(body.assignedStaffIds ?? existing.assignedStaffIds));
      let managerId: string | null =
        body.assignedManagerId === undefined ? existing.assignedManagerId : body.assignedManagerId;

      const crew = Array.from(new Set([...ids, ...(managerId ? [managerId] : [])]));
      if (crew.length > 0) {
        const rows = await prisma.user.findMany({
          where: { id: { in: crew }, role: { in: ASSIGNABLE_ROLES }, active: true },
          select: { id: true, role: true },
        });
        const valid = new Map(rows.map((r) => [r.id, r.role]));
        if (crew.some((x) => !valid.has(x))) {
          return fail("One or more selected workers are not active field accounts.", 400);
        }
        if (managerId && valid.get(managerId) !== "field_manager") {
          return fail("The team leader must be a Field Manager account.", 400);
        }
        if (!managerId) {
          managerId = ids.find((x) => valid.get(x) === "field_manager") ?? null;
        }
        if (existing.scheduledDate) {
          const slotRow = await prisma.job.findUnique({ where: { id }, select: { scheduledTimeSlot: true } });
          const terminal = ["COMPLETED", "CANCELLED", "CLOSED"];
          const clash = await prisma.job.findFirst({
            where: {
              id: { not: id },
              scheduledDate: existing.scheduledDate,
              scheduledTimeSlot: slotRow?.scheduledTimeSlot ?? "",
              status: { notIn: terminal },
              OR: [{ assignedStaffIds: { hasSome: crew } }, { assignedManagerId: { in: crew } }],
            },
            select: { id: true },
          });
          if (clash) {
            return fail("Worker already booked on another job in this date & time slot (double-booking is not allowed).", 409);
          }
        }
      }

      const nextStatus =
        crew.length > 0 && (existing.status === "SCHEDULED" || existing.status === "DRAFT")
          ? "ASSIGNED"
          : crew.length === 0 && existing.status === "ASSIGNED"
          ? "SCHEDULED"
          : existing.status;

      await prisma.job.update({
        where: { id },
        data: { assignedStaffIds: ids, assignedManagerId: managerId, status: nextStatus, updatedAt: new Date() },
      });
      logger.info("jobs.assignment_updated", { jobId: id, count: crew.length, by: user.id });
      await recordActivity({
        jobId: id,
        type: "STAFF_ASSIGNED",
        message:
          crew.length > 0
            ? `Crew updated — ${crew.length} field worker${crew.length === 1 ? "" : "s"} assigned${
                nextStatus === "ASSIGNED" && existing.status !== "ASSIGNED" ? " (job is now Staff Assigned)" : ""
              }`
            : "All field workers unassigned (job returned to Scheduled)",
        actor: { id: user.id, name: user.name, role: user.role },
      });
      void recordAudit({
        actor: user,
        action: "JOB_ASSIGNED",
        entityType: "job",
        entityId: id,
        jobId: id,
        previousState: existing.status,
        newState: nextStatus,
        details: `crew=${crew.join(",") || "none"} manager=${managerId ?? "none"}`,
        request,
      });
      if (crew.length > 0 && existing.status !== nextStatus) {
        try {
          const { notifyJobAssigned } = await import("@/lib/server/notify");
          void notifyJobAssigned(id).catch(() => {});
        } catch {
          /* notification never fails the assignment */
        }
      }
      void syncJobEvent(id).catch(() => {});
      return respondWithJob(user, id);
    }

    /* -------------------------------------------------------- reschedule */
    if (body.scheduledDate || body.scheduledTimeSlot) {
      const { user, job: existing } = await authorizeJob(id, "jobs.reschedule");
      if (["IN_PROGRESS", "WORK_COMPLETED", "COMPLETED", "CLOSED", "CANCELLED"].includes(existing.status)) {
        return fail(`A job in ${existing.status} cannot be rescheduled.`, 409);
      }
      const current = await prisma.job.findUnique({ where: { id }, select: { scheduledDate: true, scheduledTimeSlot: true } });
      const scheduledDate = body.scheduledDate ?? current?.scheduledDate ?? "";
      const scheduledTimeSlot = body.scheduledTimeSlot ?? current?.scheduledTimeSlot ?? "";
      const crew = [...existing.assignedStaffIds, ...(existing.assignedManagerId ? [existing.assignedManagerId] : [])];
      if (crew.length > 0) {
        const clash = await prisma.job.findFirst({
          where: {
            id: { not: id },
            scheduledDate,
            scheduledTimeSlot,
            status: { notIn: ["COMPLETED", "CANCELLED", "CLOSED"] },
            OR: [{ assignedStaffIds: { hasSome: crew } }, { assignedManagerId: { in: crew } }],
          },
          select: { id: true },
        });
        if (clash) return fail("The assigned crew is already booked in that slot. Re-assign or choose another window.", 409);
      }
      await prisma.job.update({ where: { id }, data: { scheduledDate, scheduledTimeSlot, updatedAt: new Date() } });
      await recordActivity({
        jobId: id,
        type: "STATUS_CHANGED",
        message: `Rescheduled to ${scheduledDate} ${scheduledTimeSlot}${body.reason ? ` — ${body.reason}` : ""}`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      void recordAudit({
        actor: user,
        action: "JOB_RESCHEDULED",
        entityType: "job",
        entityId: id,
        jobId: id,
        previousState: `${current?.scheduledDate} ${current?.scheduledTimeSlot}`,
        newState: `${scheduledDate} ${scheduledTimeSlot}`,
        reason: body.reason,
        request,
      });
      void syncJobEvent(id).catch(() => {});
      return respondWithJob(user, id);
    }

    /* ---------------------------------------------- §1 service location */
    if (body.location !== undefined) {
      // Re-pointing the service location is a desk decision: it moves the
      // geofence the crew is measured against. ASSIGNED scope cannot do it.
      const { user } = await authorizeJob(id, "jobs.update");
      if (scopeOf(user.role, "jobs.update") !== "ALL") {
        return fail("Only the desk can change the service location of a job.", 403);
      }
      const loc = body.location;
      const current = await prisma.job.findUnique({
        where: { id },
        select: { serviceAddress: true, serviceLat: true, serviceLng: true, propertyId: true },
      });
      if (!current) return fail("Job not found.", 404);

      await prisma.job.update({
        where: { id },
        data: {
          serviceAddress: loc.address?.trim() || current.serviceAddress,
          serviceLat: loc.lat ?? current.serviceLat,
          serviceLng: loc.lng ?? current.serviceLng,
          serviceLocationAccuracy: loc.accuracy ?? null,
          locationNotes: loc.notes?.trim() ?? null,
          updatedAt: new Date(),
        },
      });
      // Keep the property pin in step when it had none.
      if (hasCoords(loc)) {
        await prisma.property.updateMany({
          where: { id: current.propertyId, OR: [{ lat: null }, { lng: null }] },
          data: { lat: loc.lat, lng: loc.lng },
        });
      }
      await recordActivity({
        jobId: id,
        type: "STATUS_CHANGED",
        message: hasCoords(loc)
          ? `Service location updated — ${loc.address?.trim() || "map pin"} (${loc.lat!.toFixed(5)}, ${loc.lng!.toFixed(5)})`
          : `Service address updated — ${loc.address?.trim() || "address"}`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      void recordAudit({
        actor: user,
        action: "JOB_LOCATION_UPDATED",
        entityType: "job",
        entityId: id,
        jobId: id,
        previousState: `${current.serviceLat ?? "-"},${current.serviceLng ?? "-"}`,
        newState: `${loc.lat ?? current.serviceLat ?? "-"},${loc.lng ?? current.serviceLng ?? "-"}`,
        details: loc.address?.trim() || undefined,
        reason: body.reason,
        request,
      });
      return respondWithJob(user, id);
    }

    /* ------------------------------------------ §6 customer visibility */
    if (body.customerVisibility !== undefined) {
      const { user } = await authorizeJob(id, "jobs.update");
      if (scopeOf(user.role, "jobs.update") !== "ALL") {
        return fail("Only the desk can change what the customer sees.", 403);
      }
      const settings = await getSystemSettings();
      const next = normalizeVisibility(
        body.customerVisibility,
        normalizeVisibility(settings.defaultCustomerVisibility, DEFAULT_CUSTOMER_VISIBILITY)
      );
      await prisma.job.update({
        where: { id },
        data: { customerVisibility: next, updatedAt: new Date() },
      });
      const hidden = hiddenCount(next);
      await recordActivity({
        jobId: id,
        type: "STATUS_CHANGED",
        message:
          hidden === 0
            ? "Customer visibility updated — the customer can see everything shareable"
            : `Customer visibility updated — ${hidden} field${hidden === 1 ? "" : "s"} hidden from the customer`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      void recordAudit({
        actor: user,
        action: "JOB_VISIBILITY_UPDATED",
        entityType: "job",
        entityId: id,
        jobId: id,
        details: Object.entries(next)
          .filter(([, v]) => !v)
          .map(([k]) => `-${k}`)
          .join(",") || "all visible",
        request,
      });
      return respondWithJob(user, id);
    }

    /* -------------------------------------------------------- work notes */
    if ((body.notes !== undefined || body.customerNotes !== undefined) && !body.status) {
      const { user } = await authorizeJob(id, "jobs.update");
      // The note the CUSTOMER sees is a desk decision; field roles write the
      // internal work note only, so an internal note cannot leak by accident.
      if (body.customerNotes !== undefined && scopeOf(user.role, "jobs.update") !== "ALL") {
        return fail("Only the desk can write the note the customer sees.", 403);
      }
      await prisma.job.update({
        where: { id },
        data: {
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.customerNotes !== undefined ? { customerNotes: body.customerNotes.trim() || null } : {}),
          updatedAt: new Date(),
        },
      });
      void recordAudit({
        actor: user,
        action: body.customerNotes !== undefined ? "JOB_CUSTOMER_NOTE_UPDATED" : "JOB_NOTES_UPDATED",
        entityType: "job",
        entityId: id,
        jobId: id,
        request,
      });
      return respondWithJob(user, id);
    }

    /* ------------------------------------------------------------ status */
    const status = body.status;
    if (!status) return fail("status is required.", 400);
    const { user } = await requireUser();

    const existing = await prisma.job.findUnique({
      where: { id },
      include: { property: { select: { lat: true, lng: true } } },
    });
    if (!existing) return fail("Job not found.", 404);

    // CUSTOMER_VERIFIED is reachable ONLY through the customer's secure link.
    if (status === "CUSTOMER_VERIFIED") {
      return fail("Customer confirmation happens on the customer's secure link, not through this API.", 409);
    }

    // 1. State machine + role permission (the same table the UI uses).
    const verdict = validateTransition(existing as unknown as Job, status as JobStatus, user.role);
    const isOverride = body.override === true && can(user, "settings.manage");
    if (!verdict.allowed && !isOverride) {
      const code = verdict.permission ? 403 : 409;
      return fail(verdict.reason ?? `Transition to ${status} is not permitted for this job.`, code);
    }
    if (isOverride && !body.reason) return fail("An override requires a reason.", 400);
    if (isOverride && !(status in JOB_STATUS_CONFIG)) return fail("Unknown status.", 400);

    // 2. Scope: the record must be inside the caller's scope for that permission.
    const permission = verdict.permission ?? "jobs.update";
    if (!isOverride) await authorizeJob(id, permission);

    // 3. §2 Arrival verification: GPS first, then the on-site QR scan, then an
    //    audited manual override. The crew is never blocked from working —
    //    but the method used is always recorded (§12).
    const data: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "ARRIVED") {
      const arrival = body.arrival ?? {};
      let arrivalVerdict;
      try {
        arrivalVerdict = await verifyArrival(existing, arrival);
      } catch (e) {
        if (e instanceof QrVerificationError) return fail(e.message, e.status);
        throw e;
      }
      // A field role with no verification at all must say why. The desk can
      // record an arrival on their behalf (audited as a manual override).
      if (
        arrivalVerdict.method === "manual" &&
        !arrival.bypassReason &&
        scopeOf(user.role, "jobs.arrive") === "ASSIGNED"
      ) {
        return NextResponse.json(
          {
            success: false,
            error: gpsFailureMessage(arrivalVerdict),
            // The field app uses this to offer [Scan QR] before [Give reason].
            kind: "verification_required",
            canScanQr: true,
          },
          { status: 409 }
        );
      }
      Object.assign(data, {
        arrivedAt: new Date(),
        arrivalLat: arrival.lat ?? null,
        arrivalLng: arrival.lng ?? null,
        arrivalAccuracy: arrival.accuracy ?? null,
        arrivalVerification: arrivalVerdict.method,
        arrivalDistanceM: arrivalVerdict.distanceM,
        arrivalQrTokenId: arrivalVerdict.qrTokenId,
        arrivalBypassReason: arrival.bypassReason ?? null,
      });
    }
    if (status === "IN_PROGRESS") data.startedAt = new Date();
    if (status === "WORK_COMPLETED") {
      // Mandatory checklist items must be done before QC can be requested.
      const openCritical = await prisma.jobChecklistItem.count({
        where: { jobId: id, critical: true, status: { notIn: ["completed", "skipped"] } },
      });
      if (openCritical > 0 && !isOverride) {
        return fail(`${openCritical} mandatory checklist item${openCritical === 1 ? "" : "s"} still open.`, 409);
      }
      data.completedAt = new Date();
    }

    // Compare-and-set: only applies if nobody moved the job meanwhile (double taps, two devices).
    const moved = await prisma.job.updateMany({ where: { id, status: existing.status }, data });
    if (moved.count === 0) return fail("This job was just updated by someone else. Refresh and try again.", 409);
    const job = { status };

    const STATUS_EVENT_MESSAGES: Record<string, string> = {
      SCHEDULED: "Job scheduled",
      ASSIGNED: "Field staff assigned to the job",
      ARRIVED: "Field team arrived on site — awaiting customer confirmation",
      IN_PROGRESS: "Work started — cleaning in progress",
      WORK_COMPLETED: "Work completed — submitted for QC",
      QUALITY_CHECK: "QC inspection started",
      REWORK_COMPLETED: "Rework completed — awaiting reinspection",
      CUSTOMER_APPROVAL: "QC passed — handover link sent to customer",
      COMPLETED: "Customer approved — job completed",
      FEEDBACK_REQUESTED: "Feedback & Google review link sent to customer",
      CLOSED: "Job closed and archived",
      CANCELLED: "Job cancelled",
    };
    // §12 The activity feed names the verification method explicitly.
    const method = data.arrivalVerification as "gps" | "qr" | "manual" | undefined;
    const verificationNote =
      status === "ARRIVED" && method
        ? ` (${VERIFICATION_LABEL[method]}${
            method === "manual" && data.arrivalBypassReason ? `: ${data.arrivalBypassReason}` : ""
          })`
        : "";
    await recordActivity({
      jobId: id,
      type: "STATUS_CHANGED",
      message: (STATUS_EVENT_MESSAGES[status] || `Job moved to ${JOB_STATUS_CONFIG[status as Job["status"]]?.label || status}`) + verificationNote,
      actor: { id: user.id, name: user.name, role: user.role },
    });
    void recordAudit({
      actor: user,
      action: isOverride ? "JOB_STATUS_OVERRIDE" : "JOB_STATUS_CHANGED",
      entityType: "job",
      entityId: id,
      jobId: id,
      previousState: existing.status,
      newState: status,
      reason: body.reason ?? (status === "ARRIVED" ? (data.arrivalBypassReason as string | null) : null),
      details:
        status === "ARRIVED"
          ? `verification=${method ?? "none"} distance=${data.arrivalDistanceM ?? "n/a"}${
              method === "qr" ? ` qrToken=${data.arrivalQrTokenId}` : ""
            }`
          : undefined,
      request,
    });

    if (status === "CANCELLED") void cancelJobEvent(id).catch(() => {});
    else void syncJobEvent(id).catch(() => {});

    // Workflow side-effects (notifications always deep-link to the role screen).
    try {
      if (status === "WORK_COMPLETED") {
        const { onWorkCompleted } = await import("@/lib/server/workflow-service");
        void onWorkCompleted(id, { id: user.id, name: user.name }).catch(() => {});
      }
      if (status === "ARRIVED" && existing.status !== "ARRIVED") {
        const [{ ensureCustomerLink }, { notifyCustomerArrived }] = await Promise.all([
          import("@/lib/server/qr-service"),
          import("@/lib/server/notify"),
        ]);
        void (async () => {
          const link = await ensureCustomerLink(id, { id: user.id, name: user.name });
          if (link.success) await notifyCustomerArrived(id, link.data.linkUrl);
        })().catch(() => {});
      }
      if (status === "CUSTOMER_APPROVAL" && existing.status === "PASS") {
        const { onQcPassed } = await import("@/lib/server/workflow-service");
        void onQcPassed(id, { id: user.id, name: user.name }).catch(() => {});
      }
      if (status === "COMPLETED" && existing.referralPartnerId) {
        const { settleCommissionForJob } = await import("@/lib/server/commission");
        await settleCommissionForJob(id);
      }
    } catch (e) {
      logger.error("jobs.side_effect_failed", { jobId: id, status, error: e instanceof Error ? e.message : String(e) });
    }

    logger.info("jobs.status_changed", { jobId: id, from: existing.status, to: job.status, by: user.id, override: isOverride });
    return respondWithJob(user, id);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    return errorResponse(err, "jobs.patch.route_error");
  }
}
