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
import type { Job } from "../src/lib/types";

const principal = (role: Principal["role"], extra: Partial<Principal> = {}): Principal => ({ id: "u1", role, ...extra });

test("exactly four user types; only three sign in", () => {
  assert.deepEqual([...ROLES].sort(), ["admin", "customer", "field_manager", "qc_inspector"]);
  assert.deepEqual([...SIGN_IN_ROLES].sort(), ["admin", "field_manager", "qc_inspector"]);
  assert.equal(canSignIn("customer"), false, "customers use the secure link, never a login");
  assert.equal(canSignIn("referral_partner"), false);
});

test("legacy roles map onto the four types; unknown values never widen access", () => {
  for (const r of ["super_admin", "ops_manager", "scheduler", "accounts", "admin"]) assert.equal(normalizeRole(r), "admin", r);
  for (const r of ["staff", "field_staff", "field_manager"]) assert.equal(normalizeRole(r), "field_manager", r);
  assert.equal(normalizeRole("qc_inspector"), "qc_inspector");
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

test("workspaces: four separate experiences, each with its own home", () => {
  assert.equal(homePathFor("admin"), "/");
  assert.equal(homePathFor("field_manager"), "/my-jobs");
  assert.equal(homePathFor("qc_inspector"), "/quality-queue");
  assert.deepEqual(navFor("field_manager").map((n) => n.href), ["/my-jobs"]);
  assert.deepEqual(navFor("qc_inspector").map((n) => n.href), ["/quality-queue"]);
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
  assert.equal(isPublicPath("/customer/property/abc"), true);
  assert.equal(isPublicPath("/partner-portal/x"), false, "referral portal removed");
});

test("approvals and notification deep links follow the four roles", () => {
  assert.equal(canApprove("admin", "users.delete"), true);
  assert.equal(canApprove("field_manager", "settings.critical"), false);
  assert.equal(canApprove("admin", "audit.delete"), false, "audit history is never deleted");
  assert.equal(deepLinkFor("field_manager", "rework_assigned", { jobId: "J1" }).path, "/my-jobs/J1");
  assert.equal(deepLinkFor("qc_inspector", "qc_ready", { jobId: "J1" }).path, "/quality-queue/J1");
  assert.equal(deepLinkFor("customer", "team_arrived", { customerLink: "https://x/customer/service/t" }).path, "https://x/customer/service/t");
});
