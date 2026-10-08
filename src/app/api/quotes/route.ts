import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson, serializeQuote } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { getSystemSettings } from "@/lib/server/settings";
import { computeDocumentFigures } from "@/lib/documents";
import {
  ServiceSelectionSchema,
  ServiceLineError,
  resolveServiceLines,
  toStoredLines,
} from "@/lib/server/service-lines";
import { nextQuoteNumber, validUntilFrom } from "@/lib/server/quotes";
import { logger } from "@/lib/server/logger";

/**
 * /api/quotes — §4 professional quotations.
 *
 * A quotation prices one or many services (catalog or custom) for a customer
 * and property, stores its own GST split, and converts into a job + invoice
 * that inherit exactly the quoted figures. `quotes.manage` throughout, so
 * only the Admin desk can read or write them.
 */

/** GET /api/quotes — the quotation register, newest first. */
export async function GET() {
  try {
    await requirePermission("quotes.manage");
    const rows = await prisma.quote.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    return ok(rows.map(serializeQuote));
  } catch (err) {
    return errorResponse(err, "quotes.get.route_error");
  }
}

const CreateQuoteSchema = z.object({
  customerId: z.string().min(1).max(64),
  propertyId: z.string().min(1).max(64),
  /** §3 One or many services — catalog entries and/or custom services. */
  services: z.array(ServiceSelectionSchema).min(1).max(20),
  /** Printed on the document; defaults to the property address. */
  serviceAddress: z.string().max(500).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  invoiceType: z.enum(["GST", "NON_GST"]).default("GST"),
  interState: z.boolean().default(false),
  discount: z.number().min(0).max(10000000).optional(),
  paymentTerms: z.string().max(2000).optional(),
  serviceTerms: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * POST /api/quotes — raise a quotation. Prices come from the catalog unless
 * Admin overrides them; the GST split is computed and stored here so the
 * document can never drift from what the customer was shown.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("quotes.manage");
    const parsed = CreateQuoteSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid quotation payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const [customer, property, settings] = await Promise.all([
      prisma.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }),
      prisma.property.findUnique({ where: { id: d.propertyId }, select: { customerId: true, address: true } }),
      getSystemSettings(),
    ]);
    if (!customer) return fail("Customer not found.", 404);
    if (!property) return fail("Property not found.", 404);
    if (property.customerId !== d.customerId) return fail("Property does not belong to this customer.", 400);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const resolved = await resolveServiceLines(tx, { services: d.services });
        const figures = computeDocumentFigures({
          invoiceType: d.invoiceType,
          lines: resolved.lines,
          gstRatePercent: settings.taxRatePercent,
          interState: d.interState,
          documentDiscount: d.discount,
        });
        return tx.quote.create({
          data: {
            quoteNumber: await nextQuoteNumber(tx),
            customerId: d.customerId,
            propertyId: d.propertyId,
            serviceId: resolved.primaryServiceId,
            items: toStoredLines(resolved.lines),
            subtotal: figures.subtotal,
            discount: figures.discount,
            tax: figures.tax,
            total: figures.total,
            invoiceType: figures.invoiceType,
            gstRate: figures.gstRate,
            cgst: figures.cgst,
            sgst: figures.sgst,
            igst: figures.igst,
            interState: figures.invoiceType === "GST" && d.interState,
            serviceAddress: d.serviceAddress?.trim() || property.address || null,
            paymentTerms: d.paymentTerms?.trim() || settings.paymentTerms || null,
            serviceTerms: d.serviceTerms?.trim() || settings.serviceTerms || null,
            notes: d.notes?.trim() || null,
            validUntil: d.validUntil ?? validUntilFrom(settings.quotationValidityDays),
          },
        });
      });

      logger.info("quotes.created", { quoteId: created.id, by: user.id });
      void recordAudit({
        actor: user,
        action: "QUOTE_CREATED",
        entityType: "quote",
        entityId: created.id,
        details: `${created.quoteNumber} — ${created.invoiceType} — ${created.total}`,
        request,
      });
      return ok(serializeQuote(created), 201);
    } catch (e) {
      if (e instanceof ServiceLineError) return fail(e.message, e.status);
      throw e;
    }
  } catch (err) {
    return errorResponse(err, "quotes.post.route_error");
  }
}
