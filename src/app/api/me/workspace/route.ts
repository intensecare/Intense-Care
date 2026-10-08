import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireUser, jobWhereFor } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { can, getNextAction, workspaceFor, customerStageLabel } from "@/lib/rbac";

/**
 * GET /api/me/workspace — the ONE home payload for the signed-in role.
 *
 *   counts     — the six Operations numbers (within the caller's job scope)
 *   attention  — individual jobs that need someone to act, each with a reason
 *   queue      — the role's open jobs with their ONE next action
 *
 * Money is included only for finance.view holders (Admin).
 */

const ACTIVE = ["ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS"];
const QC_PENDING = ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"];
const REWORK = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];
const APPROVAL = ["PASS", "CUSTOMER_APPROVAL"];
const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];

interface AttentionItem {
  key: string;
  jobId: string | null;
  title: string;
  reason: string;
  href: string;
  tone: "alert" | "warning";
}

export async function GET() {
  try {
    const { user } = await requireUser();
    const ws = workspaceFor(user.role);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const where = await jobWhereFor(user, "jobs.view");
    const jobs = where
      ? await prisma.job.findMany({
          where: { ...where, status: { not: "CANCELLED" } },
          include: {
            customer: { select: { name: true } },
            property: { select: { title: true, city: true } },
            service: { select: { name: true } },
            checklistItems: { select: { status: true, critical: true } },
            photos: { select: { photoType: true } },
            reworkTasks: { select: { status: true } },
          },
          orderBy: [{ scheduledDate: "asc" }, { scheduledTimeSlot: "asc" }],
        })
      : [];

    const open = jobs.filter((j) => !DONE.includes(j.status));
    const isIn = (statuses: string[]) => (j: { status: string }) => statuses.includes(j.status);

    const counts = {
      today: jobs.filter((j) => j.scheduledDate === today).length,
      active: open.filter(isIn(ACTIVE)).length,
      qcPending: open.filter(isIn(QC_PENDING)).length,
      rework: open.filter(isIn(REWORK)).length,
      approvalPending: open.filter(isIn(APPROVAL)).length,
      completed: jobs.filter((j) => DONE.includes(j.status) && (j.approvedAt ?? j.updatedAt).toISOString().slice(0, 10) === today).length,
    };

    const label = (j: (typeof jobs)[number]) => `${j.customer?.name ?? "Customer"} · ${j.service?.name ?? "Service"}`;

    const queue = open.map((j) => {
      const mandatory = j.checklistItems.filter((c) => c.critical);
      const tracked = mandatory.length ? mandatory : j.checklistItems;
      const next = getNextAction(user.role, {
        status: j.status,
        assignedManagerId: j.assignedManagerId,
        assignedStaffIds: j.assignedStaffIds,
        customerConfirmedAt: j.customerConfirmedAt?.toISOString() ?? null,
        checklistTotal: tracked.length,
        checklistDone: tracked.filter((c) => c.status === "completed" || c.status === "skipped").length,
        photosBefore: j.photos.filter((p) => p.photoType === "before").length,
        photosAfter: j.photos.filter((p) => p.photoType === "after").length,
        openRework: j.reworkTasks.filter((t) => t.status !== "completed").length,
        approvedAt: j.approvedAt?.toISOString() ?? null,
        feedbackAt: j.customerFeedbackAt?.toISOString() ?? null,
      });
      return {
        id: j.id,
        status: j.status,
        stage: customerStageLabel(j.status),
        scheduledDate: j.scheduledDate,
        scheduledTimeSlot: j.scheduledTimeSlot,
        customerName: j.customer?.name ?? null,
        propertyTitle: j.property?.title ?? null,
        city: j.property?.city ?? null,
        serviceName: j.service?.name ?? null,
        nextAction: next,
        actionable: Boolean(next && !next.waiting && next.kind !== "view"),
      };
    });

    // Attention Required — one row per job that is stuck or needs a decision.
    const attention: AttentionItem[] = [];
    if (can(user, "jobs.assign")) {
      const soon = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10);
      for (const j of open) {
        const unassigned = !j.assignedManagerId && j.assignedStaffIds.length === 0;
        if (unassigned && j.scheduledDate <= soon) {
          attention.push({ key: `unassigned-${j.id}`, jobId: j.id, title: label(j), reason: j.scheduledDate < today ? "Overdue and has no Field Manager" : "No Field Manager assigned", href: `/jobs/${j.id}`, tone: j.scheduledDate <= today ? "alert" : "warning" });
        } else if (j.status === "ASSIGNED" && j.scheduledDate < today) {
          attention.push({ key: `late-${j.id}`, jobId: j.id, title: label(j), reason: "Scheduled date passed — team never arrived", href: `/jobs/${j.id}`, tone: "alert" });
        }
        if (j.status === "ARRIVED" && !j.customerConfirmedAt && j.arrivedAt && now.getTime() - j.arrivedAt.getTime() > 20 * 60000) {
          attention.push({ key: `confirm-${j.id}`, jobId: j.id, title: label(j), reason: "Customer has not confirmed for 20+ minutes", href: `/jobs/${j.id}`, tone: "warning" });
        }
        if (REWORK.includes(j.status)) {
          attention.push({ key: `rework-${j.id}`, jobId: j.id, title: label(j), reason: "Rework pending", href: `/jobs/${j.id}`, tone: "warning" });
        }
        if (APPROVAL.includes(j.status) && now.getTime() - j.updatedAt.getTime() > 24 * 3600000) {
          attention.push({ key: `approval-${j.id}`, jobId: j.id, title: label(j), reason: "Waiting for customer approval for over a day", href: `/jobs/${j.id}`, tone: "warning" });
        }
      }
    }
    if (can(user, "complaints.manage")) {
      const complaints = await prisma.complaint.findMany({
        where: { status: { notIn: ["resolved", "closed"] } },
        include: { job: { select: { id: true, customer: { select: { name: true } } } } },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      for (const c of complaints) {
        attention.unshift({ key: `complaint-${c.id}`, jobId: c.jobId, title: c.job?.customer?.name ?? "Customer", reason: `Customer issue: ${c.description.slice(0, 80)}`, href: `/jobs/${c.jobId}`, tone: "alert" });
      }
    }

    let finance: { outstanding: number; overdueCount: number; collectedMonth: number } | undefined;
    if (can(user, "finance.view")) {
      const invoices = await prisma.invoice.findMany({ where: { status: { notIn: ["CANCELLED"] } }, select: { balanceDue: true, dueDate: true } });
      const overdue = invoices.filter((i) => i.balanceDue > 0 && i.dueDate < today);
      const paid = await prisma.payment.aggregate({ where: { paidAt: { gte: new Date(`${today.slice(0, 7)}-01`) } }, _sum: { amount: true } });
      finance = {
        outstanding: invoices.reduce((a, i) => a + i.balanceDue, 0),
        overdueCount: overdue.length,
        collectedMonth: paid._sum.amount ?? 0,
      };
      if (overdue.length > 0) {
        attention.push({ key: "overdue", jobId: null, title: "Payments", reason: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}`, href: "/finance", tone: "warning" });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        role: user.role,
        workspace: { title: ws.title, home: ws.home, queue: ws.queue, layout: ws.layout },
        today,
        counts,
        attention,
        queue,
        finance,
      },
    });
  } catch (err) {
    return errorResponse(err, "me.workspace.route_error");
  }
}
