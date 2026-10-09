import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { csvResponse, isDay, istToday, monthBounds } from "@/lib/server/biz";
import { COUNTED } from "@/lib/server/expenses";
import { referralStats } from "@/lib/server/referrals";
import { syncFreelancePayments } from "@/lib/server/assignments";
import { jobContribution, operatingResult, REPORT_DEFINITIONS, sumInvoices } from "@/lib/profit";
import { categoryLabel, round2 } from "@/lib/business";
import { can } from "@/lib/rbac";

const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`);

/**
 * GET /api/reports/business — money, costs, profitability, staff, HR, freelance and referrals.
 * Filters: from, to, jobId, serviceId, employeeId. `?format=csv&section=jobs|expenses|staff`.
 * Definitions of every figure are returned with the data and printed on the page.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("reports.financial");
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k) || null;
    const today = istToday();
    const def = monthBounds(today.slice(0, 7));
    const from = isDay(g("from")) ? g("from")! : def.start;
    const to = isDay(g("to")) ? g("to")! : def.end;
    if (to < from) return fail("The end date can't be before the start date.", 400);
    if (Date.parse(to) - Date.parse(from) > 800 * 86400000) return fail("Pick a range of up to about two years.", 400);
    const jobId = g("jobId"), serviceId = g("serviceId"), employeeId = g("employeeId");
    const hr = can(user, "hr.manage");

    // Which jobs the filters allow (null = no job-level filter).
    const jobFilter: Prisma.JobWhereInput = {
      ...(jobId ? { id: jobId } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(employeeId ? { assignments: { some: { employeeId, status: { in: ["ASSIGNED", "ACCEPTED", "COMPLETED"] } } } } : {}),
    };
    const filtered = Object.keys(jobFilter).length > 0;
    const allowedJobIds = filtered ? (await prisma.job.findMany({ where: jobFilter, select: { id: true } })).map((j) => j.id) : null;

    await syncFreelancePayments(user);

    /* ----- invoices issued in the period (billed basis) and the money received */
    const invoices = await prisma.invoice.findMany({ where: { status: { not: "CANCELLED" }, issuedAt: { gte: dayStart(from), lte: dayEnd(to) }, ...(allowedJobIds ? { jobId: { in: allowedJobIds } } : {}) }, select: { total: true, subtotal: true, discount: true, amountPaid: true, refundedAmount: true, balanceDue: true, invoiceType: true } });
    const money = sumInvoices(invoices);
    const gstInvoices = invoices.filter((i) => i.invoiceType === "GST");
    const payments = await prisma.payment.aggregate({ where: { paidAt: { gte: dayStart(from), lte: dayEnd(to) }, ...(allowedJobIds ? { jobId: { in: allowedJobIds } } : {}) }, _sum: { amount: true }, _count: true });

    /* ----- costs: approved, non-voided expenses dated in the period */
    const expWhere: Prisma.ExpenseWhereInput = {
      AND: [COUNTED, { date: { gte: from, lte: to } }, allowedJobIds ? (employeeId && !jobId && !serviceId ? { OR: [{ employeeId }, { jobId: { in: allowedJobIds } }] } : { jobId: { in: allowedJobIds } }) : {}],
    };
    const [expAgg, paidAgg, byCat, expRows] = await Promise.all([
      prisma.expense.aggregate({ where: expWhere, _sum: { amount: true, taxAmount: true }, _count: true }),
      prisma.expense.aggregate({ where: { AND: [expWhere, { paymentStatus: "PAID" }] }, _sum: { amount: true } }),
      prisma.expense.groupBy({ by: ["category"], where: expWhere, _sum: { amount: true }, _count: true }),
      prisma.expense.findMany({ where: expWhere, orderBy: { date: "desc" }, take: 5000, select: { expenseNumber: true, date: true, category: true, description: true, amount: true, vendor: true, jobId: true, paymentStatus: true } }),
    ]);
    const counted = round2(expAgg._sum.amount ?? 0);
    const paidOut = round2(paidAgg._sum.amount ?? 0);
    const result = operatingResult({ netRevenue: money.netRevenue, countedExpenses: counted, netCollectedExGst: money.netCollectedExGst, paidExpenses: paidOut });

    /* ----- obligations as of today (not yet expenses) */
    const jobScope = allowedJobIds ? { jobId: { in: allowedJobIds } } : {};
    const [fOwed, payrollDue, refDue, refReview, payable] = await Promise.all([
      prisma.freelancePayment.aggregate({ where: { status: { in: ["PENDING_VERIFICATION", "VERIFIED", "APPROVED"] }, ...jobScope, ...(employeeId ? { employeeId } : {}) }, _sum: { amount: true }, _count: true }),
      filtered ? Promise.resolve({ _sum: { netPayable: 0 }, _count: 0 }) : prisma.payrollRecord.aggregate({ where: { status: "APPROVED" }, _sum: { netPayable: true }, _count: true }),
      filtered ? Promise.resolve({ _sum: { bonusAmount: 0 }, _count: 0 }) : prisma.referral.aggregate({ where: { status: "APPROVED", paymentStatus: "UNPAID" }, _sum: { bonusAmount: true }, _count: true }),
      filtered ? Promise.resolve({ _sum: { bonusAmount: 0 }, _count: 0 }) : prisma.referral.aggregate({ where: { status: "BONUS_REVIEW" }, _sum: { bonusAmount: true }, _count: true }),
      prisma.expense.aggregate({ where: { AND: [COUNTED, { paymentStatus: "PENDING" }, allowedJobIds ? { jobId: { in: allowedJobIds } } : {}] }, _sum: { amount: true }, _count: true }),
    ]);

    /* ----- jobs completed in the period: contribution per job */
    const jobs = await prisma.job.findMany({
      where: { ...jobFilter, status: { in: DONE }, scheduledDate: { gte: from, lte: to } },
      orderBy: { scheduledDate: "desc" },
      take: 500,
      select: { id: true, jobSerial: true, scheduledDate: true, status: true, customer: { select: { name: true } }, service: { select: { name: true } }, invoices: { where: { status: { not: "CANCELLED" } }, select: { total: true, subtotal: true, discount: true, amountPaid: true, refundedAmount: true, balanceDue: true } } },
    });
    const ids = jobs.map((j) => j.id);
    const [jobExp, jobFree] = await Promise.all([
      ids.length ? prisma.expense.groupBy({ by: ["jobId"], where: { AND: [COUNTED, { jobId: { in: ids } }] }, _sum: { amount: true } }) : [],
      ids.length ? prisma.freelancePayment.groupBy({ by: ["jobId"], where: { jobId: { in: ids }, status: { in: ["PENDING_VERIFICATION", "VERIFIED", "APPROVED"] } }, _sum: { amount: true } }) : [],
    ]);
    const em = new Map(jobExp.map((e) => [e.jobId as string, e._sum.amount ?? 0]));
    const fm = new Map(jobFree.map((e) => [e.jobId, e._sum.amount ?? 0]));
    const jobRows = jobs.map((j) => {
      const inv = sumInvoices(j.invoices);
      const c = jobContribution({ revenue: inv.netRevenue, countedExpenses: em.get(j.id) ?? 0, accruedFreelance: fm.get(j.id) ?? 0 });
      return { jobId: j.id, jobNumber: j.jobSerial, date: j.scheduledDate, customer: j.customer.name, service: j.service.name, invoiced: inv.invoiced, collected: inv.netCollected, outstanding: inv.outstanding, ...c };
    });
    const jobTotals = jobContribution({ revenue: jobRows.reduce((a, j) => a + j.revenue, 0), countedExpenses: jobRows.reduce((a, j) => a + (em.get(j.jobId) ?? 0), 0), accruedFreelance: jobRows.reduce((a, j) => a + (fm.get(j.jobId) ?? 0), 0) });

    /* ----- staff, attendance and leave (HR) */
    let staff: unknown[] = [];
    let leaveByType: { type: string; days: number }[] = [];
    if (hr) {
      const assigns = await prisma.jobAssignment.findMany({ where: { status: { in: ["ASSIGNED", "ACCEPTED", "COMPLETED"] }, job: { scheduledDate: { gte: from, lte: to }, status: { not: "CANCELLED" }, ...(jobId ? { id: jobId } : {}), ...(serviceId ? { serviceId } : {}) }, ...(employeeId ? { employeeId } : {}) }, select: { employeeId: true, status: true, expectedHours: true, actualHours: true, jobId: true } });
      const att = await prisma.attendanceRecord.findMany({ where: { date: { gte: from, lte: to }, ...(employeeId ? { employeeId } : {}) }, select: { employeeId: true, status: true } });
      const leaves = await prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: to }, endDate: { gte: from }, ...(employeeId ? { employeeId } : {}) }, select: { employeeId: true, leaveType: true, startDate: true, endDate: true, days: true } });
      const ppl = await prisma.employee.findMany({ where: { id: { in: Array.from(new Set([...assigns.map((a) => a.employeeId), ...att.map((a) => a.employeeId), ...leaves.map((l) => l.employeeId)])) } }, select: { id: true, fullName: true, employeeCode: true, employmentType: true } });
      const lt = new Map<string, number>();
      const clip = (l: (typeof leaves)[number]) => (l.days === 0.5 ? 0.5 : Math.max(0, Math.round((Date.parse(`${l.endDate < to ? l.endDate : to}T00:00:00Z`) - Date.parse(`${l.startDate > from ? l.startDate : from}T00:00:00Z`)) / 86400000) + 1));
      for (const l of leaves) lt.set(l.leaveType, round2((lt.get(l.leaveType) ?? 0) + clip(l)));
      leaveByType = Array.from(lt.entries()).map(([type, days]) => ({ type, days }));
      staff = ppl.map((p) => {
        const a = assigns.filter((x) => x.employeeId === p.id);
        const at = att.filter((x) => x.employeeId === p.id);
        return { employeeId: p.id, name: p.fullName, code: p.employeeCode, type: p.employmentType, jobs: new Set(a.map((x) => x.jobId)).size, completed: a.filter((x) => x.status === "COMPLETED").length, hours: round2(a.reduce((s, x) => s + (x.actualHours ?? x.expectedHours ?? 0), 0)), daysWorked: at.reduce((s, x) => s + (x.status === "PRESENT" ? 1 : x.status === "HALF_DAY" ? 0.5 : 0), 0), absent: at.filter((x) => x.status === "ABSENT").length, leaveDays: round2(leaves.filter((l) => l.employeeId === p.id).reduce((s, l) => s + clip(l), 0)) };
      }).sort((x, y) => (y as { jobs: number }).jobs - (x as { jobs: number }).jobs);
    }

    /* ----- freelance and referrals in the period */
    const fpAll = await prisma.freelancePayment.groupBy({ by: ["status"], where: { createdAt: { gte: dayStart(from), lte: dayEnd(to) }, ...jobScope, ...(employeeId ? { employeeId } : {}) }, _sum: { amount: true }, _count: true });
    const refs = filtered ? null : await referralStats({ referralDate: { gte: from, lte: to } });

    const out = {
      range: { from, to },
      filters: { jobId, serviceId, employeeId },
      note: filtered ? "Filters are on: general overheads (costs not linked to a job) are left out." : null,
      definitions: REPORT_DEFINITIONS,
      money: { ...money, received: round2(payments._sum.amount ?? 0), paymentsCount: payments._count, invoiceCount: invoices.length, gstInvoiceCount: gstInvoices.length, nonGstInvoiceCount: invoices.length - gstInvoices.length, gstInvoiced: round2(gstInvoices.reduce((a, i) => a + i.total, 0)), nonGstInvoiced: round2(invoices.filter((i) => i.invoiceType !== "GST").reduce((a, i) => a + i.total, 0)) },
      costs: { counted, paid: paidOut, count: expAgg._count, tax: round2(expAgg._sum.taxAmount ?? 0), byCategory: byCat.map((c) => ({ category: c.category, label: categoryLabel(c.category), total: round2(c._sum.amount ?? 0), count: c._count })).sort((a, b) => b.total - a.total) },
      obligations: { freelance: { amount: round2(fOwed._sum.amount ?? 0), count: fOwed._count }, payroll: { amount: round2(payrollDue._sum.netPayable ?? 0), count: payrollDue._count }, referralApproved: { amount: round2(refDue._sum.bonusAmount ?? 0), count: refDue._count }, referralInReview: { amount: round2(refReview._sum.bonusAmount ?? 0), count: refReview._count }, expensesPayable: { amount: round2(payable._sum.amount ?? 0), count: payable._count } },
      result,
      jobs: jobRows,
      jobTotals,
      staff: hr ? staff : null,
      leaveByType: hr ? leaveByType : null,
      freelance: Object.fromEntries(fpAll.map((s) => [s.status, { amount: round2(s._sum.amount ?? 0), count: s._count }])),
      referrals: refs,
    };

    const csv = g("format") === "csv" ? g("section") : null;
    if (csv) {
      void recordAudit({ actor: user, action: "REPORT_EXPORTED", entityType: "report", entityId: csv, details: `${from}..${to}`, request });
      if (csv === "jobs") return csvResponse(`job_profitability_${from}_${to}`, jobRows.map((j) => ({ "Job ID": j.jobNumber, Date: j.date, Customer: j.customer, Service: j.service, "Invoiced (incl. GST)": j.invoiced, "Collected (net)": j.collected, Outstanding: j.outstanding, "Revenue (before GST)": j.revenue, "Direct costs": j.directCosts, Contribution: j.contribution, "Margin %": j.marginPercent ?? "" })));
      if (csv === "expenses") return csvResponse(`expenses_by_category_${from}_${to}`, out.costs.byCategory.map((c) => ({ Category: c.label, Count: c.count, Total: c.total })));
      if (csv === "staff" && hr) return csvResponse(`staff_utilization_${from}_${to}`, (staff as { name: string; code: string; type: string; jobs: number; completed: number; hours: number; daysWorked: number; absent: number; leaveDays: number }[]).map((s) => ({ "Employee ID": s.code, Name: s.name, Type: s.type, Jobs: s.jobs, Completed: s.completed, Hours: s.hours, "Days worked": s.daysWorked, Absent: s.absent, "Leave days": s.leaveDays })));
      void expRows;
      return fail("Unknown export.", 400);
    }
    return ok(out);
  } catch (err) {
    return errorResponse(err, "reports.business.get_error");
  }
}
