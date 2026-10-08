/**
 * §6 / §8 Customer visibility and §3/§4/§5 document figures.
 *
 * These are the two pieces of logic that decide what a customer is shown and
 * what a quotation / invoice adds up to, so they are checked directly rather
 * than through a page.
 *
 * Run: npm test
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_VISIBILITY_FIELDS,
  CUSTOMER_VISIBILITY_KEYS,
  DEFAULT_CUSTOMER_VISIBILITY,
  LOCKED_VISIBILITY_KEYS,
  NEVER_CUSTOMER_VISIBLE,
  effectiveVisibility,
  hiddenCount,
  isVisible,
  normalizeVisibility,
  pickVisible,
} from "../src/lib/visibility";
import { computeDocumentFigures, computeLine, formatDuration, parseStoredLines } from "../src/lib/documents";
import { distanceMeters } from "../src/lib/server/location";

/* -------------------------------------------------------------------------- */
/* §6 Visibility configuration                                                */
/* -------------------------------------------------------------------------- */

test("every switchable field is described exactly once, and locked fields are on", () => {
  assert.equal(CUSTOMER_VISIBILITY_FIELDS.length, CUSTOMER_VISIBILITY_KEYS.length);
  const keys = CUSTOMER_VISIBILITY_FIELDS.map((f) => f.key).sort();
  assert.deepEqual(keys, [...CUSTOMER_VISIBILITY_KEYS].sort());
  // The portal cannot work without these three, so they are not switchable.
  assert.deepEqual([...LOCKED_VISIBILITY_KEYS].sort(), ["jobId", "jobStatus", "serviceName"]);
  for (const k of LOCKED_VISIBILITY_KEYS) {
    assert.equal(DEFAULT_CUSTOMER_VISIBILITY[k], true);
  }
});

test("internal business information has no switch at all", () => {
  // The never-list and the switchable list must not overlap: if they ever did,
  // internal data would become configurable.
  for (const internal of NEVER_CUSTOMER_VISIBLE) {
    assert.equal(
      (CUSTOMER_VISIBILITY_KEYS as readonly string[]).includes(internal),
      false,
      `${internal} must never be a customer-visibility switch`
    );
  }
  assert.ok(NEVER_CUSTOMER_VISIBLE.includes("internalCost"));
  assert.ok(NEVER_CUSTOMER_VISIBLE.includes("internalProfitMargin"));
  assert.ok(NEVER_CUSTOMER_VISIBLE.includes("staffSalary"));
  assert.ok(NEVER_CUSTOMER_VISIBLE.includes("otherCustomers"));
});

test("normalizeVisibility drops unknown keys and forces the locked ones on", () => {
  const v = normalizeVisibility({
    invoice: false,
    // Not a visibility key — a hostile payload must not be able to add it.
    internalCost: true,
    // Locked: the request cannot switch the Job ID off.
    jobId: false,
    // Wrong type: ignored, so the default stands.
    beforePhotos: "yes",
  });
  assert.equal(v.invoice, false, "an explicit false is respected");
  assert.equal(v.jobId, true, "a locked key cannot be switched off");
  assert.equal(v.beforePhotos, true, "a non-boolean falls back to the base");
  assert.equal("internalCost" in v, false, "unknown keys never enter the record");
  assert.deepEqual(Object.keys(v).sort(), [...CUSTOMER_VISIBILITY_KEYS].sort());
});

test("normalizeVisibility survives rubbish input", () => {
  for (const junk of [null, undefined, 42, "nope", [], true]) {
    const v = normalizeVisibility(junk);
    assert.deepEqual(v, DEFAULT_CUSTOMER_VISIBILITY, `${String(junk)} falls back to the default`);
  }
});

test("a job override narrows the company default, and can also re-open a field", () => {
  const company = { invoice: false, qcResult: false };
  // Nothing on the job: the company default applies.
  const inherited = effectiveVisibility(null, company);
  assert.equal(inherited.invoice, false);
  assert.equal(inherited.qcResult, false);
  assert.equal(inherited.beforePhotos, true);

  // The job hides more.
  const narrowed = effectiveVisibility({ beforePhotos: false }, company);
  assert.equal(narrowed.beforePhotos, false);
  assert.equal(narrowed.invoice, false, "the company default still applies to untouched fields");

  // The job re-opens one field for this customer only.
  const widened = effectiveVisibility({ invoice: true }, company);
  assert.equal(widened.invoice, true);
  assert.equal(widened.qcResult, false);
});

test("pickVisible omits hidden fields instead of blanking them (the §8 rule)", () => {
  const v = normalizeVisibility({ invoice: false, paymentStatus: false });
  const payload = pickVisible(v, {
    serviceDate: "2026-10-08",
    invoice: { total: 25000 },
    paymentStatus: "UNPAID",
    qcResult: "passed",
  });
  assert.equal("invoice" in payload, false, "a hidden field is absent, not null");
  assert.equal("paymentStatus" in payload, false);
  assert.equal(payload.serviceDate, "2026-10-08");
  assert.equal(payload.qcResult, "passed");
  // The serialized response must not even mention the hidden keys.
  assert.equal(JSON.stringify(payload).includes("invoice"), false);
});

test("hiddenCount counts only what Admin can actually change", () => {
  assert.equal(hiddenCount(DEFAULT_CUSTOMER_VISIBILITY), 0);
  assert.equal(hiddenCount(normalizeVisibility({ invoice: false })), 1);
  assert.equal(hiddenCount(normalizeVisibility({ invoice: false, quotation: false, teamName: false })), 3);
  // Locked keys are forced on, so they can never add to the count.
  assert.equal(hiddenCount(normalizeVisibility({ jobId: false, serviceName: false })), 0);
});

test("isVisible is the single question every customer-facing read asks", () => {
  const v = normalizeVisibility({ serviceLocation: false });
  assert.equal(isVisible(v, "serviceLocation"), false);
  assert.equal(isVisible(v, "serviceDate"), true);
});

/* -------------------------------------------------------------------------- */
/* §3 / §4 / §5 Document figures                                              */
/* -------------------------------------------------------------------------- */

test("a line is clamped to sane money", () => {
  const l = computeLine({ name: "Deep Cleaning", quantity: 2, unitPrice: 5000, discount: 500 });
  assert.equal(l.gross, 10000);
  assert.equal(l.net, 9500);
  // A discount can never exceed the line, and negatives are floored at zero.
  assert.equal(computeLine({ name: "x", quantity: 1, unitPrice: 100, discount: 999 }).net, 0);
  assert.equal(computeLine({ name: "x", quantity: -3, unitPrice: -100 }).gross, 0);
});

test("GST on several services splits into equal CGST and SGST halves", () => {
  const f = computeDocumentFigures({
    invoiceType: "GST",
    gstRatePercent: 18,
    lines: [
      { name: "Deep Cleaning", quantity: 1, unitPrice: 8000 },
      { name: "Sofa Cleaning", quantity: 2, unitPrice: 1500 },
    ],
  });
  assert.equal(f.subtotal, 11000);
  assert.equal(f.taxable, 11000);
  assert.equal(f.cgst, 990);
  assert.equal(f.sgst, 990);
  assert.equal(f.igst, 0);
  assert.equal(f.tax, 1980);
  assert.equal(f.total, 12980);
  assert.equal(f.cgst + f.sgst, f.tax, "the two halves always re-add to the total GST");
});

test("inter-state supply charges IGST instead of CGST and SGST", () => {
  const f = computeDocumentFigures({
    invoiceType: "GST",
    gstRatePercent: 18,
    interState: true,
    lines: [{ name: "Deep Cleaning", quantity: 1, unitPrice: 10000 }],
  });
  assert.equal(f.igst, 1800);
  assert.equal(f.cgst, 0);
  assert.equal(f.sgst, 0);
  assert.equal(f.total, 11800);
});

test("a tax-exempt service carries no GST even on a GST document", () => {
  const f = computeDocumentFigures({
    invoiceType: "GST",
    gstRatePercent: 18,
    lines: [
      { name: "Deep Cleaning", quantity: 1, unitPrice: 10000 },
      { name: "Government rebate work", quantity: 1, unitPrice: 5000, taxable: false },
    ],
  });
  assert.equal(f.taxable, 10000, "GST is charged on the taxable line only");
  assert.equal(f.exempt, 5000);
  assert.equal(f.tax, 1800);
  assert.equal(f.total, 16800, "the exempt value is still billed, just untaxed");
});

test("a Non-GST document has no GST figures at all", () => {
  const f = computeDocumentFigures({
    invoiceType: "NON_GST",
    gstRatePercent: 18,
    lines: [{ name: "Deep Cleaning", quantity: 1, unitPrice: 10000 }],
  });
  assert.equal(f.gstRate, 0);
  assert.equal(f.cgst, 0);
  assert.equal(f.sgst, 0);
  assert.equal(f.igst, 0);
  assert.equal(f.tax, 0);
  assert.equal(f.total, 10000);
});

test("a document discount spreads across the lines and still adds up", () => {
  const f = computeDocumentFigures({
    invoiceType: "GST",
    gstRatePercent: 18,
    documentDiscount: 1000,
    lines: [
      { name: "A", quantity: 1, unitPrice: 6000 },
      { name: "B", quantity: 1, unitPrice: 4000 },
    ],
  });
  assert.equal(f.discount, 1000);
  assert.equal(f.taxable, 9000, "GST is charged after the discount");
  assert.equal(f.tax, 1620);
  assert.equal(f.total, 10620);
  const lineSum = Math.round(f.lines.reduce((a, l) => a + l.net, 0) * 100) / 100;
  assert.equal(lineSum, f.taxable, "the printed line amounts match the taxable total");
});

test("legacy quotation items still read back as lines", () => {
  // Rows written before §3 carried only description/quantity/unitPrice.
  const lines = parseStoredLines([{ description: "Deep clean", quantity: 1, unitPrice: 5000 }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].name, "Deep clean", "the description becomes the service name");
  assert.equal(lines[0].taxable, true);
  assert.deepEqual(parseStoredLines(null), []);
  assert.deepEqual(parseStoredLines("nonsense"), []);
});

test("durations read the way a quotation prints them", () => {
  assert.equal(formatDuration(4), "4 hrs");
  assert.equal(formatDuration(1), "1 hr");
  assert.equal(formatDuration(48), "2 days");
  assert.equal(formatDuration(28), "1 day 4 hrs");
  assert.equal(formatDuration(0), "—");
});

/* -------------------------------------------------------------------------- */
/* §1 / §2 Location maths                                                     */
/* -------------------------------------------------------------------------- */

test("distance between two coordinates is measured in metres", () => {
  // Same point.
  assert.equal(Math.round(distanceMeters(12.9141, 74.856, 12.9141, 74.856)), 0);
  // ~1.11 km north (0.01 degrees of latitude).
  const km = distanceMeters(12.9141, 74.856, 12.9241, 74.856);
  assert.ok(km > 1050 && km < 1150, `expected about 1.1 km, got ${Math.round(km)} m`);
  // Mangalore to Bengaluru is roughly 300 km — far outside any geofence.
  const far = distanceMeters(12.9141, 74.856, 12.9716, 77.5946);
  assert.ok(far > 250_000, `expected a long distance, got ${Math.round(far)} m`);
});
