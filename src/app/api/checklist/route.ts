import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireUser, authorizeJobAccess } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { serializeChecklistItem, ok, fail, readJson } from "@/lib/server/serialize";

/**
 * GET /api/checklist — working checklist items for the jobs the caller can
 * see (staff: assigned jobs only; managers/admins: all). Optionally filter
 * with ?jobId=<id>, which enforces job-level access.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireUser();
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (jobId) {
      await authorizeJobAccess(jobId);
      const items = await prisma.jobChecklistItem.findMany({
        where: { jobId },
        orderBy: { id: "asc" },
      });
      return ok(items.map(serializeChecklistItem));
    }

    if (user.role === "staff") {
      const assigned = await prisma.job.findMany({
        where: {
          OR: [{ assignedManagerId: user.id }, { assignedStaffIds: { has: user.id } }],
        },
        select: { id: true },
      });
      const items = await prisma.jobChecklistItem.findMany({
        where: { jobId: { in: assigned.map((j) => j.id) } },
        orderBy: { id: "asc" },
      });
      return ok(items.map(serializeChecklistItem));
    }

    const items = await prisma.jobChecklistItem.findMany({ orderBy: { id: "asc" }, take: 2000 });
    return ok(items.map(serializeChecklistItem));
  } catch (err) {
    return errorResponse(err, "checklist.get.route_error");
  }
}
