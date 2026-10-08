/**
 * RBAC — permissions, scopes and the centralized permission matrix.
 *
 *   permission  = MODULE.ACTION          (what)
 *   scope       = ALL | BRANCH | TEAM | ASSIGNED | OWN | NONE   (which records)
 *
 * `ROLE_PERMISSIONS` is the ONLY place that says what a role may do. Every
 * server route and every UI surface resolves through it (see ./engine).
 * Approval authority (who may approve sensitive actions) lives in
 * ./approval.ts and is layered on top of this matrix.
 */

import type { Role } from "./roles";
import { ROLES } from "./roles";

export const PERMISSIONS = [
  "dashboard.view",

  "customers.view",
  "customers.create",
  "customers.update",
  "customers.delete",

  "properties.view",
  "properties.create",
  "properties.update",
  "properties.delete",

  "jobs.view",
  "jobs.create",
  "jobs.update",
  "jobs.assign",
  "jobs.reschedule",
  "jobs.cancel",
  "jobs.arrive",
  "jobs.start",
  "jobs.complete",
  "jobs.close",

  "scheduling.view",
  "scheduling.manage",

  "services.view",
  "services.manage",

  "checklist.view",
  "checklist.execute",
  "checklist.manage",

  "photos.view",
  "photos.upload",
  "photos.delete",

  "qc.view",
  "qc.inspect",
  "qc.pass",
  "qc.rework",
  "qc.reinspect",

  "rework.view",
  "rework.create",
  "rework.complete",

  "complaints.view",
  "complaints.create",
  "complaints.manage",

  "finance.view",
  "invoice.view",
  /** GST invoices + GST reports. The ONLY finance access a Tax Officer has;
   *  every API that serves it filters to invoiceType = GST server-side. */
  "gst.view",
  "gst.reports",
  "invoice.create",
  "invoice.update",
  "invoice.finalize",
  "payment.record",
  "payment.make",
  "refund.create",
  "refund.approve",
  "expenses.manage",
  "quotes.manage",

  "reports.view",
  "reports.financial",

  "users.view",
  "users.manage",
  "users.delete",

  "settings.view",
  "settings.manage",
  "integrations.manage",

  "audit.view",

  "referrals.view",
  "referrals.create",
  "referrals.manage",
  "commission.view",
  "commission.manage",
  "payouts.view",
  "payouts.manage",

  "amc.view",
  "amc.manage",

  "customer_approval.view",
  "customer_approval.request",
  "customer_approval.view_result",
  "customer_approval.approve",

  "feedback.view",
  "feedback.create",
  "feedback.manage",

  "notifications.view",
  "notifications.send",

  "links.manage",

  /** Intense AI assistant. What it can SEE is decided per data tool by the
   *  permissions above — this only switches the assistant on for a role. */
  "ai.use",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SCOPES = ["ALL", "BRANCH", "TEAM", "ASSIGNED", "OWN", "NONE"] as const;
export type Scope = (typeof SCOPES)[number];

/** Broader scope wins when two grants compete (ALL ⊃ BRANCH ⊃ TEAM ⊃ ASSIGNED ⊃ OWN ⊃ NONE). */
export const SCOPE_RANK: Record<Scope, number> = {
  ALL: 5,
  BRANCH: 4,
  TEAM: 3,
  ASSIGNED: 2,
  OWN: 1,
  NONE: 0,
};

export type PermissionGrant = Partial<Record<Permission, Scope>>;

function all(...perms: Permission[]): PermissionGrant {
  const g: PermissionGrant = {};
  for (const p of perms) g[p] = "ALL";
  return g;
}
function assigned(...perms: Permission[]): PermissionGrant {
  const g: PermissionGrant = {};
  for (const p of perms) g[p] = "ASSIGNED";
  return g;
}
function own(...perms: Permission[]): PermissionGrant {
  const g: PermissionGrant = {};
  for (const p of perms) g[p] = "OWN";
  return g;
}

/* -------------------------------------------------------------------------- */
/* THE PERMISSION MATRIX                                                      */
/* -------------------------------------------------------------------------- */

/** Admin runs the whole business: every permission, every record. */
const ADMIN: PermissionGrant = Object.fromEntries(
  PERMISSIONS.map((p) => [p, "ALL"])
) as PermissionGrant;

/**
 * Field Manager — only the jobs assigned to them. No revenue, no other
 * customers, no other managers' jobs, no settings, users, reports or finance.
 */
const FIELD_MANAGER: PermissionGrant = {
  ...assigned(
    "jobs.view",
    "jobs.update", // work notes only (server restricts fields)
    "jobs.arrive",
    "jobs.start",
    "jobs.complete",
    "checklist.view",
    "checklist.execute",
    "photos.view",
    "photos.upload",
    "qc.view", // result of the inspection on own jobs
    "rework.view",
    "rework.complete",
    "customers.view", // contact details of the customer on the assigned job
    "properties.view",
    "customer_approval.view"
  ),
  ...own("photos.delete"), // only photos they uploaded themselves
  ...all("services.view", "ai.use"),
};

/** QC — inspects completed work; never touches money, users or settings. */
const QC_INSPECTOR: PermissionGrant = {
  ...all(
    "jobs.view", // required data only — financial fields redacted server-side
    "checklist.view",
    "photos.view",
    "photos.upload", // QC evidence
    "qc.view",
    "qc.inspect",
    "qc.pass",
    "qc.rework",
    "qc.reinspect",
    "rework.view",
    "rework.create",
    "services.view",
    "ai.use"
  ),
};

/**
 * Customer — vocabulary only. Customers never sign in; the secure service
 * link (/api/customer/job/[token]) authorizes them by token, server-side.
 */
const CUSTOMER: PermissionGrant = {
  ...own(
    "jobs.view",
    "photos.view",
    "customer_approval.view",
    "customer_approval.approve",
    "complaints.create",
    "feedback.create"
  ),
};

/**
 * Tax Officer — read-only GST access. No jobs, customers, users, Non-GST
 * invoices, payments or settings; no create / edit / delete of anything.
 * NOTE: `gst.view` never grants Non-GST invoices — the invoice APIs force
 * invoiceType = GST for anyone without `finance.view`.
 */
const TAX_OFFICER: PermissionGrant = {
  ...all("gst.view", "gst.reports", "ai.use"),
};

export const ROLE_PERMISSIONS: Record<Role, PermissionGrant> = {
  admin: ADMIN,
  field_manager: FIELD_MANAGER,
  qc_inspector: QC_INSPECTOR,
  tax_officer: TAX_OFFICER,
  customer: CUSTOMER,
};

/** Human-readable module grouping used by the admin "Roles" screen and docs. */
export const PERMISSION_MODULES: { module: string; permissions: Permission[] }[] = (() => {
  const byModule = new Map<string, Permission[]>();
  for (const p of PERMISSIONS) {
    const mod = p.split(".")[0];
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod)!.push(p);
  }
  return Array.from(byModule.entries()).map(([module, permissions]) => ({ module, permissions }));
})();

/** Sanity: every role in the matrix is a declared role. */
for (const r of Object.keys(ROLE_PERMISSIONS)) {
  if (!(ROLES as readonly string[]).includes(r)) {
    throw new Error(`ROLE_PERMISSIONS contains unknown role ${r}`);
  }
}
