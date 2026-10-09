import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { csvResponse, isMonth, monthBounds, parsePaging } from "@/lib/server/biz";
import { dayWeight } from "@/lib/server/hr";
import { PayrollInput, netPayable } from "@/lib/server/payroll";
import { round2 } from "@/lib/business";

/**
 * GET /api/hr/payroll — payroll records (payroll.manage only). Filters: period, employeeId, status.
 * `?suggest=1&employeeId=…&period=YYYY-MM` proposes the basic amount from the agreed pay and attendance.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("payroll.manage");
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k);
    if (g("suggest")) {
      const period = g("period");
      if (!isMonth(period) || !g("employeeId")) return fail("Pick an employee and a month.", 400);
      const e = await prisma.employee.findUnique({ where: { id: g("employeeId")! }, select: { payType: true, payRate: true, employmentType: true } });
      if (!e) return fail("Staff member not found.", 404);
      const b = monthBounds(period);
      const att = await prisma.attendanceRecord.findMany({ where: { employeeId: g("employeeId")!, date: { gte: b.start, lte: b.end } }, select: { status: true, checkIn: true, checkOut: true } });
      const days = att.reduce((a, r) => a + dayWeight(r.status), 0);
      const hours = att.reduce((a, r) => a + (r.checkIn && r.checkOut ? (r.checkOut.getTime() - r.checkIn.getTime()) / 3600000 : 0), 0);
      const rate = e.payRate ?? 0;
      const basic = e.payType === "MONTHLY" ? rate : e.payType === "DAILY" ? rate * days : e.payType === "HOURLY" ? rate * hours : 0;
      return ok({ basic: round2(basic), payType: e.payType, rate, daysWorked: days, hoursWorked: round2(hours), note: e.payType === "PER_JOB" ? "Paid per job — enter the amount." : e.payType ? "From the agreed pay and this month's attendance. Check it before saving." : "No agreed pay is set for this person." });
    }
    const where: Prisma.PayrollRecordWhereInput = { ...(g("period") ? { period: g("period")! } : {}), ...(g("employeeId") ? { employeeId: g("employeeId")! } : {}), ...(g("status") ? { status: g("status")! } : {}) };
    const { page, pageSize, skip, take } = parsePaging(url);
    const include = { employee: { select: { fullName: true, employeeCode: true, employmentType: true } } };
    if (g("format") === "csv") {
      const rows = await prisma.payrollRecord.findMany({ where, orderBy: [{ period: "desc" }], include, take: 5000 });
      void recordAudit({ actor: user, action: "PAYROLL_EXPORTED", entityType: "payroll", entityId: "export", details: `${rows.length} rows`, request });
      return csvResponse("payroll", rows.map((r) => ({ Period: r.period, "Employee ID": r.employee.employeeCode, Name: r.employee.fullName, Basic: r.basic, Allowances: r.allowances, Bonuses: r.bonuses, Deductions: r.deductions, Advances: r.advances, "Net payable": r.netPayable, Status: r.status, "Paid on": r.paidAt?.toISOString().slice(0, 10) ?? "" })));
    }
    const [rows, total, sums] = await Promise.all([prisma.payrollRecord.findMany({ where, orderBy: [{ period: "desc" }, { createdAt: "desc" }], skip, take, include }), prisma.payrollRecord.count({ where }), prisma.payrollRecord.groupBy({ by: ["status"], where, _sum: { netPayable: true }, _count: true })]);
    return ok({
      rows: rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeCode: r.employee.employeeCode, period: r.period, basic: r.basic, allowances: r.allowances, deductions: r.deductions, advances: r.advances, bonuses: r.bonuses, netPayable: r.netPayable, status: r.status, notes: r.notes, approvedBy: r.approvedBy?.slice(r.approvedBy.indexOf(":") + 1) ?? null, paidAt: r.paidAt?.toISOString() ?? null, paymentMethod: r.paymentMethod })),
      total, page, pageSize,
      totals: Object.fromEntries(sums.map((s) => [s.status, { amount: round2(s._sum.netPayable ?? 0), count: s._count }])),
    });
  } catch (err) {
    return errorResponse(err, "hr.payroll.get_error");
  }
}

const Create = PayrollInput.extend({ employeeId: z.string().min(1).max(64), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the pay month.") });

/** POST — a DRAFT payroll record for one person and month (one per person per month). Freelancers are paid through Freelance payments, not payroll. */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("payroll.manage");
    const parsed = Create.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid payroll record.", 400);
    const d = parsed.data;
    const emp = await prisma.employee.findUnique({ where: { id: d.employeeId }, select: { fullName: true, employmentType: true } });
    if (!emp) return fail("Staff member not found.", 404);
    if (emp.employmentType === "FREELANCE") return fail("Freelancers are paid per job under HR → Freelance payments, not through payroll.", 409);
    const net = netPayable(d);
    if (net < 0) return fail("Deductions and advances are more than the pay. Reduce them or the net payable would be negative.", 400);
    const b = monthBounds(d.period);
    try {
      const created = await prisma.payrollRecord.create({ data: { employeeId: d.employeeId, period: d.period, periodStart: b.start, periodEnd: b.end, basic: d.basic, allowances: d.allowances, deductions: d.deductions, advances: d.advances, bonuses: d.bonuses, netPayable: net, notes: d.notes || null, createdBy: user.id } });
      void recordAudit({ actor: user, action: "PAYROLL_CREATED", entityType: "payroll", entityId: created.id, newState: "DRAFT", details: `${emp.fullName} ${d.period} net ₹${net}`, request });
      return ok({ id: created.id, netPayable: net }, 201);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(`${emp.fullName} already has a payroll record for ${d.period}.`, 409);
      throw e;
    }
  } catch (err) {
    return errorResponse(err, "hr.payroll.post_error");
  }
}
