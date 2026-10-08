import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson, serializeQuote, serializeInvoice } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { recordActivity } from "@/lib/server/activity";
import { getSystemSettings } from "@/lib/server/settings";
import { quoteDocument } from "@/lib/server/quotes";
import { parseStoredLines } from "@/lib/documents";
import { writeJobServiceLines } from "@/lib/server/service-lines";
import { nextJobSerial } from "@/lib/server/job-serial";
import { nextInvoiceNumber } from "@/lib/server/invoices";
import { normalizeVisibility, DEFAULT_CUSTOMER_VISIBILITY } from "@/lib/visibility";
import { logger } from "@/lib/server/logger";

/**
 * /api/quotes/[id] — one quotation.
 *
 *   GET    → the full document payload (company, customer, lines, GST, terms)
 *   PATCH  → send | accept | decline | convert-to-job
 *   DELETE → remove an open quotation (a converted one is job history)
 */

/** GET /api/quotes/[id] — everything the printable document needs. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("quotes.manage");
    const doc = await quoteDocument(prisma, params.id);
    if (!doc) return fail("Quotation not found.", 404);
    return ok(doc);
  } catch (err) {
    return errorResponse(err, "quotes.get_one.route_error");
  }
}

const PatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({
    action: z.literal("accept"),
    /** Who accepted — printed on the document as the acceptance record. */
    acceptedBy: z.string().min(2).max(120),
  }),
  z.object({ action: z.literal("decline"), reason: z.string().max(500).optional() }),
  z.object({
    action: z.literal("convert"),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduledTimeSlot: z
      .string()
      .min(1)
      .max(80)
      .regex(
        /^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$|^\d{1,2}:\d{2}\s*[AP]M\s*[-–]\s*\d{1,2}:\d{2}\s*[AP]M$/i,
        "Time window must be a from to range, e.g. 09:00 - 13:30"
      ),
    assignedManagerId: z.string().max(64).optional(),
    notes: z.string().max(2000).optional(),
  }),
]);

/** PATCH /api/quotes/[id] — move the quotation along its lifecycle. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const parsed = PatchSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail("Invalid quotation action.", 400);
    const body = parsed.data;

    if (body.action === "convert") {
      // Converting is a booking: it needs the booking permission too.
      const { user } = await requireAnyPermission(["quotes.manage", "jobs.create"]);
      const quote = await prisma.quote.findUnique({ where: { id: params.id } });
      if (!quote) return fail("Quotation not found.", 404);
      if (quote.status === "converted_to_job") {
        return fail("This quotation has already become a job.", 409);
      }
      if (quote.status === "declined") return fail("A declined quotation cannot be converted.", 409);

      const [customer, property, settings] = await Promise.all([
        prisma.customer.findUnique({ where: { id: quote.customerId }, select: { name: true, gstin: true } }),
        prisma.property.findUnique({ where: { id: quote.propertyId }, select: { lat: true, lng: true, address: true } }),
        getSystemSettings(),
      ]);
      if (!customer) return fail("Customer not found.", 404);

      const lines = parseStoredLines(quote.items);
      if (lines.length === 0) return fail("This quotation has no priced services to convert.", 409);
      const isGst = quote.invoiceType === "GST";
      const visibility = normalizeVisibility(
        settings.defaultCustomerVisibility,
        DEFAULT_CUSTOMER_VISIBILITY
      );

      const { job, invoice } = await prisma.$transaction(async (tx) => {
        const createdJob = await tx.job.create({
          data: {
            jobSerial: await nextJobSerial(tx, customer.name, body.scheduledDate),
            customerId: quote.customerId,
            propertyId: quote.propertyId,
            serviceId: quote.serviceId,
            scheduledDate: body.scheduledDate,
            scheduledTimeSlot: body.scheduledTimeSlot,
            assignedManagerId: body.assignedManagerId ?? null,
            assignedStaffIds: body.assignedManagerId ? [body.assignedManagerId] : [],
            status: body.assignedManagerId ? "ASSIGNED" : "SCHEDULED",
            // The quoted figures are inherited exactly: the job value is the
            // net service value and the GST stays on the invoice.
            amount: Math.round((quote.subtotal - quote.discount) * 100) / 100,
            notes: body.notes ?? `Converted from quotation ${quote.quoteNumber}`,
            // §1 The quotation address becomes the service location; the pin
            // comes from the property when it has one.
            serviceAddress: quote.serviceAddress || property?.address || null,
            serviceLat: property?.lat ?? null,
            serviceLng: property?.lng ?? null,
            customerVisibility: visibility,
          },
        });

        // §3 The quoted lines become the job service lines, unchanged.
        await writeJobServiceLines(
          tx,
          createdJob.id,
          lines.map((l) => ({ ...l, serviceId: l.serviceId ?? null }))
        );

        // The primary service rubric becomes the working checklist.
        const rubric = await tx.serviceChecklistItem.findMany({
          where: { serviceId: quote.serviceId },
          orderBy: { position: "asc" },
        });
        if (rubric.length > 0) {
          await tx.jobChecklistItem.createMany({
            data: rubric.map((item) => ({
              jobId: createdJob.id,
              area: item.area,
              task: item.task,
              critical: item.critical,
            })),
          });
        }

        const createdInvoice = await tx.invoice.create({
          data: {
            invoiceNumber: await nextInvoiceNumber(tx, isGst ? "GST" : "NON_GST"),
            invoiceType: isGst ? "GST" : "NON_GST",
            jobId: createdJob.id,
            customerId: quote.customerId,
            subtotal: quote.subtotal,
            discount: quote.discount,
            tax: quote.tax,
            gstRate: isGst ? quote.gstRate : 0,
            cgst: isGst ? quote.cgst : 0,
            sgst: isGst ? quote.sgst : 0,
            igst: isGst ? quote.igst : 0,
            interState: isGst && quote.interState,
            customerGstin: isGst ? customer.gstin ?? null : null,
            supplierGstin: isGst ? settings.gstin?.trim() || null : null,
            total: quote.total,
            balanceDue: quote.total,
            dueDate: body.scheduledDate,
          },
        });

        await tx.customer.update({ where: { id: quote.customerId }, data: { totalBookings: { increment: 1 } } });
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: "converted_to_job", jobId: createdJob.id },
        });
        return { job: createdJob, invoice: createdInvoice };
      });

      // ONE QR per job — minted here exactly as a directly-booked job.
      void (async () => {
        try {
          const { ensureCustomerLink } = await import("@/lib/server/qr-service");
          await ensureCustomerLink(job.id, { id: user.id, name: user.name });
        } catch (e) {
          logger.warn("quotes.customer_link_ensure_failed", {
            jobId: job.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      await recordActivity({
        jobId: job.id,
        type: "STATUS_CHANGED",
        message: `Job created from quotation ${quote.quoteNumber}`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      void recordAudit({
        actor: user,
        action: "QUOTE_CONVERTED",
        entityType: "quote",
        entityId: quote.id,
        jobId: job.id,
        newState: job.status,
        details: quote.quoteNumber,
        request,
      });
      return ok({ jobId: job.id, jobNumber: job.jobSerial, invoice: serializeInvoice(invoice) }, 201);
    }

    const { user } = await requirePermission("quotes.manage");
    const quote = await prisma.quote.findUnique({ where: { id: params.id } });
    if (!quote) return fail("Quotation not found.", 404);
    if (quote.status === "converted_to_job") {
      return fail("This quotation has become a job and can no longer change.", 409);
    }

    if (body.action === "send") {
      const updated = await prisma.quote.update({ where: { id: quote.id }, data: { status: "sent" } });
      void recordAudit({
        actor: user,
        action: "QUOTE_SENT",
        entityType: "quote",
        entityId: quote.id,
        details: quote.quoteNumber,
        request,
      });
      return ok(serializeQuote(updated));
    }

    if (body.action === "accept") {
      const updated = await prisma.quote.update({
        where: { id: quote.id },
        data: { status: "accepted", acceptedAt: quote.acceptedAt ?? new Date(), acceptedBy: body.acceptedBy },
      });
      void recordAudit({
        actor: user,
        action: "QUOTE_ACCEPTED",
        entityType: "quote",
        entityId: quote.id,
        details: `${quote.quoteNumber} accepted by ${body.acceptedBy}`,
        request,
      });
      return ok(serializeQuote(updated));
    }

    // decline
    const updated = await prisma.quote.update({ where: { id: quote.id }, data: { status: "declined" } });
    void recordAudit({
      actor: user,
      action: "QUOTE_DECLINED",
      entityType: "quote",
      entityId: quote.id,
      details: quote.quoteNumber,
      reason: body.reason,
      request,
    });
    return ok(serializeQuote(updated));
  } catch (err) {
    return errorResponse(err, "quotes.patch.route_error");
  }
}

/** DELETE /api/quotes/[id] — remove an open quotation. */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("quotes.manage");
    const quote = await prisma.quote.findUnique({ where: { id: params.id } });
    if (!quote) return fail("Quotation not found.", 404);
    if (quote.status === "converted_to_job") {
      return fail("A converted quotation is part of job history and cannot be deleted.", 409);
    }
    await prisma.quote.delete({ where: { id: quote.id } });
    logger.info("quotes.deleted", { quoteId: quote.id, by: user.id });
    void recordAudit({
      actor: user,
      action: "QUOTE_DELETED",
      entityType: "quote",
      entityId: quote.id,
      details: quote.quoteNumber,
      request,
    });
    return ok({ id: quote.id, deleted: true });
  } catch (err) {
    return errorResponse(err, "quotes.delete.route_error");
  }
}
