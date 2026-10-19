import { Prisma, type Invoice, type UpiPaymentAttempt } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./authz";
import { getSystemSettings } from "./settings";
import { logger } from "./logger";
import {
  buildUpiUri,
  customerPaymentStatus,
  newAttemptReference,
  normalizeUtr,
  paymentNote,
  round2,
  upiProblem,
  type CustomerPaymentStatus,
} from "@/lib/payments";

/**
 * Invoice payments.
 *
 *  applyPayment      the ONE place money is added to an invoice (Admin "record payment" and Admin "verify UPI payment" both use it).
 *                    It locks the invoice row, so two admins / two taps can't record the same money twice or overpay.
 *  UPI attempts      the customer asks to pay → we create an attempt for the invoice's OUTSTANDING balance (the browser never sends an amount) →
 *                    they pay in their UPI app → they send the UTR → an Admin checks the bank and verifies. Nothing before that marks anything paid.
 *  The job is never touched: a job completes with or without payment, and an invoice's payment status is its own thing.
 */

type Tx = Prisma.TransactionClient;

export async function applyPayment(tx: Tx, input: { invoiceId: string; amount: number; method: string; reference: string }) {
  // Row lock: concurrent payments for the same invoice run one after the other.
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`;
  const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice) throw new HttpError(404, "Invoice not found.");
  if (invoice.status === "CANCELLED") throw new HttpError(409, "This invoice is cancelled.");
  const duplicate = await tx.payment.findFirst({ where: { invoiceId: input.invoiceId, transactionReference: input.reference } });
  if (duplicate) return { payment: duplicate, invoice, status: invoice.status, duplicate: true as const };
  const amount = round2(input.amount);
  if (amount - invoice.balanceDue > 0.005) {
    throw new HttpError(400, `Payment amount (₹${amount.toFixed(2)}) exceeds the outstanding balance (₹${invoice.balanceDue.toFixed(2)}).`);
  }
  const payment = await tx.payment.create({
    data: { invoiceId: input.invoiceId, jobId: invoice.jobId, customerId: invoice.customerId, amount, paymentMethod: input.method, transactionReference: input.reference },
  });
  const amountPaid = round2(invoice.amountPaid + amount);
  const balanceDue = Math.max(0, round2(invoice.total - amountPaid));
  const status = balanceDue === 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID";
  const updated = await tx.invoice.update({ where: { id: input.invoiceId }, data: { amountPaid, balanceDue, status } });
  await tx.job.update({ where: { id: invoice.jobId }, data: { paymentStatus: status } });
  const agg = await tx.payment.aggregate({ where: { customerId: invoice.customerId }, _sum: { amount: true } });
  await tx.customer.update({ where: { id: invoice.customerId }, data: { lifetimeRevenue: agg._sum.amount ?? 0 } });
  return { payment, invoice: updated, status, duplicate: false as const };
}

/* ------------------------------------------------------------------ events */

async function event(tx: Tx, attemptId: string, from: string | null, to: string, actorType: "CUSTOMER" | "ADMIN" | "SYSTEM", actorName: string | null, note?: string) {
  await tx.upiPaymentEvent.create({ data: { attemptId, fromStatus: from, toStatus: to, actorType, actorName, note: note?.slice(0, 500) ?? null } });
}

/* ---------------------------------------------------------------- customer */

/** The invoice a customer link may pay: the job's live invoice. */
export function payableInvoice(jobId: string) {
  return prisma.invoice.findFirst({ where: { jobId, status: { not: "CANCELLED" } }, orderBy: { issuedAt: "desc" } });
}

export interface PaymentBlock {
  method: "UPI";
  status: CustomerPaymentStatus;
  outstanding: number;
  /** UPI is switched on and fully configured. */
  available: boolean;
  /** Why it isn't — shown to the Admin only (the customer just sees "ask us"). */
  canPay: boolean;
  attempt: null | { id: string; status: string; reference: string; amount: number; utrLast4: string | null; submittedAt: string | null; reviewNote: string | null };
}

/** What the customer's page needs to show Pay Now / "submitted" / "checked" — computed on the server. */
export async function paymentBlock(invoice: Invoice): Promise<PaymentBlock> {
  const settings = (await getSystemSettings()).upi;
  const attempts = await prisma.upiPaymentAttempt.findMany({ where: { invoiceId: invoice.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const status = customerPaymentStatus(invoice.status, attempts);
  const open = attempts.find((a) => a.status === "SUBMITTED") ?? attempts.find((a) => a.status === "INITIATED") ?? attempts.find((a) => a.status === "REJECTED");
  const outstanding = round2(invoice.balanceDue);
  const available = upiProblem(settings) === null;
  return {
    method: "UPI",
    status,
    outstanding,
    available,
    canPay: available && outstanding > 0.005 && !["PAID", "REFUNDED", "CANCELLED"].includes(invoice.status) && !attempts.some((a) => a.status === "SUBMITTED"),
    attempt: open
      ? { id: open.id, status: open.status, reference: open.reference, amount: open.amount, utrLast4: open.utr ? open.utr.slice(-4) : null, submittedAt: open.submittedAt?.toISOString() ?? null, reviewNote: open.status === "REJECTED" ? open.reviewNote : null }
      : null,
  };
}

const REUSE_WINDOW_MS = 30 * 60 * 1000;

export async function startAttempt(jobId: string) {
  const settings = (await getSystemSettings()).upi;
  if (upiProblem(settings)) throw new HttpError(409, "Online payment isn't available yet. Please pay as your invoice says, or contact us.");
  const invoice = await payableInvoice(jobId);
  if (!invoice) throw new HttpError(404, "There is no invoice to pay yet.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoice.id} FOR UPDATE`;
    const inv = (await tx.invoice.findUnique({ where: { id: invoice.id } }))!;
    const outstanding = round2(inv.balanceDue);
    if (["PAID", "REFUNDED", "CANCELLED"].includes(inv.status) || outstanding <= 0.005) throw new HttpError(409, "This invoice has nothing left to pay.");
    const waiting = await tx.upiPaymentAttempt.findFirst({ where: { invoiceId: inv.id, status: "SUBMITTED" } });
    if (waiting) throw new HttpError(409, "A payment for this invoice has already been submitted and is being checked. Please wait for it to be confirmed.");
    // Tapping Pay Now twice (or reloading) reuses the same attempt instead of piling up new ones.
    const recent = await tx.upiPaymentAttempt.findFirst({
      where: { invoiceId: inv.id, status: "INITIATED", amount: outstanding, createdAt: { gt: new Date(Date.now() - REUSE_WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
    });
    const attempt =
      recent ??
      (await (async () => {
        const created = await tx.upiPaymentAttempt.create({
          data: { invoiceId: inv.id, jobId, customerId: inv.customerId, reference: newAttemptReference(), amount: outstanding, payeeVpa: settings.vpa.trim(), payeeName: settings.payeeName.trim() },
        });
        await event(tx, created.id, null, "INITIATED", "CUSTOMER", null, `Pay now for ₹${outstanding.toFixed(2)}`);
        return created;
      })());
    const uri = buildUpiUri({ vpa: attempt.payeeVpa, payeeName: attempt.payeeName, amount: attempt.amount, note: paymentNote(settings.description, inv.invoiceNumber), reference: attempt.reference });
    return { attempt, invoice: inv, upiUri: uri, reused: !!recent };
  });
}

async function ownAttempt(jobId: string, attemptId: string): Promise<UpiPaymentAttempt> {
  const a = await prisma.upiPaymentAttempt.findUnique({ where: { id: attemptId } });
  // Another job's attempt is simply "not found" to this link.
  if (!a || a.jobId !== jobId) throw new HttpError(404, "Payment not found.");
  return a;
}

export async function submitAttempt(jobId: string, attemptId: string, rawUtr: string, payerNote?: string) {
  const utr = normalizeUtr(rawUtr);
  if (!utr) throw new HttpError(400, "Enter the UTR / transaction reference from your UPI app (8–35 letters and digits).");
  const a = await ownAttempt(jobId, attemptId);
  if (a.status === "SUBMITTED" && a.utr === utr) return { attempt: a, replayed: true };
  if (a.status !== "INITIATED") throw new HttpError(409, a.status === "VERIFIED" ? "This payment is already confirmed." : a.status === "SUBMITTED" ? "A different reference was already submitted for this payment." : "This payment request is no longer open. Tap Pay now to start a new one.");
  // The same UTR can't be used twice, on any invoice, or against money already recorded.
  const clash = await prisma.upiPaymentAttempt.findFirst({ where: { utr, status: { in: ["SUBMITTED", "VERIFIED"] }, NOT: { id: a.id } } });
  const recorded = await prisma.payment.findFirst({ where: { transactionReference: utr } });
  if (clash || recorded) throw new HttpError(409, "That reference has already been used for a payment. Check the number from your UPI app.");
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.upiPaymentAttempt.updateMany({ where: { id: a.id, status: "INITIATED" }, data: { status: "SUBMITTED", utr, payerNote: payerNote?.trim().slice(0, 200) || null, submittedAt: new Date() } });
      if (res.count !== 1) throw new HttpError(409, "This payment was just updated. Reload the page.");
      await event(tx, a.id, "INITIATED", "SUBMITTED", "CUSTOMER", null, `UTR ending ${utr.slice(-4)} submitted for review`);
      return tx.upiPaymentAttempt.findUniqueOrThrow({ where: { id: a.id } });
    });
    return { attempt: updated, replayed: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "That reference has already been used for a payment.");
    throw e;
  }
}

/** The customer closed the UPI app without paying / changed their mind. */
export async function cancelAttempt(jobId: string, attemptId: string) {
  const a = await ownAttempt(jobId, attemptId);
  if (a.status === "CANCELLED") return a;
  if (a.status !== "INITIATED") throw new HttpError(409, "This payment can't be cancelled any more.");
  return prisma.$transaction(async (tx) => {
    const res = await tx.upiPaymentAttempt.updateMany({ where: { id: a.id, status: "INITIATED" }, data: { status: "CANCELLED" } });
    if (res.count === 1) await event(tx, a.id, "INITIATED", "CANCELLED", "CUSTOMER", null, "Customer did not complete the payment");
    return tx.upiPaymentAttempt.findUniqueOrThrow({ where: { id: a.id } });
  });
}

/* ------------------------------------------------------------------- admin */

export interface Reviewer {
  id: string;
  name: string;
}

export async function verifyAttempt(attemptId: string, by: Reviewer, opts: { amount?: number; utr?: string; note?: string }) {
  const a = await prisma.upiPaymentAttempt.findUnique({ where: { id: attemptId } });
  if (!a) throw new HttpError(404, "Payment not found.");
  if (a.status === "VERIFIED") return { attempt: a, payment: a.paymentId ? await prisma.payment.findUnique({ where: { id: a.paymentId } }) : null, replayed: true };
  if (a.status === "REJECTED" || a.status === "CANCELLED") throw new HttpError(409, `This payment was ${a.status.toLowerCase()}. Ask the customer to start a new one.`);
  const utr = opts.utr ? normalizeUtr(opts.utr) : a.utr;
  if (opts.utr && !utr) throw new HttpError(400, "That reference isn't valid.");
  // Verifying a payment nobody submitted a UTR for needs the bank's reference — the ledger must never hold an unreferenced UPI payment.
  if (!utr) throw new HttpError(400, "Enter the UTR / reference from your bank statement to confirm this payment.");
  const amount = round2(opts.amount ?? a.amount);
  if (!(amount > 0)) throw new HttpError(400, "Enter the amount that arrived in the bank account.");
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock the attempt: a second Admin verifying at the same moment waits here, then sees it VERIFIED and gets the same answer.
      await tx.$queryRaw`SELECT id FROM "UpiPaymentAttempt" WHERE id = ${attemptId} FOR UPDATE`;
      const fresh = await tx.upiPaymentAttempt.findUnique({ where: { id: attemptId } });
      if (!fresh) throw new HttpError(404, "Payment not found.");
      if (fresh.status === "VERIFIED") return { attempt: fresh, payment: fresh.paymentId ? await tx.payment.findUnique({ where: { id: fresh.paymentId } }) : null, replayed: true };
      if (!["INITIATED", "SUBMITTED"].includes(fresh.status)) throw new HttpError(409, "This payment was just updated. Reload the list.");
      const clash = await tx.upiPaymentAttempt.findFirst({ where: { utr, status: { in: ["SUBMITTED", "VERIFIED"] }, NOT: { id: attemptId } } });
      if (clash) throw new HttpError(409, "That reference belongs to another payment.");
      const applied = await applyPayment(tx, { invoiceId: fresh.invoiceId, amount, method: "upi", reference: utr });
      if (applied.duplicate) throw new HttpError(409, "A payment with that reference is already recorded on this invoice.");
      const updated = await tx.upiPaymentAttempt.update({
        where: { id: attemptId },
        data: { status: "VERIFIED", utr, reviewedAt: new Date(), reviewedBy: by.id, reviewedByName: by.name, reviewNote: opts.note?.slice(0, 500) ?? null, paymentId: applied.payment.id },
      });
      await event(tx, attemptId, fresh.status, "VERIFIED", "ADMIN", by.name, `₹${amount.toFixed(2)} confirmed${opts.note ? ` — ${opts.note}` : ""}`);
      // The invoice is settled: other open requests for it are void.
      if (applied.status === "PAID") {
        const open = await tx.upiPaymentAttempt.findMany({ where: { invoiceId: fresh.invoiceId, status: "INITIATED", NOT: { id: attemptId } } });
        for (const o of open) {
          await tx.upiPaymentAttempt.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
          await event(tx, o.id, "INITIATED", "CANCELLED", "SYSTEM", null, "Invoice was paid in full");
        }
      }
      return { attempt: updated, payment: applied.payment, invoiceStatus: applied.status, replayed: false };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "That reference has already been used for a payment.");
    throw e;
  }
}

export async function rejectAttempt(attemptId: string, by: Reviewer, reason: string) {
  const a = await prisma.upiPaymentAttempt.findUnique({ where: { id: attemptId } });
  if (!a) throw new HttpError(404, "Payment not found.");
  if (a.status === "REJECTED") return a;
  if (!["INITIATED", "SUBMITTED"].includes(a.status)) throw new HttpError(409, a.status === "VERIFIED" ? "A confirmed payment can't be rejected here. Use a refund." : "This payment is already closed.");
  return prisma.$transaction(async (tx) => {
    const res = await tx.upiPaymentAttempt.updateMany({ where: { id: attemptId, status: { in: ["INITIATED", "SUBMITTED"] } }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: by.id, reviewedByName: by.name, reviewNote: reason.slice(0, 500) } });
    if (res.count !== 1) throw new HttpError(409, "This payment was just updated. Reload the list.");
    await event(tx, attemptId, a.status, "REJECTED", "ADMIN", by.name, reason);
    logger.info("payments.upi_rejected", { attemptId, by: by.id });
    return tx.upiPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  });
}
