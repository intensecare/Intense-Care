/**
 * RBAC — roles.
 *
 * The business runs on FIVE user types:
 *   admin          — runs the business (Operations)
 *   field_manager  — does the work on site (My Jobs)
 *   qc_inspector   — checks the work (Quality)
 *   tax_officer    — reads GST invoices and GST reports only (GST)
 *   customer       — never signs in: uses the ONE secure service link / QR per job
 *
 * `customer` stays in the list only so the customer link can share the same
 * next-action vocabulary; it is not a sign-in role (see SIGN_IN_ROLES).
 * Nothing in the application should branch on a role name directly — use
 * `can()` / `scopeOf()` from ./engine with a permission instead.
 */

export const ROLES = ["admin", "field_manager", "qc_inspector", "tax_officer", "customer"] as const;

export type Role = (typeof ROLES)[number];

/** Roles that sign in with email + password. */
export const SIGN_IN_ROLES: Role[] = ["admin", "field_manager", "qc_inspector", "tax_officer"];

/** Roles that can be assigned to a job as its Field Manager. */
export const ASSIGNABLE_ROLES: Role[] = ["field_manager"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  field_manager: "Field Manager",
  qc_inspector: "Quality Check (QC)",
  tax_officer: "Tax Officer",
  customer: "Customer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Runs the business: customers, jobs, scheduling, team assignment, quality, approvals, payments, reports, users and settings.",
  field_manager: "Does the work: sees only their assigned jobs — arrive, start, checklist, photos, complete, fix rework.",
  qc_inspector: "Checks the work: inspects completed jobs, passes them or sends them back for rework.",
  tax_officer: "Reads GST invoices and GST reports only. Cannot see Non-GST invoices, jobs, customers or users, and cannot change anything.",
  customer: "Uses the secure service link: confirms the team, follows progress, approves and rates the service.",
};

/**
 * Maps a stored role string to a canonical Role. Accounts created before the
 * simplification keep working: every desk role becomes Admin and every
 * on-site role becomes Field Manager. Unknown values resolve to `customer`,
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
    case "field_manager":
    case "field_staff":
    case "staff":
      return "field_manager";
    case "qc_inspector":
    case "qc":
      return "qc_inspector";
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
