import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireUser, jobWhereFor, dispatchWindowApplies } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import { dispatchCutoffTime } from "@/lib/server/policy";
import { can, getNextAction, workspaceFor, customerStageLabel, customerFeatures } from "@/lib/rbac";

/**
 * GET /api/me/workspace — the ONE home payload for the signed-in role (§18/§29).
 *
 * Answers "what needs my attention?" server-side so every workspace home
 * renders from one scoped call:
 *   counts     — today's jobs by stage (within the caller's jobs.view scope)
 *   attention  — items that need this role to act, each with a deep link
 *   queue      — the role's primary queue (jobs + their next action)
 * Financial figures are included only for finance.view holders.
 */
export async function GET() {
  try {
    const { user } = await requireUser();
    const ws = workspaceFor(user.role);
    const today = new Date().toISOString().slice(0, 10);

    const where = await jobWhereFor(user, "jobs.view");
    let jobs = where
      ? await prisma.job.findMany({
          where,
          include: {
            customer: { select: { name: true } },
            property: { select: { title: true, address: true, city: true } },
            service: { select: { name: true } },
            checklistItems: { select: { status: true, critical: true } },
            photos: { select: { photoType: true } },
            reworkTasks: { select: { status: true } },
            invoices: { select: { balanceDue: true, finalizedAt: true, dueDate: true, status: true } },
          },
          orderBy: [{ scheduledDate: "asc" }, { scheduledTimeSlot: "asc" }],
        })
      : [];
    if (dispatchWindowApplies(user)) {
      const visibility = getOpsDateVisibility(new Date(), { nextDayDispatchTime: dispatchCutoffTime() });
      jobs = filterJobsForOpsManager(jobs, visibility);
    }

    const active = jobs.filter((j) => !["CLOSED", "CANCELLED"].includes(j.status));
    const todayJobs = active.filter((j) => j.scheduledDate === today);
    const byStatus = (statuses: string[]) => active.filter((j) => statuses.includes(j.status)).length;

    const counts = {
      today: todayJobs.length,
      scheduled: byStatus(["DRAFT", "SCHEDULED"]),
      assigned: byStatus(["ASSIGNED"]),
      inProgress: byStatus(["ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS"]),
      qcPending: byStatus(["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"]),
      rework: byStatus(["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"]),
      approvalPending: byStatus(["PASS", "CUSTOMER_APPROVAL"]),
      completed: active.filter((j) => ["COMPLETED", "FEEDBACK_REQUESTED"].includes(j.status)).length,
    };

    const queue = active.map((j) => {
      const mandatory = j.checklistItems.filter((c) => c.critical);
      const invoice = j.invoices[0];
      const next = getNextAction(user.role, {
        status: j.status,
        assignedManagerId: j.assignedManagerId,
        assignedStaffIds: j.assignedStaffIds,
        customerConfirmedAt: j.customerConfirmedAt?.toISOString() ?? null,
        checklistTotal: mandatory.length || j.checklistItems.length,
        checklistDone: (mandatory.length ? mandatory : j.checklistItems).filter((c) => c.status === "completed" || c.status === "skipped").length,
        photosBefore: j.photos.filter((p) => p.photoType === "before").length,
        photosAfter: j.photos.filter((p) => p.photoType === "after").length,
        openRework: j.reworkTasks.filter((t) => t.status !== "completed").length,
        balanceDue: invoice?.balanceDue ?? 0,
        invoiceFinalized: Boolean(invoice?.finalizedAt),
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

    const attention: { key: string; label: string; count: number; href: string }[] = [];
    const push = (key: string, label: string, count: number, href: string) => {
      if (count > 0) attention.push({ key, label, count, href });
    };
    if (can(user, "jobs.assign")) push("unassigned", "Jobs without a team", byStatus(["SCHEDULED", "DRAFT"]), ws.layout === "desk" ? "/dispatcher" : ws.queue);
    if (can(user, "qc.inspect")) push("qc", "QC pending", counts.qcPending, "/quality-queue");
    else if (can(user, "qc.view") && ws.layout === "desk") push("qc", "QC pending", counts.qcPending, "/quality");
    if (can(user, "rework.view") && ws.layout === "desk") push("rework", "Rework in progress", counts.rework, "/quality");
    if (can(user, "complaints.manage")) {
      const openComplaints = await prisma.complaint.count({ where: { status: { notIn: ["resolved", "closed"] } } });
      push("complaints", "Customer issues", openComplaints, "/quality");
    }
    if (can(user, "customer_approval.view") && ws.layout === "desk") push("approval", "Waiting for customer approval", counts.approvalPending, "/jobs?status=CUSTOMER_APPROVAL");
    if (can(user, "amc.view") && ws.layout === "desk") {
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const amcDue = await prisma.amcVisit.count({ where: { status: { in: ["SCHEDULED", "REMINDED"] }, scheduledDate: { lte: in7 } } });
      push("amc", "AMC visits due this week", amcDue, "/amc");
    }

    let finance: Record<string, number> | undefined;
    if (can(user, "finance.view")) {
      const invoices = await prisma.invoice.findMany({ where: { status: { notIn: ["CANCELLED"] } }, select: { total: true, amountPaid: true, balanceDue: true, dueDate: true, status: true } });
      const overdue = invoices.filter((i) => i.balanceDue > 0 && i.dueDate < today);
      finance = {
        outstanding: invoices.reduce((a, i) => a + i.balanceDue, 0),
        collected: invoices.reduce((a, i) => a + i.amountPaid, 0),
        pending: invoices.filter((i) => i.balanceDue > 0).reduce((a, i) => a + i.balanceDue, 0),
        overdueCount: overdue.length,
        overdueAmount: overdue.reduce((a, i) => a + i.balanceDue, 0),
        pendingCount: invoices.filter((i) => i.balanceDue > 0).length,
        revenueMonth: 0,
      };
      const monthStart = `${today.slice(0, 7)}-01`;
      const paid = await prisma.payment.aggregate({ where: { paidAt: { gte: new Date(monthStart) } }, _sum: { amount: true } });
      finance.revenueMonth = paid._sum.amount ?? 0;
      push("overdue", "Overdue invoices", finance.overdueCount, "/finance?filter=overdue");
      if (can(user, "refund.approve")) {
        const pendingRefunds = await prisma.refund.count({ where: { status: "PENDING_APPROVAL" } });
        push("refunds", "Refunds awaiting approval", pendingRefunds, "/finance?filter=refunds");
      }
    } else if (can(user, "refund.approve")) {
      const pendingRefunds = await prisma.refund.count({ where: { status: "PENDING_APPROVAL" } });
      push("refunds", "Refunds awaiting approval", pendingRefunds, "/finance?filter=refunds");
    }

    // Customer-profile capabilities (AMC / NRI) for the customer role.
    let features: { amc: boolean; nri: boolean } | undefined;
    if (user.customerId) {
      const contracts = await prisma.amcContract.findMany({ where: { customerId: user.customerId }, select: { status: true, nriContactPhone: true, nriContactEmail: true } });
      features = customerFeatures(contracts);
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
        features,
      },
    });
  } catch (err) {
    return errorResponse(err, "me.workspace.route_error");
  }
}
