import { round2 } from "./business";

/**
 * How money is counted in Reports. These functions are the single definition
 * used by the API, and they are unit-tested.
 *
 *  Invoiced     what was billed (incl. GST) on live (not cancelled) invoices.
 *  Revenue      the billed value BEFORE GST (subtotal − discount). GST belongs to the
 *               government, so it is never revenue and never profit.
 *  Collected    money actually received (payments). An invoice is NOT collected just
 *               because it exists. Net collected = received − refunded.
 *  Outstanding  billed but not yet paid (balance due).
 *  Refunded     money given back; its before-GST part reduces revenue (pro-rata).
 *
 *  Job contribution = job revenue − direct job costs
 *  Direct job costs = approved, non-voided expenses linked to the job
 *                     (includes freelance payments and bonuses once PAID)
 *                   + freelance pay still owed for the job (accrued, not yet an expense).
 *  A freelance payment becomes an expense only when it is paid, so it is counted in
 *  exactly one of those two places. Permanent staff salaries and general overheads are
 *  operating costs: they are NOT spread across jobs.
 *
 *  Operating result = net revenue − all counted expenses in the period.
 */

export interface InvoiceFacts {
  total: number;
  subtotal: number;
  discount: number;
  amountPaid: number;
  refundedAmount: number;
  balanceDue: number;
}

export function invoiceFigures(i: InvoiceFacts) {
  const taxable = round2(i.subtotal - i.discount);
  const gst = round2(i.total - taxable);
  // The share of any rupee on this invoice that is revenue (the rest is GST).
  const ratio = i.total > 0 ? taxable / i.total : 0;
  const netCollected = Math.max(0, round2(i.amountPaid - i.refundedAmount));
  return {
    invoiced: round2(i.total),
    taxable,
    gst,
    collected: round2(i.amountPaid),
    refunded: round2(i.refundedAmount),
    netCollected,
    netCollectedExGst: round2(netCollected * ratio),
    refundedExGst: round2(i.refundedAmount * ratio),
    netRevenue: round2(taxable - i.refundedAmount * ratio),
    outstanding: round2(Math.max(0, i.balanceDue)),
  };
}

export function sumInvoices(list: InvoiceFacts[]) {
  const z = { invoiced: 0, taxable: 0, gst: 0, collected: 0, refunded: 0, netCollected: 0, netCollectedExGst: 0, refundedExGst: 0, netRevenue: 0, outstanding: 0 };
  for (const i of list) {
    const f = invoiceFigures(i);
    for (const k of Object.keys(z) as (keyof typeof z)[]) z[k] = round2(z[k] + f[k]);
  }
  return z;
}

export function jobContribution(i: { revenue: number; countedExpenses: number; accruedFreelance: number }) {
  const directCosts = round2(i.countedExpenses + i.accruedFreelance);
  const contribution = round2(i.revenue - directCosts);
  return { revenue: round2(i.revenue), directCosts, contribution, marginPercent: i.revenue > 0 ? Math.round((contribution / i.revenue) * 1000) / 10 : null };
}

export function operatingResult(i: { netRevenue: number; countedExpenses: number; netCollectedExGst: number; paidExpenses: number }) {
  return {
    /** Revenue billed in the period, less every counted cost. */
    onInvoiced: round2(i.netRevenue - i.countedExpenses),
    /** Money actually received (before GST), less money actually paid out. */
    onCash: round2(i.netCollectedExGst - i.paidExpenses),
  };
}

export const REPORT_DEFINITIONS = [
  "Revenue is the billed value before GST. GST is shown separately and is never counted as revenue or profit.",
  "Collected is money actually received. An invoice that has only been created is invoiced, not collected.",
  "Refunds reduce revenue by their before-GST share and reduce net collected.",
  "Job contribution = job revenue − direct job costs (approved expenses linked to the job + freelance pay still owed for it).",
  "A freelance payment, salary or referral bonus becomes an expense only when it is paid, so each cost is counted once.",
  "Permanent staff salaries and general overheads are operating costs and are not spread across individual jobs.",
  "Operating result = net revenue − all approved, non-voided expenses dated in the period (on a billed basis), and money received − money paid (on a cash basis).",
  "Pending, rejected and voided expenses are never counted.",
];
