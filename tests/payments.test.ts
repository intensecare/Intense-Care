import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpiUri, customerPaymentStatus, isValidPayeeName, isValidVpa, maskVpa, newAttemptReference, normalizeUtr, paymentNote, upiProblem, DEFAULT_UPI_SETTINGS } from "../src/lib/payments";

test("UPI IDs", () => {
  for (const v of ["shop@okhdfcbank", "intense.care-1@ybl", "9876543210@paytm", "a_b@oksbi"]) assert.equal(isValidVpa(v), true, v);
  for (const v of ["", "shop", "@bank", "shop@", "shop@b", "sh op@ybl", "shop@@ybl", "shop@123", "x@ybl", "shop@ybl?pa=evil", "shop@ybl&am=1"]) assert.equal(isValidVpa(v), false, v);
});

test("payee names", () => {
  assert.equal(isValidPayeeName("Intense Care Deep Cleaning"), true);
  assert.equal(isValidPayeeName("A & B Services"), true);
  assert.equal(isValidPayeeName("x"), false);
  assert.equal(isValidPayeeName("Name<script>"), false);
  assert.equal(isValidPayeeName("Name&am=1"), false); // "=" is not allowed in a name at all
});

test("configuration problems are named; nothing is hard-coded", () => {
  assert.equal(DEFAULT_UPI_SETTINGS.vpa, "");
  assert.equal(DEFAULT_UPI_SETTINGS.enabled, false);
  assert.equal(upiProblem(DEFAULT_UPI_SETTINGS), "DISABLED");
  assert.equal(upiProblem({ enabled: true, vpa: "", payeeName: "X Y", description: "" }), "NO_VPA");
  assert.equal(upiProblem({ enabled: true, vpa: "bad", payeeName: "X Y", description: "" }), "BAD_VPA");
  assert.equal(upiProblem({ enabled: true, vpa: "shop@ybl", payeeName: "", description: "" }), "NO_NAME");
  assert.equal(upiProblem({ enabled: true, vpa: "shop@ybl", payeeName: "<b>", description: "" }), "BAD_NAME");
  assert.equal(upiProblem({ enabled: true, vpa: "shop@ybl", payeeName: "Shop Name", description: "" }), null);
  assert.equal(upiProblem(null), "DISABLED");
});

test("the UPI link carries pa, pn, am, cu, tn, tr — encoded", () => {
  const uri = buildUpiUri({ vpa: "shop@okhdfcbank", payeeName: "Intense Care & Co.", amount: 5898.8200001, note: "Invoice GST-2026-00001", reference: "ICPABC123" });
  assert.equal(uri, "upi://pay?pa=shop@okhdfcbank&pn=Intense%20Care%20%26%20Co.&am=5898.82&cu=INR&tn=Invoice%20GST-2026-00001&tr=ICPABC123");
  const q = new URL(uri.replace("upi://", "https://x/")).searchParams;
  assert.deepEqual([q.get("pa"), q.get("pn"), q.get("am"), q.get("cu"), q.get("tr")], ["shop@okhdfcbank", "Intense Care & Co.", "5898.82", "INR", "ICPABC123"]);
});

test("a hostile payee name or note cannot inject extra parameters", () => {
  const uri = buildUpiUri({ vpa: "shop@ybl", payeeName: "Evil&pa=thief@ybl&am=1", amount: 100, note: "x&am=1#frag", reference: "R1" });
  const q = new URL(uri.replace("upi://", "https://x/")).searchParams;
  assert.equal(q.getAll("pa").length, 1);
  assert.equal(q.get("pa"), "shop@ybl");
  assert.equal(q.getAll("am").length, 1);
  assert.equal(q.get("am"), "100.00");
  assert.equal(q.get("pn"), "Evil&pa=thief@ybl&am=1");
});

test("amounts are validated", () => {
  const base = { vpa: "shop@ybl", payeeName: "Shop", note: "n", reference: "R" };
  assert.throws(() => buildUpiUri({ ...base, amount: 0 }));
  assert.throws(() => buildUpiUri({ ...base, amount: -5 }));
  assert.throws(() => buildUpiUri({ ...base, amount: Number.NaN }));
  assert.throws(() => buildUpiUri({ ...base, amount: 2_000_000 }));
  assert.throws(() => buildUpiUri({ ...base, vpa: "nope", amount: 5 }));
  assert.match(buildUpiUri({ ...base, amount: 0.5 }), /am=0\.50/);
});

test("notes, references and masks", () => {
  assert.equal(paymentNote("", "GST-2026-00001"), "Invoice GST-2026-00001");
  assert.equal(paymentNote("Deep cleaning", "INV-1"), "Deep cleaning INV-1");
  assert.ok(paymentNote("x".repeat(80), "INV-1").length <= 50);
  assert.equal(paymentNote("<script>", "I-1").includes("<"), false);
  const a = newAttemptReference(1_800_000_000_000, 0.123);
  const b = newAttemptReference(1_800_000_000_001, 0.124);
  assert.match(a, /^ICP[A-Z0-9]+$/);
  assert.notEqual(a, b);
  assert.ok(a.length <= 35);
  assert.equal(maskVpa("intensecare@okhdfcbank"), "in•••••••••@okhdfcbank");
});

test("UTR / reference numbers", () => {
  assert.equal(normalizeUtr("4123 4567 8901"), "412345678901");
  assert.equal(normalizeUtr("t2410191234abcd"), "T2410191234ABCD");
  assert.equal(normalizeUtr("12345"), null);
  assert.equal(normalizeUtr("1234567 8; DROP"), null);
  assert.equal(normalizeUtr(""), null);
});

test("payment status: only an Admin-recorded payment ever says PAID", () => {
  const now = Date.now();
  const fresh = new Date(now - 60_000);
  const old = new Date(now - 5 * 3600_000);
  assert.equal(customerPaymentStatus("UNPAID", [], now), "UNPAID");
  assert.equal(customerPaymentStatus("UNPAID", [{ status: "INITIATED", createdAt: fresh }], now), "PAYMENT_INITIATED");
  assert.equal(customerPaymentStatus("UNPAID", [{ status: "INITIATED", createdAt: old }], now), "UNPAID"); // an abandoned tap fades
  assert.equal(customerPaymentStatus("UNPAID", [{ status: "SUBMITTED", createdAt: fresh }], now), "PAYMENT_REVIEW_REQUIRED");
  assert.equal(customerPaymentStatus("UNPAID", [{ status: "SUBMITTED", createdAt: fresh }, { status: "INITIATED", createdAt: fresh }], now), "PAYMENT_REVIEW_REQUIRED");
  assert.equal(customerPaymentStatus("UNPAID", [{ status: "REJECTED", createdAt: old, reviewedAt: fresh }], now), "FAILED");
  assert.equal(customerPaymentStatus("UNPAID", [{ status: "CANCELLED", createdAt: fresh }], now), "UNPAID");
  assert.equal(customerPaymentStatus("PARTIAL", [], now), "PARTIALLY_PAID");
  assert.equal(customerPaymentStatus("PARTIAL", [{ status: "SUBMITTED", createdAt: fresh }], now), "PAYMENT_REVIEW_REQUIRED");
  assert.equal(customerPaymentStatus("PAID", [{ status: "SUBMITTED", createdAt: fresh }], now), "PAID");
  // No combination of attempts alone can produce PAID.
  for (const st of ["INITIATED", "SUBMITTED", "VERIFIED", "REJECTED", "CANCELLED"]) assert.notEqual(customerPaymentStatus("UNPAID", [{ status: st, createdAt: fresh }], now), "PAID", st);
});
