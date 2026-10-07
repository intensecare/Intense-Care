import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { errorResponse } from "@/lib/server/http";
import type { StaffDirectoryEntry } from "@/lib/types";

/** Job statuses that no longer count as active assignments. */
const TERMINAL_STATUSES = ["COMPLETED", "CLOSED", "CANCELLED"];
const DONE_STATUSES = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];

/**
 * GET /api/users/staff-directory — the field-staff directory for the
 * operations desk (super_admin + ops_manager).
 *
 * Returns every staff account with server-computed details: contact info,
 * assignment statistics (total/active/completed/upcoming/lead), open rework
 * tasks with the QC instructions, photo-evidence counts, and the worker's job
 * history (customer, property, service, slot). Every figure is derived from
 * the database — the client renders it verbatim, nothing is hardcoded.
 *
 * Financial fields (amount, paymentStatus) are deliberately omitted: this is
 * an operational view shared with ops_manager.
 */
export async function GET() {
  try {
    await requirePermission("users.view");

    const staff = await prisma.user.findMany({
      where: { role: { in: ASSIGNABLE_ROLES } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    const staffIds = staff.map((s) => s.id);

    const [jobs, openRework, photoCounts] = await Promise.all([
      prisma.job.findMany({
        // Jobs assigned to at least one staff account — `hasSome: []` with an
        // empty roster matches nothing, so no guard is needed here.
        where: { assignedStaffIds: { hasSome: staffIds } },
        include: {
          customer: { select: { name: true } },
          property: { select: { title: true } },
          service: { select: { name: true } },
        },
        orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
        take: 500,
      }),
      prisma.reworkTask.findMany({
        where: { status: { not: "completed" } },
        select: { id: true, jobId: true, assignedStaffId: true, instructions: true, createdAt: true },
      }),
      prisma.jobPhoto.groupBy({ by: ["uploadedByUserId"], _count: { _all: true } }),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const photosByUser = new Map(photoCounts.map((p) => [p.uploadedByUserId, p._count._all]));

    const data: StaffDirectoryEntry[] = staff.map((s) => {
      const assigned = jobs.filter(
        (j) => Array.isArray(j.assignedStaffIds) && j.assignedStaffIds.includes(s.id)
      );
      const active = assigned.filter((j) => !TERMINAL_STATUSES.includes(j.status));
      const done = assigned.filter((j) => DONE_STATUSES.includes(j.status));
      const upcoming = active.filter((j) => j.scheduledDate >= today);
      const rework = openRework.filter((r) => r.assignedStaffId === s.id);

      return {
        id: s.id,
        name: s.name,
        email: s.email,
        phone: s.phone,
        active: s.active,
        role: s.role,
        createdAt: s.createdAt.toISOString(),
        stats: {
          totalJobs: assigned.length,
          activeJobs: active.length,
          completedJobs: done.length,
          upcomingJobs: upcoming.length,
          leadJobs: assigned.filter((j) => j.assignedStaffIds[0] === s.id).length,
          openReworkTasks: rework.length,
          photosUploaded: photosByUser.get(s.id) ?? 0,
        },
        jobs: assigned.slice(0, 30).map((j) => ({
          id: j.id,
          status: j.status as StaffDirectoryEntry["jobs"][number]["status"],
          scheduledDate: j.scheduledDate,
          scheduledTimeSlot: j.scheduledTimeSlot,
          customerName: j.customer?.name ?? null,
          propertyTitle: j.property?.title ?? null,
          serviceName: j.service?.name ?? null,
          isLead: j.assignedStaffIds[0] === s.id,
          crewSize: j.assignedStaffIds.length,
        })),
        openRework: rework.map((r) => ({
          id: r.id,
          jobId: r.jobId,
          instructions: r.instructions,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return errorResponse(err, "users.staff_directory_details.route_error");
  }
}
