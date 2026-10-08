/**
 * §3 / §4 / §5 Document lines — the shared money model behind a quotation, a
 * job and its invoice.
 *
 * A job (or quotation) carries one or many priced service lines. The document
 * figures are ALWAYS derived from the lines here, so a quotation, the job
 * value and the invoice can never disagree:
 *
 *   line net  = quantity × unitPrice − discount
 *   subtotal  = Σ line gross
 *   discount  = Σ line discount  (+ a document-level discount, if any)
 *   taxable   = Σ net of GST-bearing lines   (tax-exempt lines are excluded)
 *   GST       = intra-state → CGST + SGST     inter-state → IGST
 *   total     = Σ all nets + GST
 *
 * A NON_GST document never carries GST figures at all (see lib/tax.ts).
 */

import type { InvoiceType } from "./tax";

export interface DocumentLine {
  /** Catalog service this line came from; null for a one-off custom line. */
  serviceId?: string | null;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  /** false = GST is never charged on this line (tax-exempt service). */
  taxable?: boolean;
  durationHours?: number;
}

export interface ComputedLine extends DocumentLine {
  taxable: boolean;
  discount: number;
  /** quantity × unitPrice */
  gross: number;
  /** gross − discount */
  net: number;
  /** GST charged on this line (0 on a Non-GST document or an exempt line). */
  tax: number;
  /** net + tax */
  total: number;
}

export interface DocumentFigures {
  invoiceType: InvoiceType;
  lines: ComputedLine[];
  subtotal: number;
  discount: number;
  /** The amount GST was actually charged on. */
  taxable: number;
  /** Net value of lines that carry no GST (exempt services). */
  exempt: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
  /** Total estimated duration of the services on the document, in hours. */
  durationHours: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPositive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** One line's gross / net / discount, with every input clamped to sane money. */
export function computeLine(line: DocumentLine): Omit<ComputedLine, "tax" | "total"> {
  const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1;
  const unitPrice = clampPositive(Number(line.unitPrice));
  const gross = round2(quantity * unitPrice);
  const discount = round2(Math.min(clampPositive(Number(line.discount ?? 0)), gross));
  return {
    ...line,
    quantity,
    unitPrice,
    taxable: line.taxable !== false,
    discount,
    gross,
    net: round2(gross - discount),
    durationHours: clampPositive(Number(line.durationHours ?? 0)),
  };
}

/**
 * The one calculation behind every document. `documentDiscount` is an extra
 * whole-document discount; it reduces the taxable base proportionally across
 * the GST-bearing lines so the GST shown always matches the total charged.
 */
export function computeDocumentFigures(input: {
  invoiceType: InvoiceType;
  lines: DocumentLine[];
  gstRatePercent: number;
  interState?: boolean;
  documentDiscount?: number;
}): DocumentFigures {
  const base = input.lines.map(computeLine);
  const subtotal = round2(base.reduce((a, l) => a + l.gross, 0));
  const lineDiscounts = round2(base.reduce((a, l) => a + l.discount, 0));
  const netBeforeDocDiscount = round2(base.reduce((a, l) => a + l.net, 0));

  // A document-level discount is spread across the lines by value, so each
  // line's printed amount still adds up to the grand total.
  const docDiscount = round2(
    Math.min(clampPositive(Number(input.documentDiscount ?? 0)), netBeforeDocDiscount)
  );
  const share = netBeforeDocDiscount > 0 ? docDiscount / netBeforeDocDiscount : 0;

  const isGst = input.invoiceType === "GST";
  const rate = isGst
    ? Math.min(100, Math.max(0, Number.isFinite(input.gstRatePercent) ? input.gstRatePercent : 0))
    : 0;

  let taxable = 0;
  let exempt = 0;
  const lines: ComputedLine[] = base.map((l) => {
    const net = round2(l.net - l.net * share);
    const lineTaxable = isGst && l.taxable;
    const tax = lineTaxable ? round2((net * rate) / 100) : 0;
    if (lineTaxable) taxable = round2(taxable + net);
    else exempt = round2(exempt + net);
    return { ...l, net, tax, total: round2(net + tax) };
  });

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (isGst && rate > 0) {
    if (input.interState) {
      igst = round2((taxable * rate) / 100);
    } else {
      // CGST and SGST are always EQUAL halves (the same rule as lib/tax.ts),
      // and the total GST is their sum, so the document never shows a split
      // that does not add up.
      cgst = round2((taxable * rate) / 200);
      sgst = cgst;
    }
  }
  const tax = round2(cgst + sgst + igst);

  return {
    invoiceType: isGst ? "GST" : "NON_GST",
    lines,
    subtotal,
    discount: round2(lineDiscounts + docDiscount),
    taxable,
    exempt,
    gstRate: rate,
    cgst,
    sgst,
    igst,
    tax,
    total: round2(taxable + exempt + tax),
    durationHours: round2(base.reduce((a, l) => a + (l.durationHours ?? 0) * l.quantity, 0)),
  };
}

/**
 * "2 days", "1 day 4 hrs", "3.5 hrs" — how a duration is printed on a
 * quotation. Custom services are often quoted in days, not hours.
 */
export function formatDuration(hours: number): string {
  const h = clampPositive(Number(hours));
  if (h <= 0) return "—";
  if (h < 24) return `${Math.round(h * 10) / 10} hr${h === 1 ? "" : "s"}`;
  const days = Math.floor(h / 24);
  const rest = Math.round((h - days * 24) * 10) / 10;
  const dayPart = `${days} day${days === 1 ? "" : "s"}`;
  return rest > 0 ? `${dayPart} ${rest} hr${rest === 1 ? "" : "s"}` : dayPart;
}

/** Shape stored in Quote.items (JSON) — the same line model, persisted. */
export interface StoredDocumentLine {
  serviceId?: string | null;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxable: boolean;
  durationHours: number;
}

/** Reads Quote.items (unknown JSON) back into trustworthy lines. */
export function parseStoredLines(raw: unknown): StoredDocumentLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null && !Array.isArray(it))
    .map((it) => ({
      serviceId: typeof it.serviceId === "string" ? it.serviceId : null,
      // Legacy rows stored only { description, quantity, unitPrice }.
      name: String(it.name ?? it.description ?? "Service"),
      description: String(it.description ?? ""),
      quantity: Number(it.quantity ?? 1) || 1,
      unitPrice: clampPositive(Number(it.unitPrice ?? 0)),
      discount: clampPositive(Number(it.discount ?? 0)),
      taxable: it.taxable !== false,
      durationHours: clampPositive(Number(it.durationHours ?? 0)),
    }));
}
