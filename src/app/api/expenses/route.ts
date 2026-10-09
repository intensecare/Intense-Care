import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requireAnyPermission, authorizeJob, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { csvResponse, nextExpenseNumber, parsePaging } from "@/lib/server/biz";
import { ExpenseInput, checkExpenseRules, expenseWhere, filtersFromUrl, hydrateExpenses, expenseSummary } from "@/lib/server/expenses";
import { categoryLabel, methodLabel } from "@/lib/business";
import { can } from "@/lib/rbac";

/**
 * GET /api/expenses — Admin sees every expense; a Field Manager sees only the
 * ones they submitted. Filters: from, to, category, jobId, paymentStatus,
 * approvalStatus, q, includeVoided; sort=date|amount|createdAt&dir=asc|desc;
 * page / pageSize. `?format=csv` exports the filtered list (Admin).
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireAnyPermission(["expenses.view", "expenses.manage", "expenses.submit"]);
    const full = can(user, "expenses.view") || can(user, "expenses.manage");
    const url = new URL(request.url);
    const where = expenseWhere(filtersFromUrl(url), full ? {} : { createdBy: user.id });
    const sortKey = url.searchParams.get("sort");
    const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
    const orderBy: Prisma.ExpenseOrderByWithRelationInput[] = sortKey === "amount" ? [{ amount: dir }, { createdAt: "desc" }] : sortKey === "createdAt" ? [{ createdAt: dir }] : [{ date: dir }, { createdAt: "desc" }];

    if (url.searchParams.get("format") === "csv") {
      if (!full) throw new HttpError(403, "Your role is not authorized for this action.");
      const rows = await hydrateExpenses(await prisma.expense.findMany({ where, orderBy, take: 5000 }));
      void recordAudit({ actor: user, action: "EXPENSES_EXPORTED", entityType: "expense", entityId: "export", details: `${rows.length} rows`, request });
      return csvResponse(
        `expenses_${url.searchParams.get("from") ?? "all"}_${url.searchParams.get("to") ?? "all"}`,
        rows.map((r) => ({ "Expense ID": r.expenseNumber, Date: r.date, Category: categoryLabel(r.category), Description: r.description, Vendor: r.vendor ?? "", "Amount (incl. tax)": r.amount, "Tax amount": r.taxAmount, "Payment method": methodLabel(r.paymentMethod), "Payment status": r.paymentStatus, Approval: r.approvalStatus, "Paid by": r.paidBy ?? "", Job: r.jobNumber ?? "", Staff: r.employeeName ?? "", Source: r.source?.type ?? "", Voided: r.voided ? "yes" : "no", "Created by": r.createdByName ?? "", "Created date": r.createdAt.slice(0, 10) }))
      );
    }

    const { page, pageSize, skip, take } = parsePaging(url);
    const [rows, total] = await Promise.all([prisma.expense.findMany({ where, orderBy, skip, take }), prisma.expense.count({ where })]);
    const summary = full ? await expenseSummary(where) : null;
    const pending = full ? await prisma.expense.count({ where: { approvalStatus: "PENDING_APPROVAL", voidedAt: null } }) : 0;
    return ok({ rows: await hydrateExpenses(rows), total, page, pageSize, summary, pendingApproval: pending });
  } catch (err) {
    return errorResponse(err, "expenses.get.route_error");
  }
}

/** POST /api/expenses — Admin records an expense; a Field Manager submits one for approval. */
export async function POST(request: Request) {
  try {
    const { user } = await requireAnyPermission(["expenses.manage", "expenses.submit"]);
    const manage = can(user, "expenses.manage");
    const parsed = ExpenseInput.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid expense.", 400);
    const d = parsed.data;
    const rule = checkExpenseRules(d);
    if (rule) return fail(rule, 400);

    // Replaying the same form submission returns the expense it already made.
    if (d.idempotencyKey) {
      const again = await prisma.expense.findUnique({ where: { idempotencyKey: d.idempotencyKey } });
      if (again) return ok((await hydrateExpenses([again]))[0], 200);
    }

    if (!manage) {
      // A Field Manager's expense must belong to a job assigned to them.
      if (!d.jobId) return fail("Choose the job this expense is for.", 400);
      await authorizeJob(d.jobId, "jobs.view");
      if (d.employeeId) return fail("Staff-linked expenses are recorded by Admin.", 403);
    } else if (d.jobId && !(await prisma.job.findUnique({ where: { id: d.jobId }, select: { id: true } }))) {
      return fail("That job doesn't exist.", 404);
    }
    if (d.employeeId && !(await prisma.employee.findUnique({ where: { id: d.employeeId }, select: { id: true } }))) return fail("That staff member doesn't exist.", 404);

    if (d.receiptFileId) {
      const f = await prisma.storedFile.findUnique({ where: { id: d.receiptFileId } });
      const used = f ? await prisma.expense.findFirst({ where: { receiptFileId: f.id }, select: { id: true } }) : null;
      if (!f || f.ownerType !== "expense" || used || (!manage && f.uploadedBy !== user.id)) return fail("That receipt can't be attached.", 400);
    }

    // The same bill typed twice: ask before saving a second copy.
    if (!d.confirmDuplicate) {
      const dup = await prisma.expense.findFirst({
        where: { createdBy: user.id, voidedAt: null, date: d.date, amount: d.amount, category: d.category, vendor: d.vendor ?? null, sourceType: null },
        select: { expenseNumber: true },
      });
      if (dup) return Response.json({ success: false, error: `This looks like a duplicate of ${dup.expenseNumber}. Save anyway if it's a separate bill.`, duplicate: true }, { status: 409 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const e = await tx.expense.create({
        data: {
          expenseNumber: await nextExpenseNumber(tx),
          date: d.date,
          category: d.category,
          description: d.description,
          amount: d.amount,
          taxAmount: d.taxAmount,
          paymentMethod: d.paymentMethod,
          paidBy: d.paidBy || (manage ? null : user.name),
          vendor: d.vendor || null,
          reference: d.reference || null,
          jobId: d.jobId || null,
          employeeId: manage ? d.employeeId || null : null,
          receiptFileId: d.receiptFileId || null,
          paymentStatus: d.paymentStatus,
          approvalStatus: manage ? "APPROVED" : "PENDING_APPROVAL",
          approvedBy: manage ? `${user.id}:${user.name}` : null,
          approvedAt: manage ? new Date() : null,
          notes: d.notes || null,
          idempotencyKey: d.idempotencyKey ?? null,
          createdBy: user.id,
        },
      });
      if (d.receiptFileId) await tx.storedFile.update({ where: { id: d.receiptFileId }, data: { ownerId: e.id } });
      return e;
    });
    void recordAudit({ actor: user, action: manage ? "EXPENSE_CREATED" : "EXPENSE_SUBMITTED", entityType: "expense", entityId: created.id, jobId: created.jobId, newState: created.approvalStatus, details: `${created.expenseNumber} ₹${created.amount} ${created.category}`, request });
    return ok((await hydrateExpenses([created]))[0], 201);
  } catch (err) {
    return errorResponse(err, "expenses.post.route_error");
  }
}
