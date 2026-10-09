/**
 * Profit and money-counting rules (src/lib/profit.ts) and the referral bonus maths.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceFigures, sumInvoices, jobContribution, operatingResult } from "../src/lib/profit";
import { computeBonus } from "../src/lib/server/referrals";
import { phoneKey, round2 } from "../src/lib/business";
import { slotRange, overlaps } from "../src/lib/server/assignments";
import { toCsv } from "../src/lib/server/biz";
import { netPayable } from "../src/lib/server/payroll";

test("a GST invoice: revenue excludes GST; created is not collected", () => {
  const f = invoiceFigures({ subtotal: 5000, discount: 500, total: 5310, amountPaid: 0, refundedAmount: 0, balanceDue: 5310 });
  assert.equal(f.taxable, 4500);
  assert.equal(f.gst, 810);
  assert.equal(f.invoiced, 5310);
  assert.equal(f.collected, 0, "an unpaid invoice has collected nothing");
  assert.equal(f.outstanding, 5310);
  assert.equal(f.netRevenue, 4500);
});

test("part payment and refund: the before-GST share is pro-rata", () => {
  const f = invoiceFigures({ subtotal: 5000, discount: 500, total: 5310, amountPaid: 5310, refundedAmount: 531, balanceDue: 0 });
  assert.equal(f.netCollected, 4779);
  assert.equal(f.refundedExGst, 450, "10% refunded = 10% of 4500");
  assert.equal(f.netRevenue, 4050);
  assert.equal(f.netCollectedExGst, 4050);
});

test("a Non-GST invoice has no GST at all", () => {
  const f = invoiceFigures({ subtotal: 3000, discount: 0, total: 3000, amountPaid: 1000, refundedAmount: 0, balanceDue: 2000 });
  assert.equal(f.gst, 0);
  assert.equal(f.netRevenue, 3000);
  assert.equal(f.netCollectedExGst, 1000);
});

test("totals add up across invoices", () => {
  const t = sumInvoices([
    { subtotal: 1000, discount: 0, total: 1180, amountPaid: 1180, refundedAmount: 0, balanceDue: 0 },
    { subtotal: 2000, discount: 0, total: 2000, amountPaid: 0, refundedAmount: 0, balanceDue: 2000 },
  ]);
  assert.equal(t.invoiced, 3180);
  assert.equal(t.gst, 180);
  assert.equal(t.taxable, 3000);
  assert.equal(t.collected, 1180);
  assert.equal(t.outstanding, 2000);
});

test("job contribution: revenue minus direct costs, owed freelance pay included once", () => {
  const c = jobContribution({ revenue: 4500, countedExpenses: 700, accruedFreelance: 800 });
  assert.equal(c.directCosts, 1500);
  assert.equal(c.contribution, 3000);
  assert.equal(c.marginPercent, 66.7);
  assert.equal(jobContribution({ revenue: 0, countedExpenses: 100, accruedFreelance: 0 }).marginPercent, null, "no margin on zero revenue");
});

test("operating result on a billed and on a cash basis", () => {
  const r = operatingResult({ netRevenue: 10000, countedExpenses: 6500, netCollectedExGst: 7000, paidExpenses: 5000 });
  assert.equal(r.onInvoiced, 3500);
  assert.equal(r.onCash, 2000);
});

test("referral bonus: fixed, percentage and cap", () => {
  const base = { enabled: true, bonusType: "FIXED" as const, bonusValue: 500, minJobValue: 0, requirePaid: true, eligibilityDays: 90, maxBonus: 0 };
  assert.equal(computeBonus(base, 9999), 500);
  assert.equal(computeBonus({ ...base, bonusType: "PERCENT", bonusValue: 10 }, 4500), 450);
  assert.equal(computeBonus({ ...base, bonusType: "PERCENT", bonusValue: 10, maxBonus: 300 }, 4500), 300, "capped");
  assert.equal(computeBonus({ ...base, bonusValue: -5 }, 100), 0, "never negative");
});

test("the same person is recognised by phone, however it is typed", () => {
  assert.equal(phoneKey("+91 98123-45678"), "9812345678");
  assert.equal(phoneKey("09812345678"), "9812345678");
  assert.equal(phoneKey("123"), null);
});

test("time windows: partial overlaps clash, back-to-back does not", () => {
  assert.deepEqual(slotRange("09:00 - 13:00"), [540, 780]);
  assert.equal(overlaps("09:00 - 13:00", "11:00 - 15:00"), true, "overlap");
  assert.equal(overlaps("09:00 - 13:00", "13:00 - 15:00"), false, "back-to-back is fine");
  assert.equal(overlaps("09:00 - 13:00", "not a time"), true, "unreadable slot is treated as a clash");
});

test("payroll net payable is computed, never trusted", () => {
  assert.equal(netPayable({ basic: 15000, allowances: 1000, bonuses: 500, deductions: 200, advances: 2000 }), 14300);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test("CSV export cannot inject spreadsheet formulas", () => {
  const csv = toCsv([{ a: "=HYPERLINK(\"x\")", b: "+1", c: "@cmd", d: "-5", e: 'say "hi", ok', f: 12 }]);
  assert.ok(csv.includes("'=HYPERLINK"), "= is neutralised");
  assert.ok(csv.includes("'+1") && csv.includes("'@cmd") && csv.includes("'-5"));
  assert.ok(csv.includes('"say ""hi"", ok"'), "quotes escaped");
  assert.ok(/,12(\r|$)/.test(csv.split("\r\n")[1]), "numbers are left alone");
});
