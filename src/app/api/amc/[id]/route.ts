import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { syncJobEvent } from "@/lib/server/google-calendar";

/** Audit-trail event for AMC actions (entityType "amc", visible on /audit). */
async function auditAmc(
  actorId: string,
  actorName: string,
  action: string,
  entityId: string,
  details: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: "amc",
        entityId,
        action,
        performedBy: `${actorId}:${actorName}`,
        details,
      },
    });
  } catch {
    // Audit logging must never fail the business action.
  }
}

/** Default ops slot used for spawned AMC visit jobs. */
const AMC_JOB_TIME_SLOT = "09:00 - 13:00";

/**
 * Spawns the standard Job for an AMC visit so the visit flows through the
 * same execution surface as a booked job: ops calendar, job file (Next-Action
 * engine, tabs), field checklist (instantiated from the service rubric),
 * and the Google Calendar sync. AMC jobs carry NO invoice — the contract is
 * the billing instrument — so they appear as "Billed under AMC contract" on
 * the job's Billing tab instead of a per-visit tax invoice.
 */
/** Why a visit completion did (not) produce an execution job. */
type SpawnOutcome = "spawned" | "already_linked" | "service_missing" | "service_inactive";

async function spawnVisitJob(
  contractId: string,
  visitId: string,
  user: { id: string; name: string }
): Promise<SpawnOutcome> {
  const contract = await prisma.amcContract.findUnique({ where: { id: contractId } });
  const visit = await prisma.amcVisit.findUnique({ where: { id: visitId } });
  if (!contract || !visit || visit.jobId) return "already_linked";

  const service = contract.serviceId
    ? await prisma.service.findUnique({
        where: { id: contract.serviceId },
        include: { checklistTemplate: { orderBy: { position: "asc" as const } } },
      })
    : null;
  // Rubric-driven execution needs an active service package. The visit still
  // completes (it happened in the real world) — the caller surfaces why no
  // job was spawned via the audit trail.
  if (!service) return "service_missing";
  if (!service.active) return "service_inactive";

  const slot = visit.scheduledSlot?.trim() || AMC_JOB_TIME_SLOT;
  const job = await prisma.job.create({
    data: {
      customerId: contract.customerId,
      propertyId: contract.propertyId,
      serviceId: service.id,
      scheduledDate: visit.scheduledDate,
      scheduledTimeSlot: slot,
      assignedStaffIds: visit.staffIds,
      amount: 0,
      paymentStatus: "NOT_APPLICABLE",
      status: visit.staffIds.length > 0 ? "ASSIGNED" : "SCHEDULED",
      notes: `AMC visit ${visit.visitNumber}/${contract.visitCount} under contract ${contract.contractNumber} — billed under the AMC contract, no per-visit invoice.`,
    },
  });

  // Working checklist from the company rubric — same as a regular booking.
  if (service.checklistTemplate.length > 0) {
    await prisma.jobChecklistItem.createMany({
      data: service.checklistTemplate.map((item) => ({
        jobId: job.id,
        area: item.area,
        task: item.task,
        critical: item.critical,
      })),
    });
  }

  // Claim the visit atomically: two concurrent completions must never leave
  // two jobs for one visit. Losing claimant deletes its duplicate.
  const claim = await prisma.amcVisit.updateMany({
    where: { id: visit.id, jobId: null },
    data: { jobId: job.id },
  });
  if (claim.count === 0) {
    await prisma.job.delete({ where: { id: job.id } }).catch(() => {}); // checklist cascades
    return "already_linked";
  }
  logger.info("amc.visit_job_spawned", {
    contractId,
    visitId: visit.id,
    jobId: job.id,
    by: user.id,
  });

  // §1 Google Calendar sync — env-gated, fire-and-forget, idempotent via
  // the job's stored googleEventId (same path as regular bookings).
  void syncJobEvent(job.id).catch(() => {});
  return "spawned";
}

/** Keeps the spawned job aligned with the visit record (date/slot/status). */
async function syncVisitJob(visitId: string, data: { scheduledDate?: string; scheduledTimeSlot?: string; status?: string }) {
  const visit = await prisma.amcVisit.findUnique({ where: { id: visitId } });
  if (!visit?.jobId) return;
  try {
    await prisma.job.update({ where: { id: visit.jobId }, data });
  } catch {
    // The job may have been deleted by an operator; the visit stays truthful.
  }
}

/**
 * PATCH /api/amc/[id] — contract & visit lifecycle actions:
 *   { action: "reschedule_visit", visitId, scheduledDate, scheduledSlot? }
 *   { action: "remind_visit", visitId }                  → marks reminder sent
 *   { action: "complete_visit", visitId, ...NRI report } → visit completed
 *   { action: "nri_approval", visitId, nriApproved, nriNotes? }
 *   { action: "update_contract", paymentStatus?, status?, notes? }
 *
 * AMC visits are lightweight records outside the strict job state machine;
 * completing a visit records the §2 NRI report fields verbatim.
 */
const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reschedule_visit"),
    visitId: z.string().min(1),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduledSlot: z.string().max(64).optional().nullable(),
  }),
  z.object({
    action: z.literal("remind_visit"),
    visitId: z.string().min(1),
  }),
  z.object({
    action: z.literal("complete_visit"),
    visitId: z.string().min(1),
    arrivedAt: z.string().datetime().optional().nullable(),
    completedAt: z.string().datetime().optional().nullable(),
    staffIds: z.array(z.string()).max(20).optional(),
    qcScore: z.number().int().min(0).max(100).optional().nullable(),
    issuesFound: z.string().max(2000).optional().nullable(),
    recommendations: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("nri_approval"),
    visitId: z.string().min(1),
    nriApproved: z.boolean(),
    nriNotes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("update_contract"),
    paymentStatus: z.enum(["PENDING", "PARTIAL", "PAID"]).optional(),
    status: z.enum(["ACTIVE", "EXPIRING_SOON", "EXPIRED", "CANCELLED"]).optional(),
    notes: z.string().max(2000).optional().nullable(),
  }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requirePermission("amc.manage");
    const { id } = params;

    const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid AMC action payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const contract = await prisma.amcContract.findUnique({ where: { id } });
    if (!contract) {
      return NextResponse.json({ success: false, error: "AMC contract not found." }, { status: 404 });
    }

    // Cancelled contracts are read-only except for bookkeeping updates
    // (e.g. recording a final payment status).
    if (contract.status === "CANCELLED" && body.action !== "update_contract") {
      return NextResponse.json(
        { success: false, error: "This contract is cancelled — visits can no longer be modified." },
        { status: 409 }
      );
    }

    switch (body.action) {
      case "reschedule_visit": {
        const visit = await prisma.amcVisit.findFirst({
          where: { id: body.visitId, contractId: id },
        });
        if (!visit) {
          return NextResponse.json({ success: false, error: "Visit not found." }, { status: 404 });
        }
        if (visit.status === "COMPLETED" || visit.status === "CANCELLED") {
          return NextResponse.json(
            { success: false, error: `Visit ${visit.visitNumber} is ${visit.status.toLowerCase()} and cannot be rescheduled.` },
            { status: 409 }
          );
        }
        // Day-level worker-overlap guard (any slot): catching same-day
        // double-bookings across the assigned crew. Applies to unspawned
        // visits too — their job would eventually collide on that date.
        if (visit.staffIds.length > 0) {
          const conflict = await prisma.job.findFirst({
            where: {
              scheduledDate: body.scheduledDate,
              status: { notIn: ["COMPLETED", "CANCELLED", "CLOSED"] },
              ...(visit.jobId ? { id: { not: visit.jobId } } : {}),
              assignedStaffIds: { hasSome: visit.staffIds },
            },
          });
          if (conflict) {
            return NextResponse.json(
              {
                success: false,
                error: `One of the assigned workers already has an active job on ${body.scheduledDate}. Pick another date or free the worker first.`,
              },
              { status: 409 }
            );
          }
        }
        await prisma.amcVisit.update({
          where: { id: visit.id },
          data: {
            scheduledDate: body.scheduledDate,
            scheduledSlot: body.scheduledSlot ?? visit.scheduledSlot,
            // A reminded visit that gets moved is still a reminded visit —
            // downgrading it to RESCHEDULED would silently drop the reminder.
            status: visit.status === "REMINDED" ? "REMINDED" : "RESCHEDULED",
          },
        });
        await syncVisitJob(visit.id, { scheduledDate: body.scheduledDate, status: "SCHEDULED" });
        if (visit.jobId) void syncJobEvent(visit.jobId).catch(() => {});
        logger.info("amc.visit_rescheduled", { contractId: id, visitId: visit.id, by: user.id });
        void auditAmc(user.id, user.name, "VISIT_RESCHEDULED", id, `Visit ${visit.visitNumber} moved to ${body.scheduledDate}`);
        return NextResponse.json({ success: true });
      }

      case "remind_visit": {
        const visit = await prisma.amcVisit.findFirst({
          where: { id: body.visitId, contractId: id },
        });
        if (!visit) {
          return NextResponse.json({ success: false, error: "Visit not found." }, { status: 404 });
        }
        if (visit.status === "COMPLETED" || visit.status === "CANCELLED") {
          return NextResponse.json(
            { success: false, error: `Visit ${visit.visitNumber} is ${visit.status.toLowerCase()} — no reminder needed.` },
            { status: 409 }
          );
        }
        await prisma.amcVisit.update({
          where: { id: visit.id },
          data: { reminderSentAt: new Date(), status: visit.status === "SCHEDULED" ? "REMINDED" : visit.status },
        });
        logger.info("amc.visit_reminder_marked", { contractId: id, visitId: visit.id, by: user.id });
        void auditAmc(user.id, user.name, "VISIT_REMINDER", id, `Reminder logged for visit ${visit.visitNumber}`);
        return NextResponse.json({ success: true });
      }

      case "complete_visit": {
        const visit = await prisma.amcVisit.findFirst({
          where: { id: body.visitId, contractId: id },
        });
        if (!visit) {
          return NextResponse.json({ success: false, error: "Visit not found." }, { status: 404 });
        }
        // Guard before any spawn/mutation: completing twice must be impossible
        // (a second request would otherwise respawn the job records again).
        if (visit.status === "COMPLETED" || visit.status === "CANCELLED") {
          return NextResponse.json(
            { success: false, error: `Visit ${visit.visitNumber} is ${visit.status.toLowerCase()} and cannot be completed again.` },
            { status: 409 }
          );
        }
        // Spawn the standard execution job on first completion so the visit
        // was actually dispatched through the calendar/field pipeline.
        const spawnOutcome = await spawnVisitJob(id, visit.id, user);
        const completedVisit = await prisma.amcVisit.findUnique({ where: { id: visit.id } });
        // Never let a skipped spawn pass silently — the desk must see why a
        // completed visit has no execution job on the calendar.
        if (spawnOutcome === "service_missing" || spawnOutcome === "service_inactive") {
          logger.warn("amc.visit_completed_without_job", {
            contractId: id,
            visitId: visit.id,
            reason: spawnOutcome,
            by: user.id,
          });
          void auditAmc(
            user.id,
            user.name,
            "VISIT_COMPLETED_NO_JOB",
            id,
            `Visit ${visit.visitNumber} completed WITHOUT an execution job — the contract's service package is ${spawnOutcome === "service_missing" ? "missing" : "inactive"}. Reassign an active service on the contract to enable calendar/field execution.`
          );
        }
        await prisma.amcVisit.update({
          where: { id: visit.id },
          data: {
            status: "COMPLETED",
            arrivedAt: body.arrivedAt ? new Date(body.arrivedAt) : completedVisit?.arrivedAt ?? new Date(),
            completedAt: body.completedAt ? new Date(body.completedAt) : new Date(),
            staffIds: body.staffIds ?? visit.staffIds,
            qcScore: body.qcScore ?? visit.qcScore,
            issuesFound: body.issuesFound ?? visit.issuesFound,
            recommendations: body.recommendations ?? visit.recommendations,
          },
        });
        if (completedVisit?.jobId) {
          await prisma.job
            .update({
              where: { id: completedVisit.jobId },
              data: {
                status: "COMPLETED",
                completedAt: new Date(),
                // Keep the spawned job's crew in lockstep when the desk
                // amended the staff list while recording the visit.
                ...(body.staffIds ? { assignedStaffIds: body.staffIds } : {}),
              },
            })
            .catch(() => {});
        }
        logger.info("amc.visit_completed", { contractId: id, visitId: visit.id, by: user.id });
        void auditAmc(
          user.id,
          user.name,
          "VISIT_COMPLETED",
          id,
          `Visit ${visit.visitNumber} completed${body.qcScore !== undefined && body.qcScore !== null ? ` — QC ${body.qcScore}%` : ""}`
        );
        return NextResponse.json({ success: true });
      }

      case "nri_approval": {
        const visit = await prisma.amcVisit.findFirst({
          where: { id: body.visitId, contractId: id },
        });
        if (!visit) {
          return NextResponse.json({ success: false, error: "Visit not found." }, { status: 404 });
        }
        await prisma.amcVisit.update({
          where: { id: visit.id },
          data: { nriApproved: body.nriApproved, nriNotes: body.nriNotes ?? null },
        });
        void auditAmc(user.id, user.name, "NRI_APPROVAL", id, `Visit ${visit.visitNumber}: ${body.nriApproved ? "approved" : "flagged"} by the NRI owner`);
        return NextResponse.json({ success: true });
      }

      case "update_contract": {
        // Cancelling (or expiring) a contract must tear down the still-pending
        // execution: visits close and their spawned jobs leave the calendar.
        if (body.status === "CANCELLED" || body.status === "EXPIRED") {
          const [openVisits, linkedJobs] = await Promise.all([
            prisma.amcVisit.findMany({
              where: { contractId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
              select: { id: true },
            }),
            // Every job spawned for this contract, whatever the visit state —
            // the updateMany filter keeps terminal jobs untouched (covers a
            // completed visit whose job was reverted by the admin override).
            prisma.amcVisit.findMany({
              where: { contractId: id, jobId: { not: null } },
              select: { jobId: true },
            }),
          ]);
          const jobIds = linkedJobs.map((v) => v.jobId).filter((x): x is string => Boolean(x));
          await prisma.$transaction([
            ...(openVisits.length
              ? [
                  prisma.amcVisit.updateMany({
                    where: { id: { in: openVisits.map((v) => v.id) } },
                    data: { status: "CANCELLED" },
                  }),
                ]
              : []),
            ...(jobIds.length
              ? [
                  prisma.job.updateMany({
                    where: { id: { in: jobIds }, status: { notIn: ["COMPLETED", "CANCELLED", "CLOSED"] } },
                    data: { status: "CANCELLED" },
                  }),
                ]
              : []),
          ]);
        }
        await prisma.amcContract.update({
          where: { id },
          data: {
            ...(body.paymentStatus ? { paymentStatus: body.paymentStatus } : {}),
            ...(body.status ? { status: body.status } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
          },
        });
        void auditAmc(
          user.id,
          user.name,
          "CONTRACT_UPDATED",
          id,
          [body.paymentStatus ? `paymentStatus → ${body.paymentStatus}` : null, body.status ? `status → ${body.status}` : null, body.notes !== undefined ? "notes updated" : null]
            .filter(Boolean)
            .join(" · ") || "contract updated"
        );
        return NextResponse.json({ success: true });
      }
    }
  } catch (err) {
    return errorResponse(err, "amc.patch.route_error");
  }
}
