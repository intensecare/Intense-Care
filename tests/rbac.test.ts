/**
 * Four user types — Admin, Field Manager, QC, Customer (link only).
 * Permission matrix, sign-in rules, next action and workspace routing.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  SIGN_IN_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  normalizeRole,
  canSignIn,
  scopeOf,
  authorize,
  getNextAction,
  routeAllowed,
  navFor,
  homePathFor,
  canApprove,
  deepLinkFor,
  isPublicPath,
  type Principal,
} from "../src/lib/rbac";
import { validateTransition } from "../src/lib/state-machine";
import { computeInvoiceFigures, isValidGstin } from "../src/lib/tax";
import { jobIdPrefix } from "../src/lib/server/job-serial";
import { toolsFor } from "../src/lib/server/ai/tools";
import type { Job } from "../src/lib/types";

const principal = (role: Principal["role"], extra: Partial<Principal> = {}): Principal => ({ id: "u1", role, ...extra });

test("exactly five user types; four sign in (the customer uses the job QR / link)", () => {
  assert.deepEqual([...ROLES].sort(), ["admin", "customer", "field_manager", "qc_inspector", "tax_officer"]);
  assert.deepEqual([...SIGN_IN_ROLES].sort(), ["admin", "field_manager", "qc_inspector", "tax_officer"]);
  assert.equal(canSignIn("customer"), false, "customers use the secure link, never a login");
  assert.equal(canSignIn("referral_partner"), false);
});

test("legacy roles map onto the four types; unknown values never widen access", () => {
  for (const r of ["super_admin", "ops_manager", "scheduler", "accounts", "admin"]) assert.equal(normalizeRole(r), "admin", r);
  for (const r of ["staff", "field_staff", "field_manager"]) assert.equal(normalizeRole(r), "field_manager", r);
  assert.equal(normalizeRole("qc_inspector"), "qc_inspector");
  assert.equal(normalizeRole("tax_officer"), "tax_officer");
  assert.equal(normalizeRole("referral_partner"), "customer");
  assert.equal(normalizeRole("hacker"), "customer");
  assert.equal(normalizeRole(undefined), "customer");
});

test("matrix: only declared permissions; Admin holds everything", () => {
  for (const role of ROLES) {
    for (const p of Object.keys(ROLE_PERMISSIONS[role])) {
      assert.ok((PERMISSIONS as readonly string[]).includes(p), `${role} grants unknown permission ${p}`);
    }
  }
  for (const p of PERMISSIONS) assert.equal(scopeOf("admin", p), "ALL");
});

test("Field Manager: only assigned jobs; no revenue, customers list, settings, users, reports or finance", () => {
  assert.equal(scopeOf("field_manager", "jobs.view"), "ASSIGNED");
  for (const p of ["finance.view", "invoice.view", "reports.view", "users.view", "users.manage", "settings.view", "settings.manage", "dashboard.view", "jobs.assign", "qc.pass", "qc.inspect"] as const) {
    assert.equal(scopeOf("field_manager", p), "NONE", p);
  }
  const fm = principal("field_manager");
  assert.equal(authorize(fm, "jobs.start", { assignedManagerId: "u1", assignedStaffIds: [] }).allowed, true);
  assert.equal(authorize(fm, "jobs.start", { assignedManagerId: "someone-else", assignedStaffIds: [] }).allowed, false, "another manager's job");
  assert.equal(authorize(fm, "customers.view", { assignedManagerId: "other" }).allowed, false);
});

test("QC: inspects, passes and raises rework; never touches money, users or settings", () => {
  for (const p of ["qc.inspect", "qc.pass", "qc.rework", "qc.reinspect", "photos.upload"] as const) assert.equal(scopeOf("qc_inspector", p), "ALL", p);
  for (const p of ["finance.view", "users.manage", "settings.manage", "jobs.assign", "jobs.arrive", "jobs.complete"] as const) {
    assert.equal(scopeOf("qc_inspector", p), "NONE", p);
  }
});

test("state machine: Field Manager cannot pass QC; QC cannot complete field work; start needs customer confirmation", () => {
  const job = (status: Job["status"], extra: Partial<Job> = {}) => ({ id: "JOB-1", status, assignedStaffIds: [], ...extra }) as unknown as Job;
  assert.equal(validateTransition(job("QUALITY_CHECK"), "PASS", "field_manager").allowed, false);
  assert.equal(validateTransition(job("IN_PROGRESS"), "WORK_COMPLETED", "qc_inspector").allowed, false);
  assert.equal(validateTransition(job("IN_PROGRESS"), "WORK_COMPLETED", "field_manager").allowed, true);
  assert.equal(validateTransition(job("CUSTOMER_VERIFIED"), "IN_PROGRESS", "field_manager").allowed, false, "needs customerConfirmedAt");
  assert.equal(validateTransition(job("CUSTOMER_VERIFIED", { customerConfirmedAt: "2026-10-08T10:00:00Z" }), "IN_PROGRESS", "field_manager").allowed, true);
  assert.equal(validateTransition(job("SCHEDULED"), "COMPLETED", "admin").allowed, false, "no skipping the journey");
});

test("Field Manager flow: I'm Here → wait → Start → checklist → photos → Complete → wait for QC → fix rework", () => {
  const ctx = { assignedManagerId: "u1", assignedStaffIds: [] as string[] };
  assert.equal(getNextAction("field_manager", { ...ctx, status: "ASSIGNED" })?.label, "I'm Here");
  assert.equal(getNextAction("field_manager", { ...ctx, status: "ARRIVED" })?.waiting, true);
  assert.equal(getNextAction("field_manager", { ...ctx, status: "ARRIVED", customerConfirmedAt: "x" })?.target, "IN_PROGRESS");
  assert.equal(getNextAction("field_manager", { ...ctx, status: "IN_PROGRESS", checklistTotal: 3, checklistDone: 1 })?.kind, "checklist");
  assert.equal(getNextAction("field_manager", { ...ctx, status: "IN_PROGRESS", checklistTotal: 3, checklistDone: 3 })?.kind, "photos");
  assert.equal(getNextAction("field_manager", { ...ctx, status: "IN_PROGRESS", checklistTotal: 3, checklistDone: 3, photosBefore: 1, photosAfter: 1 })?.target, "WORK_COMPLETED");
  assert.equal(getNextAction("field_manager", { ...ctx, status: "WORK_COMPLETED" })?.label, "Waiting for QC");
  assert.equal(getNextAction("field_manager", { ...ctx, status: "REWORK_ASSIGNED", openRework: 2 })?.kind, "rework");
  assert.equal(getNextAction("field_manager", { ...ctx, status: "REWORK_COMPLETED" })?.waiting, true);
});

test("QC next action: inspect → reinspect; waits while rework is open", () => {
  assert.equal(getNextAction("qc_inspector", { status: "WORK_COMPLETED" })?.label, "Inspect");
  assert.equal(getNextAction("qc_inspector", { status: "REWORK_COMPLETED" })?.label, "Reinspect");
  assert.equal(getNextAction("qc_inspector", { status: "REWORK_ASSIGNED" })?.waiting, true);
});

test("customer vocabulary: confirm → view progress → approve → rate", () => {
  assert.equal(getNextAction("customer", { status: "ARRIVED" })?.kind, "confirm");
  assert.equal(getNextAction("customer", { status: "IN_PROGRESS" })?.label, "View Progress");
  assert.equal(getNextAction("customer", { status: "CUSTOMER_APPROVAL" })?.kind, "approve");
  assert.equal(getNextAction("customer", { status: "COMPLETED" })?.kind, "feedback");
});

test("workspaces: five separate experiences, each with its own home", () => {
  assert.equal(homePathFor("tax_officer"), "/gst");
  assert.deepEqual(navFor("tax_officer").map((n) => n.label), ["GST Dashboard", "GST Invoices", "GST Reports", "Intense AI"]);
  assert.deepEqual(
    navFor("admin").filter((n) => !n.secondary).map((n) => n.label),
    ["Dashboard", "Intense AI", "Jobs", "Customers", "Invoices", "QC", "Reports", "Users"]
  );
  assert.equal(homePathFor("admin"), "/");
  assert.equal(homePathFor("field_manager"), "/my-jobs");
  assert.equal(homePathFor("qc_inspector"), "/quality-queue");
  assert.deepEqual(navFor("field_manager").map((n) => n.href), ["/my-jobs", "/assistant"]);
  assert.deepEqual(navFor("qc_inspector").map((n) => n.href), ["/quality-queue", "/assistant"]);
  assert.equal(navFor("customer").length, 0);
  assert.ok(navFor("admin").some((n) => n.href === "/users"));
});

test("routing: Field Manager and QC can't open the Operations desk; customer pages are public", () => {
  for (const path of ["/", "/jobs", "/jobs/JOB-1", "/customers", "/finance", "/reports", "/users", "/settings"]) {
    assert.equal(routeAllowed("field_manager", path), false, `FM ${path}`);
    assert.equal(routeAllowed("qc_inspector", path), false, `QC ${path}`);
  }
  assert.equal(routeAllowed("field_manager", "/my-jobs/JOB-1"), true);
  assert.equal(routeAllowed("qc_inspector", "/quality-queue/JOB-1"), true);
  assert.equal(routeAllowed("admin", "/my-jobs"), false, "Admin manages jobs from the job page");
  assert.equal(isPublicPath("/customer/service/abc"), true);
  assert.equal(isPublicPath("/partner-portal/x"), false, "referral portal removed");
});

test("Tax Officer: GST invoices and GST reports only — nothing else, read-only", () => {
  const grants = Object.entries(ROLE_PERMISSIONS.tax_officer).filter(([, s]) => s !== "NONE").map(([p]) => p).sort();
  assert.deepEqual(grants, ["ai.use", "gst.reports", "gst.view"]);
  for (const p of ["finance.view", "invoice.view", "invoice.create", "invoice.update", "jobs.view", "jobs.update", "users.manage", "customers.view", "qc.view", "settings.manage", "links.manage"] as const) {
    assert.equal(scopeOf("tax_officer", p), "NONE", p);
  }
  for (const path of ["/gst", "/gst/invoices", "/gst/invoices/abc", "/gst/reports"]) assert.equal(routeAllowed("tax_officer", path), true, path);
  for (const path of ["/", "/jobs", "/jobs/x", "/invoices", "/invoices/x", "/customers", "/users", "/settings", "/reports", "/my-jobs", "/quality-queue"]) {
    assert.equal(routeAllowed("tax_officer", path), false, path);
  }
  for (const role of ["field_manager", "qc_inspector"] as const) {
    for (const path of ["/gst", "/gst/invoices/abc", "/invoices", "/invoices/abc"]) assert.equal(routeAllowed(role, path), false, `${role} ${path}`);
  }
  assert.equal(routeAllowed("admin", "/invoices/abc"), true);
  assert.equal(routeAllowed("admin", "/gst/reports"), true);
});

test("Intense AI: every sign-in role may open it; the data tools follow each role's permissions", () => {
  for (const r of ["admin", "field_manager", "qc_inspector", "tax_officer"] as const) {
    assert.equal(scopeOf(r, "ai.use") !== "NONE", true, r);
    assert.equal(routeAllowed(r, "/assistant"), true, r);
  }
  assert.equal(scopeOf("customer", "ai.use"), "NONE", "customers use the QR-token assistant, not a login");
  const names = (role: "admin" | "field_manager" | "qc_inspector" | "tax_officer") =>
    toolsFor({ kind: "user", user: { id: "u", name: "U", email: "u@x", role, teamId: null, branchId: null, customerId: null, referralPartnerId: null } }).map((t) => t.name).sort();
  assert.deepEqual(names("tax_officer"), ["get_gst_summary", "get_invoices"]);
  assert.deepEqual(names("qc_inspector"), ["get_job_details", "get_jobs", "get_qc_report", "get_rework_report"]);
  assert.deepEqual(names("field_manager"), ["get_customers", "get_job_details", "get_jobs", "get_my_work_summary", "get_qc_report", "get_rework_report"]);
  assert.ok(names("admin").includes("get_revenue_summary") && names("admin").includes("get_field_manager_performance") && !names("admin").includes("get_my_service"));
  assert.deepEqual(toolsFor({ kind: "customer", jobId: "j", customerName: "C" }).map((t) => t.name), ["get_my_service"]);
});

test("GST / Non-GST invoice maths", () => {
  const intra = computeInvoiceFigures({ invoiceType: "GST", subtotal: 4999, gstRatePercent: 18 });
  assert.deepEqual([intra.cgst, intra.sgst, intra.igst, intra.tax, intra.total], [449.91, 449.91, 0, 899.82, 5898.82]);
  const inter = computeInvoiceFigures({ invoiceType: "GST", subtotal: 4999, gstRatePercent: 18, interState: true });
  assert.deepEqual([inter.cgst, inter.sgst, inter.igst, inter.tax, inter.total], [0, 0, 899.82, 899.82, 5898.82]);
  const disc = computeInvoiceFigures({ invoiceType: "GST", subtotal: 10000, discount: 1000, gstRatePercent: 18 });
  assert.deepEqual([disc.taxable, disc.tax, disc.total], [9000, 1620, 10620]);
  const non = computeInvoiceFigures({ invoiceType: "NON_GST", subtotal: 4999, discount: 99, gstRatePercent: 18 });
  assert.deepEqual([non.gstRate, non.cgst, non.sgst, non.igst, non.tax, non.total], [0, 0, 0, 0, 0, 4900]);
  assert.equal(isValidGstin("29ABCDE1234F1Z5"), true);
  assert.equal(isValidGstin("29abcde1234f1z5"), true);
  assert.equal(isValidGstin("12345"), false);
});

test("Job ID: CUSTOMER-NAME-DDMMYYYY prefix", () => {
  assert.equal(jobIdPrefix("Rahul Sharma", "2026-10-08"), "RAHUL-SHARMA-08102026");
  assert.equal(jobIdPrefix("  ABC  Cleaning ", "2026-10-08"), "ABC-CLEANING-08102026");
  assert.equal(jobIdPrefix("Dr. A.  O'Brien & Sons!", "2026-01-02"), "DR-A-O-BRIEN-AND-SONS-02012026");
  assert.equal(jobIdPrefix("José Núñez", "2026-10-08"), "JOSE-NUNEZ-08102026");
  assert.equal(jobIdPrefix("गणेश", "2026-10-08"), "CUSTOMER-08102026");
});

test("approvals and notification deep links follow the four roles", () => {
  assert.equal(canApprove("admin", "users.delete"), true);
  assert.equal(canApprove("field_manager", "settings.critical"), false);
  assert.equal(canApprove("admin", "audit.delete"), false, "audit history is never deleted");
  assert.equal(deepLinkFor("field_manager", "rework_assigned", { jobId: "J1" }).path, "/my-jobs/J1");
  assert.equal(deepLinkFor("qc_inspector", "qc_ready", { jobId: "J1" }).path, "/quality-queue/J1");
  assert.equal(deepLinkFor("customer", "team_arrived", { customerLink: "https://x/customer/service/t" }).path, "https://x/customer/service/t");
});
