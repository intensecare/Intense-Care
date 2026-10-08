import type { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import { can } from "@/lib/rbac";
import type { InvoiceType } from "@/lib/tax";

/**
 * Invoice access — the ONE rule every invoice API goes through.
 *   finance.view (Admin)      → every invoice, GST and Non-GST
 *   gst.view     (Tax Officer) → GST invoices ONLY (invoiceType = 'GST')
 *   anyone else               → nothing
 * The filter is applied in the database query, so a Tax Officer who edits a
 * URL or an API request can still never read a Non-GST invoice.
 */
export function invoiceWhereFor(user: SessionUser): Prisma.InvoiceWhereInput | null {
  if (can(user, "finance.view")) return {};
  if (can(user, "gst.view")) return { invoiceType: "GST" };
  return null;
}

/** Indian financial year of a date, e.g. 2026-10-08 → "2627" (Apr–Mar). */
export function financialYear(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

/**
 * Next invoice number. GST and Non-GST invoices use SEPARATE number series
 * so the two never mix: GST-2627-00001 … and INV-2627-00001 …
 */
export async function nextInvoiceNumber(db: PrismaClient | Prisma.TransactionClient, type: InvoiceType): Promise<string> {
  const seq = type === "GST" ? "gst_invoice_seq" : "non_gst_invoice_seq";
  const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('"${seq}"') AS n`);
  return `${type === "GST" ? "GST" : "INV"}-${financialYear()}-${String(n).padStart(5, "0")}`;
}

/** Start of a YYYY-MM-DD day in IST, as a UTC Date (for date filters). */
export function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}
