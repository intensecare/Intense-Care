import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson, serializeQuote, parseLines } from "@/lib/server/serialize";
import { getSystemSettings } from "@/lib/server/settings";
import { recordAudit } from "@/lib/server/audit";
import { QuoteInputSchema, buildQuoteData, nextQuoteNumber, ensureQuoteShareLink, quoteDocument } from "@/lib/server/quotations";
import { validateCrew, createJobWithInvoice, afterJobCreated } from "@/lib/server/job-create";
import { nextInvoiceNumber } from "@/lib/server/invoices";
import { computeInvoiceFigures } from "@/lib/tax";

/** GET /api/quotations/[id] — the quotation as a printable document (Admin). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("quotes.manage");
    const settings = await getSystemSettings();
    const doc = await quoteDocument(params.id, settings);
    const share = doc.q.shareTokenEnc ? await ensureQuoteShareLink(doc.q.id) : null;
    return ok({ quote: serializeQuote(doc.q, { customerName: doc.customer.name, propertyTitle: doc.property?.title }), customer: doc.customer, property: doc.property, job: doc.job, company: doc.company, shareUrl: share });
  } catch (err) {
    return errorResponse(err, "quotations.detail.route_error");
  }
}

/** PATCH /api/quotations/[id] — edit (not once it became a job). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("quotes.manage");
    const existing = await prisma.quote.findUnique({ where: { id: params.id } });
    if (!existing) return fail("Quotation not found.", 404);
    if (existing.status === "converted_to_job") return fail("This quotation is already a job — edit the job's invoice instead.", 409);
    const parsed = QuoteInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid quotation.", 400);
    const data = await buildQuoteData(parsed.data, await getSystemSettings());
    // Editing an accepted quotation sends it back for acceptance.
    const updated = await prisma.quote.update({ where: { id: existing.id }, data: { ...data, status: parsed.data.status, acceptedAt: null, acceptedBy: null } });
    void recordAudit({ actor: user, action: "QUOTE_UPDATED", entityType: "quote", entityId: updated.id, previousState: `₹${existing.total}`, newState: `₹${updated.total}`, request });
    return ok(serializeQuote(updated));
  } catch (err) {
    return errorResponse(err, "quotations.patch.route_error");
  }
}

/** DELETE /api/quotations/[id] — only quotations that never became a job. */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("quotes.manage");
    const q = await prisma.quote.findUnique({ where: { id: params.id } });
    if (!q) return fail("Quotation not found.", 404);
    if (q.jobId) return fail("This quotation became a job and is kept for the record.", 409);
    await prisma.quote.delete({ where: { id: q.id } });
    void recordAudit({ actor: user, action: "QUOTE_DELETED", entityType: "quote", entityId: q.id, details: q.quoteNumber, request });
    return ok({ id: q.id, deleted: true });
  } catch (err) {
    return errorResponse(err, "quotations.delete.route_error");
  }
}

const ConvertSchema = z.object({
  action: z.enum(["convert-job", "convert-invoice"]),
  propertyId: z.string().max(64).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledTimeSlot: z.string().regex(/^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$/).optional(),
  assignedManagerId: z.string().max(64).optional(),
});

/**
 * POST /api/quotations/[id] { action }:
 *   duplicate | share | accept | decline | convert-job | convert-invoice
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("quotes.manage");
    const body = (await readJson(request)) ?? {};
    const action = typeof body.action === "string" ? body.action : "";
    const q = await prisma.quote.findUnique({ where: { id: params.id } });
    if (!q) return fail("Quotation not found.", 404);

    if (action === "duplicate") {
      const today = new Date(Date.now() + 330 * 60 * 1000);
      const settings = await getSystemSettings();
      const valid = new Date(today.getTime() + settings.quotationValidityDays * 86400000).toISOString().slice(0, 10);
      const copy = await prisma.quote.create({
        data: {
          quoteNumber: await nextQuoteNumber(),
          customerId: q.customerId, propertyId: q.propertyId, serviceId: q.serviceId, items: (q.items ?? []) as Prisma.InputJsonValue,
          quoteType: q.quoteType, gstRate: q.gstRate, cgst: q.cgst, sgst: q.sgst, igst: q.igst, interState: q.interState, customerGstin: q.customerGstin,
          subtotal: q.subtotal, tax: q.tax, discount: q.discount, total: q.total, validUntil: valid,
          terms: q.terms, paymentTerms: q.paymentTerms, notes: q.notes, status: "draft",
        },
      });
      void recordAudit({ actor: user, action: "QUOTE_DUPLICATED", entityType: "quote", entityId: copy.id, details: `from ${q.quoteNumber}`, request });
      return ok(serializeQuote(copy), 201);
    }

    if (action === "share") {
      const url = await ensureQuoteShareLink(q.id);
      if (q.status === "draft") await prisma.quote.update({ where: { id: q.id }, data: { status: "sent" } });
      return ok({ url });
    }

    if (action === "accept" || action === "decline") {
      if (q.status === "converted_to_job") return fail("This quotation is already a job.", 409);
      const updated = await prisma.quote.update({
        where: { id: q.id },
        data: action === "accept" ? { status: "accepted", acceptedAt: new Date(), acceptedBy: `Recorded by ${user.name}` } : { status: "declined", acceptedAt: null, acceptedBy: null },
      });
      void recordAudit({ actor: user, action: action === "accept" ? "QUOTE_ACCEPTED" : "QUOTE_DECLINED", entityType: "quote", entityId: q.id, request });
      return ok(serializeQuote(updated));
    }

    if (action === "convert-job" || action === "convert-invoice") {
      const parsed = ConvertSchema.safeParse(body);
      if (!parsed.success) return fail("Pick a date and a time window.", 400);
      const d = parsed.data;
      const settings = await getSystemSettings();
      const lines = parseLines(q.items);
      if (!lines.length) return fail("This quotation has no lines.", 400);

      // Already a job: "Convert to Invoice" refreshes that job's draft invoice from the quotation.
      if (q.jobId) {
        if (action === "convert-job") return fail("This quotation is already a job.", 409);
        const invoice = await prisma.invoice.findFirst({ where: { jobId: q.jobId, status: { not: "CANCELLED" } }, orderBy: { issuedAt: "desc" } });
        if (!invoice) return fail("The job has no invoice.", 404);
        if (invoice.finalizedAt || invoice.amountPaid > 0) return ok({ jobId: q.jobId, invoiceId: invoice.id, unchanged: true });
        const f = computeInvoiceFigures({ invoiceType: q.quoteType === "NON_GST" ? "NON_GST" : "GST", subtotal: q.subtotal, discount: q.discount, gstRatePercent: settings.taxRatePercent, interState: q.interState });
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            items: lines as unknown as Prisma.InputJsonValue, subtotal: f.subtotal, discount: f.discount, tax: f.tax, gstRate: f.gstRate, cgst: f.cgst, sgst: f.sgst, igst: f.igst,
            interState: f.invoiceType === "GST" && q.interState, invoiceType: f.invoiceType, customerGstin: f.invoiceType === "GST" ? q.customerGstin : null,
            supplierGstin: f.invoiceType === "GST" ? settings.gstin?.trim() || null : null, total: f.total, balanceDue: f.total, quoteId: q.id,
            ...(f.invoiceType !== invoice.invoiceType ? { invoiceNumber: await nextInvoiceNumber(prisma, f.invoiceType) } : {}),
          },
        });
        return ok({ jobId: q.jobId, invoiceId: invoice.id });
      }

      if (q.status === "declined") return fail("A declined quotation can't be converted. Duplicate it to send a new one.", 409);
      const propertyId = q.propertyId ?? d.propertyId;
      if (!propertyId) return fail("Pick the property for this job.", 400);
      if (!d.scheduledDate || !d.scheduledTimeSlot) return fail("Pick a date and a time window.", 400);
      const crew = await validateCrew(user, { assignedManagerId: d.assignedManagerId, scheduledDate: d.scheduledDate, scheduledTimeSlot: d.scheduledTimeSlot });

      // The job's primary service: the first catalogue line, or — for an all-custom
      // quotation — a custom service created from it (so jobs, reports and the
      // customer page all work as usual).
      let serviceId = lines.find((l) => l.serviceId)?.serviceId ?? null;
      if (!serviceId) {
        const first = lines[0];
        const custom = await prisma.service.create({
          data: {
            name: first.description.slice(0, 120),
            slug: `custom-${q.quoteNumber.toLowerCase()}-${Date.now().toString(36)}`,
            description: lines.map((l) => l.description).join("; ").slice(0, 500),
            basePrice: q.subtotal,
            estimatedDurationHours: 4,
            isCustom: true,
            gstTreatment: q.quoteType,
            notes: `Created from quotation ${q.quoteNumber}`,
          },
        });
        serviceId = custom.id;
      }
      const { job, invoice } = await createJobWithInvoice(
        {
          customerId: q.customerId,
          propertyId,
          serviceId,
          scheduledDate: d.scheduledDate,
          scheduledTimeSlot: d.scheduledTimeSlot,
          assignedManagerId: crew.assignedManagerId,
          assignedStaffIds: [],
          notes: `From quotation ${q.quoteNumber}`,
          quoteId: q.id,
          invoice: { type: q.quoteType === "NON_GST" ? "NON_GST" : "GST", interState: q.interState, items: lines, discount: q.discount, customerGstin: q.customerGstin },
        },
        settings
      ).catch((e) => {
        throw e instanceof HttpError ? e : new HttpError(500, "Could not create the job.");
      });
      await prisma.quote.update({ where: { id: q.id }, data: { status: "converted_to_job", jobId: job.id, propertyId } });
      afterJobCreated(job.id, user);
      void recordAudit({ actor: user, action: "QUOTE_CONVERTED", entityType: "quote", entityId: q.id, jobId: job.id, newState: job.status, details: `${q.quoteNumber} → ${job.jobSerial}`, request });
      return ok({ jobId: job.id, jobNumber: job.jobSerial, invoiceId: invoice.id }, 201);
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "quotations.action.route_error");
  }
}
