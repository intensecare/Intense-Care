import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";

/**
 * GET /api/bank-transactions?bankAccountId=&status= — imported statement lines for the
 * reconciliation screen. Admin only.
 */
export async function GET(request: Request) {
  try {
    await requirePermission("finance.reconcile");
    const url = new URL(request.url);
    const bankAccountId = url.searchParams.get("bankAccountId") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const [rows, unmatchedPayments] = await Promise.all([
      prisma.bankTransaction.findMany({
        where: { ...(bankAccountId ? { bankAccountId } : {}), ...(status ? { status } : {}) },
        orderBy: { txnDate: "desc" },
        take: 500,
        include: { reconciliation: { include: { payment: { select: { id: true, invoiceId: true, amount: true, paymentMethod: true } } } } },
      }),
      // Recorded payments with nothing matched to them yet — the pool a transaction can be matched against.
      prisma.payment.findMany({
        where: { reconciliation: null },
        orderBy: { paidAt: "desc" },
        take: 200,
        select: { id: true, invoiceId: true, amount: true, paymentMethod: true, transactionReference: true, paidAt: true, receivingBankAccountId: true, invoice: { select: { invoiceNumber: true } } },
      }),
    ]);
    return ok({
      transactions: rows.map((t) => ({
        id: t.id,
        bankAccountId: t.bankAccountId,
        txnDate: t.txnDate,
        description: t.description,
        amount: t.amount,
        reference: t.reference ?? undefined,
        status: t.status,
        importedAt: t.importedAt.toISOString(),
        source: t.source,
        reconciliation: t.reconciliation
          ? { id: t.reconciliation.id, paymentId: t.reconciliation.paymentId, matchedAmount: t.reconciliation.matchedAmount, status: t.reconciliation.status, payment: t.reconciliation.payment }
          : null,
      })),
      unmatchedPayments: unmatchedPayments.map((p) => ({
        id: p.id,
        invoiceId: p.invoiceId,
        invoiceNumber: p.invoice?.invoiceNumber,
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        transactionReference: p.transactionReference,
        paidAt: p.paidAt.toISOString(),
        receivingBankAccountId: p.receivingBankAccountId ?? undefined,
      })),
    });
  } catch (err) {
    return errorResponse(err, "bank_transactions.get.route_error");
  }
}
