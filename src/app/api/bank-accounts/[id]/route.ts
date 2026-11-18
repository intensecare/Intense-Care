import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson, serializeInvoice, serializePayment } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { BankAccountInputSchema, serializeBankAccount } from "@/lib/server/bank-accounts";

/**
 * GET /api/bank-accounts/[id] — one account's configured details plus three figures that must
 * never be confused with each other (per the Finance dashboard rule):
 *   invoicedTotal   sum of invoice.total for invoices assigned to this account (revenue billed via it)
 *   collectedTotal  sum of Payment.amount actually recorded as received into this account
 *   openingBalance  what the Admin typed in when the account was configured — informational only,
 *                   never a live bank balance (there is no bank-feed integration).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("finance.bank.manage");
    const acc = await prisma.bankAccount.findUnique({ where: { id: params.id } });
    if (!acc) return fail("Bank account not found.", 404);
    const [invoices, payments, unmatchedCount] = await Promise.all([
      prisma.invoice.findMany({ where: { bankAccountId: acc.id }, orderBy: { issuedAt: "desc" }, take: 100 }),
      prisma.payment.findMany({ where: { receivingBankAccountId: acc.id }, orderBy: { paidAt: "desc" }, take: 200 }),
      prisma.bankTransaction.count({ where: { bankAccountId: acc.id, status: "UNMATCHED" } }),
    ]);
    const invoicedTotal = Math.round(invoices.reduce((a, i) => a + i.total, 0) * 100) / 100;
    const collectedTotal = Math.round(payments.reduce((a, p) => a + p.amount, 0) * 100) / 100;
    return ok({
      account: serializeBankAccount(acc, true),
      invoicedTotal,
      collectedTotal,
      openingBalance: acc.openingBalance ?? null,
      unmatchedTransactionCount: unmatchedCount,
      invoices: invoices.map(serializeInvoice),
      payments: payments.map(serializePayment),
    });
  } catch (err) {
    return errorResponse(err, "bank_accounts.detail.route_error");
  }
}

const UpdateSchema = z.union([
  BankAccountInputSchema.partial().extend({ action: z.literal("update") }),
  z.object({ action: z.literal("set-default") }),
  z.object({ action: z.literal("set-status"), status: z.enum(["ACTIVE", "INACTIVE"]) }),
]);

/** PATCH /api/bank-accounts/[id] — edit details, set as default, or activate/deactivate. Never deleted. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("finance.bank.manage");
    const acc = await prisma.bankAccount.findUnique({ where: { id: params.id } });
    if (!acc) return fail("Bank account not found.", 404);
    const parsed = UpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid payload.", 400);
    const body = parsed.data;

    if (body.action === "set-default") {
      if (acc.status !== "ACTIVE") return fail("Only an active account can be the default.", 409);
      const updated = await prisma.$transaction(async (tx) => {
        await tx.bankAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        return tx.bankAccount.update({ where: { id: acc.id }, data: { isDefault: true } });
      });
      void recordAudit({ actor: user, action: "BANK_ACCOUNT_SET_DEFAULT", entityType: "bank_account", entityId: acc.id, details: acc.displayName, request });
      return ok(serializeBankAccount(updated, true));
    }

    if (body.action === "set-status") {
      // Deactivating never touches historical invoices/payments/transactions — it only hides the
      // account from future pickers (resolveBankAccountForNew only offers status = ACTIVE accounts).
      const updated = await prisma.bankAccount.update({ where: { id: acc.id }, data: { status: body.status, isDefault: body.status === "INACTIVE" ? false : acc.isDefault } });
      void recordAudit({ actor: user, action: body.status === "ACTIVE" ? "BANK_ACCOUNT_ACTIVATED" : "BANK_ACCOUNT_DEACTIVATED", entityType: "bank_account", entityId: acc.id, details: acc.displayName, request });
      return ok(serializeBankAccount(updated, true));
    }

    // action === "update" — edits the LIVE record only. Invoices/quotations already issued keep the
    // snapshot they were given at the time; this never rewrites a document already sent out.
    const { action: _a, isDefault: _d, ...fields } = body;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) data[k] = v;
    if (typeof data.accountNumber === "string") data.accountNumberLast4 = (data.accountNumber as string).slice(-4);
    if (data.branch === "") data.branch = null;
    if (data.upiId === "") data.upiId = null;
    if (data.notes === "") data.notes = null;
    const updated = await prisma.bankAccount.update({ where: { id: acc.id }, data });
    void recordAudit({ actor: user, action: "BANK_ACCOUNT_UPDATED", entityType: "bank_account", entityId: acc.id, details: updated.displayName, request });
    return ok(serializeBankAccount(updated, true));
  } catch (err) {
    return errorResponse(err, "bank_accounts.patch.route_error");
  }
}
