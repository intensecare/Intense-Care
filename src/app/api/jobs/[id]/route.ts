import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { cleanVisibility } from "@/lib/server/job-create";
import { resolveQrToken } from "@/lib/server/qr-service";
import { requireUser, authorizeJob, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { validateTransition, JOB_STATUS_CONFIG } from "@/lib/state-machine";
import type { Job } from "@/lib/types";
import { serializeJob, withStaffNames, fail } from "@/lib/server/serialize";
import { projectJob } from "@/lib/server/projections";
import { recordActivity } from "@/lib/server/activity";
import { recordAudit } from "@/lib/server/audit";
import { ACTIVE_ASSIGNMENT, conflictsForMany, crewClash, logAssignment } from "@/lib/server/assignments";
import { notifyStaffAssignment } from "@/lib/server/notify";
import { userNames } from "@/lib/server/biz";
import { syncJobEvent, cancelJobEvent } from "@/lib/server/google-calendar";
import { ASSIGNABLE_ROLES, can, scopeOf, type JobStatus } from "@/lib/rbac";
import type { SessionUser } from "@/lib/server/session";

const JOB_INCLUDE = {
  customer: { select: { name: true, phone: true } },
  property: { select: { title: true, address: true } },
  service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
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

/* -------------------------------------------------------------------------- */
/* GPS-verified arrival (§8 / §11)                                             */
/* -------------------------------------------------------------------------- */

const ArrivalSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100000).optional(),
  bypassReason: z.string().min(5).max(300).optional(),
  /** GPS unavailable? The Field Manager scans the customer's secure QR for this job / property. */
  qrToken: z.string().min(16).max(200).optional(),
});

function geofenceMeters(): number {
  const raw = Number.parseInt(process.env.ARRIVAL_GEOFENCE_METERS || "300", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 300;
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const PatchSchema = z.object({
  status: z.string().min(1).max(32).optional(),
  assignedStaffIds: z.array(z.string().min(1).max(64)).max(20).optional(),
  assignedManagerId: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledTimeSlot: z.string().max(80).optional(),
  arrival: ArrivalSchema.optional(),
  /** Super Admin override of the state machine — must carry a reason (audited). */
  override: z.boolean().optional(),
  reason: z.string().max(500).optional(),
  /** Admin: the job's map location, notes for the customer, what the customer sees. */
  location: z
    .object({ lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(), address: z.string().max(500).nullable() })
    .nullable()
    .optional(),
  customerNotes: z.string().max(2000).nullable().optional(),
  customerVisibility: z.record(z.string(), z.boolean()).nullable().optional(),
});

/**
 * PATCH /api/jobs/[id] — the ONLY write path for a job's lifecycle:
 *   assignment  (jobs.assign)      crew + field manager
 *   reschedule  (jobs.reschedule)  date / time window
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
          const clash = await crewClash(crew, { id, scheduledDate: existing.scheduledDate, scheduledTimeSlot: slotRow?.scheduledTimeSlot ?? "" });
          if (clash) {
            return fail(`Already booked on ${clash.jobSerial} (${clash.scheduledTimeSlot}) — overlapping times can't be double-booked.`, 409);
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
      if (managerId !== existing.assignedManagerId) {
        const names = await userNames([existing.assignedManagerId, managerId]);
        await logAssignment({ jobId: id, action: "MANAGER_CHANGED", actor: { id: user.id, name: user.name }, detail: `${existing.assignedManagerId ? names.get(existing.assignedManagerId) ?? "—" : "none"} → ${managerId ? names.get(managerId) ?? "—" : "none"}` }).catch(() => {});
      }
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
      if (crew.length > 0 && (existing.status !== nextStatus || managerId !== existing.assignedManagerId)) {
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
      const clash = await crewClash(crew, { id, scheduledDate, scheduledTimeSlot });
      if (clash) return fail(`The assigned crew is already booked on ${clash.jobSerial} (${clash.scheduledTimeSlot}). Re-assign or choose another window.`, 409);
      // Cleaning staff on the job must also be free at the new time.
      const team = await prisma.jobAssignment.findMany({ where: { jobId: id, status: { in: ACTIVE_ASSIGNMENT } }, select: { employeeId: true, employee: { select: { fullName: true } } } });
      if (team.length) {
        const cf = await conflictsForMany(team.map((t) => t.employeeId), { id, scheduledDate, scheduledTimeSlot });
        const bad = team.flatMap((t) => (cf.get(t.employeeId) ?? []).filter((c) => c.kind === "job" || c.kind === "leave").map((c) => `${t.employee.fullName}: ${c.message}`));
        if (bad.length) return fail(`Some cleaning staff aren't free at the new time — ${bad.join(" ")} Remove or replace them first.`, 409);
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
      if (team.length) {
        await logAssignment({ jobId: id, action: "RESCHEDULED", actor: { id: user.id, name: user.name }, detail: `${current?.scheduledDate} ${current?.scheduledTimeSlot} → ${scheduledDate} ${scheduledTimeSlot}` }).catch(() => {});
        void notifyStaffAssignment(id, team.map((t) => t.employeeId), "updated").catch(() => {});
      }
      void syncJobEvent(id).catch(() => {});
      return respondWithJob(user, id);
    }

    /* ------------------------- location, customer notes, customer visibility */
    if ((body.location !== undefined || body.customerNotes !== undefined || body.customerVisibility !== undefined) && !body.status) {
      // Desk settings of the job — the same authority as assigning it.
      const { user } = await authorizeJob(id, "jobs.assign");
      const data: Prisma.JobUpdateInput = { updatedAt: new Date() };
      if (body.location !== undefined) {
        data.locationLat = body.location?.lat ?? null;
        data.locationLng = body.location?.lng ?? null;
        data.locationAddress = body.location?.address || null;
      }
      if (body.customerNotes !== undefined) data.customerNotes = body.customerNotes?.trim() || null;
      if (body.customerVisibility !== undefined) {
        const v = cleanVisibility(body.customerVisibility);
        data.customerVisibility = v ? (v as Prisma.InputJsonValue) : Prisma.DbNull;
      }
      await prisma.job.update({ where: { id }, data });
      void recordAudit({ actor: user, action: "JOB_DETAILS_UPDATED", entityType: "job", entityId: id, jobId: id, details: Object.keys(data).filter((k) => k !== "updatedAt").join(","), request });
      return respondWithJob(user, id);
    }

    /* -------------------------------------------------------- work notes */
    if (body.notes !== undefined && !body.status) {
      const { user } = await authorizeJob(id, "jobs.update");
      await prisma.job.update({ where: { id }, data: { notes: body.notes, updatedAt: new Date() } });
      void recordAudit({ actor: user, action: "JOB_NOTES_UPDATED", entityType: "job", entityId: id, jobId: id, request });
      return respondWithJob(user, id);
    }

    /* ------------------------------------------------------------ status */
    const status = body.status;
    if (!status) return fail("status is required.", 400);
    const { user } = await requireUser();

    const existing = await prisma.job.findUnique({ where: { id }, include: { property: { select: { lat: true, lng: true } } } }); // incl. locationLat/locationLng
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

    // 3. GPS verification on arrival (field scope only; desk overrides are audited).
    const data: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "ARRIVED") {
      const arrival = body.arrival ?? {};
      const hasCoords = typeof arrival.lat === "number" && typeof arrival.lng === "number";
      // The job's own map pin first, else the property's.
      const targetLat = existing.locationLat ?? existing.property?.lat ?? null;
      const targetLng = existing.locationLng ?? existing.property?.lng ?? null;
      const fieldUser = scopeOf(user.role, "jobs.arrive") === "ASSIGNED";
      let verification: "gps" | "qr" | "manual" | "admin_override" = "manual";
      let distance: number | null = null;
      if (hasCoords && targetLat !== null && targetLng !== null) {
        distance = distanceMeters(arrival.lat!, arrival.lng!, targetLat, targetLng);
        if (distance <= geofenceMeters() + (arrival.accuracy ?? 0)) verification = "gps";
      }
      if (verification !== "gps" && arrival.qrToken) {
        // The secure QR proves presence only if it belongs to THIS job or this property.
        const resolved = await resolveQrToken(arrival.qrToken);
        const scanned = resolved.ok ? await prisma.job.findUnique({ where: { id: resolved.data.job.id }, select: { id: true, propertyId: true } }) : null;
        if (!scanned || (scanned.id !== existing.id && scanned.propertyId !== existing.propertyId)) {
          return fail("That QR code is not for this job's location. Scan the customer's QR for this service.", 409);
        }
        verification = "qr";
      }
      if (verification === "manual" && !fieldUser) {
        if (!arrival.bypassReason) return fail("Give a reason for marking arrival on the Field Manager's behalf.", 400);
        verification = "admin_override";
      }
      if (verification === "manual" && !arrival.bypassReason && fieldUser) {
        return fail(
          hasCoords && distance !== null
            ? `You appear to be ${Math.round(distance)} m from the location. Move closer, scan the customer's QR, or give a reason.`
            : "GPS couldn't verify your location. Scan the customer's QR, or give a reason to continue.",
          409
        );
      }
      Object.assign(data, {
        arrivedAt: new Date(),
        arrivalLat: arrival.lat ?? null,
        arrivalLng: arrival.lng ?? null,
        arrivalAccuracy: arrival.accuracy ?? null,
        arrivalVerification: verification,
        arrivalDistanceM: distance,
        arrivalBypassReason: verification === "gps" || verification === "qr" ? null : arrival.bypassReason ?? null,
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
    const gpsNote =
      status === "ARRIVED"
        ? data.arrivalVerification === "gps"
          ? " (verified by GPS)"
          : data.arrivalVerification === "qr"
          ? " (verified by QR scan)"
          : data.arrivalVerification === "admin_override"
          ? ` (Admin override: ${data.arrivalBypassReason})`
          : ` (not verified${data.arrivalBypassReason ? `: ${data.arrivalBypassReason}` : ""})`
        : "";
    await recordActivity({
      jobId: id,
      type: "STATUS_CHANGED",
      message: (STATUS_EVENT_MESSAGES[status] || `Job moved to ${JOB_STATUS_CONFIG[status as Job["status"]]?.label || status}`) + gpsNote,
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
      details: status === "ARRIVED" ? `verification=${data.arrivalVerification} distance=${data.arrivalDistanceM ?? "n/a"}` : undefined,
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
