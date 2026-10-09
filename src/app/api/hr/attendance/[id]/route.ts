import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";

const Fix = z.object({
  reason: z.string().trim().min(3, "Say why the record is being corrected.").max(300),
  status: z.enum(["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEKLY_OFF"]).optional(),
  checkIn: z.string().datetime().nullable().optional(),
  checkOut: z.string().datetime().nullable().optional(),
});

/** PATCH — Admin correction. The reason, who and when are kept on the record and in the audit log. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("attendance.correct");
    const parsed = Fix.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid correction.", 400);
    const d = parsed.data;
    const r = await prisma.attendanceRecord.findUnique({ where: { id: params.id } });
    if (!r) return fail("Attendance record not found.", 404);
    const checkIn = d.checkIn === undefined ? r.checkIn : d.checkIn ? new Date(d.checkIn) : null;
    const checkOut = d.checkOut === undefined ? r.checkOut : d.checkOut ? new Date(d.checkOut) : null;
    if (checkIn && checkOut && checkOut < checkIn) return fail("Check-out can't be before check-in.", 400);
    const updated = await prisma.attendanceRecord.update({ where: { id: r.id }, data: { status: d.status ?? r.status, checkIn, checkOut, correctedBy: `${user.id}:${user.name}`, correctedAt: new Date(), correctionReason: d.reason } });
    void recordAudit({ actor: user, action: "ATTENDANCE_CORRECTED", entityType: "attendance", entityId: r.id, jobId: r.jobId, previousState: `${r.status} ${r.checkIn?.toISOString() ?? "-"} → ${r.checkOut?.toISOString() ?? "-"}`, newState: `${updated.status} ${updated.checkIn?.toISOString() ?? "-"} → ${updated.checkOut?.toISOString() ?? "-"}`, reason: d.reason, request });
    return ok({ id: updated.id, status: updated.status });
  } catch (err) {
    return errorResponse(err, "hr.attendance.patch_error");
  }
}
