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

const SUPER_ADMIN: PermissionGrant = Object.fromEntries(
  PERMISSIONS.map((p) => [p, "ALL"])
) as PermissionGrant;

const OPS_MANAGER: PermissionGrant = {
  ...all(
    "dashboard.view",
    "customers.view",
    "customers.create",
    "customers.update",
    "properties.view",
    "properties.create",
    "properties.update",
    "jobs.view",
    "jobs.create",
    "jobs.update",
    "jobs.assign",
    "jobs.reschedule",
    "jobs.cancel",
    "jobs.close",
    "scheduling.view",
    "scheduling.manage",
    "services.view",
    "checklist.view",
    "checklist.manage",
    "photos.view",
    "qc.view", // monitor only — inspection belongs to the QC inspector
    "rework.view",
    "rework.create",
    "complaints.view",
    "complaints.manage",
    "amc.view",
    "amc.manage",
    "reports.view", // operational reports only (no reports.financial)
    "users.view", // staff directory / availability
    "settings.view",
    "audit.view",
    "customer_approval.view",
    "customer_approval.request",
    "customer_approval.view_result",
    "feedback.view",
    "feedback.manage",
    "notifications.view",
    "notifications.send",
    "links.manage",
    "refund.approve" // approval authority for refunds above the configured limit (§17)
  ),
};

const SCHEDULER: PermissionGrant = {
  ...all(
    "dashboard.view",
    "customers.view", // basic — financial fields are redacted server-side
    "customers.create",
    "properties.view",
    "properties.create",
    "jobs.view",
    "jobs.create",
    "jobs.update",
    "jobs.assign",
    "jobs.reschedule",
    "jobs.cancel",
    "scheduling.view",
    "scheduling.manage",
    "services.view",
    "checklist.view",
    "qc.view", // status only
    "amc.view",
    "users.view", // availability of field crews
    "notifications.view",
    "notifications.send",
    "links.manage",
    "customer_approval.view"
  ),
};

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
    "customer_approval.view",
    "reports.view", // own jobs only
    "feedback.view"
  ),
  ...own("photos.delete"), // only photos they uploaded themselves
  ...all("services.view"),
};

const FIELD_STAFF: PermissionGrant = {
  ...assigned(
    "jobs.view",
    "checklist.view",
    "checklist.execute",
    "photos.view",
    "photos.upload",
    "rework.view",
    "rework.complete",
    "properties.view"
  ),
  ...own("photos.delete"),
  ...all("services.view"),
};

const QC_INSPECTOR: PermissionGrant = {
  ...all(
    "dashboard.view",
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
    "feedback.view",
    "customer_approval.view_result",
    "services.view"
  ),
};

const ACCOUNTS: PermissionGrant = {
  ...all(
    "dashboard.view",
    "finance.view",
    "invoice.view",
    "invoice.create",
    "invoice.update",
    "invoice.finalize",
    "payment.record",
    "refund.create", // below the configured limit; above requires refund.approve
    "expenses.manage",
    "quotes.manage",
    "reports.view",
    "reports.financial",
    "jobs.view", // billing data of jobs
    "customers.view",
    "properties.view",
    "qc.view", // result only
    "referrals.view",
    "commission.view",
    "commission.manage",
    "payouts.view",
    "payouts.manage",
    "amc.view",
    "services.view",
    "notifications.view"
  ),
};

const REFERRAL_PARTNER: PermissionGrant = {
  ...own(
    "dashboard.view",
    "referrals.view",
    "referrals.create", // generate own referral link
    "commission.view",
    "payouts.view",
    "jobs.view" // summary-level status of referred jobs only
  ),
};

const CUSTOMER: PermissionGrant = {
  ...own(
    "dashboard.view",
    "customers.view",
    "customers.update",
    "properties.view",
    "jobs.view",
    "checklist.view",
    "photos.view",
    "qc.view",
    "customer_approval.view",
    "customer_approval.approve",
    "complaints.create",
    "feedback.create",
    "feedback.view",
    "invoice.view",
    "payment.make",
    "amc.view",
    "reports.view"
  ),
};

export const ROLE_PERMISSIONS: Record<Role, PermissionGrant> = {
  super_admin: SUPER_ADMIN,
  ops_manager: OPS_MANAGER,
  scheduler: SCHEDULER,
  field_manager: FIELD_MANAGER,
  field_staff: FIELD_STAFF,
  qc_inspector: QC_INSPECTOR,
  accounts: ACCOUNTS,
  referral_partner: REFERRAL_PARTNER,
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
