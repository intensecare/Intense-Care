import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { csvResponse, parsePaging } from "@/lib/server/biz";
import { syncFreelancePayments } from "@/lib/server/assignments";
import { freelanceStatusLabel, round2 } from "@/lib/business";

const include = { employee: { select: { fullName: true, employeeCode: true } }, job: { select: { jobSerial: true, scheduledDate: true, service: { select: { name: true } } } } } as const;

/**
 * GET /api/hr/freelance-payments — what freelancers are owed for completed jobs, and what has been paid.
 * Payment records appear by themselves when a job a freelancer worked is completed.
 * Filters: status, employeeId, jobId, page. `?format=csv` exports.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("freelance.manage");
    await syncFreelancePayments(user);
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k);
    const where: Prisma.FreelancePaymentWhereInput = { ...(g("status") ? { status: g("status")! } : {}), ...(g("employeeId") ? { employeeId: g("employeeId")! } : {}), ...(g("jobId") ? { jobId: g("jobId")! } : {}) };
    const map = (r: Prisma.FreelancePaymentGetPayload<{ include: typeof include }>) => ({ id: r.id, paymentNumber: r.paymentNumber, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeCode: r.employee.employeeCode, jobId: r.jobId, jobNumber: r.job.jobSerial, jobDate: r.job.scheduledDate, service: r.job.service.name, rateType: r.rateType, rate: r.rate, hours: r.hours, amount: r.amount, status: r.status, verifiedAt: r.verifiedAt?.toISOString() ?? null, verifiedBy: r.verifiedBy?.slice(r.verifiedBy.indexOf(":") + 1) ?? null, approvedAt: r.approvedAt?.toISOString() ?? null, approvedBy: r.approvedBy?.slice(r.approvedBy.indexOf(":") + 1) ?? null, paidAt: r.paidAt?.toISOString() ?? null, paymentMethod: r.paymentMethod, paymentReference: r.paymentReference, rejectionReason: r.rejectionReason, notes: r.notes });
    if (g("format") === "csv") {
      const rows = (await prisma.freelancePayment.findMany({ where, orderBy: { createdAt: "desc" }, include, take: 5000 })).map(map);
      return csvResponse("freelance_payments", rows.map((r) => ({ "Payment ID": r.paymentNumber, Freelancer: r.employeeName, "Freelancer ID": r.employeeCode, Job: r.jobNumber, "Job date": r.jobDate, Rate: `${r.rateType} ${r.rate}`, Hours: r.hours ?? "", Amount: r.amount, Status: freelanceStatusLabel(r.status), "Paid on": r.paidAt?.slice(0, 10) ?? "", "Paid by": r.paymentMethod ?? "", Reference: r.paymentReference ?? "" })));
    }
    const { page, pageSize, skip, take } = parsePaging(url);
    const [rows, total, sums] = await Promise.all([prisma.freelancePayment.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include }), prisma.freelancePayment.count({ where }), prisma.freelancePayment.groupBy({ by: ["status"], where, _sum: { amount: true }, _count: true })]);
    return ok({ rows: rows.map(map), total, page, pageSize, totals: Object.fromEntries(sums.map((s) => [s.status, { amount: round2(s._sum.amount ?? 0), count: s._count }])) });
  } catch (err) {
    return errorResponse(err, "hr.freelance.get_error");
  }
}
