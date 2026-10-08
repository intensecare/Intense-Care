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
            service: { select: { name: true } },
            property: { select: { address: true, city: true, postalCode: true } },
            customer: { select: { name: true, phone: true, email: true, address: true, gstin: true } },
            locationAddress: true,
          },
        },
      },
    });
    if (!row) {
      logger.info("invoices.detail_not_visible", { userId: user.id, role: user.role, invoiceId: params.id });
      return fail("Invoice not found.", 404);
    }

    const settings = await getSystemSettings();
    const full = can(user, "finance.view");
    const c = row.job.customer;
    return ok({
      invoice: serializeInvoice(row),
      job: {
        id: full ? row.job.id : undefined,
        jobNumber: row.job.jobSerial,
        serviceName: row.job.service.name,
        serviceDate: row.job.scheduledDate,
      },
      customer: {
        name: c.name,
        address: row.billingAddress || c.address || [row.job.property.address, row.job.property.city, row.job.property.postalCode].filter(Boolean).join(", "),
        serviceAddress: row.serviceAddress || row.job.locationAddress || [row.job.property.address, row.job.property.city].filter(Boolean).join(", "),
        gstin: row.customerGstin ?? undefined,
        // Contact details are for Admin only — a Tax Officer sees what a GST invoice needs.
        phone: full ? c.phone : undefined,
        email: full ? c.email || undefined : undefined,
      },
      company: {
        name: settings.companyName,
        address: settings.companyAddress,
        phone: settings.companyPhone,
        email: settings.companyEmail,
        gstin: row.invoiceType === "GST" ? row.supplierGstin || settings.gstin || "" : "",
        sacCode: row.invoiceType === "GST" ? settings.sacCode || "" : "",
        tagline: settings.companyTagline,
        logo: settings.logoDataUrl,
        signature: settings.signatureDataUrl,
        signatoryName: settings.signatoryName,
      },
    });
  } catch (err) {
    return errorResponse(err, "invoices.detail.route_error");
  }
}
