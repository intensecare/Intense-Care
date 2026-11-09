import { prisma } from "@/lib/server/prisma";
import type { SessionUser } from "@/lib/server/session";
import { HttpError } from "@/lib/server/authz";
import { invoiceWhereFor } from "@/lib/server/invoices";
import { serializeInvoice } from "@/lib/server/serialize";
import { getSystemSettings } from "@/lib/server/settings";
import { logger } from "@/lib/server/logger";
import { can } from "@/lib/rbac";

/**
 * One invoice as a printable document — the single source for the invoice page AND the invoice PDF, so the two can
 * never disagree. The lookup carries the GST-only rule for a Tax Officer: a Non-GST invoice id answers 404 exactly
 * like an id that does not exist. Contact details are for Admin only.
 */
export async function loadInvoiceDetail(user: SessionUser, id: string) {
  const scope = invoiceWhereFor(user);
  if (!scope) throw new HttpError(403, "Your role is not authorized for invoices.");
  const row = await prisma.invoice.findFirst({
    where: { AND: [{ id }, scope] },
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
    logger.info("invoices.detail_not_visible", { userId: user.id, role: user.role, invoiceId: id });
    throw new HttpError(404, "Invoice not found.");
  }
  const settings = await getSystemSettings();
  const full = can(user, "finance.view");
  const c = row.job?.customer;
  const quote = row.quoteId ? await prisma.quote.findUnique({ where: { id: row.quoteId }, select: { quoteNumber: true } }) : null;
  return {
    invoice: serializeInvoice(row),
    quoteNumber: quote?.quoteNumber ?? null,
    upi: settings.upi?.enabled && settings.upi.vpa ? { vpa: settings.upi.vpa, payeeName: settings.upi.payeeName } : null,
    job: row.job
      ? {
          id: full ? row.job.id : undefined,
          jobNumber: row.job.jobSerial,
          serviceName: row.job.service?.name ?? "Service",
          serviceDate: row.job.scheduledDate,
        }
      : {
          id: undefined,
          jobNumber: "—",
          serviceName: "Service",
          serviceDate: "—",
        },
    customer: {
      name: c?.name || "Customer",
      address:
        row.billingAddress ||
        c?.address ||
        [row.job?.property?.address, row.job?.property?.city, row.job?.property?.postalCode]
          .filter(Boolean)
          .join(", ") ||
        "—",
      serviceAddress:
        row.serviceAddress ||
        row.job?.locationAddress ||
        [row.job?.property?.address, row.job?.property?.city].filter(Boolean).join(", ") ||
        "—",
      gstin: row.customerGstin ?? undefined,
      // Contact details are for Admin only — a Tax Officer sees what a GST invoice needs.
      phone: full ? c?.phone : undefined,
      email: full ? c?.email || undefined : undefined,
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
  };
}
