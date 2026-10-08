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
