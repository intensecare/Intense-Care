/**
 * RBAC — the authorization engine.
 *
 *   can(principal, permission)                  → may this user use the module action at all?
 *   scopeOf(role, permission)                   → which records (ALL/BRANCH/TEAM/ASSIGNED/OWN/NONE)
 *   authorize(principal, permission, resource)  → is THIS record inside the user's scope?
 *
 * Pure and side-effect free, so the exact same decisions run in the browser
 * (to decide what to show) and on the server (to decide what to allow).
 * The browser result is a convenience; the server result is the law.
 */

import type { Role } from "./roles";
import { normalizeRole } from "./roles";
import { ROLE_PERMISSIONS, SCOPE_RANK, type Permission, type Scope } from "./permissions";

/** The authenticated identity, as the session resolves it. */
export interface Principal {
  id: string;
  role: Role;
  /** Field team the user belongs to (TEAM scope). */
  teamId?: string | null;
  /** Branch / city the user operates in (BRANCH scope). */
  branchId?: string | null;
  /** Customer record this login belongs to (OWN scope for the customer role). */
  customerId?: string | null;
  /** Referral partner this login belongs to (OWN scope for the partner role). */
  referralPartnerId?: string | null;
}

/**
 * The parts of a record that scope resolution looks at. Every field is
 * optional: a resource only carries the relationships it actually has.
 */
export interface ResourceRef {
  /** Customer who owns the record (job.customerId, invoice.customerId …). */
  customerId?: string | null;
  /** Referral partner attributed to the record (job.referralPartnerId …). */
  referralPartnerId?: string | null;
  /** Field manager assigned to the job. */
  assignedManagerId?: string | null;
  /** Crew assigned to the job. */
  assignedStaffIds?: string[] | null;
  /** User who created/uploaded the record (photos, notes). */
  createdByUserId?: string | null;
  /** Team ids of everyone assigned to the record (TEAM scope). */
  teamIds?: string[] | null;
  /** Branch the record belongs to (BRANCH scope). */
  branchId?: string | null;
  /** The user id when the record IS a user (users.view OWN = own profile). */
  userId?: string | null;
}

export interface AuthzDecision {
  allowed: boolean;
  scope: Scope;
  reason?: string;
}

export function scopeOf(role: Role | string, permission: Permission): Scope {
  const r = normalizeRole(role);
  return ROLE_PERMISSIONS[r]?.[permission] ?? "NONE";
}

/** Module-level check: the user has the permission with any non-empty scope. */
export function can(principal: Pick<Principal, "role">, permission: Permission): boolean {
  return scopeOf(principal.role, permission) !== "NONE";
}

export function canAny(principal: Pick<Principal, "role">, permissions: Permission[]): boolean {
  return permissions.some((p) => can(principal, p));
}

export function canAll(principal: Pick<Principal, "role">, permissions: Permission[]): boolean {
  return permissions.every((p) => can(principal, p));
}

/** True when `scope` is at least as broad as `atLeast`. */
export function scopeAtLeast(scope: Scope, atLeast: Scope): boolean {
  return SCOPE_RANK[scope] >= SCOPE_RANK[atLeast];
}

/** Does the principal relate to the resource as an ASSIGNED worker/manager? */
export function isAssignedTo(principal: Pick<Principal, "id">, resource: ResourceRef): boolean {
  if (resource.assignedManagerId && resource.assignedManagerId === principal.id) return true;
  if (Array.isArray(resource.assignedStaffIds) && resource.assignedStaffIds.includes(principal.id)) return true;
  return false;
}

/** Does the principal OWN the resource (customer / partner / creator / self)? */
export function ownsResource(principal: Principal, resource: ResourceRef): boolean {
  if (principal.customerId && resource.customerId && resource.customerId === principal.customerId) return true;
  if (
    principal.referralPartnerId &&
    resource.referralPartnerId &&
    resource.referralPartnerId === principal.referralPartnerId
  )
    return true;
  if (resource.createdByUserId && resource.createdByUserId === principal.id) return true;
  if (resource.userId && resource.userId === principal.id) return true;
  return false;
}

/** Pure scope test — no permission lookup; used by `authorize` and by query builders. */
export function matchesScope(scope: Scope, principal: Principal, resource: ResourceRef): boolean {
  switch (scope) {
    case "ALL":
      return true;
    case "BRANCH":
      return Boolean(principal.branchId && resource.branchId && principal.branchId === resource.branchId) ||
        isAssignedTo(principal, resource);
    case "TEAM":
      return (
        Boolean(principal.teamId && Array.isArray(resource.teamIds) && resource.teamIds.includes(principal.teamId)) ||
        isAssignedTo(principal, resource)
      );
    case "ASSIGNED":
      return isAssignedTo(principal, resource);
    case "OWN":
      return ownsResource(principal, resource);
    case "NONE":
    default:
      return false;
  }
}

/**
 * Record-level authorization: permission AND scope must both hold.
 * Returns the effective scope so callers can further redact (e.g. an
 * ASSIGNED viewer never receives financial fields).
 */
export function authorize(principal: Principal, permission: Permission, resource: ResourceRef): AuthzDecision {
  const scope = scopeOf(principal.role, permission);
  if (scope === "NONE") {
    return { allowed: false, scope, reason: `Your role is not authorized for ${permission}.` };
  }
  if (matchesScope(scope, principal, resource)) return { allowed: true, scope };
  return {
    allowed: false,
    scope,
    reason:
      scope === "OWN"
        ? "This record does not belong to you."
        : scope === "ASSIGNED"
        ? "You are not assigned to this job."
        : "This record is outside your team or branch.",
  };
}

/** Every permission a role holds, with its scope — handed to the client on sign-in. */
export function grantsFor(role: Role | string): { permission: Permission; scope: Scope }[] {
  const r = normalizeRole(role);
  return (Object.entries(ROLE_PERMISSIONS[r]) as [Permission, Scope][])
    .filter(([, scope]) => scope !== "NONE")
    .map(([permission, scope]) => ({ permission, scope }));
}

/**
 * Customer-profile capabilities (NOT roles). AMC / NRI are features the
 * customer role gains from their contracts, so the portal can add the AMC
 * section and the remote-confirmation flow without a separate login type.
 */
export interface CustomerFeatures {
  amc: boolean;
  nri: boolean;
}

export function customerFeatures(contracts: { status: string; nriContactPhone?: string | null; nriContactEmail?: string | null }[]): CustomerFeatures {
  const live = contracts.filter((c) => c.status === "ACTIVE" || c.status === "EXPIRING_SOON");
  return {
    amc: live.length > 0,
    nri: live.some((c) => Boolean(c.nriContactPhone || c.nriContactEmail)),
  };
}
