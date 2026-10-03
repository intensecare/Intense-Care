import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireUser, authorizeJobAccess } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { getOpsDateVisibility } from "@/lib/ops-visibility";
import { dispatchCutoffTime } from "@/lib/server/policy";
import { getAllowedTransitions } from "@/lib/state-machine";
import type { Job } from "@/lib/types";
import { serializeJob, redactJobForOps, withStaffNames } from "@/lib/server/serialize";

/**
 * Serializes a single job for API responses with the same display data as the
 * list route: resolved staff names and the authoritative OTP verification
 * state (a hardcoded "none" here used to revert verified jobs after
 * transitions and re-prompt the customer's OTP).
 */
async function serializeJobWithDisplayData(
  full: Parameters<typeof serializeJob>[0],
  isSuperAdmin: boolean
) {
  const [verified, users] = await Promise.all([
    prisma.otpChallenge.findFirst({
      where: { jobId: full.id, status: "VERIFIED" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const nameMap = new Map(users.map((u) => [u.id, u.name]));
  const otp = verified
    ? {
        status: "verified" as const,
        verifiedAt: verified.updatedAt.toISOString(),
        verifiedBy: verified.createdByUserId,
      }
    : undefined;
  const serialized = isSuperAdmin
    ? serializeJob(full, otp)
    : redactJobForOps(serializeJob(full, otp));
  return withStaffNames(serialized, nameMap);
}

/**
 * GET /api/jobs/[id] — server-side view of a job: lifecycle status, latest OTP
 * challenge summary (no codes), and the current completion invite (masked).
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    await authorizeJobAccess(id);

    const job = await prisma.job.findUnique({ where: { id } });
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
          { success: false, error: "This job is outside your dispatch visibility window." },
          { status: 403 }
        );
      }
    }

    const [latestChallenge, verifiedChallenge, invite] = await Promise.all([
      prisma.otpChallenge.findFirst({ where: { jobId: id }, orderBy: { createdAt: "desc" } }),
      prisma.otpChallenge.findFirst({ where: { jobId: id, status: "VERIFIED" } }),
      prisma.completionInvite.findFirst({ where: { jobId: id }, orderBy: { createdAt: "desc" } }),
    ]);

    const customer = await prisma.customer.findUnique({ where: { id: job.customerId } });

    return NextResponse.json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        customerId: job.customerId,
        customerName: customer?.name ?? null,
        customerPhoneMasked: customer
          ? `******${customer.phone.replace(/[^0-9]/g, "").slice(-4)}`
          : null,
        otp: {
          hasPendingChallenge: latestChallenge?.status === "PENDING",
          verified: !!verifiedChallenge,
          attemptsUsed: latestChallenge?.attempts ?? 0,
          maxAttempts: latestChallenge?.maxAttempts ?? 0,
          expiresAt: latestChallenge?.expiresAt ?? null,
          status: verifiedChallenge
            ? "verified"
            : latestChallenge
            ? latestChallenge.status.toLowerCase()
            : "none",
          sentToLast4: latestChallenge?.phoneLast4 ?? null,
        },
        completionInvite: invite
          ? {
              id: invite.id,
              signStatus: invite.signStatus,
              signedAt: invite.signedAt,
              createdAt: invite.createdAt,
            }
          : null,
      },
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

    const existing = await prisma.job.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
    }

    // Authorization FIRST (before state validation) so unassigned workers
    // get a clear 403 rather than leaking state-machine details.
    // Directly-assigned workers may only update jobs they are assigned to;
    // only the lead (first-assigned) worker can drive the OTP-gated
    // CUSTOMER_VERIFIED transition; managers/admins may transition all.
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
      if (
        status === "CUSTOMER_VERIFIED" &&
        existing.assignedStaffIds[0] !== user.id
      ) {
        return NextResponse.json(
          { success: false, error: "Only the lead worker assigned to this job can verify the customer OTP." },
          { status: 403 }
        );
      }
    }

    // Server-side state-machine gate: reject transitions the lifecycle does
    // not allow (staff-scope PATCH is a status mirror, so workers cannot push
    // arbitrary/unrelated states). Managers/admins are the mirror origin and
    // stay unrestricted.
    if (user.role === "staff") {
      const otpVerified = await prisma.otpChallenge.findFirst({
        where: { jobId: id, status: "VERIFIED" },
      });
      const allowed = getAllowedTransitions({
        ...existing,
        otpVerification: { status: otpVerified ? "verified" : "pending" } as Job["otpVerification"],
      } as unknown as Job)
        .filter((t) => t.allowedRoles.includes("staff"))
        .map((t) => t.status as string);
      if (!allowed.includes(status)) {
        return NextResponse.json(
          { success: false, error: `Transition to ${status} is not permitted for this job.` },
          { status: 409 }
        );
      }
    }

    // OTP integrity gate: CUSTOMER_VERIFIED may ONLY be reached through the
    // server-verified OTP flow (/api/otp/verify), never by mirroring a status
    // value directly — for any role. This closes the bypass where a client
    // PATCH could skip customer verification entirely.
    if (status === "CUSTOMER_VERIFIED") {
      const verified = await prisma.otpChallenge.findFirst({
        where: { jobId: id, status: "VERIFIED" },
      });
      if (!verified) {
        return NextResponse.json(
          { success: false, error: "Customer OTP must be verified before this transition." },
          { status: 409 }
        );
      }
    }

    const job = await prisma.job.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });

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
