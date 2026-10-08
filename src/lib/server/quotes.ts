/**
 * §4 Quotation helpers — numbering and the document payload.
 *
 * A quotation is a real business document: it carries the company identity,
 * the priced service lines, the GST split and its own terms, so the PDF the
 * customer receives is exactly what was quoted — and the job and invoice it
 * converts into inherit the same figures.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { financialYear } from "./invoices";
import { getSystemSettings } from "./settings";
import { parseStoredLines } from "@/lib/documents";
import type { SystemSettings } from "@/lib/types";

type Db = PrismaClient | Prisma.TransactionClient;

/** Quotation numbers run in their own financial-year series: QTN-2627-00001. */
export async function nextQuoteNumber(db: Db): Promise<string> {
  const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('"quote_seq"') AS n`);
  return `QTN-${financialYear()}-${String(n).padStart(5, "0")}`;
}

/** YYYY-MM-DD, `days` from today, for the default quotation validity. */
export function validUntilFrom(days: number): string {
  const d = new Date(Date.now() + Math.max(1, days) * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export interface DocumentCompany {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  sacCode: string;
  logoUrl: string;
  paymentTerms: string;
  serviceTerms: string;
  bankDetails: string;
}

/** The company block printed at the top of every quotation and invoice. */
export function documentCompany(settings: SystemSettings): DocumentCompany {
  return {
    name: settings.companyName || "",
    tagline: settings.companyTagline || "",
    address: settings.companyAddress || "",
    phone: settings.companyPhone || "",
    email: settings.companyEmail || "",
    gstin: settings.gstin || "",
    sacCode: settings.sacCode || "",
    logoUrl: settings.companyLogoUrl || "",
    paymentTerms: settings.paymentTerms || "",
    serviceTerms: settings.serviceTerms || "",
    bankDetails: settings.bankDetails || "",
  };
}

/**
 * Everything the quotation document needs, in one payload: the quotation, its
 * priced lines, the customer, the service address and the company identity.
 */
export async function quoteDocument(db: PrismaClient, quoteId: string) {
  const quote = await db.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return null;

  const [customer, property, settings, job] = await Promise.all([
    db.customer.findUnique({
      where: { id: quote.customerId },
      select: { name: true, phone: true, email: true, address: true, gstin: true },
    }),
    db.property.findUnique({ where: { id: quote.propertyId }, select: { title: true, address: true } }),
    getSystemSettings(),
    quote.jobId ? db.job.findUnique({ where: { id: quote.jobId }, select: { jobSerial: true } }) : Promise.resolve(null),
  ]);

  const lines = parseStoredLines(quote.items).map((l) => ({
    ...l,
    amount: Math.round((l.quantity * l.unitPrice - l.discount) * 100) / 100,
  }));

  return {
    quote: {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      createdAt: quote.createdAt.toISOString(),
      validUntil: quote.validUntil,
      status: quote.status,
      invoiceType: quote.invoiceType === "NON_GST" ? ("NON_GST" as const) : ("GST" as const),
      subtotal: quote.subtotal,
      discount: quote.discount,
      taxable: Math.round((quote.subtotal - quote.discount) * 100) / 100,
      gstRate: quote.gstRate,
      cgst: quote.cgst,
      sgst: quote.sgst,
      igst: quote.igst,
      interState: quote.interState,
      tax: quote.tax,
      total: quote.total,
      paymentTerms: quote.paymentTerms || settings.paymentTerms || "",
      serviceTerms: quote.serviceTerms || settings.serviceTerms || "",
      notes: quote.notes || "",
      acceptedAt: quote.acceptedAt?.toISOString() ?? null,
      acceptedBy: quote.acceptedBy ?? null,
      jobId: quote.jobId ?? null,
      jobNumber: job?.jobSerial ?? null,
      lines,
    },
    customer: {
      name: customer?.name ?? "Customer",
      phone: customer?.phone ?? "",
      email: customer?.email ?? "",
      address: customer?.address ?? "",
      gstin: customer?.gstin ?? undefined,
    },
    serviceAddress: quote.serviceAddress || property?.address || customer?.address || "",
    propertyTitle: property?.title ?? "",
    company: documentCompany(settings),
  };
}

export type QuoteDocumentPayload = NonNullable<Awaited<ReturnType<typeof quoteDocument>>>;
