import { NextResponse } from "next/server";
import { nextJobSerial } from "@/lib/server/job-serial";
import { nextInvoiceNumber } from "@/lib/server/invoices";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, requireAnyPermission, requireApproval, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import {
  serializeInvoice,
  serializePayment,
  serializeExpense,
  serializeQuote,
  serializeRefund,
  ok,
  fail,
  readJson,
  nextDocNumber,
} from "@/lib/server/serialize";
import { getTaxRate, computeInvoiceFigures, GSTIN_PATTERN } from "@/lib/tax";
import { getSystemSettings } from "@/lib/server/settings";
import { logger } from "@/lib/server/logger";
import { recordAudit } from "@/lib/server/audit";
import { recordActivity } from "@/lib/server/activity";
import { can, canApprove, refundNeedsApproval, discountNeedsApproval } from "@/lib/rbac";

/**
 * GET /api/finance — invoices, payments, refunds, expenses.
 * (Quotations have their own module: /api/quotations.)
 *   finance.view ALL  (Accounts, Super Admin) → everything
 *   invoice.view OWN  (customer login)        → own invoices + payments only
 */
export async function GET() {
  try {
    const { user, permission, scope } = await requireAnyPermission(["finance.view", "invoice.view"]);
    const own = scope === "OWN";
    const customerFilter = own ? { customerId: user.customerId ?? "__none__" } : {};

    const [invoices, payments, refunds, expenses] = await Promise.all([
      prisma.invoice.findMany({ where: customerFilter, orderBy: { issuedAt: "desc" }, take: 500 }),
      prisma.payment.findMany({ where: customerFilter, orderBy: { paidAt: "desc" }, take: 500 }),
      prisma.refund.findMany({ where: customerFilter, orderBy: { createdAt: "desc" }, take: 500 }),
      own || !can(user, "expenses.manage") ? Promise.resolve([]) : prisma.expense.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    ]);
    logger.debug("finance.get", { by: user.id, permission, scope });
    return ok({
      invoices: invoices.map(serializeInvoice),
      payments: payments.map(serializePayment),
      refunds: refunds.map(serializeRefund),
      expenses: expenses.map(serializeExpense),
    });
  } catch (err) {
    return errorResponse(err, "finance.get.route_error");
  }
}

const PaymentSchema = z.object({
  action: z.literal("record-payment"),
  invoiceId: z.string().min(1).max(64),
  amount: z.number().min(0.01).max(100000000),
  paymentMethod: z.enum(["card", "bank_transfer", "cash", "upi", "online_link"]),
  reference: z.string().min(1).max(160),
});

const FinalizeSchema = z.object({ action: z.literal("finalize-invoice"), invoiceId: z.string().min(1).max(64) });

const UpdateInvoiceSchema = z.object({
  action: z.literal("update-invoice"),
  invoiceId: z.string().min(1).max(64),
  discount: z.number().min(0).max(100000000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().max(300).optional(),
  /** Switch between a GST and a Non-GST invoice (only before it is finalized). */
  invoiceType: z.enum(["GST", "NON_GST"]).optional(),
  interState: z.boolean().optional(),
  customerGstin: z.string().max(20).optional(),
});

const RefundSchema = z.object({
  action: z.literal("create-refund"),
  invoiceId: z.string().min(1).max(64),
  amount: z.number().min(0.01).max(100000000),
  reason: z.string().min(5).max(500),
  method: z.enum(["original", "bank_transfer", "upi", "cash"]).default("original"),
});

const RefundDecisionSchema = z.object({
  action: z.enum(["approve-refund", "reject-refund"]),
  refundId: z.string().min(1).max(64),
  reason: z.string().max(300).optional(),
});

const ExpenseSchema = z.object({
  action: z.literal("create-expense"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(["equipment", "chemicals", "fuel", "salaries", "marketing", "utilities", "other"]),
  amount: z.number().min(0.01).max(100000000),
  description: z.string().min(1).max(500),
  paymentMethod: z.enum(["cash", "card", "bank_transfer", "upi"]),
  reference: z.string().max(160).optional(),
});

/** Applies an approved refund to the ledger (invoice totals + job status), atomically. */
async function processRefund(refundId: string) {
  return prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw new HttpError(404, "Refund not found.");
    if (refund.status === "PROCESSED") return refund;
    const invoice = await tx.invoice.findUnique({ where: { id: refund.invoiceId } });
    if (!invoice) throw new HttpError(404, "Invoice not found.");
    const refundedAmount = invoice.refundedAmount + refund.amount;
    const status = refundedAmount >= invoice.amountPaid - 0.005 ? "REFUNDED" : invoice.status;
    await tx.invoice.update({ where: { id: invoice.id }, data: { refundedAmount, status } });
    await tx.job.update({ where: { id: invoice.jobId }, data: { paymentStatus: status } });
    return tx.refund.update({ where: { id: refundId }, data: { status: "PROCESSED", processedAt: new Date() } });
  });
}

/** POST /api/finance — payments, invoice finalization/updates, refunds (with approval), expenses. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const action = typeof body?.action === "string" ? body.action : "";

    /* ------------------------------------------------------- record payment */
    if (action === "record-payment") {
      const { user } = await requirePermission("payment.record");
      const parsed = PaymentSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payment payload.", 400);
      const d = parsed.data;

      const invoice = await prisma.invoice.findUnique({ where: { id: d.invoiceId } });
      if (!invoice) return fail("Invoice not found.", 404);
      if (invoice.status === "CANCELLED") return fail("This invoice is cancelled.", 409);

      // Idempotency: the same reference on the same invoice is the same payment.
      const duplicate = await prisma.payment.findFirst({ where: { invoiceId: d.invoiceId, transactionReference: d.reference } });
      if (duplicate) return ok({ ...serializePayment(duplicate), duplicate: true });

      if (d.amount - invoice.balanceDue > 0.005) {
        return fail(
          `Payment amount (₹${d.amount.toFixed(2)}) exceeds the outstanding balance (₹${invoice.balanceDue.toFixed(2)}).`,
          400
        );
      }

      const { payment, lifetimeRevenue, status } = await prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            invoiceId: d.invoiceId,
            jobId: invoice.jobId,
            customerId: invoice.customerId,
            amount: d.amount,
            paymentMethod: d.paymentMethod,
            transactionReference: d.reference,
          },
        });
        const amountPaid = invoice.amountPaid + d.amount;
        const balanceDue = Math.max(0, invoice.total - amountPaid);
        const status = balanceDue === 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID";
        await tx.invoice.update({ where: { id: d.invoiceId }, data: { amountPaid, balanceDue, status } });
        await tx.job.update({ where: { id: invoice.jobId }, data: { paymentStatus: status } });
        const agg = await tx.payment.aggregate({ where: { customerId: invoice.customerId }, _sum: { amount: true } });
        const revenue = agg._sum.amount ?? 0;
        await tx.customer.update({ where: { id: invoice.customerId }, data: { lifetimeRevenue: revenue } });
        return { payment: created, lifetimeRevenue: revenue, status };
      });

      logger.info("finance.payment_recorded", { invoiceId: d.invoiceId, amount: d.amount, customerLifetimeRevenue: lifetimeRevenue, by: user.id });
      void recordAudit({ actor: user, action: "PAYMENT_RECORDED", entityType: "payment", entityId: payment.id, jobId: invoice.jobId, previousState: invoice.status, newState: status, details: `₹${d.amount} via ${d.paymentMethod} ref ${d.reference}`, request });
      return ok(serializePayment(payment), 201);
    }

    /* ----------------------------------------------------- finalize invoice */
    if (action === "finalize-invoice") {
      const { user } = await requirePermission("invoice.finalize");
      const parsed = FinalizeSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);
      const invoice = await prisma.invoice.findUnique({ where: { id: parsed.data.invoiceId } });
      if (!invoice) return fail("Invoice not found.", 404);
      if (invoice.finalizedAt) return ok({ ...serializeInvoice(invoice), alreadyFinalized: true });
      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: { finalizedAt: new Date(), finalizedBy: `${user.id}:${user.name}` },
      });
      await recordActivity({ jobId: invoice.jobId, type: "STATUS_CHANGED", message: `Invoice ${invoice.invoiceNumber} finalized and sent`, actor: { id: user.id, name: user.name, role: user.role } });
      void recordAudit({ actor: user, action: "INVOICE_FINALIZED", entityType: "invoice", entityId: invoice.id, jobId: invoice.jobId, details: `₹${invoice.total}`, request });
      return ok(serializeInvoice(updated));
    }

    /* -------------------------------------------------- update (pre-final) */
    if (action === "update-invoice") {
      const { user } = await requirePermission("invoice.update");
      const parsed = UpdateInvoiceSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid invoice update.", 400);
      const d = parsed.data;
      const invoice = await prisma.invoice.findUnique({ where: { id: d.invoiceId } });
      if (!invoice) return fail("Invoice not found.", 404);
      if (invoice.finalizedAt) return fail("Finalized invoices cannot be edited. Issue a refund or credit instead.", 409);
      if (invoice.amountPaid > 0 && d.discount !== undefined) return fail("A discount cannot be applied after a payment was recorded.", 409);

      const data: Record<string, unknown> = {};
      if (d.dueDate) data.dueDate = d.dueDate;
      const settings = await getSystemSettings();
      if (d.discount !== undefined) {
        const percent = invoice.subtotal > 0 ? (d.discount / invoice.subtotal) * 100 : 0;
        if (discountNeedsApproval(percent, settings)) {
          // High-value discount: approval authority (§17).
          requireApproval(user, "discount.high_value");
          if (!d.reason) return fail("A reason is required for a discount above the configured limit.", 400);
        }
      }
      if (d.discount !== undefined || d.invoiceType !== undefined || d.interState !== undefined || d.customerGstin !== undefined) {
        const type = d.invoiceType ?? (invoice.invoiceType === "NON_GST" ? "NON_GST" : "GST");
        const gstin = (d.customerGstin ?? invoice.customerGstin ?? "").trim().toUpperCase();
        if (type === "GST" && gstin && !GSTIN_PATTERN.test(gstin)) return fail("Customer GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5.", 400);
        // Keep the rate the invoice was issued with; a Non-GST invoice turning
        // into GST takes today's configured rate.
        const rate = invoice.invoiceType === "GST" && invoice.gstRate > 0 ? invoice.gstRate : settings.taxRatePercent;
        const f = computeInvoiceFigures({
          invoiceType: type,
          subtotal: invoice.subtotal,
          discount: d.discount ?? invoice.discount,
          gstRatePercent: rate,
          interState: d.interState ?? invoice.interState,
        });
        if (f.total < invoice.amountPaid) return fail("The new total would be less than what the customer already paid.", 409);
        Object.assign(data, {
          invoiceType: f.invoiceType,
          discount: f.discount,
          tax: f.tax,
          gstRate: f.gstRate,
          cgst: f.cgst,
          sgst: f.sgst,
          igst: f.igst,
          interState: f.invoiceType === "GST" && (d.interState ?? invoice.interState),
          customerGstin: f.invoiceType === "GST" ? gstin || null : null,
          supplierGstin: f.invoiceType === "GST" ? invoice.supplierGstin ?? (settings.gstin?.trim() || null) : null,
          total: f.total,
          balanceDue: Math.max(0, Math.round((f.total - invoice.amountPaid) * 100) / 100),
        });
        // GST and Non-GST invoices never share a number series.
        if (f.invoiceType !== invoice.invoiceType) data.invoiceNumber = await nextInvoiceNumber(prisma, f.invoiceType);
      }
      const updated = await prisma.invoice.update({ where: { id: invoice.id }, data });
      void recordAudit({ actor: user, action: "INVOICE_UPDATED", entityType: "invoice", entityId: invoice.id, jobId: invoice.jobId, previousState: `${invoice.invoiceType} total=${invoice.total}`, newState: `${updated.invoiceType} total=${updated.total}`, reason: d.reason, request });
      return ok(serializeInvoice(updated));
    }

    /* -------------------------------------------------------------- refunds */
    if (action === "create-refund") {
      const { user } = await requirePermission("refund.create");
      const parsed = RefundSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid refund payload (a reason of at least 5 characters is required).", 400);
      const d = parsed.data;
      const invoice = await prisma.invoice.findUnique({ where: { id: d.invoiceId } });
      if (!invoice) return fail("Invoice not found.", 404);
      const refundable = invoice.amountPaid - invoice.refundedAmount;
      if (d.amount - refundable > 0.005) return fail(`Refund exceeds the refundable amount (₹${refundable.toFixed(2)}).`, 400);

      const settings = await getSystemSettings();
      const needsApproval = refundNeedsApproval(d.amount, settings);
      const selfApproved = !needsApproval || canApprove(user.role, "refund.high_value");

      const refund = await prisma.refund.create({
        data: {
          invoiceId: invoice.id,
          jobId: invoice.jobId,
          customerId: invoice.customerId,
          amount: d.amount,
          reason: d.reason,
          method: d.method,
          status: selfApproved ? "APPROVED" : "PENDING_APPROVAL",
          requestedBy: `${user.id}:${user.name}`,
          approvedBy: selfApproved ? `${user.id}:${user.name}` : null,
          approvedAt: selfApproved ? new Date() : null,
        },
      });
      const final = selfApproved ? await processRefund(refund.id) : refund;
      void recordAudit({
        actor: user,
        action: selfApproved ? "REFUND_PROCESSED" : "REFUND_REQUESTED",
        entityType: "refund",
        entityId: refund.id,
        jobId: invoice.jobId,
        newState: final.status,
        reason: d.reason,
        details: `₹${d.amount}${needsApproval ? " (above limit)" : ""}`,
        request,
      });
      return ok(serializeRefund(final), 201);
    }

    if (action === "approve-refund" || action === "reject-refund") {
      const { user } = await requirePermission("refund.approve");
      requireApproval(user, "refund.high_value");
      const parsed = RefundDecisionSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);
      const refund = await prisma.refund.findUnique({ where: { id: parsed.data.refundId } });
      if (!refund) return fail("Refund not found.", 404);
      if (refund.status !== "PENDING_APPROVAL") return fail(`Refund is already ${refund.status}.`, 409);
      if (action === "reject-refund") {
        const rejected = await prisma.refund.update({ where: { id: refund.id }, data: { status: "REJECTED", approvedBy: `${user.id}:${user.name}`, approvedAt: new Date() } });
        void recordAudit({ actor: user, action: "REFUND_REJECTED", entityType: "refund", entityId: refund.id, jobId: refund.jobId, previousState: "PENDING_APPROVAL", newState: "REJECTED", reason: parsed.data.reason, request });
        return ok(serializeRefund(rejected));
      }
      await prisma.refund.update({ where: { id: refund.id }, data: { status: "APPROVED", approvedBy: `${user.id}:${user.name}`, approvedAt: new Date() } });
      const processed = await processRefund(refund.id);
      void recordAudit({ actor: user, action: "REFUND_APPROVED", entityType: "refund", entityId: refund.id, jobId: refund.jobId, previousState: "PENDING_APPROVAL", newState: "PROCESSED", reason: parsed.data.reason, details: `₹${refund.amount}`, request });
      return ok(serializeRefund(processed));
    }

    /* ------------------------------------------------------------- expenses */
    if (action === "create-expense") {
      const { user } = await requirePermission("expenses.manage");
      const parsed = ExpenseSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid expense payload.", 400);
      const { action: _action, ...d } = parsed.data;
      const created = await prisma.expense.create({ data: { ...d, reference: d.reference, createdBy: user.id } });
      void recordAudit({ actor: user, action: "EXPENSE_CREATED", entityType: "expense", entityId: created.id, details: `₹${d.amount} ${d.category}`, request });
      return ok(serializeExpense(created), 201);
    }

    if (action === "delete-expense") {
      const { user } = await requirePermission("expenses.manage");
      const parsed = z.object({ action: z.literal("delete-expense"), id: z.string().min(1).max(64) }).safeParse(body);
      if (!parsed.success) return fail("Invalid expense delete payload.", 400);
      const existing = await prisma.expense.findUnique({ where: { id: parsed.data.id } });
      if (!existing) return fail("Expense not found.", 404);
      await prisma.expense.delete({ where: { id: parsed.data.id } });
      logger.info("finance.expense_deleted", { expenseId: parsed.data.id, by: user.id });
      void recordAudit({ actor: user, action: "EXPENSE_DELETED", entityType: "expense", entityId: parsed.data.id, request });
      return ok({ id: parsed.data.id, deleted: true });
    }


    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "finance.post.route_error");
  }
}
