import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { formatAddress, normalizeCoords } from "@/lib/location";
import { prisma } from "@/lib/server/prisma";
import { cleanVisibility } from "@/lib/server/job-create";
import { getSystemSettings } from "@/lib/server/settings";
import { checkJobStart, logStartAttempt, startSummary, type StartCheck } from "@/lib/server/start-verification";
import { START_MODES, START_MODE_INFO, effectiveStartMode, type StartMode } from "@/lib/start-verification";
import { requireUser, authorizeJob, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { validateTransition, JOB_STATUS_CONFIG } from "@/lib/state-machine";
import type { Job } from "@/lib/types";
import { serializeJob, withStaffNames, fail, JOB_PROPERTY_SELECT } from "@/lib/server/serialize";
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
  property: { select: JOB_PROPERTY_SELECT },
  service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
} as const;

/** GPS and QR results kept apart, for the Field Manager's screen. */
function verificationView(c: StartCheck) {
  return {
    gps: { result: c.gpsResult, message: c.gpsMessage ?? null, distanceM: c.distanceM, at: c.gpsCheckedAt?.toISOString() ?? null },
    qr: { result: c.qrResult, message: c.qrMessage ?? null, at: c.qrCheckedAt?.toISOString() ?? null },
  };
}

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
  /** The customer's QR for this job (QR and QR + GPS modes). The server resolves it — the job it names is never taken from the client. */
  qrToken: z.string().min(16).max(200).optional(),
});

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
    .object({
      lat: z.number().min(-90).max(90).nullable(),
      lng: z.number().min(-180).max(180).nullable(),
      address: z.string().max(500).nullable(),
      /** true = drop this job's own pin and follow the property's saved location again. */
      followProperty: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  customerNotes: z.string().max(2000).nullable().optional(),
  customerVisibility: z.record(z.string(), z.boolean()).nullable().optional(),
  /** Admin: this job's start verification mode (null = company default). */
  startVerificationMode: z.enum(START_MODES).nullable().optional(),
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
    if ((body.location !== undefined || body.customerNotes !== undefined || body.customerVisibility !== undefined || body.startVerificationMode !== undefined) && !body.status) {
      // Desk settings of the job — the same authority as assigning it.
      const { user } = await authorizeJob(id, "jobs.assign");
      const data: Prisma.JobUpdateInput = { updatedAt: new Date() };
      if (body.location !== undefined) {
        const cur = await prisma.job.findUnique({ where: { id }, include: { property: true } });
        if (!cur) return fail("Job not found.", 404);
        const propPin = normalizeCoords(cur.property.lat, cur.property.lng);
        const propAddress = formatAddress(cur.property);
        if (body.location === null || body.location.followProperty) {
          Object.assign(data, { locationLat: propPin?.lat ?? null, locationLng: propPin?.lng ?? null, locationAddress: propAddress || null, locationSource: "PROPERTY" });
        } else {
          const pin = normalizeCoords(body.location.lat, body.location.lng);
          if (!pin && (body.location.lat !== null || body.location.lng !== null)) {
            return fail("The map location needs both latitude and longitude (and can't be 0, 0).", 400);
          }
          // Empty values never wipe a saved pin or address.
          const keep = normalizeCoords(cur.locationLat, cur.locationLng);
          const next = pin ?? keep ?? propPin;
          const same = !!next && !!propPin && Math.abs(next.lat - propPin.lat) < 1e-6 && Math.abs(next.lng - propPin.lng) < 1e-6;
          Object.assign(data, {
            locationLat: next?.lat ?? null,
            locationLng: next?.lng ?? null,
            locationAddress: body.location.address?.trim() || cur.locationAddress || propAddress || null,
            locationSource: !next || same ? "PROPERTY" : "JOB",
          });
        }
      }
      if (body.customerNotes !== undefined) data.customerNotes = body.customerNotes?.trim() || null;
      if (body.startVerificationMode !== undefined) {
        const sv = (await getSystemSettings()).jobStartVerification;
        if (body.startVerificationMode !== null && !sv.allowPerJobOverride) return fail("Per-job start verification is turned off in Settings.", 409);
        const cur = await prisma.job.findUnique({ where: { id }, select: { status: true, startVerificationMode: true } });
        if (cur && !["SCHEDULED", "ASSIGNED"].includes(cur.status)) return fail("The job has already started — its start verification can't be changed now.", 409);
        data.startVerificationMode = body.startVerificationMode;
        void recordAudit({ actor: user, action: "JOB_START_MODE_CHANGED", entityType: "job", entityId: id, jobId: id, previousState: cur?.startVerificationMode ?? "DEFAULT", newState: body.startVerificationMode ?? "DEFAULT", request });
      }
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

    // 3. Job start verification (the "I'm here" step). The mode comes from the database, never the request.
    const data: Record<string, unknown> = { status, updatedAt: new Date() };
    let start: { mode: StartMode; check: StartCheck; arrival: z.infer<typeof ArrivalSchema> } | null = null;
    if (status === "ARRIVED") {
      const arrival = body.arrival ?? {};
      const sv = (await getSystemSettings()).jobStartVerification;
      const mode = effectiveStartMode(existing.startVerificationMode, sv);
      const fieldUser = scopeOf(user.role, "jobs.arrive") === "ASSIGNED";
      const check = await checkJobStart({ job: existing, mode, settings: sv, arrival, fieldUser, userId: user.id });
      if (!check.ok) {
        await logStartAttempt({ jobId: id, user, mode, check, arrival, statusBefore: existing.status, statusAfter: existing.status });
        void recordAudit({ actor: user, action: "JOB_START_VERIFICATION_FAILED", entityType: "job", entityId: id, jobId: id, previousState: existing.status, newState: existing.status, details: `mode=${mode} code=${check.code} distance=${check.distanceM ?? "n/a"} qr=${check.qrResult}`, request });
        return NextResponse.json({ success: false, error: check.error, code: check.code, mode, verification: verificationView(check) }, { status: check.status ?? 409 });
      }
      start = { mode, check, arrival };
      Object.assign(data, {
        arrivedAt: new Date(),
        arrivalLat: arrival.lat ?? null,
        arrivalLng: arrival.lng ?? null,
        arrivalAccuracy: arrival.accuracy ?? null,
        arrivalVerification: check.verification,
        arrivalDistanceM: check.distanceM,
        arrivalBypassReason: check.result === "OVERRIDE" ? arrival.bypassReason?.trim() ?? null : null,
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
    if (moved.count === 0) {
      if (start) await logStartAttempt({ jobId: id, user, mode: start.mode, check: { ...start.check, ok: false, result: "FAILED" }, arrival: start.arrival, statusBefore: existing.status, statusAfter: existing.status, failureReason: "Duplicate or out-of-date start request — the job had already changed." });
      return fail("This job was just updated by someone else. Refresh and try again.", 409);
    }
    if (start) {
      await logStartAttempt({ jobId: id, user, mode: start.mode, check: start.check, arrival: start.arrival, statusBefore: existing.status, statusAfter: status });
      // A passed on-site GPS check confirms the property's saved pin (its coordinates are never replaced by the device's).
      if (start.check.gpsResult === "PASSED" && start.check.target?.source === "PROPERTY") {
        await prisma.property.update({ where: { id: existing.propertyId }, data: { locationVerifiedAt: new Date() } }).catch(() => {});
      }
    }
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
    const gpsNote = start ? startSummary(start.check, start.mode, start.arrival.bypassReason) : "";
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
      details: start ? `mode=${start.mode} (${START_MODE_INFO[start.mode].label}) verification=${data.arrivalVerification} distance=${data.arrivalDistanceM ?? "n/a"} accuracy=${start.arrival.accuracy ?? "n/a"} qr=${start.check.qrResult}` : undefined,
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

/**
 * DELETE /api/jobs/[id] — remove a job (Admin only).
 * Protected against deleting completed jobs with recorded payments or active financial history.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const { user, job } = await authorizeJob(id, "jobs.cancel");

    // Check for payments or paid invoices
    const paidInvoice = await prisma.invoice.findFirst({
      where: { jobId: id, amountPaid: { gt: 0 } },
    });
    if (paidInvoice) {
      return fail(
        `Job has paid invoices (₹${paidInvoice.amountPaid} received). Financial audit trail must be preserved — cancel the job instead.`,
        409
      );
    }

    const hasCompletedQC = await prisma.qualityCheck.findFirst({
      where: { jobId: id, decision: "PASS" },
    });
    if (job.status === "COMPLETED" && hasCompletedQC) {
      return fail(
        "Completed jobs with passed quality inspections cannot be deleted. Use cancellation or archive workflow.",
        409
      );
    }

    // Perform atomic cascading delete for draft/cancelled/unpaid test jobs
    await prisma.$transaction(async (tx) => {
      // 1. Clear AMC visit reference if any
      await tx.amcVisit.updateMany({ where: { jobId: id }, data: { jobId: null } });

      // 2. Delete freelance payments / expenses linked to this job
      await tx.freelancePayment.deleteMany({ where: { jobId: id } });
      await tx.attendanceRecord.deleteMany({ where: { jobId: id } });
      await tx.commissionEntry.deleteMany({ where: { jobId: id } });

      // 3. Delete invoices and payments (all verified unpaid)
      await tx.payment.deleteMany({ where: { jobId: id } });
      await tx.refund.deleteMany({ where: { jobId: id } });
      await tx.invoice.deleteMany({ where: { jobId: id } });

      // 4. Delete checklist, photos, assignments, verifications, activities, complaints, quality checks
      await tx.jobChecklistItem.deleteMany({ where: { jobId: id } });
      await tx.jobPhoto.deleteMany({ where: { jobId: id } });
      await tx.jobStartVerification.deleteMany({ where: { jobId: id } });
      await tx.jobAssignmentEvent.deleteMany({ where: { jobId: id } });
      await tx.jobAssignment.deleteMany({ where: { jobId: id } });
      await tx.reworkTask.deleteMany({ where: { jobId: id } });
      await tx.qualityIssue.deleteMany({ where: { jobId: id } });
      await tx.qualityCheck.deleteMany({ where: { jobId: id } });
      await tx.complaint.deleteMany({ where: { jobId: id } });
      await tx.qrToken.deleteMany({ where: { jobId: id } });
      await tx.jobActivityEvent.deleteMany({ where: { jobId: id } });

      // 5. Delete the job record
      await tx.job.delete({ where: { id } });

      // 6. Decrement customer total bookings
      await tx.customer.update({
        where: { id: job.customerId },
        data: { totalBookings: { decrement: 1 } },
      }).catch(() => {});
    });

    void cancelJobEvent(id).catch(() => {});
    void recordAudit({
      actor: user,
      action: "JOB_DELETED",
      entityType: "job",
      entityId: id,
      details: `Job ${id} (${job.status}) deleted`,
      request,
    });

    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    return errorResponse(err, "jobs.delete.route_error");
  }
}
