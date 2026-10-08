import { Invoice, SystemSettings } from "./types";

/**
 * Central GST/tax calculation for the ERP.
 *
 * The rate lives in SystemSettings (Superadmin-configurable, Settings page).
 * All tax computations go through here — no hardcoded percentages anywhere.
 *
 * Compliance behavior: invoices store their OWN computed figures at issue
 * time. Changing the configured rate affects NEW invoices only; already-
 * issued invoices are never silently rewritten (accounting requirement —
 * corrections go through refund/reissue, handled separately by ops).
 */

/** Effective tax rate (fraction) from settings, clamped to a sane range. */
export function getTaxRate(settings: Pick<SystemSettings, "taxRatePercent">): number {
  const pct = Number(settings?.taxRatePercent);
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.min(100, pct) / 100;
}

/** True when tax should be applied at all (0% disables tax lines). */
export function isTaxEnabled(settings: Pick<SystemSettings, "taxRatePercent">): boolean {
  return getTaxRate(settings) > 0;
}

/** Human label for the configured tax, e.g. "GST Tax (18%)". */
export function getTaxLabel(settings: Pick<SystemSettings, "taxRatePercent" | "taxLabel">): string {
  const pct = Math.round(getTaxRate(settings) * 10000) / 100; // normalize float dust
  const name = settings?.taxLabel?.trim() || "GST";
  return `${name} Tax (${pct}%)`;
}

/** Business GSTIN shown on statutory invoice documents. */
export function getGstin(settings: Pick<SystemSettings, "gstin">): string {
  return settings?.gstin?.trim() || "";
}

/** SAC/service code shown on statutory invoice documents. */
export function getSacCode(settings: Pick<SystemSettings, "sacCode">): string {
  return settings?.sacCode?.trim() || "";
}

export interface TaxComputation {
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  rateApplied: number; // fraction, e.g. 0.18
}

/**
 * Computes invoice/quote money figures from a base amount using the
 * configured rate. Rounding matches the previous behavior (whole rupees) so
 * existing records stay comparable.
 */
export function computeTaxedTotals(
  baseAmount: number,
  discount: number = 0,
  settings: Pick<SystemSettings, "taxRatePercent">
): TaxComputation {
  const rate = getTaxRate(settings);
  const subtotal = Math.max(0, Math.round(baseAmount));
  const discountValue = Math.min(Math.max(0, Math.round(discount)), subtotal);
  const taxable = subtotal - discountValue;
  const tax = Math.round(taxable * rate);
  return {
    subtotal,
    tax,
    discount: discountValue,
    total: taxable + tax,
    rateApplied: rate,
  };
}

/** Recomputes an invoice's total/balance from stored fields (no rate use). */
export function recomputeFromStored(inv: Pick<Invoice, "subtotal" | "tax" | "discount" | "amountPaid">): {
  total: number;
  balanceDue: number;
} {
  const total = Math.max(0, inv.subtotal - (inv.discount || 0) + (inv.tax || 0));
  return { total, balanceDue: Math.max(0, total - (inv.amountPaid || 0)) };
}

/* -------------------------------------------------------------------------- */
/* GST / Non-GST invoices                                                     */
/* -------------------------------------------------------------------------- */

export type InvoiceType = "GST" | "NON_GST";

export interface InvoiceFigures {
  invoiceType: InvoiceType;
  subtotal: number;
  discount: number;
  /** Amount GST is charged on (subtotal − discount). */
  taxable: number;
  /** GST % applied, e.g. 18. Always 0 on a Non-GST invoice. */
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Total GST (cgst + sgst + igst). */
  tax: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The one place invoice money is calculated.
 *   GST, intra-state → CGST = SGST = taxable × rate / 2
 *   GST, inter-state → IGST = taxable × rate
 *   Non-GST          → no GST at all; total = taxable
 * Figures are rounded to paise; CGST and SGST are always equal.
 */
export function computeInvoiceFigures(input: {
  invoiceType: InvoiceType;
  subtotal: number;
  discount?: number;
  gstRatePercent: number;
  interState?: boolean;
}): InvoiceFigures {
  const subtotal = round2(Math.max(0, input.subtotal));
  const discount = round2(Math.min(Math.max(0, input.discount ?? 0), subtotal));
  const taxable = round2(subtotal - discount);
  if (input.invoiceType === "NON_GST") {
    return { invoiceType: "NON_GST", subtotal, discount, taxable, gstRate: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: taxable };
  }
  const rate = Number.isFinite(input.gstRatePercent) ? Math.min(100, Math.max(0, input.gstRatePercent)) : 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (input.interState) {
    igst = round2((taxable * rate) / 100);
  } else {
    cgst = round2((taxable * rate) / 200);
    sgst = cgst;
  }
  const tax = round2(cgst + sgst + igst);
  return { invoiceType: "GST", subtotal, discount, taxable, gstRate: rate, cgst, sgst, igst, tax, total: round2(taxable + tax) };
}

/** Indian GSTIN format: 2-digit state code, PAN, entity code, Z, checksum. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(v: string): boolean {
  return GSTIN_PATTERN.test(v.trim().toUpperCase());
}
