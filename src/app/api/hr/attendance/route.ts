import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requireAnyPermission, requirePermission, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { csvResponse, isMonth, monthBounds, istToday, isDay } from "@/lib/server/biz";
import { teamEmployeeIds, dayWeight } from "@/lib/server/hr";
import { can } from "@/lib/rbac";
import { ATTENDANCE_STATUSES } from "@/lib/business";

const label = (k: string) => ATTENDANCE_STATUSES.find((s) => s.key === k)?.label ?? k;

/**
 * GET /api/hr/attendance?month=YYYY-MM | ?date=YYYY-MM-DD [&employeeId] — records
 * plus a per-person summary (days present, half days, absent, approved leave).
 * Admin sees all staff; a Field Manager sees only staff on their jobs.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireAnyPermission(["attendance.record", "attendance.correct", "hr.manage"]);
    const url = new URL(request.url);
    const month = url.searchParams.get("month");
    const date = url.searchParams.get("date");
    const employeeId = url.searchParams.get("employeeId");
    const full = can(user, "attendance.correct") || can(user, "hr.manage");
    const allowed = full ? null : await teamEmployeeIds(user.id);
    const range = isDay(date) ? { start: date, end: date } : isMonth(month) ? monthBounds(month) : monthBounds(istToday().slice(0, 7));
    const where: Prisma.AttendanceRecordWhereInput = { date: { gte: range.start, lte: range.end }, ...(employeeId ? { employeeId } : {}), ...(allowed ? { employeeId: employeeId ? (allowed.includes(employeeId) ? employeeId : "__none__") : { in: allowed } } : {}) };
    const rows = await prisma.attendanceRecord.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 2000, include: { employee: { select: { fullName: true, employeeCode: true, employmentType: true } }, job: { select: { jobSerial: true } } } });
    const leaves = await prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: range.end }, endDate: { gte: range.start }, ...(allowed ? { employeeId: { in: allowed } } : {}), ...(employeeId ? { employeeId } : {}) }, select: { employeeId: true, startDate: true, endDate: true } });
    const summary = new Map<string, { employeeId: string; name: string; code: string; present: number; half: number; absent: number; leaveDays: number }>();
    const row = (id: string, name: string, code: string) => summary.get(id) ?? (summary.set(id, { employeeId: id, name, code, present: 0, half: 0, absent: 0, leaveDays: 0 }), summary.get(id)!);
    const marked = new Set<string>();
    for (const r of rows) {
      const s = row(r.employeeId, r.employee.fullName, r.employee.employeeCode);
      marked.add(`${r.employeeId}|${r.date}`);
      if (r.status === "PRESENT") s.present++;
      else if (r.status === "HALF_DAY") s.half++;
      else if (r.status === "ABSENT") s.absent++;
      else if (r.status === "LEAVE") s.leaveDays++;
    }
    if (full) {
      // Approved leave counts as leave on days that have no attendance record.
      const names = await prisma.employee.findMany({ where: { id: { in: Array.from(new Set(leaves.map((l) => l.employeeId))) } }, select: { id: true, fullName: true, employeeCode: true } });
      const nm = new Map(names.map((n) => [n.id, n]));
      for (const l of leaves) {
        const n = nm.get(l.employeeId);
        if (!n) continue;
        const s = row(l.employeeId, n.fullName, n.employeeCode);
        for (let d = new Date(`${l.startDate > range.start ? l.startDate : range.start}T00:00:00Z`); d.toISOString().slice(0, 10) <= (l.endDate < range.end ? l.endDate : range.end); d = new Date(d.getTime() + 86400000)) {
          if (!marked.has(`${l.employeeId}|${d.toISOString().slice(0, 10)}`)) s.leaveDays++;
        }
      }
    }
    const records = rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeCode: r.employee.employeeCode, date: r.date, checkIn: r.checkIn?.toISOString() ?? null, checkOut: r.checkOut?.toISOString() ?? null, status: r.status, jobId: r.jobId, jobNumber: r.job?.jobSerial ?? null, verificationMethod: r.verificationMethod, verificationRef: r.verificationRef, notes: r.notes, corrected: !!r.correctedAt, correctionReason: r.correctionReason }));
    if (url.searchParams.get("format") === "csv") {
      if (!full) throw new HttpError(403, "Your role is not authorized for this action.");
      return csvResponse(`attendance_${range.start}_${range.end}`, records.map((r) => ({ Date: r.date, "Employee ID": r.employeeCode, Name: r.employeeName, Status: label(r.status), "Check-in": r.checkIn ?? "", "Check-out": r.checkOut ?? "", Job: r.jobNumber ?? "", Verification: r.verificationMethod, Corrected: r.corrected ? "yes" : "no", Reason: r.correctionReason ?? "" })));
    }
    return ok({ range, records, summary: Array.from(summary.values()).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ ...s, daysWorked: s.present + s.half * 0.5 })) });
  } catch (err) {
    return errorResponse(err, "hr.attendance.get_error");
  }
}

const Record = z.object({
  employeeId: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(["check-in", "check-out", "mark"]),
  status: z.enum(["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEKLY_OFF"]).optional(),
  jobId: z.string().max(64).optional().nullable(),
  verificationMethod: z.enum(["NONE", "GPS", "QR", "MANUAL"]).default("NONE"),
  verificationRef: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

/**
 * POST — record attendance. check-in / check-out / mark never overwrite an
 * existing record (a second tap is refused); changing a record needs an Admin
 * correction with a reason. Job-location verification is stored as a reference
 * only — it is never treated as proof of attendance by itself.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("attendance.record");
    const parsed = Record.safeParse(await readJson(request));
    if (!parsed.success) return fail("Check the details and try again.", 400);
    const d = parsed.data;
    const admin = can(user, "attendance.correct");
    const today = istToday();
    if (d.date > today) return fail("Attendance can't be recorded for a future date.", 400);
    if (!admin) {
      if (d.date !== today) return fail("Field Managers record today's attendance only. Ask Admin to record or correct earlier days.", 403);
      if (!(await teamEmployeeIds(user.id)).includes(d.employeeId)) return fail("That staff member isn't on one of your jobs.", 403);
      if (d.action === "mark" && d.status && !["PRESENT", "ABSENT", "HALF_DAY"].includes(d.status)) return fail("Choose present, half day or absent.", 400);
    }
    const emp = await prisma.employee.findUnique({ where: { id: d.employeeId }, select: { id: true, status: true, fullName: true } });
    if (!emp) return fail("Staff member not found.", 404);
    if (emp.status === "EXITED") return fail("This person has left. Their record is closed.", 409);
    if (d.jobId) {
      const onJob = await prisma.jobAssignment.findFirst({ where: { jobId: d.jobId, employeeId: d.employeeId, status: { notIn: ["REMOVED", "DECLINED"] } }, select: { id: true } });
      if (!onJob) return fail("That staff member isn't assigned to this job.", 400);
    }
    const now = new Date();
    const base = { jobId: d.jobId || null, verificationMethod: d.verificationMethod, verificationRef: d.verificationRef || null, notes: d.notes || null };
    try {
      let rec;
      if (d.action === "check-in" || d.action === "mark") {
        rec = await prisma.attendanceRecord.create({ data: { employeeId: d.employeeId, date: d.date, status: d.action === "check-in" ? "PRESENT" : d.status ?? "PRESENT", checkIn: d.action === "check-in" ? now : null, recordedBy: user.id, ...base } });
      } else {
        const u = await prisma.attendanceRecord.updateMany({ where: { employeeId: d.employeeId, date: d.date, checkIn: { not: null }, checkOut: null }, data: { checkOut: now } });
        if (u.count === 0) return fail("There is no open check-in to close for this person today.", 409);
        rec = await prisma.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: d.employeeId, date: d.date } } });
      }
      void recordAudit({ actor: user, action: `ATTENDANCE_${d.action.toUpperCase().replace("-", "_")}`, entityType: "attendance", entityId: rec.id, jobId: rec.jobId, newState: rec.status, details: `${emp.fullName} ${d.date}`, request });
      return ok({ id: rec.id, status: rec.status, checkIn: rec.checkIn?.toISOString() ?? null, checkOut: rec.checkOut?.toISOString() ?? null, weight: dayWeight(rec.status) }, 201);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(`${emp.fullName} already has attendance recorded for ${d.date}. Ask Admin for a correction.`, 409);
      throw e;
    }
  } catch (err) {
    return errorResponse(err, "hr.attendance.post_error");
  }
}
