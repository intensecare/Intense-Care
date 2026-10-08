import { prisma } from "@/lib/server/prisma";
import { requireAnyPermission } from "@/lib/server/authz";
import { invoiceWhereFor } from "@/lib/server/invoices";
import { errorResponse } from "@/lib/server/http";
import { serializeInvoice, ok, fail } from "@/lib/server/serialize";
import { getSystemSettings } from "@/lib/server/settings";
import { logger } from "@/lib/server/logger";
import { can } from "@/lib/rbac";

/**
 * GET /api/invoices/[id] — one invoice, ready to print.
 * The lookup itself carries the GST-only rule for a Tax Officer, so a
 * Non-GST invoice id answers 404 exactly like an id that does not exist.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireAnyPermission(["finance.view", "gst.view"]);
    const scope = invoiceWhereFor(user);
    if (!scope) return fail("Your role is not authorized for invoices.", 403);

    const row = await prisma.invoice.findFirst({
      where: { AND: [{ id: params.id }, scope] },
      include: {
        job: {
          select: {
            id: true,
            jobSerial: true,
            scheduledDate: true,
            scheduledTimeSlot: true,
            serviceAddress: true,
            service: { select: { name: true } },
            property: { select: { address: true, city: true, postalCode: true } },
            customer: { select: { name: true, phone: true, email: true, address: true, gstin: true } },
            // §3/§5 Every priced service becomes a line on the invoice.
            serviceLines: { orderBy: { position: "asc" } },
          },
        },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    if (!row) {
      logger.info("invoices.detail_not_visible", { userId: user.id, role: user.role, invoiceId: params.id });
      return fail("Invoice not found.", 404);
    }

    const settings = await getSystemSettings();
    const full = can(user, "finance.view");
    const c = row.job.customer;
    const propertyAddress = [row.job.property.address, row.job.property.city, row.job.property.postalCode]
      .filter(Boolean)
      .join(", ");
    return ok({
      invoice: serializeInvoice(row),
      job: {
        id: full ? row.job.id : undefined,
        jobNumber: row.job.jobSerial,
        serviceName: row.job.service.name,
        serviceDate: row.job.scheduledDate,
        serviceTimeSlot: row.job.scheduledTimeSlot,
        // §5 Where the service was carried out, as a separate block from the
        // billing address.
        serviceAddress: row.job.serviceAddress || propertyAddress,
      },
      // §5 The item table. One line per service that was sold.
      lines: row.job.serviceLines.map((l) => ({
        name: l.name,
        description: l.description || undefined,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxable: l.taxable,
        amount: Math.round((l.quantity * l.unitPrice - l.discount) * 100) / 100,
      })),
      // Payment history is Admin-only; a Tax Officer reads the GST document.
      payments: full
        ? row.payments.map((p) => ({
            id: p.id,
            amount: p.amount,
            paymentMethod: p.paymentMethod,
            transactionReference: p.transactionReference,
            paidAt: p.paidAt.toISOString(),
          }))
        : [],
      customer: {
        name: c.name,
        address: c.address || propertyAddress,
        gstin: row.customerGstin ?? undefined,
        // Contact details are for Admin only — a Tax Officer sees what a GST invoice needs.
        phone: full ? c.phone : undefined,
        email: full ? c.email || undefined : undefined,
      },
      company: {
        name: settings.companyName,
        tagline: settings.companyTagline || "",
        address: settings.companyAddress,
        phone: settings.companyPhone,
        email: settings.companyEmail,
        gstin: row.invoiceType === "GST" ? row.supplierGstin || settings.gstin || "" : "",
        sacCode: row.invoiceType === "GST" ? settings.sacCode || "" : "",
        logoUrl: settings.companyLogoUrl || "",
        paymentTerms: settings.paymentTerms || "",
        // Bank details belong on the invoice only while money is owed, and
        // only for the Admin desk that issues it.
        bankDetails: full ? settings.bankDetails || "" : "",
      },
    });
  } catch (err) {
    return errorResponse(err, "invoices.detail.route_error");
  }
}
