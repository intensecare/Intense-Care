import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, authorizeJob, visibleJobIds } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { serializeChecklistItem, ok, fail, readJson } from "@/lib/server/serialize";

/**
 * GET /api/checklist — working checklist items for the jobs the caller can
 * see (staff: assigned jobs only; managers/admins: all). Optionally filter
 * with ?jobId=<id>, which enforces job-level access.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("checklist.view");
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (jobId) {
      await authorizeJob(jobId, "checklist.view");
      const items = await prisma.jobChecklistItem.findMany({ where: { jobId }, orderBy: { id: "asc" } });
      return ok(items.map(serializeChecklistItem));
    }

    // Collection scoped to the jobs the caller may see (ASSIGNED / TEAM / OWN / ALL).
    const ids = await visibleJobIds(user, "checklist.view");
    const items = await prisma.jobChecklistItem.findMany({
      where: ids === "ALL" ? undefined : { jobId: { in: ids } },
      orderBy: { id: "asc" },
      take: 2000,
    });
    return ok(items.map(serializeChecklistItem));
  } catch (err) {
    return errorResponse(err, "checklist.get.route_error");
  }
}
