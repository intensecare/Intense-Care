import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireRole, requireUser, authorizeJobAccess } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import {
  serializeQualityCheck,
  serializeQualityIssue,
  serializeReworkTask,
  serializeComplaint,
  ok,
  fail,
  readJson,
} from "@/lib/server/serialize";
import { logger } from "@/lib/server/logger";
import { recordActivity } from "@/lib/server/activity";

/**
 * GET /api/quality — QC checks, issues, rework tasks, complaints.
 * Staff receive only records for their assigned jobs; managers/admins all.
 */
export async function GET() {
  try {
    const { user } = await requireUser();

    let jobIds: string[] | null = null;
    if (user.role === "staff") {
      const assigned = await prisma.job.findMany({
        where: {
          OR: [{ assignedManagerId: user.id }, { assignedStaffIds: { has: user.id } }],
        },
        select: { id: true },
      });
      jobIds = assigned.map((j) => j.id);
    }

    const [checks, issues, tasks, complaints] = await Promise.all([
      prisma.qualityCheck.findMany({
        where: jobIds ? { jobId: { in: jobIds } } : undefined,
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.qualityIssue.findMany({
        where: jobIds ? { jobId: { in: jobIds } } : undefined,
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.reworkTask.findMany({
        where: jobIds ? { jobId: { in: jobIds } } : undefined,
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.complaint.findMany({
        where: jobIds ? { jobId: { in: jobIds } } : undefined,
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ]);

    return ok({
      qualityChecks: checks.map(serializeQualityCheck),
      qualityIssues: issues.map(serializeQualityIssue),
      reworkTasks: tasks.map(serializeReworkTask),
      complaints: complaints.map(serializeComplaint),
    });
  } catch (err) {
    return errorResponse(err, "quality.get.route_error");
  }
}

const IssueSchema = z.object({
  area: z.string().min(1).max(120),
  itemDescription: z.string().min(1).max(500),
  severity: z.enum(["minor", "major", "critical"]),
  notes: z.string().max(1000).default(""),
  assignedStaffId: z.string().max(64).optional(),
});

const SubmitSchema = z.object({
  action: z.literal("submit-check"),
  jobId: z.string().min(1).max(64),
  score: z.number().int().min(0).max(100),
  decision: z.enum(["PASS", "REWORK_REQUIRED"]),
  notes: z.string().max(2000).default(""),
  issues: z.array(IssueSchema).max(50).default([]),
});

const CompleteReworkSchema = z.object({
  action: z.literal("complete-rework"),
  taskId: z.string().min(1).max(64),
  notes: z.string().max(1000).default(""),
});

const ReinspectSchema = z.object({
  action: z.literal("reinspect-pass"),
  jobId: z.string().min(1).max(64),
  notes: z.string().max(1000).default(""),
});

const ComplaintSchema = z.object({
  action: z.literal("request-attention"),
  jobId: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  category: z.enum(["quality", "punctuality", "staff_behavior", "damage", "missed_area", "billing"]),
});

/**
 * POST /api/quality — QC lifecycle write-through:
 * submit checks (creating issues + rework tasks), complete rework,
 * pass reinspection, and customer attention requests.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = await readJson(request);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "submit-check") {
      const parsed = SubmitSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid QC payload.", 400);
      const d = parsed.data;

      await authorizeJobAccess(d.jobId);
      const job = await prisma.job.findUnique({ where: { id: d.jobId } });
      if (!job) return fail("Job not found.", 404);

      const qc = await prisma.qualityCheck.create({
        data: {
          jobId: d.jobId,
          inspectorId: user.id,
          score: d.score,
          decision: d.decision,
          notes: d.notes,
        },
      });

      if (d.decision === "REWORK_REQUIRED" && d.issues.length > 0) {
        const leadWorker = job.assignedStaffIds[0] ?? "";
        for (const issue of d.issues) {
          const createdIssue = await prisma.qualityIssue.create({
            data: {
              qualityCheckId: qc.id,
              jobId: d.jobId,
              area: issue.area,
              itemDescription: issue.itemDescription,
              severity: issue.severity,
              notes: issue.notes,
              assignedStaffId: issue.assignedStaffId || leadWorker,
              reworkInstructions: issue.notes,
            },
          });
          const task = await prisma.reworkTask.create({
            data: {
              qualityIssueId: createdIssue.id,
              jobId: d.jobId,
              assignedStaffId: issue.assignedStaffId || leadWorker,
              instructions: issue.notes,
            },
          });
          await prisma.qualityIssue.update({
            where: { id: createdIssue.id },
            data: { reworkTaskId: task.id },
          });
        }
        // §19 unified loop: flag → dispatch (notify staff — they act in the
        // field app) so the job lands in REWORK_ASSIGNED, not a limbo state.
        await prisma.job.update({
          where: { id: d.jobId },
          data: { status: "REWORK_ASSIGNED", qualityCheckId: qc.id },
        });
        try {
          const { notifyReworkAssigned } = await import("@/lib/server/notify");
          void notifyReworkAssigned(d.jobId).catch(() => {});
        } catch {
          // notification failure must never fail the QC decision
        }
      } else {
        // §17/§21 unified flow: PASS → the customer's ONE link becomes the
        // handover/approval page; the customer is notified server-side.
        await prisma.job.update({
          where: { id: d.jobId },
          data: { status: "PASS", qualityCheckId: qc.id },
        });
        try {
          const { onQcPassed } = await import("@/lib/server/workflow-service");
          void onQcPassed(d.jobId, { id: user.id, name: user.name }).catch(() => {});
        } catch {
          // handover notification failure must never fail the QC decision
        }
      }

      logger.info("quality.check_submitted", { jobId: d.jobId, decision: d.decision, by: user.id });

      // Supervisor-visible live feed events: the QC verdict and, when rework
      // is required, the exact instructions heading to the field worker.
      await recordActivity({
        jobId: d.jobId,
        type: "QC_SUBMITTED",
        message:
          d.decision === "PASS"
            ? `QC audit PASSED (${d.score}%) — ready for customer sign-off`
            : `QC audit flagged rework (${d.score}%) — ${d.issues.length} defect${d.issues.length === 1 ? "" : "s"} assigned to field staff`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      if (d.decision === "REWORK_REQUIRED") {
        for (const issue of d.issues) {
          await recordActivity({
            jobId: d.jobId,
            type: "REWORK_ASSIGNED",
            message: `Rework assigned [${issue.area}] (${issue.severity}): ${issue.itemDescription}${issue.notes ? ` — ${issue.notes}` : ""}`,
            actor: { id: user.id, name: user.name, role: user.role },
          });
        }
      }

      return ok(serializeQualityCheck(qc), 201);
    }

    if (action === "complete-rework") {
      const parsed = CompleteReworkSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid rework payload.", 400);
      const d = parsed.data;

      // Role separation: rework is EXECUTED by the assigned field worker (or
      // overridden by the owner). The QC desk audits — it never closes its
      // own rework tasks, which used to make the pipeline state confusing.
      if (user.role === "ops_manager") {
        return fail("Rework tasks are completed by the assigned field worker in the Field App.", 403);
      }

      const task = await prisma.reworkTask.findUnique({ where: { id: d.taskId } });
      if (!task) return fail("Rework task not found.", 404);
      await authorizeJobAccess(task.jobId);

      const now = new Date();
      await prisma.$transaction([
        prisma.reworkTask.update({
          where: { id: d.taskId },
          data: { status: "completed", completedAt: now, completedNotes: d.notes },
        }),
        prisma.qualityIssue.updateMany({
          where: { reworkTaskId: d.taskId },
          data: { status: "resolved", resolvedAt: now },
        }),
      ]);

      // Pipeline sync: when the LAST open rework task on the job closes,
      // move the job to REWORK_COMPLETED so the QC queue and the state
      // machine stay truthful (previously the job stayed REWORK_REQUIRED).
      const remaining = await prisma.reworkTask.count({
        where: { jobId: task.jobId, status: { not: "completed" } },
      });
      const job = await prisma.job.findUnique({ where: { id: task.jobId }, select: { status: true } });
      if (remaining === 0 && job && ["REWORK_REQUIRED", "REWORK_COMPLETED"].includes(job.status)) {
        await prisma.job.update({
          where: { id: task.jobId },
          data: { status: "REWORK_COMPLETED", updatedAt: new Date() },
        });
      }

      await recordActivity({
        jobId: task.jobId,
        type: "REWORK_COMPLETED",
        message: `Rework completed: ${task.instructions}${d.notes ? ` — ${d.notes}` : ""}${remaining === 0 ? ". All rework done — awaiting QC reinspection." : ` (${remaining} task${remaining === 1 ? "" : "s"} still open)`}`,
        actor: { id: user.id, name: user.name, role: user.role },
      });

      return ok({ id: d.taskId, status: "completed", jobStatus: remaining === 0 ? "REWORK_COMPLETED" : job?.status });
    }

    if (action === "reinspect-pass") {
      const parsed = ReinspectSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid reinspection payload.", 400);
      const d = parsed.data;

      await authorizeJobAccess(d.jobId);
      const now = new Date();
      // §20/§21 unified flow: reinspection pass lands on PASS first — the
      // customer handover (approval token + invite + notification) is minted
      // server-side, then the pre-existing transition still completes.
      await prisma.job.update({ where: { id: d.jobId }, data: { status: "PASS" } });
      try {
        const { onQcPassed } = await import("@/lib/server/workflow-service");
        await onQcPassed(d.jobId, { id: user.id, name: user.name });
      } catch {
        // handover mint failure must never fail the reinspection
      }
      await prisma.$transaction([
        prisma.job.update({ where: { id: d.jobId }, data: { status: "CUSTOMER_APPROVAL" } }),
        prisma.qualityIssue.updateMany({
          where: { jobId: d.jobId, status: { notIn: ["resolved", "reinspected_pass"] } },
          data: { status: "reinspected_pass", resolvedAt: now },
        }),
      ]);
      await recordActivity({
        jobId: d.jobId,
        type: "QC_SUBMITTED",
        message: `Reinspection passed — handover link sent to customer${d.notes ? ` (${d.notes})` : ""}`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      return ok({ jobId: d.jobId, status: "CUSTOMER_APPROVAL" });
    }

    if (action === "request-attention") {
      const parsed = ComplaintSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid complaint payload.", 400);
      const d = parsed.data;

      const job = await prisma.job.findUnique({ where: { id: d.jobId } });
      if (!job) return fail("Job not found.", 404);

      // Resolve the ops owner dynamically from the user directory.
      const opsManager = await prisma.user.findFirst({
        where: { role: "ops_manager", active: true },
        orderBy: { createdAt: "asc" },
      });

      const complaint = await prisma.complaint.create({
        data: {
          jobId: d.jobId,
          customerId: job.customerId,
          category: d.category,
          severity: "high",
          description: d.description,
          assignedOwnerId: opsManager?.id ?? user.id,
          assignedOwnerName: opsManager?.name ?? "Operations",
        },
      });

      // A customer attention request reopens the job for rework.
      const leadWorker = job.assignedStaffIds[0] ?? "";
      const attentionIssue = await prisma.qualityIssue.create({
        data: {
          qualityCheckId: null, // Customer attention requests don't have a formal QC record
          jobId: d.jobId,
          area: d.category.replace("_", " ").toUpperCase(),
          itemDescription: d.description,
          severity: "critical",
          notes: `Customer attention request: ${d.description}`,
          assignedStaffId: leadWorker,
          reworkInstructions: d.description,
        },
      });
      await prisma.reworkTask.create({
        data: {
          qualityIssueId: attentionIssue.id,
          jobId: d.jobId,
          assignedStaffId: leadWorker,
          instructions: `Customer attention request: ${d.description}`,
        },
      });
      await prisma.job.update({ where: { id: d.jobId }, data: { status: "REWORK_REQUIRED" } });

      await recordActivity({
        jobId: d.jobId,
        type: "ATTENTION_REQUESTED",
        message: `Customer raised an issue (${d.category.replace("_", " ")}): ${d.description} — rework dispatched to field staff`,
        actor: { id: user.id, name: user.name, role: user.role },
      });

      return ok(serializeComplaint(complaint), 201);
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "quality.post.route_error");
  }
}

/** PATCH /api/quality — update a job checklist item's working state. */
export async function PATCH(request: Request) {
  try {
    const { user } = await requireUser();
    const body = (await readJson(request)) || {};
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    if (!itemId) return fail("itemId is required.", 400);

    const item = await prisma.jobChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) return fail("Checklist item not found.", 404);
    await authorizeJobAccess(item.jobId);

    const status = typeof body.status === "string" ? body.status : "pending";
    if (!["pending", "completed", "skipped", "issue"].includes(status)) {
      return fail("Invalid checklist status.", 400);
    }

    const updated = await prisma.jobChecklistItem.update({
      where: { id: itemId },
      data: {
        status,
        skippedReason: typeof body.skippedReason === "string" ? body.skippedReason : undefined,
        issueNotes: typeof body.issueNotes === "string" ? body.issueNotes : undefined,
        photoEvidence: typeof body.photoEvidence === "string" ? body.photoEvidence : undefined,
        completedBy: status === "completed" ? user.name || user.id : undefined,
        completedAt: status === "completed" ? new Date() : undefined,
      },
    });

    // Live feed: report meaningful checklist progress (not unpending noise).
    if (status === "completed") {
      await recordActivity({
        jobId: item.jobId,
        type: "CHECKLIST_UPDATED",
        message: `Checklist item completed [${item.area}]: ${item.task}`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
    } else if (status === "issue") {
      await recordActivity({
        jobId: item.jobId,
        type: "CHECKLIST_UPDATED",
        message: `Issue flagged on checklist item [${item.area}]: ${item.task}${body.issueNotes ? ` — ${body.issueNotes}` : ""}`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
    }

    return ok({ id: updated.id, status: updated.status });
  } catch (err) {
    return errorResponse(err, "quality.patch.route_error");
  }
}
