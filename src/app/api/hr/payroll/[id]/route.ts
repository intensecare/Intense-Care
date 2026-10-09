import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { istToday } from "@/lib/server/biz";
import { createSourceExpense } from "@/lib/server/expenses";
import { PAYMENT_METHOD_KEYS } from "@/lib/business";
import { PayrollInput, netPayable } from "@/lib/server/payroll";

/** PATCH — edit a DRAFT record. Approved and paid records are locked. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("payroll.manage");
    const p = await prisma.payrollRecord.findUnique({ where: { id: params.id } });
    if (!p) return fail("Payroll record not found.", 404);
    if (p.status !== "DRAFT") return fail("Only a draft can be edited. Approved and paid records are locked.", 409);
    const parsed = PayrollInput.safeParse({ ...p, ...(await readJson(request)) });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid payroll record.", 400);
    const d = parsed.data;
    const net = netPayable(d);
    if (net < 0) return fail("Deductions and advances are more than the pay.", 400);
    const u = await prisma.payrollRecord.updateMany({ where: { id: p.id, status: "DRAFT" }, data: { basic: d.basic, allowances: d.allowances, deductions: d.deductions, advances: d.advances, bonuses: d.bonuses, netPayable: net, notes: d.notes || null } });
    if (u.count === 0) return fail("This record was approved while you were editing.", 409);
    void recordAudit({ actor: user, action: "PAYROLL_UPDATED", entityType: "payroll", entityId: p.id, previousState: `net ₹${p.netPayable}`, newState: `net ₹${net}`, request });
    return ok({ id: p.id, netPayable: net });
  } catch (err) {
    return errorResponse(err, "hr.payroll.patch_error");
  }
}

/** DELETE — a draft only (nothing was approved or paid). */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("payroll.manage");
    const u = await prisma.payrollRecord.deleteMany({ where: { id: params.id, status: "DRAFT" } });
    if (u.count === 0) return fail("Only a draft can be deleted.", 409);
    void recordAudit({ actor: user, action: "PAYROLL_DRAFT_DELETED", entityType: "payroll", entityId: params.id, request });
    return ok({ id: params.id, deleted: true });
  } catch (err) {
    return errorResponse(err, "hr.payroll.delete_error");
  }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("pay"), paymentMethod: z.enum(PAYMENT_METHOD_KEYS), paymentReference: z.string().trim().max(120).optional(), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
]);

/**
 * POST { action: approve | pay }. Pay adds the STAFF_WAGES expense for the NET amount
 * actually paid now, in the same transaction — once per record. (Record an advance as an
 * expense when it is given; payroll then deducts it, so it is counted once.)
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("payroll.manage");
    const parsed = Action.safeParse(await readJson(request));
    if (!parsed.success) return fail("Unknown action.", 400);
    const a = parsed.data;
    const p = await prisma.payrollRecord.findUnique({ where: { id: params.id }, include: { employee: { select: { fullName: true, employeeCode: true } } } });
    if (!p) return fail("Payroll record not found.", 404);
    const by = `${user.id}:${user.name}`;
    if (a.action === "approve") {
      const u = await prisma.payrollRecord.updateMany({ where: { id: p.id, status: "DRAFT" }, data: { status: "APPROVED", approvedBy: by, approvedAt: new Date() } });
      if (u.count === 0) return fail("This record isn't a draft any more.", 409);
      void recordAudit({ actor: user, action: "PAYROLL_APPROVED", entityType: "payroll", entityId: p.id, previousState: "DRAFT", newState: "APPROVED", details: `${p.employee.fullName} ${p.period} ₹${p.netPayable}`, request });
    } else {
      if (p.netPayable <= 0) return fail("There is nothing to pay on this record.", 409);
      try {
        await prisma.$transaction(async (tx) => {
          const c = await tx.payrollRecord.updateMany({ where: { id: p.id, status: "APPROVED" }, data: { status: "PAID", paidBy: by, paidAt: new Date(), paymentMethod: a.paymentMethod, paymentReference: a.paymentReference || null } });
          if (c.count === 0) throw Object.assign(new Error("not payable"), { code: "NOT_PAYABLE" });
          const e = await createSourceExpense(tx, { sourceType: "PAYROLL", sourceId: p.id, category: "STAFF_WAGES", amount: p.netPayable, date: a.paidOn ?? istToday(), description: `Salary ${p.period} — ${p.employee.fullName} (${p.employee.employeeCode})`, paymentMethod: a.paymentMethod, reference: a.paymentReference ?? null, employeeId: p.employeeId, paidBy: user.name, createdBy: user.id });
          await tx.payrollRecord.update({ where: { id: p.id }, data: { expenseId: e.id } });
        });
      } catch (e) {
        if ((e as { code?: string }).code === "NOT_PAYABLE" || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) return fail("This payroll record has already been paid, or isn't approved yet.", 409);
        throw e;
      }
      void recordAudit({ actor: user, action: "PAYROLL_PAID", entityType: "payroll", entityId: p.id, previousState: "APPROVED", newState: "PAID", details: `${p.employee.fullName} ${p.period} ₹${p.netPayable} via ${a.paymentMethod}`, request });
    }
    return ok({ id: p.id });
  } catch (err) {
    return errorResponse(err, "hr.payroll.action_error");
  }
}
