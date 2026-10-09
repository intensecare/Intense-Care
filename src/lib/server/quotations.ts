import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./authz";
import { financialYear } from "./invoices";
import { resolveBaseUrl } from "./policy";
import { generateToken, hashToken, sealToken, openToken } from "./qr-service";
import { computeInvoiceFigures, GSTIN_PATTERN } from "@/lib/tax";
import type { SystemSettings, QuoteLine } from "@/lib/types";

/**
 * Quotations — line items (catalogue services and one-off custom lines),
 * GST or Non-GST, discount, terms, validity, a share link the customer can
 * accept from, and conversion into a Job and its Invoice.
 */

export const LineSchema = z.object({
  serviceId: z.string().max(64).nullable().optional(),
  description: z.string().trim().max(300).default(""),
  quantity: z.number().positive().max(100000),
  rate: z.number().min(0).max(10_000_000),
});

const GstinField = z
  .string()
  .max(20)
  .transform((v) => v.trim().toUpperCase())
  .refine((v) => v === "" || GSTIN_PATTERN.test(v), "Customer GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5.");

export const QuoteInputSchema = z.object({
  customerId: z.string().min(1).max(64),
  propertyId: z.string().max(64).nullable().optional(),
  items: z.array(LineSchema).min(1, "Add at least one service.").max(50),
  discount: z.number().min(0).max(10_000_000).default(0),
  quoteType: z.enum(["GST", "NON_GST"]).default("GST"),
  interState: z.boolean().default(false),
  customerGstin: GstinField.optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid-until date."),
  terms: z.string().max(4000).optional(),
  paymentTerms: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["draft", "sent"]).default("sent"),
});
export type QuoteInput = z.infer<typeof QuoteInputSchema>;

/** Normalised lines + money, computed by the same GST maths as invoices. */
export async function buildQuoteData(input: QuoteInput, settings: SystemSettings) {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true, gstin: true } });
  if (!customer) throw new HttpError(404, "Customer not found.");
  if (input.propertyId) {
    const prop = await prisma.property.findUnique({ where: { id: input.propertyId }, select: { customerId: true } });
    if (!prop || prop.customerId !== customer.id) throw new HttpError(400, "That property does not belong to this customer.");
  }
  const ids = input.items.map((l) => l.serviceId).filter((x): x is string => !!x);
  const services = ids.length ? await prisma.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const byId = new Map(services.map((s) => [s.id, s]));
  const items: QuoteLine[] = input.items.map((l) => {
    const svc = l.serviceId ? byId.get(l.serviceId) : undefined;
    if (l.serviceId && !svc) throw new HttpError(400, "One of the services no longer exists.");
    const description = l.description || svc?.name || "";
    if (!description) throw new HttpError(400, "Every custom line needs a description.");
    return { serviceId: svc?.id ?? null, description, quantity: l.quantity, rate: l.rate, amount: Math.round(l.quantity * l.rate * 100) / 100, custom: !svc };
  });
  const subtotal = Math.round(items.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  if (input.discount > subtotal) throw new HttpError(400, "The discount can't be more than the subtotal.");
  const f = computeInvoiceFigures({ invoiceType: input.quoteType, subtotal, discount: input.discount, gstRatePercent: settings.taxRatePercent, interState: input.interState });
  const gst = f.invoiceType === "GST";
  return {
    customerId: customer.id,
    propertyId: input.propertyId || null,
    serviceId: items.find((l) => l.serviceId)?.serviceId ?? null,
    items: items as unknown as Prisma.InputJsonValue,
    quoteType: f.invoiceType,
    gstRate: f.gstRate,
    cgst: f.cgst,
    sgst: f.sgst,
    igst: f.igst,
    interState: gst && input.interState,
    customerGstin: gst ? input.customerGstin || customer.gstin || null : null,
    subtotal: f.subtotal,
    discount: f.discount,
    tax: f.tax,
    total: f.total,
    validUntil: input.validUntil,
    terms: input.terms ?? settings.quotationTerms,
    paymentTerms: input.paymentTerms ?? settings.quotationPaymentTerms,
    notes: input.notes ?? null,
  };
}

/** QT-2627-00001 — its own number series. */
export async function nextQuoteNumber(db: PrismaClient | Prisma.TransactionClient = prisma): Promise<string> {
  const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('"quote_seq"') AS n`);
  return `QT-${financialYear()}-${String(n).padStart(5, "0")}`;
}

/** The quotation's share link (created once, then the same link is re-used). */
export async function ensureQuoteShareLink(quoteId: string): Promise<string> {
  const q = await prisma.quote.findUnique({ where: { id: quoteId }, select: { shareTokenEnc: true } });
  if (!q) throw new HttpError(404, "Quotation not found.");
  let raw = q.shareTokenEnc ? openToken(q.shareTokenEnc) : null;
  if (!raw) {
    raw = generateToken();
    await prisma.quote.update({ where: { id: quoteId }, data: { shareTokenHash: hashToken(raw), shareTokenEnc: sealToken(raw) } });
  }
  return `${resolveBaseUrl(null)}/customer/quote/${raw}`;
}

/** Looks a quotation up by its share token (hash only). */
export async function quoteByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return null;
  return prisma.quote.findUnique({ where: { shareTokenHash: hashToken(token) } });
}

/** Everything a printed quotation needs. `internal` adds desk-only fields. */
export async function quoteDocument(id: string, settings: SystemSettings) {
  const q = await prisma.quote.findUnique({ where: { id } });
  if (!q) throw new HttpError(404, "Quotation not found.");
  const [customer, property, job] = await Promise.all([
    prisma.customer.findUnique({ where: { id: q.customerId }, select: { name: true, phone: true, email: true, address: true, gstin: true } }),
    q.propertyId ? prisma.property.findUnique({ where: { id: q.propertyId }, select: { title: true, address: true, city: true } }) : null,
    q.jobId ? prisma.job.findUnique({ where: { id: q.jobId }, select: { jobSerial: true, invoices: { select: { id: true }, take: 1 } } }) : null,
  ]);
  return {
    q,
    customer: customer ?? { name: "Customer", phone: "", email: "", address: "", gstin: null },
    property: property ? { title: property.title, address: [property.address, property.city].filter(Boolean).join(", ") } : null,
    job: job ? { id: q.jobId!, jobNumber: job.jobSerial, invoiceId: job.invoices[0]?.id ?? null } : null,
    company: {
      name: settings.companyName,
      tagline: settings.companyTagline,
      address: settings.companyAddress,
      phone: settings.companyPhone,
      email: settings.companyEmail,
      gstin: settings.gstin,
      sacCode: settings.sacCode,
      logo: settings.logoDataUrl,
      signature: settings.signatureDataUrl,
      signatoryName: settings.signatoryName,
    },
  };
}
