/**
 * RBAC engine, matrix, next-action and workspace tests.
 * Run: npx tsx tests/rbac.test.ts   (or `npm test`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  normalizeRole,
  scopeOf,
  can,
  authorize,
  matchesScope,
  grantsFor,
  getNextAction,
  TRANSITION_PERMISSION,
  customerStageLabel,
  routeAllowed,
  navFor,
  homePathFor,
  canApprove,
  refundNeedsApproval,
  DEFAULT_APPROVAL_LIMITS,
  customerFeatures,
  deepLinkFor,
  type Principal,
} from "../src/lib/rbac";

const principal = (role: Principal["role"], extra: Partial<Principal> = {}): Principal => ({ id: "u1", role, ...extra });

test("matrix: every role grants only declared permissions and super admin holds everything", () => {
  for (const role of ROLES) {
    for (const p of Object.keys(ROLE_PERMISSIONS[role])) {
      assert.ok((PERMISSIONS as readonly string[]).includes(p), `${role} grants unknown permission ${p}`);
    }
  }
  for (const p of PERMISSIONS) assert.equal(scopeOf("super_admin", p), "ALL");
});

test("roles: legacy and unknown roles normalize safely", () => {
  assert.equal(normalizeRole("staff"), "field_manager");
  assert.equal(normalizeRole("ops_manager"), "ops_manager");
  assert.equal(normalizeRole("hacker"), "customer");
  assert.equal(normalizeRole(undefined), "customer");
});

test("scope: ops manager sees all jobs, field manager only assigned, customer only own", () => {
  assert.equal(scopeOf("ops_manager", "jobs.view"), "ALL");
  assert.equal(scopeOf("field_manager", "jobs.view"), "ASSIGNED");
  assert.equal(scopeOf("field_staff", "jobs.view"), "ASSIGNED");
  assert.equal(scopeOf("customer", "jobs.view"), "OWN");
  assert.equal(scopeOf("referral_partner", "referrals.view"), "OWN");
  assert.equal(scopeOf("referral_partner", "jobs.create"), "NONE");
});

test("authorize: assigned scope requires assignment on the record", () => {
  const fm = principal("field_manager");
  const job = { assignedManagerId: "u1", assignedStaffIds: [] as string[], customerId: "c9" };
  assert.equal(authorize(fm, "jobs.start", job).allowed, true);
  assert.equal(authorize(fm, "jobs.start", { ...job, assignedManagerId: "other" }).allowed, false);
  assert.equal(authorize(fm, "jobs.start", { assignedManagerId: null, assignedStaffIds: ["u1"] }).allowed, true);
});

test("authorize: own scope ties the customer login to the customer record", () => {
  const cust = principal("customer", { customerId: "c1" });
  assert.equal(authorize(cust, "jobs.view", { customerId: "c1" }).allowed, true);
  assert.equal(authorize(cust, "jobs.view", { customerId: "c2" }).allowed, false);
  assert.equal(authorize(cust, "jobs.assign", { customerId: "c1" }).allowed, false);
  const partner = principal("referral_partner", { referralPartnerId: "p1" });
  assert.equal(authorize(partner, "commission.view", { referralPartnerId: "p1" }).allowed, true);
  assert.equal(authorize(partner, "commission.view", { referralPartnerId: "p2" }).allowed, false);
});

test("authorize: photos.delete OWN lets a worker delete only their own uploads", () => {
  const staff = principal("field_staff");
  assert.equal(authorize(staff, "photos.delete", { createdByUserId: "u1" }).allowed, true);
  assert.equal(authorize(staff, "photos.delete", { createdByUserId: "u2" }).allowed, false);
});

test("scope: team and branch scopes resolve from principal attributes", () => {
  const p = principal("ops_manager", { teamId: "t1", branchId: "b1" });
  assert.equal(matchesScope("TEAM", p, { teamIds: ["t1"] }), true);
  assert.equal(matchesScope("TEAM", p, { teamIds: ["t2"] }), false);
  assert.equal(matchesScope("BRANCH", p, { branchId: "b1" }), true);
  assert.equal(matchesScope("BRANCH", p, { branchId: "b2" }), false);
});

test("separation of duties: QC cannot touch money, accounts cannot touch QC, scheduler cannot QC or pay", () => {
  assert.equal(can(principal("qc_inspector"), "payment.record"), false);
  assert.equal(can(principal("qc_inspector"), "invoice.update"), false);
  assert.equal(can(principal("qc_inspector"), "qc.pass"), true);
  assert.equal(can(principal("accounts"), "qc.pass"), false);
  assert.equal(can(principal("accounts"), "checklist.execute"), false);
  assert.equal(can(principal("accounts"), "jobs.assign"), false);
  assert.equal(can(principal("scheduler"), "qc.pass"), false);
  assert.equal(can(principal("scheduler"), "payment.record"), false);
  assert.equal(can(principal("scheduler"), "settings.manage"), false);
  assert.equal(can(principal("ops_manager"), "users.manage"), false);
  assert.equal(can(principal("ops_manager"), "settings.manage"), false);
  assert.equal(can(principal("field_manager"), "finance.view"), false);
  assert.equal(can(principal("field_manager"), "qc.pass"), false);
  assert.equal(can(principal("field_manager"), "commission.view"), false);
  assert.equal(can(principal("field_staff"), "jobs.assign"), false);
  assert.equal(can(principal("customer"), "users.view"), false);
});

test("approval authority: refunds above the limit need ops manager or super admin; audit deletion is never allowed", () => {
  assert.equal(refundNeedsApproval(DEFAULT_APPROVAL_LIMITS.refundApprovalLimit, DEFAULT_APPROVAL_LIMITS), false);
  assert.equal(refundNeedsApproval(DEFAULT_APPROVAL_LIMITS.refundApprovalLimit + 1, DEFAULT_APPROVAL_LIMITS), true);
  assert.equal(canApprove("accounts", "refund.high_value"), false);
  assert.equal(canApprove("ops_manager", "refund.high_value"), true);
  assert.equal(canApprove("super_admin", "users.delete"), true);
  assert.equal(canApprove("ops_manager", "users.delete"), false);
  for (const r of ROLES) assert.equal(canApprove(r, "audit.delete"), false);
});

test("transitions: every status maps to a permission, and field execution belongs to field roles", () => {
  assert.equal(scopeOf("field_manager", TRANSITION_PERMISSION.ARRIVED), "ASSIGNED");
  assert.equal(scopeOf("field_manager", TRANSITION_PERMISSION.IN_PROGRESS), "ASSIGNED");
  assert.equal(scopeOf("field_manager", TRANSITION_PERMISSION.WORK_COMPLETED), "ASSIGNED");
  assert.equal(scopeOf("ops_manager", TRANSITION_PERMISSION.ARRIVED), "NONE");
  assert.equal(scopeOf("ops_manager", TRANSITION_PERMISSION.PASS), "NONE");
  assert.equal(scopeOf("qc_inspector", TRANSITION_PERMISSION.PASS), "ALL");
  assert.equal(scopeOf("field_staff", TRANSITION_PERMISSION.WORK_COMPLETED), "NONE");
  assert.equal(scopeOf("field_staff", TRANSITION_PERMISSION.REWORK_COMPLETED), "ASSIGNED");
});

test("next action: field manager journey", () => {
  const base = { assignedManagerId: "u1", assignedStaffIds: ["u1"] };
  assert.equal(getNextAction("field_manager", { ...base, status: "ASSIGNED" })?.label, "Arrived");
  assert.equal(getNextAction("field_manager", { ...base, status: "ARRIVED" })?.label, "Waiting for Customer");
  assert.equal(getNextAction("field_manager", { ...base, status: "ARRIVED", customerConfirmedAt: "x" })?.label, "Start Service");
  assert.equal(getNextAction("field_manager", { ...base, status: "CUSTOMER_VERIFIED" })?.target, "IN_PROGRESS");
  assert.equal(getNextAction("field_manager", { ...base, status: "IN_PROGRESS", checklistTotal: 4, checklistDone: 2 })?.kind, "checklist");
  assert.equal(getNextAction("field_manager", { ...base, status: "IN_PROGRESS", checklistTotal: 4, checklistDone: 4, photosBefore: 0, photosAfter: 0 })?.kind, "photos");
  assert.equal(getNextAction("field_manager", { ...base, status: "IN_PROGRESS", checklistTotal: 4, checklistDone: 4, photosBefore: 1, photosAfter: 1 })?.target, "WORK_COMPLETED");
  assert.equal(getNextAction("field_manager", { ...base, status: "WORK_COMPLETED" })?.waiting, true);
  assert.equal(getNextAction("field_manager", { ...base, status: "REWORK_ASSIGNED", openRework: 2 })?.kind, "rework");
});

test("next action: field staff never starts or completes the job itself", () => {
  const j = { assignedStaffIds: ["u1"], status: "CUSTOMER_VERIFIED" };
  assert.equal(getNextAction("field_staff", j)?.waiting, true);
  const done = { assignedStaffIds: ["u1"], status: "IN_PROGRESS", checklistTotal: 2, checklistDone: 2, photosBefore: 1, photosAfter: 1 };
  assert.notEqual(getNextAction("field_staff", done)?.kind, "transition");
});

test("next action: QC, accounts and customer", () => {
  assert.equal(getNextAction("qc_inspector", { status: "WORK_COMPLETED" })?.label, "Inspect");
  assert.equal(getNextAction("qc_inspector", { status: "REWORK_COMPLETED" })?.label, "Reinspect");
  assert.equal(getNextAction("qc_inspector", { status: "REWORK_ASSIGNED" })?.waiting, true);
  assert.equal(getNextAction("accounts", { status: "COMPLETED", balanceDue: 100, invoiceFinalized: true })?.label, "Record Payment");
  assert.equal(getNextAction("accounts", { status: "COMPLETED", balanceDue: 100, invoiceFinalized: false })?.label, "Finalize Invoice");
  assert.equal(getNextAction("accounts", { status: "IN_PROGRESS" })?.waiting, true);
  assert.equal(getNextAction("customer", { status: "ARRIVED" })?.kind, "confirm");
  assert.equal(getNextAction("customer", { status: "CUSTOMER_APPROVAL" })?.kind, "approve");
  assert.equal(getNextAction("customer", { status: "COMPLETED" })?.kind, "feedback");
  assert.equal(getNextAction("ops_manager", { status: "SCHEDULED" })?.kind, "assign");
  assert.equal(getNextAction("ops_manager", { status: "WORK_COMPLETED" })?.waiting, true);
  assert.equal(getNextAction("super_admin", { status: "WORK_COMPLETED" })?.kind, "inspect");
});

test("customer vocabulary never exposes internal statuses", () => {
  for (const s of ["QUALITY_CHECK", "REWORK_ASSIGNED", "REINSPECTION", "WORK_COMPLETED"]) {
    assert.equal(customerStageLabel(s), "Quality Check");
  }
  assert.equal(customerStageLabel("ARRIVED"), "Team Arrived");
  assert.equal(customerStageLabel("CUSTOMER_APPROVAL"), "Ready for Approval");
});

test("workspaces: each role lands on its own home and cannot open another role's workspace", () => {
  assert.equal(homePathFor("super_admin"), "/");
  assert.equal(homePathFor("ops_manager"), "/operations");
  assert.equal(homePathFor("scheduler"), "/schedule");
  assert.equal(homePathFor("field_manager"), "/my-jobs");
  assert.equal(homePathFor("field_staff"), "/my-tasks");
  assert.equal(homePathFor("qc_inspector"), "/quality-queue");
  assert.equal(homePathFor("accounts"), "/finance");
  assert.equal(homePathFor("referral_partner"), "/my-referrals");
  assert.equal(homePathFor("customer"), "/my-services");

  assert.equal(routeAllowed("customer", "/jobs"), false);
  assert.equal(routeAllowed("customer", "/my-services/abc"), true);
  assert.equal(routeAllowed("field_staff", "/finance"), false);
  assert.equal(routeAllowed("field_staff", "/my-tasks/abc"), true);
  assert.equal(routeAllowed("qc_inspector", "/users"), false);
  assert.equal(routeAllowed("qc_inspector", "/quality-queue/abc"), true);
  assert.equal(routeAllowed("accounts", "/quality-queue"), false);
  assert.equal(routeAllowed("accounts", "/finance"), true);
  assert.equal(routeAllowed("ops_manager", "/settings"), false);
  assert.equal(routeAllowed("ops_manager", "/jobs/abc"), true);
  assert.equal(routeAllowed("scheduler", "/quality"), false);
  assert.equal(routeAllowed("referral_partner", "/referrals"), false);
  assert.equal(routeAllowed("super_admin", "/settings"), true);
  assert.equal(routeAllowed("customer", "/customer/job/token"), true);
});

test("workspaces: nav items are filtered by the matrix", () => {
  const opsNav = navFor("ops_manager").map((n) => n.href);
  assert.ok(opsNav.includes("/operations"));
  assert.ok(!opsNav.includes("/settings"));
  assert.ok(!opsNav.includes("/finance"));
  assert.ok(navFor("accounts").every((n) => can(principal("accounts"), n.permission)));
});

test("grants: client receives only non-empty scopes", () => {
  const g = grantsFor("field_staff");
  assert.ok(g.every((x) => x.scope !== "NONE"));
  assert.ok(g.some((x) => x.permission === "checklist.execute" && x.scope === "ASSIGNED"));
});

test("customer features: AMC / NRI are capabilities, not roles", () => {
  assert.deepEqual(customerFeatures([]), { amc: false, nri: false });
  assert.deepEqual(customerFeatures([{ status: "ACTIVE" }]), { amc: true, nri: false });
  assert.deepEqual(customerFeatures([{ status: "ACTIVE", nriContactPhone: "+1" }]), { amc: true, nri: true });
  assert.deepEqual(customerFeatures([{ status: "EXPIRED", nriContactPhone: "+1" }]), { amc: false, nri: false });
});

test("deep links land on role-specific action pages", () => {
  assert.equal(deepLinkFor("qc_inspector", "qc_ready", { jobId: "j1" }).path, "/quality-queue/j1");
  assert.equal(deepLinkFor("field_staff", "job_assigned", { jobId: "j1" }).path, "/my-tasks/j1");
  assert.equal(deepLinkFor("field_manager", "job_assigned", { jobId: "j1" }).path, "/my-jobs/j1");
  assert.equal(deepLinkFor("customer", "team_arrived", { jobId: "j1", customerLink: "https://x/customer/job/t" }).path, "https://x/customer/job/t");
  assert.equal(deepLinkFor("accounts", "payment_received", { invoiceId: "i1" }).cta, "VIEW PAYMENT");
});
