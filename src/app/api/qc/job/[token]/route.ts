import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { resolveQrToken, mintQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { recordActivity } from "@/lib/server/activity";
import { logger } from "@/lib/server/logger";
import { onQcPassed } from "@/lib/server/workflow-service";
import { notifyReworkAssigned } from "@/lib/server/notify";

/**
 * /qc/job/{token} API — §17, §18, §20, §27, §30.
 *
 * Purpose scopes: QC_INSPECTION and REINSPECTION only. The inspector sees
 * checklist + before/after evidence + open issues + rework history, then
 * issues [PASS] or [REWORK REQUIRED]. Every decision is one authoritative
 * transition; duplicates are idempotent no-ops. No finance data is exposed.
 */

function fail(error: string, status: number, kind?: string) {
  return NextResponse.json({ success: false, error, ...(kind ? { kind } : {}) }, { status });
}

export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`qc:${clientIp(request)}`, 90, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const resolved = await resolveQrToken(params.token, ["QC_INSPECTION", "REINSPECTION"]);
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { tokenRow, job } = resolved.data;

    const [checklist, photos, issues, reworkTasks, qcHistory, jobRow] = await Promise.all([
      prisma.jobChecklistItem.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } }),
      prisma.jobPhoto.findMany({ where: { jobId: job.id }, orderBy: { uploadedAt: "asc" } }),
      prisma.qualityIssue.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } }),
      prisma.reworkTask.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } }),
      prisma.qualityCheck.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } }),
      prisma.job.findUnique({
        where: { id: job.id },
        select: { status: true, completedAt: true, notes: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        purpose: tokenRow.purpose,
        job: {
          id: job.id,
          status: jobRow?.status ?? job.status,
          serviceName: (await prisma.service.findUnique({ where: { id: job.serviceId }, select: { name: true } }))?.name ?? "Service",
          scheduledDate: job.scheduledDate,
          completedAt: jobRow?.completedAt?.toISOString() ?? null,
          internalNotes: jobRow?.notes ?? null, // QC sees internal notes
        },
        property: { title: job.propertyName, address: job.propertyAddress },
        customerName: job.customerName, // display only; no contact details
        checklist: checklist.map((c) => ({
          id: c.id,
          area: c.area,
          task: c.task,
          critical: c.critical,
          status: c.status,
          issueNotes: c.issueNotes,
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
        issues: issues.map((i) => ({
          id: i.id,
          area: i.area,
          itemDescription: i.itemDescription,
          severity: i.severity,
          notes: i.notes,
          status: i.status,
          reworkTaskId: i.reworkTaskId,
          createdAt: i.createdAt.toISOString(),
        })),
        rework: reworkTasks.map((r) => ({
          id: r.id,
          instructions: r.instructions,
          status: r.status,
          completedNotes: r.completedNotes,
          completedAt: r.completedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        qcHistory: qcHistory.map((q) => ({
          id: q.id,
          score: q.score,
          decision: q.decision,
          notes: q.notes,
          createdAt: q.createdAt.toISOString(),
        })),
      },
    });
  } catch (err) {
    logger.error("qc.job.get.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Failed to load the inspection.", 500);
  }
}

const DecideSchema = z.object({
  score: z.number().int().min(0).max(100),
  notes: z.string().max(2000).default(""),
  issues: z
    .array(
      z.object({
        area: z.string().min(1).max(120),
        problem: z.string().min(1).max(500),
        severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
        comment: z.string().max(1000).optional(),
      })
    )
    .max(50)
    .default([]),
});

export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`qc-post:${clientIp(request)}`, 30, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";

    const resolved = await resolveQrToken(params.token, ["QC_INSPECTION", "REINSPECTION"]);
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { tokenRow, job } = resolved.data;
    const actor = { id: `qr:${tokenRow.id}`, name: "QC Inspector (secure link)", role: "qc-link" };
    const jobRow = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true } });
    if (!jobRow) return fail("Job not found.", 404);

    /* ---------------- §17/§18 PASS ---------------- */
    if (action === "pass") {
      if (!["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"].includes(jobRow.status)) {
        return fail(`Inspection applies from WORK_COMPLETED/REINSPECTION (current: ${jobRow.status}).`, 409);
      }
      const parsed = DecideSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid decision payload.", 400);

      const now = new Date();
      const qc = await prisma.qualityCheck.create({
        data: {
          jobId: job.id,
          inspectorId: actor.id,
          score: parsed.data.score,
          decision: "PASS",
          notes: parsed.data.notes || (jobRow.status === "REINSPECTION" ? "Reinspection passed." : "Quality check passed."),
        },
      });
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "PASS", qualityCheckId: qc.id, updatedAt: now },
      });
      // Resolve any lingering issues as reinspected_pass.
      await prisma.qualityIssue.updateMany({
        where: { jobId: job.id, status: { notIn: ["resolved", "reinspected_pass"] } },
        data: { status: "reinspected_pass", resolvedAt: now },
      });
      await recordActivity({
        jobId: job.id,
        type: "QC_SUBMITTED",
        message: `QC PASSED (${parsed.data.score}%) via secure QC link${parsed.data.notes ? ` — ${parsed.data.notes}` : ""}`,
        actor,
      });
      // §21 — handover: mint approval link + notify customer.
      void onQcPassed(job.id, { name: actor.name }).catch(() => {});
      return NextResponse.json({ success: true, data: { status: "PASS", qcId: qc.id } });
    }

    /* ---------------- §18 REWORK REQUIRED ---------------- */
    if (action === "rework") {
      if (!["WORK_COMPLETED", "QUALITY_CHECK", "REINSPECTION"].includes(jobRow.status)) {
        if (["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_COMPLETED"].includes(jobRow.status)) {
          return NextResponse.json({ success: true, data: { alreadyFlagged: true, status: jobRow.status } });
        }
        return fail(`Rework decision applies from an inspection stage (current: ${jobRow.status}).`, 409);
      }
      const parsed = DecideSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid decision payload.", 400);
      if (parsed.data.issues.length === 0) {
        return fail("At least one issue (area, problem, severity) is required to flag rework.", 400);
      }

      const now = new Date();
      const qc = await prisma.qualityCheck.create({
        data: {
          jobId: job.id,
          inspectorId: actor.id,
          score: parsed.data.score,
          decision: "REWORK_REQUIRED",
          notes: parsed.data.notes || null,
        },
      });

      const lead = await prisma.job.findUnique({ where: { id: job.id }, select: { assignedStaffIds: true } });
      const leadId = lead?.assignedStaffIds[0] ?? null;

      for (const issue of parsed.data.issues) {
        const created = await prisma.qualityIssue.create({
          data: {
            qualityCheckId: qc.id,
            jobId: job.id,
            area: issue.area,
            itemDescription: issue.problem,
            severity: issue.severity.toLowerCase(), // LOW/MEDIUM/HIGH → minor/major/critical mapping below
            notes: issue.comment ?? "",
            assignedStaffId: leadId,
            reworkInstructions: issue.comment ?? issue.problem,
          },
        });
        const task = await prisma.reworkTask.create({
          data: {
            qualityIssueId: created.id,
            jobId: job.id,
            assignedStaffId: leadId,
            instructions: `[${issue.area}] (${issue.severity.toLowerCase()}) ${issue.problem}${issue.comment ? ` — ${issue.comment}` : ""}`,
          },
        });
        await prisma.qualityIssue.update({ where: { id: created.id }, data: { reworkTaskId: task.id } });
        await recordActivity({
          jobId: job.id,
          type: "REWORK_ASSIGNED",
          message: `Rework assigned [${issue.area}] (${issue.severity.toLowerCase()}): ${issue.problem}`,
          actor,
        });
      }

      const reinspection = tokenRow.purpose === "REINSPECTION";
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "REWORK_REQUIRED", qualityCheckId: qc.id, updatedAt: now },
      });
      // Dispatch: REWORK_REQUIRED → REWORK_ASSIGNED with notification + link.
      const link = await mintQrToken(job.id, "REWORK", { name: actor.name });
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "REWORK_ASSIGNED", updatedAt: new Date() },
      });
      if (link.success) void notifyReworkAssigned(job.id, link.data.linkUrl).catch(() => {});
      else void notifyReworkAssigned(job.id).catch(() => {});

      await recordActivity({
        jobId: job.id,
        type: "QC_SUBMITTED",
        message: `${reinspection ? "Reinspection" : "QC"} flagged REWORK (${parsed.data.score}%) — ${parsed.data.issues.length} defect${parsed.data.issues.length === 1 ? "" : "s"}, dispatched to field staff`,
        actor,
      });

      return NextResponse.json(
        { success: true, data: { status: "REWORK_ASSIGNED", qcId: qc.id, issueCount: parsed.data.issues.length } },
        { status: 201 }
      );
    }

    /* ---------------- §20 REINSPECTION PASS (from rework loop) ---------------- */
    if (action === "reinspect-pass") {
      if (jobRow.status !== "REINSPECTION" && jobRow.status !== "REWORK_COMPLETED") {
        return fail(`Reinspection pass applies from REWORK_COMPLETED/REINSPECTION (current: ${jobRow.status}).`, 409);
      }
      const now = new Date();
      const qc = await prisma.qualityCheck.create({
        data: {
          jobId: job.id,
          inspectorId: actor.id,
          score: typeof body?.score === "number" ? Math.min(100, Math.max(0, Math.round(body.score))) : 100,
          decision: "PASS",
          notes: "Reinspection passed — corrective work verified.",
        },
      });
      await prisma.$transaction([
        prisma.job.update({
          where: { id: job.id },
          data: { status: "PASS", qualityCheckId: qc.id, updatedAt: now },
        }),
        prisma.qualityIssue.updateMany({
          where: { jobId: job.id, status: { notIn: ["resolved", "reinspected_pass"] } },
          data: { status: "reinspected_pass", resolvedAt: now },
        }),
      ]);
      await recordActivity({
        jobId: job.id,
        type: "QC_SUBMITTED",
        message: "Reinspection passed via secure QC link — corrective work verified",
        actor,
      });
      void onQcPassed(job.id, { name: actor.name }).catch(() => {});
      return NextResponse.json({ success: true, data: { status: "PASS" } });
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    logger.error("qc.job.post.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Action failed due to a server error.", 500);
  }
}
