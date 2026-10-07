/**
 * RBAC — roles.
 *
 * Nine primary roles. AMC / NRI is NOT a role: it is a customer-profile
 * capability (see `customerFeatures` in engine.ts) attached to the CUSTOMER
 * role. Nothing in the application should branch on a role name directly —
 * use `can()` / `scopeOf()` from ./engine with a permission instead.
 */

export const ROLES = [
  "super_admin",
  "ops_manager",
  "scheduler",
  "field_manager",
  "field_staff",
  "qc_inspector",
  "accounts",
  "referral_partner",
  "customer",
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that sign in to the internal application (desk or field). */
export const INTERNAL_ROLES: Role[] = [
  "super_admin",
  "ops_manager",
  "scheduler",
  "field_manager",
  "field_staff",
  "qc_inspector",
  "accounts",
];

/** Roles that only ever see their own records through a portal. */
export const EXTERNAL_ROLES: Role[] = ["referral_partner", "customer"];

/** Roles that execute work on site (mobile-first workspace). */
export const FIELD_ROLES: Role[] = ["field_manager", "field_staff"];

/** Roles the dispatcher may put on a job crew. */
export const ASSIGNABLE_ROLES: Role[] = ["field_manager", "field_staff"];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  ops_manager: "Operations Manager",
  scheduler: "Scheduler / Coordinator",
  field_manager: "Field Manager / Team Leader",
  field_staff: "Field Staff / Cleaner",
  qc_inspector: "Quality Inspector",
  accounts: "Accounts / Finance",
  referral_partner: "Referral Partner",
  customer: "Customer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: "Complete control of the business: users, roles, configuration, finance and every module.",
  ops_manager: "Runs daily operations: bookings, scheduling, crews, QC monitoring, rework and customer issues.",
  scheduler: "Manages appointments, calendars and crew assignments. Never performs QC or touches payments.",
  field_manager: "Leads the on-site team: navigate, arrive, GPS verification, start, checklist, photos, complete.",
  field_staff: "Executes assigned tasks: checklist, photos, notes, task and rework completion.",
  qc_inspector: "Independently verifies service quality: inspect evidence, pass, or raise rework.",
  accounts: "Billing and payments: invoices, payments, refunds within limit, financial reports.",
  referral_partner: "Generates and tracks referrals: own leads, conversions, commission and payouts.",
  customer: "Views and approves their own services; AMC / NRI features are attached to this role.",
};

/**
 * Maps a stored role string to a canonical Role. Legacy accounts (`staff`)
 * ran the whole on-site flow as lead workers, so they become field managers.
 * Unknown values resolve to the least-privileged external role so a corrupt
 * row can never widen access.
 */
export function normalizeRole(raw: string | null | undefined): Role {
  if (!raw) return "customer";
  if ((ROLES as readonly string[]).includes(raw)) return raw as Role;
  if (raw === "staff") return "field_manager";
  if (raw === "admin") return "super_admin";
  return "customer";
}

export function isInternalRole(role: Role): boolean {
  return INTERNAL_ROLES.includes(role);
}

export function isFieldRole(role: Role): boolean {
  return FIELD_ROLES.includes(role);
}
