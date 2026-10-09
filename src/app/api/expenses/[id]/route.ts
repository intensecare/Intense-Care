import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireAnyPermission, requirePermission, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { ExpenseInput, checkExpenseRules, hydrateExpenses } from "@/lib/server/expenses";
import { can } from "@/lib/rbac";

async function load(id: string, userId: string, full: boolean) {
  const e = await prisma.expense.findUnique({ where: { id } });
  // A Field Manager can't tell another person's expense exists.
  if (!e || (!full && e.createdBy !== userId)) throw new HttpError(404, "Expense not found.");
  return e;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireAnyPermission(["expenses.view", "expenses.manage", "expenses.submit"]);
    const e = await load(params.id, user.id, can(user, "expenses.view") || can(user, "expenses.manage"));
    return ok((await hydrateExpenses([e]))[0]);
  } catch (err) {
    return errorResponse(err, "expenses.detail.route_error");
  }
}

const EditInput = ExpenseInput.partial().omit({ idempotencyKey: true, confirmDuplicate: true });

/** PATCH — Admin edits any open expense; a Field Manager edits their own while it awaits approval. Every change is audited with the old and new values. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireAnyPermission(["expenses.manage", "expenses.submit"]);
    const manage = can(user, "expenses.manage");
    const e = await load(params.id, user.id, manage);
    if (e.voidedAt) return fail("A voided expense can't be changed.", 409);
    if (!manage && e.approvalStatus !== "PENDING_APPROVAL") return fail("This expense has been reviewed and can't be changed. Ask Admin.", 409);
    const parsed = EditInput.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid expense.", 400);
    const d = parsed.data;

    // Paid-out payroll / freelance / referral rows are changed through their own workflow.
    const sourced = !!e.sourceType;
    const allowedForSourced = new Set(["notes", "receiptFileId"]);
    if (sourced && Object.keys(d).some((k) => !allowedForSourced.has(k))) return fail("This expense was created by a payroll, freelance or referral payment. Only the notes and receipt can be edited here.", 409);
    if (!manage && (d.employeeId !== undefined || d.jobId !== undefined)) return fail("Only Admin can change the job or staff link.", 403);

    const next = {
      date: d.date ?? e.date,
      category: (d.category ?? e.category) as typeof e.category,
      amount: d.amount ?? e.amount,
      taxAmount: d.taxAmount ?? e.taxAmount,
    };
    if (!sourced) {
      const rule = checkExpenseRules({ date: next.date, amount: next.amount, taxAmount: next.taxAmount, category: next.category as never });
      if (rule && !(next.category === e.category && /^Freelance|^Referral/.test(rule))) return fail(rule, 400);
    }
    if (d.jobId && !(await prisma.job.findUnique({ where: { id: d.jobId }, select: { id: true } }))) return fail("That job doesn't exist.", 404);
    if (d.employeeId && !(await prisma.employee.findUnique({ where: { id: d.employeeId }, select: { id: true } }))) return fail("That staff member doesn't exist.", 404);
    if (d.receiptFileId && d.receiptFileId !== e.receiptFileId) {
      const f = await prisma.storedFile.findUnique({ where: { id: d.receiptFileId } });
      const used = f ? await prisma.expense.findFirst({ where: { receiptFileId: f.id, id: { not: e.id } }, select: { id: true } }) : null;
      if (!f || f.ownerType !== "expense" || used || (!manage && f.uploadedBy !== user.id)) return fail("That receipt can't be attached.", 400);
    }

    const data = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "string" && v === "" ? null : v]));
    const changes = Object.entries(data).filter(([k, v]) => (e as Record<string, unknown>)[k] !== v);
    if (!changes.length) return ok((await hydrateExpenses([e]))[0]);
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.expense.update({ where: { id: e.id }, data });
      if (data.receiptFileId) await tx.storedFile.update({ where: { id: data.receiptFileId as string }, data: { ownerId: e.id } });
      return u;
    });
    const before = Object.fromEntries(changes.map(([k]) => [k, (e as Record<string, unknown>)[k]]));
    void recordAudit({ actor: user, action: "EXPENSE_UPDATED", entityType: "expense", entityId: e.id, jobId: e.jobId, previousState: JSON.stringify(before).slice(0, 480), newState: JSON.stringify(Object.fromEntries(changes)).slice(0, 480), details: e.expenseNumber, request });
    return ok((await hydrateExpenses([updated]))[0]);
  } catch (err) {
    return errorResponse(err, "expenses.patch.route_error");
  }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3, "Say why it is rejected.").max(300) }),
  z.object({ action: z.literal("void"), reason: z.string().trim().min(3, "Say why it is being voided.").max(300) }),
  z.object({ action: z.literal("mark-paid") }),
]);

/** POST { action: approve | reject | void | mark-paid } — Admin only. State changes are compare-and-set, so a double click or two admins can't apply one twice. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("expenses.manage");
    const parsed = Action.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Unknown action.", 400);
    const a = parsed.data;
    const e = await prisma.expense.findUnique({ where: { id: params.id } });
    if (!e) return fail("Expense not found.", 404);
    const by = `${user.id}:${user.name}`;

    if (a.action === "approve" || a.action === "reject") {
      const r = await prisma.expense.updateMany({
        where: { id: e.id, approvalStatus: "PENDING_APPROVAL", voidedAt: null },
        data: a.action === "approve" ? { approvalStatus: "APPROVED", approvedBy: by, approvedAt: new Date() } : { approvalStatus: "REJECTED", approvedBy: by, approvedAt: new Date(), notes: `${e.notes ? e.notes + "\n" : ""}Rejected: ${a.reason}` },
      });
      if (r.count === 0) return fail("This expense isn't waiting for approval any more.", 409);
      void recordAudit({ actor: user, action: a.action === "approve" ? "EXPENSE_APPROVED" : "EXPENSE_REJECTED", entityType: "expense", entityId: e.id, jobId: e.jobId, previousState: "PENDING_APPROVAL", newState: a.action === "approve" ? "APPROVED" : "REJECTED", reason: a.action === "reject" ? a.reason : null, details: e.expenseNumber ?? "", request });
    } else if (a.action === "void") {
      if (e.sourceType) return fail("This expense belongs to a payroll, freelance or referral payment and can't be voided here.", 409);
      const r = await prisma.expense.updateMany({ where: { id: e.id, voidedAt: null }, data: { voidedAt: new Date(), voidedBy: by, voidReason: a.reason } });
      if (r.count === 0) return fail("This expense is already voided.", 409);
      void recordAudit({ actor: user, action: "EXPENSE_VOIDED", entityType: "expense", entityId: e.id, jobId: e.jobId, previousState: e.approvalStatus, newState: "VOIDED", reason: a.reason, details: `${e.expenseNumber} ₹${e.amount}`, request });
    } else {
      const r = await prisma.expense.updateMany({ where: { id: e.id, paymentStatus: "PENDING", voidedAt: null }, data: { paymentStatus: "PAID" } });
      if (r.count === 0) return fail("This expense is already paid.", 409);
      void recordAudit({ actor: user, action: "EXPENSE_MARKED_PAID", entityType: "expense", entityId: e.id, jobId: e.jobId, previousState: "PENDING", newState: "PAID", details: `${e.expenseNumber} ₹${e.amount}`, request });
    }
    const fresh = await prisma.expense.findUniqueOrThrow({ where: { id: e.id } });
    return ok((await hydrateExpenses([fresh]))[0]);
  } catch (err) {
    return errorResponse(err, "expenses.action.route_error");
  }
}

/** DELETE /api/expenses/[id] — Admin or creator deletes draft/unpaid expense. */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireAnyPermission(["expenses.manage", "expenses.submit"]);
    const manage = can(user, "expenses.manage");
    const e = await load(params.id, user.id, manage);

    if (e.sourceType) {
      return fail(
        "This expense was created automatically by payroll, freelance or referral payment and cannot be deleted here.",
        400
      );
    }

    if (e.paymentStatus === "PAID" && !manage) {
      return fail("Paid expenses cannot be deleted. Please request Admin to void this expense.", 403);
    }

    await prisma.$transaction(async (tx) => {
      if (e.receiptFileId) {
        await tx.storedFile
          .update({
            where: { id: e.receiptFileId },
            data: { ownerId: null },
          })
          .catch(() => null);
      }
      await tx.expense.delete({ where: { id: params.id } });
    });

    void recordAudit({
      actor: user,
      action: "EXPENSE_DELETED",
      entityType: "expense",
      entityId: e.id,
      jobId: e.jobId,
      previousState: `${e.expenseNumber} ₹${e.amount} (${e.approvalStatus})`,
      details: "Expense deleted",
      request,
    });

    return ok({ success: true, message: `Expense ${e.expenseNumber} deleted.` });
  } catch (err) {
    return errorResponse(err, "expenses.delete.route_error");
  }
}

