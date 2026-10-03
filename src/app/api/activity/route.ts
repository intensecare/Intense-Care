import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { serializeActivityEvent } from "@/lib/server/activity";

/**
 * GET /api/activity?jobId=...&limit=... — live pipeline activity feed.
 *
 * - Managers/admins: all events (optionally filtered to one job for the job
 *   record's Audit tab).
 * - Staff: only events for jobs they are assigned to (their own work log and
 *   QC feedback on it), never the whole company feed.
 *
 * Consumed by the Quality page's live feed (poll) and the job record's
 * Audit Log tab.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireUser();
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId") || undefined;
    const limitParam = parseInt(searchParams.get("limit") || "60", 10);
    const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 60, 1), 200);

    const where: Record<string, unknown> = jobId ? { jobId } : {};

    // Staff see only the activity of jobs they are assigned to (their own
    // work log and the QC feedback on it) — never the whole company feed.
    if (user.role === "staff") {
      const assigned = await prisma.job.findMany({
        where: {
          OR: [{ assignedManagerId: user.id }, { assignedStaffIds: { has: user.id } }],
        },
        select: { id: true },
      });
      const allowedIds = assigned.map((j) => j.id);
      if (jobId && !allowedIds.includes(jobId)) {
        return NextResponse.json({ success: true, data: [] });
      }
      where.jobId = jobId ?? { in: allowedIds };
    }

    const events = await prisma.jobActivityEvent.findMany({
      where: where as { jobId?: string | { in: string[] } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ success: true, data: events.map(serializeActivityEvent) });
  } catch (err) {
    return errorResponse(err, "activity.get.route_error");
  }
}
