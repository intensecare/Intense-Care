/** Order pricing — pure, shared by the order form preview and the server. All amounts in paise. */

export interface PricedLine {
  quantity: number;
  unitPrice: number;
}

export function lineTotal(line: PricedLine): number {
  return Math.round(line.quantity * line.unitPrice);
}

export function computeTotals(lines: PricedLine[], discount: number, taxPercent: number) {
  const subtotal = lines.reduce((acc, l) => acc + lineTotal(l), 0);
  const safeDiscount = Math.min(Math.max(0, Math.round(discount)), subtotal);
  const taxable = subtotal - safeDiscount;
  const tax = Math.round((taxable * Math.max(0, taxPercent)) / 100);
  return { subtotal, discount: safeDiscount, tax, total: taxable + tax };
}

export function paymentStatusFor(total: number, amountPaid: number): "UNPAID" | "PARTIAL" | "PAID" {
  if (total > 0 && amountPaid >= total) return "PAID";
  return amountPaid > 0 ? "PARTIAL" : "UNPAID";
}
