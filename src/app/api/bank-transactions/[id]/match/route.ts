import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { round2 } from "@/lib/payments";

const MatchSchema = z.object({ paymentId: z.string().min(1).max(64), notes: z.string().max(500).optional() });

/**
 * POST /api/bank-transactions/[id]/match — Admin links one imported statement line to one recorded
 * Payment. A transaction (and a Payment) can be reconciled at most once — the unique index on
 * ReconciliationRecord.bankTransactionId / .paymentId makes a second match for either row impossible,
 * so the same money can never be reconciled twice.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("finance.reconcile");
    const txn = await prisma.bankTransaction.findUnique({ where: { id: params.id }, include: { reconciliation: true } });
    if (!txn) return fail("Bank transaction not found.", 404);
    if (txn.reconciliation) return fail("This transaction is already reconciled.", 409);
    const parsed = MatchSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail("Pick a payment to match.", 400);
    const payment = await prisma.payment.findUnique({ where: { id: parsed.data.paymentId }, include: { reconciliation: true } });
    if (!payment) return fail("Payment not found.", 404);
    if (payment.reconciliation) return fail("That payment is already matched to another transaction.", 409);

    const matchedAmount = round2(Math.min(txn.amount, payment.amount));
    const status = Math.abs(txn.amount - payment.amount) < 0.005 ? "MATCHED" : "PARTIALLY_MATCHED";

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.reconciliationRecord.create({
        data: { bankTransactionId: txn.id, paymentId: payment.id, matchedAmount, status, matchedBy: `${user.id}:${user.name}`, notes: parsed.data.notes?.trim() || null },
      });
      await tx.bankTransaction.update({ where: { id: txn.id }, data: { status } });
      return created;
    });
    void recordAudit({
      actor: user,
      action: "PAYMENT_RECONCILED",
      entityType: "bank_transaction",
      entityId: txn.id,
      details: `₹${matchedAmount} matched to payment ${payment.id} (${status})`,
      request,
    });
    return ok({ id: record.id, status: record.status, matchedAmount: record.matchedAmount }, 201);
  } catch (err) {
    return errorResponse(err, "bank_transactions.match.route_error");
  }
}

/**
 * DELETE /api/bank-transactions/[id]/match — Admin reverses a match made in error. The transaction
 * (and the payment it was matched to) go back to being matchable; the reversal itself is preserved
 * in the audit log (append-only) rather than on the deleted link row, since the Payment and
 * BankTransaction rows — the actual financial facts — are never touched by a reversal.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("finance.reconcile");
    const txn = await prisma.bankTransaction.findUnique({ where: { id: params.id }, include: { reconciliation: true } });
    if (!txn) return fail("Bank transaction not found.", 404);
    if (!txn.reconciliation) return fail("This transaction isn't reconciled.", 409);
    const reconciliationId = txn.reconciliation.id;
    const paymentId = txn.reconciliation.paymentId;
    await prisma.$transaction(async (tx) => {
      await tx.reconciliationRecord.delete({ where: { id: reconciliationId } });
      await tx.bankTransaction.update({ where: { id: txn.id }, data: { status: "UNMATCHED" } });
    });
    void recordAudit({ actor: user, action: "PAYMENT_RECONCILIATION_REVERSED", entityType: "bank_transaction", entityId: txn.id, details: `was matched to payment ${paymentId}`, request });
    return ok({ id: txn.id, reversed: true });
  } catch (err) {
    return errorResponse(err, "bank_transactions.unmatch.route_error");
  }
}
