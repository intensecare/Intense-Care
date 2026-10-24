/**
 * RBAC — roles.
 *
 * The business runs on FOUR sign-in user types (+ the customer link):
 *   admin                     — runs the business (Operations)
 *   field_operations_manager  — does the work on site AND checks the work (My Jobs + Quality)
 *   tax_officer               — reads GST invoices and GST reports only (GST)
 *   customer                  — never signs in: uses the ONE secure service link / QR per job
 *
 * "field_manager" and "qc_inspector" were merged into field_operations_manager.
 * Those two names survive ONLY as legacy stored values (see normalizeRole /
 * LEGACY_ROLE_VALUES) so old rows, tokens and history keep resolving; nothing
 * can be created with them any more.
 *
 * `customer` stays in the list only so the customer link can share the same
 * next-action vocabulary; it is not a sign-in role (see SIGN_IN_ROLES).
 * Nothing in the application should branch on a role name directly — use
 * `can()` / `scopeOf()` from ./engine with a permission instead.
 */

export const ROLES = ["admin", "field_operations_manager", "tax_officer", "customer"] as const;

export type Role = (typeof ROLES)[number];

/**
 * Every stored `User.role` string that means Field Operations Manager — the current value plus the pre-merge ones, so a
 * database query is right both before and after the migration has been applied.
 */
export const FIELD_OPS_STORED_ROLES = ["field_operations_manager", "field_manager", "field_staff", "staff", "qc_inspector", "qc"];

/** Stored values from before the merge. Read-only: kept for migration and historical records. */
export const LEGACY_ROLE_VALUES = ["field_manager", "qc_inspector"] as const;

/** Roles that sign in with email + password. */
export const SIGN_IN_ROLES: Role[] = ["admin", "field_operations_manager", "tax_officer"];

/** Roles that can be assigned to a job as its Field Operations Manager. */
export const ASSIGNABLE_ROLES: Role[] = ["field_operations_manager"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  field_operations_manager: "Field Operations Manager",
  tax_officer: "Tax Officer",
  customer: "Customer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Runs the business: customers, jobs, scheduling, team assignment, quality, approvals, payments, reports, users and settings.",
  field_operations_manager:
    "Runs the work on site and checks it: their assigned jobs (arrive, start, checklist, photos, complete, fix rework) and the quality queue (inspect, pass or return for rework, reinspect). No finance, users or settings.",
  tax_officer: "Reads GST invoices and GST reports only. Cannot see Non-GST invoices, jobs, customers or users, and cannot change anything.",
  customer: "Uses the secure service link: confirms the team, follows progress, approves and rates the service.",
};

/**
 * Maps a stored role string to a canonical Role. Accounts created before the
 * simplification / merge keep working: every desk role becomes Admin and every
 * on-site or QC role becomes Field Operations Manager. Unknown values resolve to `customer`,
 * which cannot sign in, so a corrupt row can never widen access.
 */
export function normalizeRole(raw: string | null | undefined): Role {
  switch (raw) {
    case "admin":
    case "super_admin":
    case "ops_manager":
    case "scheduler":
    case "accounts":
      return "admin";
    case "field_operations_manager":
    case "field_manager":
    case "field_staff":
    case "staff":
    case "qc_inspector":
    case "qc":
      return "field_operations_manager";
    case "tax_officer":
      return "tax_officer";
    default:
      return "customer";
  }
}

/** May an account with this stored role sign in? */
export function canSignIn(raw: string | null | undefined): boolean {
  return SIGN_IN_ROLES.includes(normalizeRole(raw));
}
