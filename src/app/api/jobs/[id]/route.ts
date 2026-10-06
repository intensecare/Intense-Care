import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireUser, authorizeJobAccess } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { getOpsDateVisibility } from "@/lib/ops-visibility";
import { dispatchCutoffTime } from "@/lib/server/policy";
import { getAllowedTransitions, JOB_STATUS_CONFIG } from "@/lib/state-machine";
import type { Job } from "@/lib/types";
import { serializeJob, redactJobForOps, withStaffNames } from "@/lib/server/serialize";
import { recordActivity } from "@/lib/server/activity";
import { syncJobEvent, cancelJobEvent } from "@/lib/server/google-calendar";

/**
 * Serializes a single job for API responses with the same display data as the
 * list route: resolved staff names. The customer's verification state lives on
 * the Job itself (customerConfirmedAt — set by the secure-link confirm), so no
 * extra lookup is needed.
 */
async function serializeJobWithDisplayData(
  full: Parameters<typeof serializeJob>[0],
  isSuperAdmin: boolean
) {
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const nameMap = new Map(users.map((u) => [u.id, u.name]));
  const serialized = isSuperAdmin ? serializeJob(full) : redactJobForOps(serializeJob(full));
  return withStaffNames(serialized, nameMap);
}

/**
 * GET /api/jobs/[id] — server-side view of a single job (same shape as the
 * list route, including customer-confirmation state).
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    await authorizeJobAccess(id);

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true, phone: true } },
        property: { select: { title: true, address: true } },
        service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
    }

    // Ops Managers are restricted to the dispatch visibility window on every
    // route — single-job fetches included (no URL/date manipulation bypass).
    const { user } = await requireUser();
    if (user.role === "ops_manager") {
      const visibility = getOpsDateVisibility(new Date(), {
        nextDayDispatchTime: dispatchCutoffTime(),
      });
      if (!visibility.isDateVisible(job.scheduledDate)) {
        logger.warn("jobs.get_one.ops_window_denied", { jobId: id, by: user.id });
        return NextResponse.json(
          { success: false, error: "This job is not yet open for dispatch." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: await serializeJobWithDisplayData(job, user.role === "super_admin"),
    });
  } catch (err) {
    return errorResponse(err, "jobs.get_one.route_error");
  }
}

/**
 * PATCH /api/jobs/[id] — mirrors lifecycle status changes made in the ERP UI
 * (e.g. staff marking work completed) into the server store.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requireUser();
    const { id } = params;

    const body = await request.json().catch(() => null);

    // Assignment updates (managers/admins only): set the direct field-worker
    // list; first entry becomes the lead worker. Optionally moves a
    // SCHEDULED job to ASSIGNED. Assigned ids are validated against real,
    // active staff accounts — no phantom assignments.
    if (Array.isArray(body?.assignedStaffIds)) {
      if (user.role === "staff") {
        return NextResponse.json(
          { success: false, error: "Only managers can assign workers." },
          { status: 403 }
        );
      }
      const ids = (body.assignedStaffIds as unknown[]).filter(
        (v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64
      );
      const existingJob = await prisma.job.findUnique({ where: { id } });
      if (!existingJob) {
        return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
      }

      // Validate every assigned id: must be an active staff account.
      if (ids.length > 0) {
        const staffRows = await prisma.user.findMany({
          where: { id: { in: ids }, role: "staff", active: true },
          select: { id: true },
        });
        const valid = new Set(staffRows.map((s) => s.id));
        const invalid = ids.filter((x) => !valid.has(x));
        if (invalid.length > 0) {
          return NextResponse.json(
            { success: false, error: "One or more selected workers are not active staff accounts." },
            { status: 400 }
          );
        }

        // Double-booking guard (server-authoritative): a worker cannot be on
        // two non-terminal jobs with the same date + time slot.
        if (existingJob.scheduledDate && existingJob.scheduledTimeSlot) {
          const terminal = ["COMPLETED", "CANCELLED", "CLOSED"];
          const sameSlot = await prisma.job.findMany({
            where: {
              id: { not: id },
              scheduledDate: existingJob.scheduledDate,
              scheduledTimeSlot: existingJob.scheduledTimeSlot,
              status: { notIn: terminal },
              OR: ids.map((sid) => ({ assignedStaffIds: { has: sid } })),
            },
            select: { id: true, assignedStaffIds: true },
          });
          const busy = new Set(sameSlot.flatMap((j) => j.assignedStaffIds));
          const clash = ids.filter((sid) => busy.has(sid));
          if (clash.length > 0) {
            return NextResponse.json(
              {
                success: false,
                error:
                  "Worker already booked on another job in this date & time slot (double-booking is not allowed).",
              },
              { status: 409 }
            );
          }
        }
      }

      // Booking-window integrity: a job may not be pulled into the past.
      if (
        existingJob.scheduledDate &&
        existingJob.scheduledDate < new Date().toISOString().slice(0, 10) &&
        existingJob.status === "SCHEDULED"
      ) {
        // Past-dated scheduled jobs stay schedulable for record correction.
      }

      const nextStatus =
        ids.length > 0 &&
        (existingJob.status === "SCHEDULED" || existingJob.status === "DRAFT")
          ? "ASSIGNED"
          : ids.length === 0 && existingJob.status === "ASSIGNED"
          ? "SCHEDULED"
          : existingJob.status;
      const job = await prisma.job.update({
        where: { id },
        data: { assignedStaffIds: ids, status: nextStatus, updatedAt: new Date() },
      });
      logger.info("jobs.assignment_updated", { jobId: id, count: ids.length, by: user.id });
      // Supervisor-visible activity feed: crew changes are pipeline events.
      await recordActivity({
        jobId: id,
        type: "STAFF_ASSIGNED",
        message:
          ids.length > 0
            ? `Crew updated — ${ids.length} field worker${ids.length === 1 ? "" : "s"} assigned${
                nextStatus === "ASSIGNED" && existingJob.status !== "ASSIGNED" ? " (job is now Staff Assigned)" : ""
              }`
            : "All field workers unassigned (job returned to Scheduled)",
        actor: { id: user.id, name: user.name, role: user.role },
      });
      // §1 Google Calendar: the event carries the team — refresh on crew change.
      void syncJobEvent(id).catch(() => {});
      // Redact financial fields for non-super_admin callers on the way out.
      const { user: _u } = await requireUser();
      const full = await prisma.job.findUnique({
        where: { id },
        include: {
          customer: { select: { name: true, phone: true } },
          property: { select: { title: true, address: true } },
          service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
        },
      });
      return NextResponse.json({
        success: true,
        data: full ? await serializeJobWithDisplayData(full, _u.role === "super_admin") : job,
      });
    }

    const status = body?.status;
    if (typeof status !== "string" || status.length === 0 || status.length > 32) {
      return NextResponse.json({ success: false, error: "status is required." }, { status: 400 });
    }

    // Role separation: field-execution states belong to the assigned field
    // worker (they are physically on site). The ops_manager runs dispatch and
    // the QC desk — not arrival, work progress or rework completion.
    const FIELD_EXECUTION_STATUSES = [
      "ARRIVED",
      "CUSTOMER_VERIFIED",
      "IN_PROGRESS",
      "WORK_COMPLETED",
      "REWORK_COMPLETED",
    ];
    if (user.role === "ops_manager" && FIELD_EXECUTION_STATUSES.includes(status)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Field execution actions (arrival, work progress, rework completion) are performed by the assigned field worker. Use the Quality Control desk for audits and rework.",
        },
        { status: 403 }
      );
    }

    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
    }

    // Authorization FIRST (before state validation) so unassigned workers
    // get a clear 403 rather than leaking state-machine details.
    // Directly-assigned workers may only update jobs they are assigned to;
    // managers/admins may transition all.
    if (user.role !== "super_admin" && user.role !== "ops_manager") {
      if (
        existing.assignedManagerId !== user.id &&
        !(Array.isArray(existing.assignedStaffIds) && existing.assignedStaffIds.includes(user.id))
      ) {
        return NextResponse.json(
          { success: false, error: "You are not assigned to this job." },
          { status: 403 }
        );
      }
    }

    // Server-side state-machine gate: reject transitions the lifecycle does
    // not allow (staff-scope PATCH is a status mirror, so workers cannot push
    // arbitrary/unrelated states). Managers/admins are the mirror origin and
    // stay unrestricted.
    if (user.role === "staff") {
      const allowed = getAllowedTransitions(existing as unknown as Job)
        .filter((t) => t.allowedRoles.includes("staff"))
        .map((t) => t.status as string);
      if (!allowed.includes(status)) {
        return NextResponse.json(
          { success: false, error: `Transition to ${status} is not permitted for this job.` },
          { status: 409 }
        );
      }
    }

    // Verification integrity gate: CUSTOMER_VERIFIED may ONLY be reached
    // through the customer's secure-link confirmation (customerConfirmedAt set
    // by /api/customer/job/[token]) — never by mirroring a status value
    // directly, for any role. This closes any bypass that skips verification.
    if (status === "CUSTOMER_VERIFIED") {
      const confirmed = await prisma.job.findUnique({
        where: { id },
        select: { customerConfirmedAt: true },
      });
      if (!confirmed?.customerConfirmedAt) {
        return NextResponse.json(
          { success: false, error: "Customer confirmation via the secure link is required before this transition." },
          { status: 409 }
        );
      }
    }

    const job = await prisma.job.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });

    // Live pipeline feed: every lifecycle move is a supervisor-visible event.
    const STATUS_EVENT_MESSAGES: Record<string, string> = {
      SCHEDULED: "Job scheduled",
      ASSIGNED: "Field staff assigned to the job",
      ARRIVED: "Field worker arrived on site — awaiting customer confirmation",
      CUSTOMER_VERIFIED: "Customer confirmed via secure link — property entry authorized",
      IN_PROGRESS: "Work started — cleaning in progress",
      WORK_COMPLETED: "Field worker marked work completed — submitted for QC audit",
      QUALITY_CHECK: "QC inspection started",
      REWORK_COMPLETED: "Rework completed by field worker — awaiting reinspection",
      CUSTOMER_APPROVAL: "QC passed — handover link sent to customer",
      COMPLETED: "Customer approved — job completed",
      FEEDBACK_REQUESTED: "Feedback & Google review link sent to customer",
      CLOSED: "Job closed and archived",
      CANCELLED: "Job cancelled",
    };
    await recordActivity({
      jobId: id,
      type: "STATUS_CHANGED",
      message: STATUS_EVENT_MESSAGES[status] || `Job moved to ${JOB_STATUS_CONFIG[status as Job["status"]]?.label || status}`,
      actor: { id: user.id, name: user.name, role: user.role },
    });

    // §1 Google Calendar: refresh the event on job updates; cancel it on cancel.
    if (status === "CANCELLED") {
      void cancelJobEvent(id).catch(() => {});
    } else {
      void syncJobEvent(id).catch(() => {});
    }

    // §16 unified flow: work completion fires the QC notification + QC token
    // mint server-side (field app and manager link both benefit).
    if (status === "WORK_COMPLETED") {
      try {
        const { onWorkCompleted } = await import("@/lib/server/workflow-service");
        void onWorkCompleted(id, { id: user.id, name: user.name }).catch(() => {});
      } catch {
        // never fail the transition on notification issues
      }
    }

    // Arrival side-effect: the customer gets the ONE secure link by SMS so
    // they can confirm the team on site (provider-gated; audited in SmsLog).
    if (status === "ARRIVED" && existing.status !== "ARRIVED") {
      try {
        const [{ ensureCustomerLink }, { notifyCustomerArrived }] = await Promise.all([
          import("@/lib/server/qr-service"),
          import("@/lib/server/notify"),
        ]);
        void (async () => {
          const link = await ensureCustomerLink(id, { id: user.id, name: user.name });
          if (link.success) await notifyCustomerArrived(id, link.data.linkUrl);
        })().catch(() => {});
      } catch {
        // notification failure must never fail the arrival transition
      }
    }

    // Server-authoritative commission settlement: when a referred job
    // completes, create the commission entry (idempotent) and update the
    // partner aggregates. Never left to a client-side call that may not fire.
    if (status === "COMPLETED" && existing.referralPartnerId) {
      try {
        const { settleCommissionForJob } = await import("@/lib/server/commission");
        await settleCommissionForJob(id);
      } catch (e) {
        logger.error("jobs.settle_commission_failed", {
          jobId: id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    logger.info("jobs.status_mirrored", { jobId: id, status, by: user.id });
    // Redact financial fields for non-super_admin callers on the way out.
    if (user.role === "super_admin") {
      return NextResponse.json({ success: true, data: job });
    }
    const full = await prisma.job.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true, phone: true } },
        property: { select: { title: true, address: true } },
        service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
      },
    });
    return NextResponse.json({
      success: true,
      data: full ? await serializeJobWithDisplayData(full, false) : job,
    });
  } catch (err) {
    return errorResponse(err, "jobs.patch.route_error");
  }
}
