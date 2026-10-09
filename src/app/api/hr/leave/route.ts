import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { inclusiveDays, parsePaging } from "@/lib/server/biz";

export async function GET(request: Request) {
  try {
    await requirePermission("leave.manage");
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const employeeId = url.searchParams.get("employeeId");
    const where = { ...(status ? { status } : {}), ...(employeeId ? { employeeId } : {}) };
    const { page, pageSize, skip, take } = parsePaging(url);
    const [rows, total, pending] = await Promise.all([
      prisma.leaveRequest.findMany({ where, orderBy: [{ startDate: "desc" }], skip, take, include: { employee: { select: { fullName: true, employeeCode: true } } } }),
      prisma.leaveRequest.count({ where }),
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
    ]);
    return ok({ rows: rows.map((l) => ({ id: l.id, employeeId: l.employeeId, employeeName: l.employee.fullName, employeeCode: l.employee.employeeCode, leaveType: l.leaveType, startDate: l.startDate, endDate: l.endDate, days: l.days, reason: l.reason, status: l.status, approverName: l.approverName, decidedAt: l.decidedAt?.toISOString() ?? null, decisionNote: l.decisionNote })), total, page, pageSize, pending });
  } catch (err) {
    return errorResponse(err, "hr.leave.get_error");
  }
}

const Create = z.object({
  employeeId: z.string().min(1).max(64),
  leaveType: z.enum(["CASUAL", "SICK", "PAID", "UNPAID", "OTHER"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first day."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the last day."),
  halfDay: z.boolean().default(false),
  reason: z.string().trim().min(3, "Give a reason.").max(300),
});

/** POST — Admin records a leave request for a staff member (staff don't sign in). It stays PENDING until decided. */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("leave.manage");
    const parsed = Create.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid leave request.", 400);
    const d = parsed.data;
    if (d.endDate < d.startDate) return fail("The last day can't be before the first day.", 400);
    if (d.halfDay && d.startDate !== d.endDate) return fail("A half-day leave is for a single day.", 400);
    const days = d.halfDay ? 0.5 : inclusiveDays(d.startDate, d.endDate);
    if (days > 90) return fail("A single leave request can cover at most 90 days.", 400);
    const emp = await prisma.employee.findUnique({ where: { id: d.employeeId }, select: { id: true, fullName: true, status: true, employmentType: true } });
    if (!emp) return fail("Staff member not found.", 404);
    if (emp.status === "EXITED") return fail("This person has left.", 409);
    const clash = await prisma.leaveRequest.findFirst({ where: { employeeId: d.employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: d.endDate }, endDate: { gte: d.startDate } }, select: { startDate: true, endDate: true, status: true } });
    if (clash) return fail(`They already have ${clash.status.toLowerCase()} leave from ${clash.startDate} to ${clash.endDate}.`, 409);
    const { halfDay: _h, ...rest } = d;
    const created = await prisma.leaveRequest.create({ data: { ...rest, days, requestedBy: user.id } });
    void recordAudit({ actor: user, action: "LEAVE_REQUESTED", entityType: "leave", entityId: created.id, newState: "PENDING", details: `${emp.fullName} ${d.startDate}–${d.endDate} (${days} d)`, request });
    return ok({ id: created.id }, 201);
  } catch (err) {
    return errorResponse(err, "hr.leave.post_error");
  }
}
