import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import {
  serializeInvoice,
  serializePayment,
  serializeExpense,
  serializeQuote,
  ok,
  fail,
  readJson,
  nextDocNumber,
} from "@/lib/server/serialize";
import { getTaxRate } from "@/lib/tax";
import { getSystemSettings } from "@/lib/server/settings";
import { logger } from "@/lib/server/logger";

/**
 * GET /api/finance — invoices, payments, expenses (super_admin ONLY).
 * Financial data (collections, receivables, expenses, commissions) is the
 * super_admin's domain; ops_manager is denied at the API boundary.
 */
export async function GET() {
  try {
    await requireRole(["super_admin"]);
    const [invoices, payments, expenses, quotes] = await Promise.all([
      prisma.invoice.findMany({ orderBy: { issuedAt: "desc" }, take: 500 }),
      prisma.payment.findMany({ orderBy: { paidAt: "desc" }, take: 500 }),
      prisma.expense.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.quote.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    ]);
    return ok({
      invoices: invoices.map(serializeInvoice),
      payments: payments.map(serializePayment),
      expenses: expenses.map(serializeExpense),
      quotes: quotes.map(serializeQuote),
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

const ExpenseSchema = z.object({
  action: z.literal("create-expense"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(["equipment", "chemicals", "fuel", "salaries", "marketing", "utilities", "other"]),
  amount: z.number().min(0.01).max(100000000),
  description: z.string().min(1).max(500),
  paymentMethod: z.enum(["cash", "card", "bank_transfer", "upi"]),
  reference: z.string().max(160).optional(),
});

const QuoteSchema = z.object({
  action: z.literal("create-quote"),
  customerId: z.string().min(1).max(64),
  propertyId: z.string().min(1).max(64),
  serviceId: z.string().min(1).max(64),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(300),
        quantity: z.number().min(0.01).max(100000),
        unitPrice: z.number().min(0).max(10000000),
      })
    )
    .min(1)
    .max(100),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const ConvertSchema = z.object({
  action: z.literal("convert-quote"),
  quoteId: z.string().min(1).max(64),
  // Optional service schedule for the converted booking; falls back to
  // tomorrow's date with a morning window when omitted.
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledTimeSlot: z
    .string()
    .regex(/^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$|^\d{1,2}:\d{2}\s*[AP]M\s*[-–]\s*\d{1,2}:\d{2}\s*[AP]M$/i)
    .max(80)
    .optional(),
});

/** POST /api/finance — record payments, log expenses, create/convert quotes (admins). */
export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);
    const body = await readJson(request);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "record-payment") {
      const parsed = PaymentSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payment payload.", 400);
      const d = parsed.data;

      const invoice = await prisma.invoice.findUnique({ where: { id: d.invoiceId } });
      if (!invoice) return fail("Invoice not found.", 404);

      // §13 edge case: a payment may not exceed the invoice's outstanding
      // balance. Over-collection would push amountPaid above total and flip
      // the invoice to PAID with untracked credit on the ledger. Half-a-paisa
      // tolerance absorbs binary float noise on 2-decimal money fields.
      if (d.amount - invoice.balanceDue > 0.005) {
        return fail(
          `Payment amount (₹${d.amount.toFixed(2)}) exceeds the outstanding balance (₹${invoice.balanceDue.toFixed(2)}).`,
          400,
        );
      }

      // Atomic settlement: the payment receipt, the invoice/job status, and
      // the customer's lifetime-revenue counter commit together. The counter
      // is RECOMPUTED from the payment ledger inside the transaction, so
      // Customer.lifetimeRevenue can never drift from actual collections.
      const { payment, lifetimeRevenue } = await prisma.$transaction(async (tx) => {
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

        await tx.invoice.update({
          where: { id: d.invoiceId },
          data: { amountPaid, balanceDue, status },
        });
        await tx.job.update({
          where: { id: invoice.jobId },
          data: { paymentStatus: status },
        });

        const agg = await tx.payment.aggregate({
          where: { customerId: invoice.customerId },
          _sum: { amount: true },
        });
        const revenue = agg._sum.amount ?? 0;
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { lifetimeRevenue: revenue },
        });

        return { payment: created, lifetimeRevenue: revenue };
      });

      logger.info("finance.payment_recorded", {
        invoiceId: d.invoiceId,
        amount: d.amount,
        customerLifetimeRevenue: lifetimeRevenue,
        by: user.id,
      });
      return ok(serializePayment(payment), 201);
    }

    if (action === "create-expense") {
      const parsed = ExpenseSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid expense payload.", 400);
      const { action: _action, ...d } = parsed.data;
      const created = await prisma.expense.create({
        data: { ...d, reference: d.reference, createdBy: user.id },
      });
      return ok(serializeExpense(created), 201);
    }

    if (action === "create-quote") {
      const parsed = QuoteSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid quote payload.", 400);
      const d = parsed.data;

      const settings = await getSystemSettings();
      const subtotal = d.items.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0);
      const rate = getTaxRate(settings);
      const tax = Math.round(subtotal * rate * 100) / 100;

      const created = await prisma.quote.create({
        data: {
          quoteNumber: nextDocNumber("QUO"),
          customerId: d.customerId,
          propertyId: d.propertyId,
          serviceId: d.serviceId,
          // Line items are stored verbatim so the quoted document can show
          // exactly what was priced (legacy quotations have none).
          items: d.items.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
          })),
          subtotal,
          tax,
          total: subtotal + tax,
          validUntil: d.validUntil,
        },
      });
      return ok(serializeQuote(created), 201);
    }

    if (action === "convert-quote") {
      const parsed = ConvertSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid convert payload.", 400);

      const quote = await prisma.quote.findUnique({ where: { id: parsed.data.quoteId } });
      if (!quote) return fail("Quote not found.", 404);
      if (quote.status !== "sent") return fail("Only open quotations can be converted.", 409);

      // Accepted quotations become a scheduled job with its tax invoice,
      // created atomically so the invoice always has a real job behind it.
      // The desk picks the service date/window at conversion; defaults keep
      // the previous behavior for API callers that omit them.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const scheduledDate = parsed.data.scheduledDate ?? tomorrow.toISOString().slice(0, 10);
      const scheduledTimeSlot = parsed.data.scheduledTimeSlot ?? "09:00 - 13:30";

      const { job, invoice } = await prisma.$transaction(async (tx) => {
        const createdJob = await tx.job.create({
          data: {
            customerId: quote.customerId,
            propertyId: quote.propertyId,
            serviceId: quote.serviceId,
            scheduledDate,
            scheduledTimeSlot,
            amount: quote.total,
            status: "SCHEDULED",
            notes: `Converted from quotation ${quote.quoteNumber}`,
          },
        });
        const createdInvoice = await tx.invoice.create({
          data: {
            invoiceNumber: nextDocNumber("INV"),
            jobId: createdJob.id,
            customerId: quote.customerId,
            subtotal: quote.subtotal,
            tax: quote.tax,
            discount: quote.discount,
            total: quote.total,
            balanceDue: quote.total,
            dueDate: quote.validUntil,
          },
        });
        // The converted booking counts toward the customer's booking total.
        await tx.customer.update({
          where: { id: quote.customerId },
          data: { totalBookings: { increment: 1 } },
        });
        // Status string matches the client contract (Quote["status"]) so the
        // UI hides convert/delete actions on converted quotations.
        await tx.quote.update({ where: { id: quote.id }, data: { status: "converted_to_job" } });
        return { job: createdJob, invoice: createdInvoice };
      });

      // The customer's ONE secure link: minted the moment the quotation
      // becomes a job. Fire-and-forget — never fails a conversion.
      void (async () => {
        try {
          const { ensureCustomerLink } = await import("@/lib/server/qr-service");
          await ensureCustomerLink(job.id, { id: user.id, name: user.name });
        } catch (e) {
          logger.warn("finance.customer_link_ensure_failed", { jobId: job.id, error: e instanceof Error ? e.message : String(e) });
        }
      })();

      return ok({ invoice: serializeInvoice(invoice), jobId: job.id }, 201);
    }

    if (action === "delete-expense") {
      const parsed = z.object({ action: z.literal("delete-expense"), id: z.string().min(1).max(64) }).safeParse(body);
      if (!parsed.success) return fail("Invalid expense delete payload.", 400);
      const existing = await prisma.expense.findUnique({ where: { id: parsed.data.id } });
      if (!existing) return fail("Expense not found.", 404);
      await prisma.expense.delete({ where: { id: parsed.data.id } });
      logger.info("finance.expense_deleted", { expenseId: parsed.data.id, by: user.id });
      return ok({ id: parsed.data.id, deleted: true });
    }

    if (action === "delete-quote") {
      const parsed = z.object({ action: z.literal("delete-quote"), id: z.string().min(1).max(64) }).safeParse(body);
      if (!parsed.success) return fail("Invalid quote delete payload.", 400);
      const quote = await prisma.quote.findUnique({ where: { id: parsed.data.id } });
      if (!quote) return fail("Quote not found.", 404);
      if (quote.status !== "sent") {
        return fail("Only open quotations can be deleted; converted quotations are part of job history.", 409);
      }
      await prisma.quote.delete({ where: { id: parsed.data.id } });
      logger.info("finance.quote_deleted", { quoteId: parsed.data.id, by: user.id });
      return ok({ id: parsed.data.id, deleted: true });
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "finance.post.route_error");
  }
}
