import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { istToday } from "@/lib/server/biz";
import { createSourceExpense } from "@/lib/server/expenses";
import { PAYMENT_METHOD_KEYS, round2 } from "@/lib/business";

const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), hours: z.number().min(0.25, "Enter the hours worked.").max(100).optional(), notes: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3, "Say why it is rejected.").max(300) }),
  z.object({ action: z.literal("pay"), paymentMethod: z.enum(PAYMENT_METHOD_KEYS), paymentReference: z.string().trim().max(120).optional(), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
]);

/**
 * POST { action: verify | approve | reject | pay }.
 *   PENDING_VERIFICATION → verify (work confirmed; hours entered for hourly pay; the amount is recomputed here)
 *   VERIFIED → approve → pay (adds the FREELANCE_PAYMENTS expense once, in one transaction).
 * Every step is compare-and-set and audited with who and when.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("freelance.manage");
    const parsed = Action.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Unknown action.", 400);
    const a = parsed.data;
    const p = await prisma.freelancePayment.findUnique({ where: { id: params.id }, include: { employee: { select: { fullName: true, employeeCode: true } }, job: { select: { jobSerial: true, status: true } }, assignment: { select: { status: true } } } });
    if (!p) return fail("Payment not found.", 404);
    const by = `${user.id}:${user.name}`;
    const log = (action: string, from: string, to: string, extra?: { reason?: string; details?: string }) =>
      recordAudit({ actor: user, action, entityType: "freelance_payment", entityId: p.id, jobId: p.jobId, previousState: from, newState: to, reason: extra?.reason ?? null, details: extra?.details ?? `${p.paymentNumber} ${p.employee.fullName} ${p.job.jobSerial} ₹${p.amount}`, request });

    if (a.action === "verify") {
      if (!DONE.includes(p.job.status)) return fail("The job isn't completed yet, so the work can't be verified.", 409);
      let hours = p.hours;
      let amount = p.amount;
      if (p.rateType === "HOURLY") {
        hours = a.hours ?? p.hours;
        if (!hours || hours <= 0) return fail("Enter the hours worked — this freelancer is paid per hour.", 400);
        amount = round2(p.rate * hours);
      }
      const u = await prisma.freelancePayment.updateMany({ where: { id: p.id, status: "PENDING_VERIFICATION" }, data: { status: "VERIFIED", verifiedBy: by, verifiedAt: new Date(), hours, amount, notes: a.notes ?? p.notes } });
      if (u.count === 0) return fail("This payment isn't waiting for verification any more.", 409);
      if (p.rateType === "HOURLY") await prisma.jobAssignment.update({ where: { id: p.assignmentId }, data: { actualHours: hours } });
      void log("FREELANCE_VERIFIED", "PENDING_VERIFICATION", "VERIFIED", { details: `${p.paymentNumber} ${p.job.jobSerial} ${hours ?? ""}h ₹${amount}` });
    } else if (a.action === "approve") {
      const u = await prisma.freelancePayment.updateMany({ where: { id: p.id, status: "VERIFIED" }, data: { status: "APPROVED", approvedBy: by, approvedAt: new Date() } });
      if (u.count === 0) return fail("This payment must be verified before it can be approved.", 409);
      void log("FREELANCE_APPROVED", "VERIFIED", "APPROVED");
    } else if (a.action === "reject") {
      const u = await prisma.freelancePayment.updateMany({ where: { id: p.id, status: { in: ["PENDING_VERIFICATION", "VERIFIED", "APPROVED"] } }, data: { status: "REJECTED", rejectionReason: a.reason } });
      if (u.count === 0) return fail("This payment can't be rejected now.", 409);
      void log("FREELANCE_REJECTED", p.status, "REJECTED", { reason: a.reason });
    } else {
      if (p.amount <= 0) return fail("There is nothing to pay.", 409);
      try {
        await prisma.$transaction(async (tx) => {
          const e = await createSourceExpense(tx, { sourceType: "FREELANCE", sourceId: p.id, category: "FREELANCE_PAYMENTS", amount: p.amount, date: a.paidOn ?? istToday(), description: `Freelance payment ${p.paymentNumber} — ${p.employee.fullName} (${p.job.jobSerial})`, paymentMethod: a.paymentMethod, reference: a.paymentReference ?? null, employeeId: p.employeeId, jobId: p.jobId, paidBy: user.name, createdBy: user.id });
          // The expense goes in first: the database refuses a PAID record without one, and its unique source key stops a second payment.
          const c = await tx.freelancePayment.updateMany({ where: { id: p.id, status: "APPROVED" }, data: { status: "PAID", paidBy: by, paidAt: new Date(), paymentMethod: a.paymentMethod, paymentReference: a.paymentReference || null, expenseId: e.id } });
          if (c.count === 0) throw Object.assign(new Error("not payable"), { code: "NOT_PAYABLE" });
        });
      } catch (e) {
        if ((e as { code?: string }).code === "NOT_PAYABLE" || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) return fail("This payment has already been recorded, or isn't approved yet.", 409);
        throw e;
      }
      void log("FREELANCE_PAID", "APPROVED", "PAID", { details: `${p.paymentNumber} ₹${p.amount} via ${a.paymentMethod}` });
    }
    return ok({ id: p.id });
  } catch (err) {
    return errorResponse(err, "hr.freelance.action_error");
  }
}
