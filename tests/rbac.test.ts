/**
 * User types — Admin, Field Operations Manager (field work + QC), Tax Officer, Customer (link only).
 * Permission matrix, sign-in rules, next action and workspace routing.
 * Run: npm test
 */
import "dotenv/config";
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
import { inspectionBarredReason, DEFAULT_QC_POLICY } from "../src/lib/qc-policy";
import { validateTransition } from "../src/lib/state-machine";
import { computeInvoiceFigures, isValidGstin } from "../src/lib/tax";
import { jobIdPrefix } from "../src/lib/server/job-serial";
import { toolsFor } from "../src/lib/server/ai/tools";
import type { Job } from "../src/lib/types";

const principal = (role: Principal["role"], extra: Partial<Principal> = {}): Principal => ({ id: "u1", role, ...extra });

test("exactly four user types; three sign in (the customer uses the job QR / link)", () => {
  assert.deepEqual([...ROLES].sort(), ["admin", "customer", "field_operations_manager", "tax_officer"]);
  assert.deepEqual([...SIGN_IN_ROLES].sort(), ["admin", "field_operations_manager", "tax_officer"]);
  assert.equal(canSignIn("customer"), false, "customers use the secure link, never a login");
  assert.equal(canSignIn("referral_partner"), false);
});

test("legacy roles map onto the four types; unknown values never widen access", () => {
  for (const r of ["super_admin", "ops_manager", "scheduler", "accounts", "admin"]) assert.equal(normalizeRole(r), "admin", r);
  // The merge: every pre-merge field / QC value resolves to the combined role, so old rows keep working.
  for (const r of ["staff", "field_staff", "field_manager", "qc_inspector", "qc", "field_operations_manager"]) assert.equal(normalizeRole(r), "field_operations_manager", r);
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

test("Field Operations Manager (field side): only assigned jobs; no revenue, settings, users, reports or finance; never Admin", () => {
  assert.equal(scopeOf("field_operations_manager", "jobs.view"), "ASSIGNED");
  for (const p of ["finance.view", "invoice.view", "reports.view", "users.view", "users.manage", "settings.view", "settings.manage", "dashboard.view", "jobs.assign", "payment.record", "contacts.view", "media.manage", "integrations.manage"] as const) {
    assert.equal(scopeOf("field_operations_manager", p), "NONE", p);
  }
  const fm = principal("field_operations_manager");
  assert.equal(authorize(fm, "jobs.start", { assignedManagerId: "u1", assignedStaffIds: [] }).allowed, true);
  assert.equal(authorize(fm, "jobs.start", { assignedManagerId: "someone-else", assignedStaffIds: [] }).allowed, false, "another manager's job");
  assert.equal(authorize(fm, "customers.view", { assignedManagerId: "other" }).allowed, false);
});

test("Field Operations Manager (quality side): inspects, passes, raises and reinspects rework — same role, still no money", () => {
  for (const p of ["qc.view", "qc.inspect", "qc.pass", "qc.rework", "qc.reinspect", "rework.view", "rework.create"] as const) assert.equal(scopeOf("field_operations_manager", p), "ALL", p);
  assert.equal(scopeOf("field_operations_manager", "rework.complete"), "ASSIGNED", "only on the jobs they work on");
  assert.equal(scopeOf("field_operations_manager", "jobs.arrive"), "ASSIGNED");
  for (const p of ["finance.view", "users.manage", "settings.manage", "jobs.assign"] as const) assert.equal(scopeOf("field_operations_manager", p), "NONE", p);
  // The role keeps its pre-merge parts out of Admin's reach: Admin has everything, this role does not.
  const all = PERMISSIONS.filter((p) => scopeOf("field_operations_manager", p) === "NONE").length;
  assert.ok(all > PERMISSIONS.length / 2, "most permissions stay Admin-only");
});

test("merge: legacy Field Manager and QC identifiers resolve to the combined role with the SAME permissions", () => {
  for (const legacy of ["field_manager", "qc_inspector", "qc", "staff", "field_staff"]) {
    assert.equal(normalizeRole(legacy), "field_operations_manager", legacy);
    assert.equal(canSignIn(legacy), true, `${legacy} can still sign in`);
    for (const p of PERMISSIONS) assert.equal(scopeOf(legacy, p), scopeOf("field_operations_manager", p), `${legacy} ${p}`);
  }
  assert.equal(normalizeRole("customer"), "customer");
  assert.equal(canSignIn("customer"), false);
});

test("state machine: no skipping the journey, whoever holds the role; start needs customer confirmation", () => {
  const job = (status: Job["status"], extra: Partial<Job> = {}) => ({ id: "JOB-1", status, assignedStaffIds: [], ...extra }) as unknown as Job;
  assert.equal(validateTransition(job("QUALITY_CHECK"), "PASS", "field_operations_manager").allowed, true, "the combined role may pass an inspected job");
  assert.equal(validateTransition(job("IN_PROGRESS"), "PASS", "field_operations_manager").allowed, false, "…but not straight from the work");
  assert.equal(validateTransition(job("WORK_COMPLETED"), "COMPLETED", "field_operations_manager").allowed, false);
  assert.equal(validateTransition(job("SCHEDULED"), "WORK_COMPLETED", "field_operations_manager").allowed, false);
  assert.equal(validateTransition(job("IN_PROGRESS"), "WORK_COMPLETED", "field_operations_manager").allowed, true);
  assert.equal(validateTransition(job("CUSTOMER_VERIFIED"), "IN_PROGRESS", "field_operations_manager").allowed, false, "needs customerConfirmedAt");
  assert.equal(validateTransition(job("CUSTOMER_VERIFIED", { customerConfirmedAt: "2026-10-08T10:00:00Z" }), "IN_PROGRESS", "field_operations_manager").allowed, true);
  assert.equal(validateTransition(job("SCHEDULED"), "COMPLETED", "admin").allowed, false, "no skipping the journey");
});

test("Field Manager flow: I'm Here → wait → Start → checklist → photos → Complete → wait for QC → fix rework", () => {
  const ctx = { assignedManagerId: "u1", assignedStaffIds: [] as string[] };
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "ASSIGNED" })?.label, "Start Job");
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "ARRIVED" })?.waiting, true);
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "ARRIVED", customerConfirmedAt: "x" })?.target, "IN_PROGRESS");
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "IN_PROGRESS", checklistTotal: 3, checklistDone: 1 })?.kind, "checklist");
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "IN_PROGRESS", checklistTotal: 3, checklistDone: 3 })?.kind, "photos");
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "IN_PROGRESS", checklistTotal: 3, checklistDone: 3, photosBefore: 1, photosAfter: 1 })?.target, "WORK_COMPLETED");
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "WORK_COMPLETED" })?.label, "Waiting for QC");
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "REWORK_ASSIGNED", openRework: 2 })?.kind, "rework");
  assert.equal(getNextAction("field_operations_manager", { ...ctx, status: "REWORK_COMPLETED" })?.waiting, true);
});

test("QC next action (job on someone else's crew): inspect → reinspect; waits while rework is open", () => {
  const other = { assignedManagerId: "someone-else", assignedStaffIds: [] as string[], viewerId: "u1", separationOfDuties: true };
  assert.equal(getNextAction("field_operations_manager", { ...other, status: "WORK_COMPLETED" })?.label, "Inspect");
  assert.equal(getNextAction("field_operations_manager", { ...other, status: "REWORK_COMPLETED" })?.label, "Reinspect");
  assert.equal(getNextAction("field_operations_manager", { ...other, status: "REWORK_ASSIGNED" })?.waiting, true);
});

test("separation of duties: on their OWN job the combined role is told to wait — unless the company switched the rule off", () => {
  const mine = { assignedManagerId: "u1", assignedStaffIds: [] as string[], viewerId: "u1" };
  assert.equal(getNextAction("field_operations_manager", { ...mine, separationOfDuties: true, status: "WORK_COMPLETED" })?.label, "Needs another inspector");
  assert.equal(getNextAction("field_operations_manager", { ...mine, separationOfDuties: true, status: "REWORK_COMPLETED" })?.waiting, true);
  assert.equal(getNextAction("field_operations_manager", { ...mine, separationOfDuties: false, status: "WORK_COMPLETED" })?.label, "Inspect");
  assert.equal(getNextAction("field_operations_manager", { ...mine, separationOfDuties: false, status: "IN_PROGRESS", checklistTotal: 1, checklistDone: 0 })?.kind, "checklist", "field work is unaffected");
});

test("separation-of-duties policy: crew members are barred only while the rule is on", () => {
  const job = { assignedManagerId: "m1", assignedStaffIds: ["s1", "s2"] };
  for (const id of ["m1", "s1", "s2"]) {
    assert.ok(inspectionBarredReason({ separationOfDuties: true }, id, job), id);
    assert.equal(inspectionBarredReason({ separationOfDuties: false }, id, job), null, id);
  }
  assert.equal(inspectionBarredReason({ separationOfDuties: true }, "outsider", job), null);
  assert.equal(inspectionBarredReason(DEFAULT_QC_POLICY, "m1", job) !== null, true, "the rule is ON by default");
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
    ["Dashboard", "Intense AI", "Jobs", "Customers", "Leads", "Quotations", "Invoices", "QC", "Reports", "Users"]
  );
  assert.deepEqual(
    navFor("admin").filter((n) => n.secondary).map((n) => n.label),
    ["Schedule", "Properties", "Services", "GST", "Expenses", "Referrals", "HR", "Contacts", "Media & Storage", "Reviews & Feedback", "Settings"]
  );
  assert.equal(homePathFor("admin"), "/");
  assert.equal(homePathFor("field_operations_manager"), "/my-jobs");
  assert.deepEqual(navFor("field_operations_manager").map((n) => n.href), ["/my-jobs", "/quality-queue"]);
  assert.equal(navFor("customer").length, 0);
  assert.ok(navFor("admin").some((n) => n.href === "/users"));
  // §4 Quotations are an Admin surface only — no other role holds quotes.manage.
  assert.ok(navFor("admin").some((n) => n.href === "/quotations"));
  for (const role of ["field_operations_manager", "tax_officer", "customer"] as const) {
    assert.equal(routeAllowed(role, "/quotations"), false, role + " must not reach quotations");
  }
});

test("routing: the Field Operations Manager can't open the Operations desk; customer pages are public", () => {
  for (const path of ["/", "/jobs", "/jobs/JOB-1", "/jobs/new", "/quotations", "/reviews", "/customers", "/finance", "/reports", "/users", "/settings"]) {
    assert.equal(routeAllowed("field_operations_manager", path), false, `FOM ${path}`);
  }
  assert.equal(routeAllowed("field_operations_manager", "/my-jobs/JOB-1"), true);
  assert.equal(routeAllowed("field_operations_manager", "/quality-queue/JOB-1"), true);
  assert.equal(routeAllowed("field_operations_manager", "/quality-queue"), true);
  assert.equal(routeAllowed("admin", "/my-jobs"), false, "Admin manages jobs from the job page");
  assert.equal(isPublicPath("/customer/service/abc"), true);
  assert.equal(isPublicPath("/customer/quote/abc"), true);
  assert.equal(isPublicPath("/partner-portal/x"), false, "referral portal removed");
});

test("Tax Officer: GST invoices and GST reports only — nothing else, read-only (plus Intense AI, scoped to those same tools)", () => {
  const grants = Object.entries(ROLE_PERMISSIONS.tax_officer).filter(([, s]) => s !== "NONE").map(([p]) => p).sort();
  assert.deepEqual(grants, ["ai.use", "gst.reports", "gst.view"]);
  for (const p of ["finance.view", "invoice.view", "invoice.create", "invoice.update", "jobs.view", "jobs.update", "users.manage", "customers.view", "qc.view", "settings.manage", "links.manage"] as const) {
    assert.equal(scopeOf("tax_officer", p), "NONE", p);
  }
  for (const path of ["/gst", "/gst/invoices", "/gst/invoices/abc", "/gst/reports"]) assert.equal(routeAllowed("tax_officer", path), true, path);
  for (const path of ["/", "/jobs", "/jobs/x", "/invoices", "/invoices/x", "/customers", "/users", "/settings", "/reports", "/my-jobs", "/quality-queue"]) {
    assert.equal(routeAllowed("tax_officer", path), false, path);
  }
  for (const role of ["field_operations_manager"] as const) {
    for (const path of ["/gst", "/gst/invoices/abc", "/invoices", "/invoices/abc"]) assert.equal(routeAllowed(role, path), false, `${role} ${path}`);
  }
  assert.equal(routeAllowed("admin", "/invoices/abc"), true);
  assert.equal(routeAllowed("admin", "/gst/reports"), true);
});

test("Intense AI: every internal role may open it, scoped to what that role can already see; Customer cannot", () => {
  for (const r of ["admin", "field_operations_manager", "tax_officer"] as const) {
    assert.equal(scopeOf(r, "ai.use") !== "NONE", true, r);
    assert.equal(routeAllowed(r, "/assistant"), true, r);
  }
  assert.equal(scopeOf("customer", "ai.use"), "NONE", "customer");
  assert.equal(routeAllowed("customer", "/assistant"), false, "customer");
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
  assert.equal(canApprove("field_operations_manager", "settings.critical"), false);
  assert.equal(canApprove("admin", "audit.delete"), false, "audit history is never deleted");
  assert.equal(deepLinkFor("field_operations_manager", "rework_assigned", { jobId: "J1" }).path, "/my-jobs/J1");
  assert.equal(deepLinkFor("field_operations_manager", "qc_ready", { jobId: "J1" }).path, "/quality-queue/J1");
  assert.equal(deepLinkFor("customer", "team_arrived", { customerLink: "https://x/customer/service/t" }).path, "https://x/customer/service/t");
});

test("Expenses, referrals, HR, payroll: who may do what", () => {
  const sensitive = ["hr.sensitive", "hr.manage", "payroll.manage", "leave.manage", "freelance.manage", "attendance.correct", "referrals.approve", "referrals.manage", "expenses.manage", "expenses.view"] as const;
  for (const p of sensitive) assert.equal(scopeOf("admin", p), "ALL", `admin ${p}`);
  // Field Manager: their own team and attendance, and expenses they submit — never money, payroll or personal details.
  assert.equal(scopeOf("field_operations_manager", "hr.view"), "ASSIGNED");
  assert.equal(scopeOf("field_operations_manager", "attendance.record"), "ASSIGNED");
  assert.equal(scopeOf("field_operations_manager", "expenses.submit"), "ASSIGNED");
  for (const p of sensitive) assert.equal(scopeOf("field_operations_manager", p), "NONE", `field_operations_manager must not have ${p}`);
  // Tax Officer and Customer get none of it.
  for (const r of ["tax_officer", "customer"] as const) {
    for (const p of [...sensitive, "hr.view", "attendance.record", "expenses.submit"] as const) assert.equal(scopeOf(r, p), "NONE", `${r} must not have ${p}`);
  }
});

test("routing: HR, Expenses and Referrals are Admin-only pages", () => {
  for (const path of ["/hr", "/hr/abc", "/expenses", "/referrals"]) {
    assert.equal(routeAllowed("admin", path), true, `admin ${path}`);
    for (const r of ["field_operations_manager", "tax_officer"] as const) assert.equal(routeAllowed(r, path), false, `${r} ${path}`);
  }
});
