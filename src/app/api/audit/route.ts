import { prisma } from "@/lib/server/prisma";
import { requirePermission, visibleJobIds } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { serializeCommissionEntry, serializeAuditLog, ok, fail, readJson } from "@/lib/server/serialize";
import { settleCommissionForJob } from "@/lib/server/commission";
import { recordAudit } from "@/lib/server/audit";

/**
 * GET /api/audit?jobId=&limit= — the audit trail (§27), newest first.
 * audit.view holders see the company trail; a jobId narrows it to one job and
 * is additionally checked against the caller's job scope. There is NO delete
 * handler on purpose: audit history cannot be removed through the app.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("audit.view");
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId") || undefined;
    const limitParam = parseInt(searchParams.get("limit") || "300", 10);
    const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 300, 1), 1000);

    if (jobId) {
      const ids = await visibleJobIds(user, "jobs.view");
      if (ids !== "ALL" && !ids.includes(jobId)) return ok([]);
    }
    const rows = await prisma.auditLog.findMany({
      where: jobId ? { OR: [{ jobId }, { entityType: "job", entityId: jobId }] } : undefined,
      orderBy: { timestamp: "desc" },
      take: limit,
    });
    return ok(rows.map(serializeAuditLog));
  } catch (err) {
    return errorResponse(err, "audit.get.route_error");
  }
}

/**
 * POST /api/audit — client-originated audit events:
 *   status-audit       any signed-in user records an event about their own action
 *   settle-commission  commission.manage — settles a completed referred job (idempotent)
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "status-audit") {
      const { user } = await requirePermission("dashboard.view");
      const entityType = typeof body?.entityType === "string" ? body.entityType.slice(0, 40) : "job";
      const entityId = typeof body?.entityId === "string" ? body.entityId.slice(0, 64) : "n/a";
      await recordAudit({
        actor: user,
        action: typeof body?.auditAction === "string" ? body.auditAction.slice(0, 80) : "EVENT",
        entityType,
        entityId,
        jobId: entityType === "job" ? entityId : undefined,
        details: typeof body?.details === "string" ? body.details.slice(0, 500) : undefined,
        request,
      });
      return ok({ recorded: true }, 201);
    }

    if (action === "settle-commission") {
      const { user } = await requirePermission("commission.manage");
      const jobId = typeof body?.jobId === "string" ? body.jobId : "";
      if (!jobId) return fail("jobId is required.", 400);
      const entry = await settleCommissionForJob(jobId);
      void recordAudit({ actor: user, action: "COMMISSION_SETTLED", entityType: "commission", entityId: entry.id, jobId, request });
      return ok(serializeCommissionEntry(entry), 201);
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "audit.post.route_error");
  }
}
