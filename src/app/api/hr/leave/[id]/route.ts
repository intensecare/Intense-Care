import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";

const Decide = z.object({ action: z.enum(["approve", "reject", "cancel"]), note: z.string().trim().max(300).optional() });

/** POST { action: approve | reject | cancel, note? } — a decision is final and records who decided and when. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("leave.manage");
    const parsed = Decide.safeParse(await readJson(request));
    if (!parsed.success) return fail("Unknown action.", 400);
    const { action, note } = parsed.data;
    if (action === "reject" && !note) return fail("Say why the leave is rejected.", 400);
    const l = await prisma.leaveRequest.findUnique({ where: { id: params.id }, include: { employee: { select: { fullName: true } } } });
    if (!l) return fail("Leave request not found.", 404);
    const from = action === "cancel" ? ["PENDING", "APPROVED"] : ["PENDING"];
    const to = action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "CANCELLED";
    const u = await prisma.leaveRequest.updateMany({ where: { id: l.id, status: { in: from } }, data: { status: to, approverId: user.id, approverName: user.name, decidedAt: new Date(), decisionNote: note || null } });
    if (u.count === 0) return fail("This request has already been decided.", 409);
    void recordAudit({ actor: user, action: `LEAVE_${to}`, entityType: "leave", entityId: l.id, previousState: l.status, newState: to, reason: note ?? null, details: `${l.employee.fullName} ${l.startDate}–${l.endDate}`, request });
    return ok({ id: l.id, status: to });
  } catch (err) {
    return errorResponse(err, "hr.leave.action_error");
  }
}
