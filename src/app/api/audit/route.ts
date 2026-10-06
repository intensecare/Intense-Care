import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireRole, requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import {
  serializeCommissionEntry,
  serializeAuditLog,
  ok,
  fail,
  readJson,
} from "@/lib/server/serialize";
import { settleCommissionForJob } from "@/lib/server/commission";
import { logger } from "@/lib/server/logger";

/**
 * GET /api/audit — recent audit trail (super_admin ONLY), newest first.
 */
export async function GET() {
  try {
    await requireRole(["super_admin"]);
    const rows = await prisma.auditLog.findMany({ orderBy: { timestamp: "desc" }, take: 300 });
    return ok(rows.map(serializeAuditLog));
  } catch (err) {
    return errorResponse(err, "audit.get.route_error");
  }
}

/**
 * POST /api/audit — operational write-through actions that don't fit other
 * resources. Currently: settle-commission (called when a job COMPLETES with
 * referral attribution) and status-audit (records arbitrary state changes).
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const action = typeof body?.action === "string" ? body.action : "";

    // Staff may record operational audit entries for their own actions
    // (status transitions, notification events) but never touch commission settlement.
    if (action === "status-audit") {
      const { user } = await requireUser();
      const entityType = typeof body?.entityType === "string" ? body.entityType.slice(0, 40) : "job";
      const entityId = typeof body?.entityId === "string" ? body.entityId.slice(0, 64) : "";
      const detail = typeof body?.details === "string" ? body.details.slice(0, 500) : "";
      const evt = await prisma.auditLog.create({
        data: {
          entityType,
          entityId: entityId || "n/a",
          action: typeof body?.auditAction === "string" ? body.auditAction.slice(0, 80) : "EVENT",
          performedBy: `${user.id}:${user.name}`,
          details: detail,
        },
      });
      return ok(serializeAuditLog(evt), 201);
    }

    const { user } = await requireRole(["super_admin", "ops_manager"]);

    if (action === "settle-commission") {
      const jobId = typeof body?.jobId === "string" ? body.jobId : "";
      if (!jobId) return fail("jobId is required.", 400);

      const entry = await settleCommissionForJob(jobId);
      return ok(serializeCommissionEntry(entry), 201);
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "audit.post.route_error");
  }
}
