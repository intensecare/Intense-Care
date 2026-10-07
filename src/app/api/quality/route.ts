import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, authorizeJob, visibleJobIds, requireUser } from "@/lib/server/authz";
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
import { recordAudit } from "@/lib/server/audit";
import { can } from "@/lib/rbac";

/**
 * GET /api/quality — QC checks, issues, rework tasks, complaints, scoped to
 * the jobs the caller may see (qc.view / rework.view / complaints.view).
 */
export async function GET() {
  try {
    const { user } = await requireUser();
    const ids = await visibleJobIds(user, "jobs.view");
    const jobFilter = ids === "ALL" ? undefined : { jobId: { in: ids } };
    const none = { id: "__none__" };

    const [checks, issues, tasks, complaints] = await Promise.all([
      can(user, "qc.view")
        ? prisma.qualityCheck.findMany({ where: jobFilter, orderBy: { createdAt: "desc" }, take: 500 })
        : prisma.qualityCheck.findMany({ where: none }),
      can(user, "qc.view") || can(user, "rework.view")
        ? prisma.qualityIssue.findMany({ where: jobFilter, orderBy: { createdAt: "desc" }, take: 500 })
        : prisma.qualityIssue.findMany({ where: none }),
      can(user, "rework.view")
        ? prisma.reworkTask.findMany({ where: jobFilter, orderBy: { createdAt: "desc" }, take: 500 })
        : prisma.reworkTask.findMany({ where: none }),
      can(user, "complaints.view")
        ? prisma.complaint.findMany({ where: jobFilter, orderBy: { createdAt: "desc" }, take: 500 })
        : prisma.complaint.findMany({ where: none }),
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

const StartSchema = z.object({ action: z.literal("start-inspection"), jobId: z.string().min(1).max(64) });

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

const ReworkDispatchSchema = z.object({ action: z.literal("dispatch-rework"), jobId: z.string().min(1).max(64) });

const ComplaintSchema = z.object({
  action: z.literal("request-attention"),
  jobId: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  category: z.enum(["quality", "punctuality", "staff_behavior", "damage", "missed_area", "billing"]),
});

/** First active user holding the given permission — the owner for complaints. */
async function firstUserWith(permission: "complaints.manage"): Promise<{ id: string; name: string } | null> {
  const { ROLES, scopeOf } = await import("@/lib/rbac");
  const roles = ROLES.filter((r) => scopeOf(r, permission) !== "NONE" && r !== "super_admin");
  const row =
    (await prisma.user.findFirst({ where: { role: { in: roles }, active: true }, orderBy: { createdAt: "asc" } })) ??
    (await prisma.user.findFirst({ where: { role: "super_admin", active: true }, orderBy: { createdAt: "asc" } }));
  return row ? { id: row.id, name: row.name } : null;
}

/**
 * POST /api/quality — QC lifecycle write-through. Every action resolves its
 * permission + job scope through the matrix:
 *   start-inspection  qc.inspect     WORK_COMPLETED → QUALITY_CHECK
 *   submit-check      qc.pass / qc.rework
 *   dispatch-rework   rework.create  REWORK_REQUIRED → REWORK_ASSIGNED
 *   complete-rework   rework.complete (assigned field worker)
 *   reinspect-pass    qc.reinspect
 *   request-attention complaints.create / complaints.manage
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "start-inspection") {
      const parsed = StartSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);
      const { user, job } = await authorizeJob(parsed.data.jobId, "qc.inspect");
      if (job.status !== "WORK_COMPLETED") return fail(`Inspection starts from WORK_COMPLETED (current: ${job.status}).`, 409);
      await prisma.job.update({ where: { id: job.id }, data: { status: "QUALITY_CHECK", updatedAt: new Date() } });
      await recordActivity({ jobId: job.id, type: "STATUS_CHANGED", message: "QC inspection started", actor: { id: user.id, name: user.name, role: user.role } });
      void recordAudit({ actor: user, action: "QC_STARTED", entityType: "job", entityId: job.id, jobId: job.id, previousState: "WORK_COMPLETED", newState: "QUALITY_CHECK", request });
      return ok({ jobId: job.id, status: "QUALITY_CHECK" });
    }

    if (action === "submit-check") {
      const parsed = SubmitSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid QC payload.", 400);
      const d = parsed.data;

      const { user, job } = await authorizeJob(d.jobId, d.decision === "PASS" ? "qc.pass" : "qc.rework");
      if (!["WORK_COMPLETED", "QUALITY_CHECK", "REINSPECTION", "REWORK_COMPLETED"].includes(job.status)) {
        return fail(`A QC decision is not possible while the job is ${job.status}.`, 409);
      }
      if (d.decision === "REWORK_REQUIRED" && d.issues.length === 0) {
        return fail("Add at least one issue to require rework.", 400);
      }

      const qc = await prisma.qualityCheck.create({
        data: { jobId: d.jobId, inspectorId: user.id, score: d.score, decision: d.decision, notes: d.notes },
      });

      if (d.decision === "REWORK_REQUIRED") {
        const leadWorker = job.assignedManagerId ?? job.assignedStaffIds[0] ?? "";
        await prisma.$transaction(async (tx) => {
          for (const issue of d.issues) {
            const createdIssue = await tx.qualityIssue.create({
              data: {
                qualityCheckId: qc.id,
                jobId: d.jobId,
                area: issue.area,
                itemDescription: issue.itemDescription,
                severity: issue.severity,
                notes: issue.notes,
                assignedStaffId: issue.assignedStaffId || leadWorker,
                reworkInstructions: issue.notes || issue.itemDescription,
              },
            });
            const task = await tx.reworkTask.create({
              data: {
                qualityIssueId: createdIssue.id,
                jobId: d.jobId,
                assignedStaffId: issue.assignedStaffId || leadWorker,
                instructions: issue.notes || issue.itemDescription,
              },
            });
            await tx.qualityIssue.update({ where: { id: createdIssue.id }, data: { reworkTaskId: task.id } });
          }
          // Flag → dispatch in one step so the job never idles in REWORK_REQUIRED.
          await tx.job.update({ where: { id: d.jobId }, data: { status: "REWORK_ASSIGNED", qualityCheckId: qc.id } });
        });
        try {
          const { notifyReworkAssigned } = await import("@/lib/server/notify");
          void notifyReworkAssigned(d.jobId).catch(() => {});
        } catch {
          /* notification failure must never fail the QC decision */
        }
      } else {
        await prisma.job.update({ where: { id: d.jobId }, data: { status: "PASS", qualityCheckId: qc.id } });
        try {
          const { onQcPassed } = await import("@/lib/server/workflow-service");
          void onQcPassed(d.jobId, { id: user.id, name: user.name }).catch(() => {});
        } catch {
          /* handover notification failure must never fail the QC decision */
        }
      }

      logger.info("quality.check_submitted", { jobId: d.jobId, decision: d.decision, by: user.id });
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
      void recordAudit({
        actor: user,
        action: d.decision === "PASS" ? "QC_PASSED" : "QC_REWORK_REQUIRED",
        entityType: "qc",
        entityId: qc.id,
        jobId: d.jobId,
        previousState: job.status,
        newState: d.decision === "PASS" ? "PASS" : "REWORK_ASSIGNED",
        details: `score=${d.score} issues=${d.issues.length}`,
        request,
      });

      return ok(serializeQualityCheck(qc), 201);
    }

    if (action === "dispatch-rework") {
      const parsed = ReworkDispatchSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);
      const { user } = await authorizeJob(parsed.data.jobId, "rework.create");
      const { dispatchRework } = await import("@/lib/server/workflow-service");
      const res = await dispatchRework(parsed.data.jobId, { id: user.id, name: user.name, role: user.role });
      if (!res.ok) return fail(res.message, 409);
      void recordAudit({ actor: user, action: "REWORK_DISPATCHED", entityType: "job", entityId: parsed.data.jobId, jobId: parsed.data.jobId, newState: "REWORK_ASSIGNED", request });
      return ok({ jobId: parsed.data.jobId, status: "REWORK_ASSIGNED" });
    }

    if (action === "complete-rework") {
      const parsed = CompleteReworkSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid rework payload.", 400);
      const d = parsed.data;

      const task = await prisma.reworkTask.findUnique({ where: { id: d.taskId } });
      if (!task) return fail("Rework task not found.", 404);
      // rework.complete is ASSIGNED-scoped for field roles: the QC desk never closes its own tasks.
      const { user } = await authorizeJob(task.jobId, "rework.complete");
      if (task.status === "completed") return ok({ id: d.taskId, status: "completed", jobId: task.jobId, alreadyCompleted: true });

      const now = new Date();
      await prisma.$transaction([
        prisma.reworkTask.update({ where: { id: d.taskId }, data: { status: "completed", completedAt: now, completedNotes: d.notes } }),
        prisma.qualityIssue.updateMany({ where: { reworkTaskId: d.taskId }, data: { status: "resolved", resolvedAt: now } }),
      ]);

      const remaining = await prisma.reworkTask.count({ where: { jobId: task.jobId, status: { not: "completed" } } });
      const job = await prisma.job.findUnique({ where: { id: task.jobId }, select: { status: true } });
      if (
        remaining === 0 &&
        job &&
        ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_COMPLETED"].includes(job.status)
      ) {
        await prisma.job.update({ where: { id: task.jobId }, data: { status: "REWORK_COMPLETED", updatedAt: new Date() } });
        try {
          const { notifyQcReady } = await import("@/lib/server/notify");
          void notifyQcReady(task.jobId, undefined, "reinspection").catch(() => {});
        } catch {
          /* best effort */
        }
      } else if (job && job.status === "REWORK_ASSIGNED") {
        await prisma.job.update({ where: { id: task.jobId }, data: { status: "REWORK_IN_PROGRESS", updatedAt: new Date() } });
      }

      await recordActivity({
        jobId: task.jobId,
        type: "REWORK_COMPLETED",
        message: `Rework completed: ${task.instructions}${d.notes ? ` — ${d.notes}` : ""}${remaining === 0 ? ". All rework done — awaiting QC reinspection." : ` (${remaining} task${remaining === 1 ? "" : "s"} still open)`}`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      void recordAudit({ actor: user, action: "REWORK_TASK_COMPLETED", entityType: "rework", entityId: d.taskId, jobId: task.jobId, details: d.notes, request });

      return ok({ id: d.taskId, status: "completed", jobId: task.jobId, jobStatus: remaining === 0 ? "REWORK_COMPLETED" : job?.status });
    }

    if (action === "reinspect-pass") {
      const parsed = ReinspectSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid reinspection payload.", 400);
      const d = parsed.data;

      const { user, job } = await authorizeJob(d.jobId, "qc.reinspect");
      if (!["REWORK_COMPLETED", "REINSPECTION"].includes(job.status)) {
        return fail(`Reinspection applies after rework is completed (current: ${job.status}).`, 409);
      }
      const now = new Date();
      await prisma.job.update({ where: { id: d.jobId }, data: { status: "PASS" } });
      try {
        const { onQcPassed } = await import("@/lib/server/workflow-service");
        await onQcPassed(d.jobId, { id: user.id, name: user.name });
      } catch {
        /* handover mint failure must never fail the reinspection */
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
      void recordAudit({ actor: user, action: "QC_REINSPECTION_PASSED", entityType: "job", entityId: d.jobId, jobId: d.jobId, previousState: job.status, newState: "CUSTOMER_APPROVAL", details: d.notes, request });
      return ok({ jobId: d.jobId, status: "CUSTOMER_APPROVAL" });
    }

    if (action === "request-attention") {
      const parsed = ComplaintSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid complaint payload.", 400);
      const d = parsed.data;

      const { user } = await requireUser();
      const permission = can(user, "complaints.manage") ? "complaints.manage" : "complaints.create";
      const { job } = await authorizeJob(d.jobId, permission);

      const owner = await firstUserWith("complaints.manage");
      const complaint = await prisma.complaint.create({
        data: {
          jobId: d.jobId,
          customerId: job.customerId,
          category: d.category,
          severity: "high",
          description: d.description,
          assignedOwnerId: owner?.id ?? user.id,
          assignedOwnerName: owner?.name ?? "Operations",
        },
      });

      const leadWorker = job.assignedManagerId ?? job.assignedStaffIds[0] ?? "";
      const attentionIssue = await prisma.qualityIssue.create({
        data: {
          qualityCheckId: null,
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
        data: { qualityIssueId: attentionIssue.id, jobId: d.jobId, assignedStaffId: leadWorker, instructions: `Customer attention request: ${d.description}` },
      });
      await prisma.job.update({ where: { id: d.jobId }, data: { status: "REWORK_REQUIRED" } });

      await recordActivity({
        jobId: d.jobId,
        type: "ATTENTION_REQUESTED",
        message: `Customer raised an issue (${d.category.replace("_", " ")}): ${d.description} — rework dispatched to field staff`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      void recordAudit({ actor: user, action: "COMPLAINT_CREATED", entityType: "complaint", entityId: complaint.id, jobId: d.jobId, newState: "REWORK_REQUIRED", details: d.description, request });

      return ok(serializeComplaint(complaint), 201);
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "quality.post.route_error");
  }
}

/** PATCH /api/quality — update a job checklist item's working state (checklist.execute, ASSIGNED). */
export async function PATCH(request: Request) {
  try {
    const body = (await readJson(request)) || {};
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    if (!itemId) return fail("itemId is required.", 400);

    const item = await prisma.jobChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) return fail("Checklist item not found.", 404);
    const { user, job } = await authorizeJob(item.jobId, "checklist.execute");
    if (!["IN_PROGRESS", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_REQUIRED"].includes(job.status)) {
      return fail("The checklist can be executed only while the service is in progress.", 409);
    }

    const status = typeof body.status === "string" ? body.status : "pending";
    if (!["pending", "completed", "skipped", "issue"].includes(status)) return fail("Invalid checklist status.", 400);
    if (status === "skipped" && item.critical && !can(user, "checklist.manage")) {
      return fail("Mandatory items cannot be skipped. Flag an issue instead.", 409);
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

    if (status === "completed") {
      await recordActivity({ jobId: item.jobId, type: "CHECKLIST_UPDATED", message: `Checklist item completed [${item.area}]: ${item.task}`, actor: { id: user.id, name: user.name, role: user.role } });
    } else if (status === "issue") {
      await recordActivity({ jobId: item.jobId, type: "CHECKLIST_UPDATED", message: `Issue flagged on checklist item [${item.area}]: ${item.task}${body.issueNotes ? ` — ${body.issueNotes}` : ""}`, actor: { id: user.id, name: user.name, role: user.role } });
    }

    return ok({ id: updated.id, status: updated.status });
  } catch (err) {
    return errorResponse(err, "quality.patch.route_error");
  }
}
