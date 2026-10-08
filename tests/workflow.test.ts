/**
 * Order workflow, pricing and customer-link tests (pure — no database).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUSES,
  TRANSITIONS,
  AUTO_ADVANCE,
  canTransition,
  availableActions,
  findTransition,
  customerStepIndex,
  customerStatusLines,
  type OrderStatus,
} from "../src/lib/workflow";
import { computeTotals, lineTotal, paymentStatusFor } from "../src/lib/pricing";
import { customerKey, verifyCustomerKey } from "../src/lib/server/link-key";

test("happy path is a single connected chain from CREATED to DELIVERED", () => {
  const path: OrderStatus[] = ["CREATED", "PICKUP_ASSIGNED", "PICKED_UP", "PROCESSING", "QC_PENDING", "QC_PASSED", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(findTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]} must be allowed`);
  }
});

test("QC failure loop: QC_PENDING → QC_FAILED → REWORK → QC_PENDING → QC_PASSED", () => {
  assert.ok(canTransition("QC", "QC_PENDING", "QC_FAILED"));
  assert.ok(canTransition("ADMIN", "QC_FAILED", "REWORK"));
  assert.ok(canTransition("ADMIN", "REWORK", "QC_PENDING"));
  assert.ok(canTransition("QC", "QC_PENDING", "QC_PASSED"));
  assert.ok(canTransition("QC", "QC_PENDING", "REWORK"));
});

test("invalid transitions are rejected", () => {
  assert.equal(canTransition("ADMIN", "CREATED", "DELIVERED"), false);
  assert.equal(canTransition("ADMIN", "QC_FAILED", "READY"), false);
  assert.equal(canTransition("ADMIN", "PROCESSING", "READY"), false);
  assert.equal(canTransition("ADMIN", "DELIVERED", "CREATED"), false);
  assert.equal(canTransition("ADMIN", "OUT_FOR_DELIVERY", "CANCELLED"), false);
  assert.equal(availableActions("ADMIN", "DELIVERED").length, 0, "delivered is final");
  assert.equal(availableActions("ADMIN", "CANCELLED").length, 0, "cancelled is final");
});

test("field managers can only move pickup and delivery steps", () => {
  const fm = TRANSITIONS.filter((t) => t.actors.includes("FIELD_MANAGER")).map((t) => `${t.from}>${t.to}`).sort();
  assert.deepEqual(fm, ["OUT_FOR_DELIVERY>DELIVERED", "PICKUP_ASSIGNED>PICKED_UP", "READY>OUT_FOR_DELIVERY"]);
  assert.equal(canTransition("FIELD_MANAGER", "QC_PENDING", "QC_PASSED"), false);
  assert.equal(canTransition("FIELD_MANAGER", "CREATED", "CANCELLED"), false);
});

test("QC can only make QC decisions", () => {
  const qc = TRANSITIONS.filter((t) => t.actors.includes("QC")).map((t) => t.from);
  assert.ok(qc.every((f) => f === "QC_PENDING"));
  assert.equal(canTransition("QC", "PROCESSING", "QC_PENDING"), false);
  assert.equal(canTransition("QC", "READY", "OUT_FOR_DELIVERY"), false);
});

test("fail and rework need a reason; automation steps are system-driven", () => {
  assert.equal(findTransition("QC_PENDING", "QC_FAILED")?.requiresReason, true);
  assert.equal(findTransition("QC_PENDING", "REWORK")?.requiresReason, true);
  assert.equal(findTransition("QC_PENDING", "QC_PASSED")?.requiresReason, undefined);
  assert.equal(AUTO_ADVANCE.PICKED_UP, "PROCESSING");
  assert.equal(AUTO_ADVANCE.QC_PASSED, "READY");
  for (const [from, to] of Object.entries(AUTO_ADVANCE)) {
    assert.ok(canTransition("SYSTEM", from as OrderStatus, to as OrderStatus), `${from} → ${to} must be allowed for SYSTEM`);
  }
});

test("customer timeline maps every status and hides internal QC detail", () => {
  assert.equal(customerStepIndex("CREATED"), 0);
  assert.equal(customerStepIndex("PICKUP_ASSIGNED"), 0);
  assert.equal(customerStepIndex("PICKED_UP"), 1);
  assert.equal(customerStepIndex("QC_FAILED"), 3);
  assert.equal(customerStepIndex("REWORK"), 3);
  assert.equal(customerStepIndex("READY"), 4);
  assert.equal(customerStepIndex("DELIVERED"), 6);
  assert.equal(customerStepIndex("CANCELLED"), -1);
  assert.equal(customerStatusLines("REWORK").qc, "Being re-done for quality");
  for (const s of ORDER_STATUSES) assert.equal(typeof customerStepIndex(s), "number");
});

test("pricing: line totals, discount cap, tax and payment status (paise)", () => {
  assert.equal(lineTotal({ quantity: 2.5, unitPrice: 9900 }), 24750);
  const t = computeTotals([{ quantity: 2, unitPrice: 2500 }, { quantity: 1, unitPrice: 12000 }], 2000, 18);
  assert.deepEqual(t, { subtotal: 17000, discount: 2000, tax: 2700, total: 17700 });
  assert.equal(computeTotals([{ quantity: 1, unitPrice: 1000 }], 5000, 0).total, 0);
  assert.equal(paymentStatusFor(17700, 0), "UNPAID");
  assert.equal(paymentStatusFor(17700, 5000), "PARTIAL");
  assert.equal(paymentStatusFor(17700, 17700), "PAID");
  assert.equal(paymentStatusFor(0, 0), "UNPAID");
});

test("customer link key is bound to the order id and link version", () => {
  const secret = "x".repeat(16) + "0123456789abcdefghij";
  const k = customerKey("order_a", 1, secret);
  assert.equal(k.length, 32);
  assert.ok(verifyCustomerKey("order_a", 1, k, secret));
  assert.equal(verifyCustomerKey("order_b", 1, k, secret), false, "changing the order must fail");
  assert.equal(verifyCustomerKey("order_a", 2, k, secret), false, "a revoked link (new version) must fail");
  assert.equal(verifyCustomerKey("order_a", 1, k.slice(0, -1) + (k.endsWith("A") ? "B" : "A"), secret), false);
  assert.equal(verifyCustomerKey("order_a", 1, "", secret), false);
  assert.equal(verifyCustomerKey("order_a", 1, k, secret + "z"), false);
});
