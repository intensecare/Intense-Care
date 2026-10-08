import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { istDayStart } from "@/lib/server/invoices";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GET /api/invoices/report?from&to — GST summary by month.
 * GST invoices ONLY (Non-GST invoices are never part of a GST report),
 * cancelled invoices excluded. Admin and Tax Officer (gst.reports).
 */
export async function GET(request: Request) {
  try {
    await requirePermission("gst.reports");
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const issuedAt: { gte?: Date; lt?: Date } = {};
    if (from && DATE.test(from)) issuedAt.gte = istDayStart(from);
    if (to && DATE.test(to)) issuedAt.lt = new Date(istDayStart(to).getTime() + 24 * 60 * 60 * 1000);

    const rows = await prisma.invoice.findMany({
      where: { invoiceType: "GST", status: { not: "CANCELLED" }, ...(Object.keys(issuedAt).length ? { issuedAt } : {}) },
      select: { issuedAt: true, subtotal: true, discount: true, cgst: true, sgst: true, igst: true, tax: true, total: true },
      orderBy: { issuedAt: "asc" },
      take: 10000,
    });

    type Bucket = { month: string; invoices: number; taxable: number; cgst: number; sgst: number; igst: number; totalGst: number; grandTotal: number };
    const empty = (month: string): Bucket => ({ month, invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalGst: 0, grandTotal: 0 });
    const byMonth = new Map<string, Bucket>();
    const totals = empty("TOTAL");
    for (const r of rows) {
      const ist = new Date(r.issuedAt.getTime() + 330 * 60 * 1000);
      const month = ist.toISOString().slice(0, 7);
      const b = byMonth.get(month) ?? empty(month);
      for (const t of [b, totals]) {
        t.invoices += 1;
        t.taxable += r.subtotal - r.discount;
        t.cgst += r.cgst;
        t.sgst += r.sgst;
        t.igst += r.igst;
        t.totalGst += r.tax;
        t.grandTotal += r.total;
      }
      byMonth.set(month, b);
    }
    const tidy = (b: Bucket): Bucket => ({ ...b, taxable: round2(b.taxable), cgst: round2(b.cgst), sgst: round2(b.sgst), igst: round2(b.igst), totalGst: round2(b.totalGst), grandTotal: round2(b.grandTotal) });
    return ok({ months: Array.from(byMonth.values()).map(tidy).reverse(), totals: tidy(totals) });
  } catch (err) {
    return errorResponse(err, "invoices.report.route_error");
  }
}
