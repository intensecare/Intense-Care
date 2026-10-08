/**
 * Server-side authorization — permission + scope + resource + action.
 *
 *   requireUser()                       → signed-in identity or 401
 *   requirePermission("jobs.assign")    → identity + effective scope, or 403
 *   authorizeJob(jobId, "jobs.start")   → the job, if it is inside the scope
 *   jobWhereFor(user, "jobs.view")      → Prisma filter that returns ONLY the
 *                                         records the scope allows
 *   requireApproval(user, kind)         → approval authority (§17)
 *
 * No route checks role names. Every decision goes through the central
 * matrix in src/lib/rbac so the UI and the API can never disagree.
 */

import type { Prisma } from "@prisma/client";
import { getSessionUser, type SessionUser } from "./session";
import { prisma } from "./prisma";
import { logger } from "./logger";
import {
  authorize,
  can,
  scopeOf,
  matchesScope,
  canApprove,
  type Permission,
  type Scope,
  type ResourceRef,
  type ApprovalKind,
} from "@/lib/rbac";

export interface AuthContext {
  user: SessionUser;
}

export interface PermissionContext extends AuthContext {
  permission: Permission;
  scope: Scope;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Resolves the signed-in user or throws 401. */
export async function requireUser(): Promise<AuthContext> {
  const user = await getSessionUser();
  if (!user) {
    throw new HttpError(401, "Authentication required. Please sign in again.");
  }
  return { user };
}

/** Module-level gate: the user must hold the permission with a non-empty scope. */
export async function requirePermission(permission: Permission): Promise<PermissionContext> {
  const { user } = await requireUser();
  const scope = scopeOf(user.role, permission);
  if (scope === "NONE") {
    logger.warn("authz.permission_denied", { userId: user.id, role: user.role, permission });
    throw new HttpError(403, "Your role is not authorized for this action.");
  }
  return { user, permission, scope };
}

/** Any one of the permissions suffices (returns the first that matches). */
export async function requireAnyPermission(permissions: Permission[]): Promise<PermissionContext> {
  const { user } = await requireUser();
  for (const permission of permissions) {
    const scope = scopeOf(user.role, permission);
    if (scope !== "NONE") return { user, permission, scope };
  }
  logger.warn("authz.permission_denied", { userId: user.id, role: user.role, permissions });
  throw new HttpError(403, "Your role is not authorized for this action.");
}

/** Approval authority (§17): the user's role must be an approver for the kind. */
export function requireApproval(user: SessionUser, kind: ApprovalKind): void {
  if (!canApprove(user.role, kind)) {
    logger.warn("authz.approval_denied", { userId: user.id, role: user.role, kind });
    throw new HttpError(403, "This action requires approval from an authorized role.");
  }
}

/** Convenience: does the session user hold the permission at all? */
export function userCan(user: SessionUser, permission: Permission): boolean {
  return can(user, permission);
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

const JOB_SCOPE_SELECT = {
  id: true,
  customerId: true,
  referralPartnerId: true,
  assignedManagerId: true,
  assignedStaffIds: true,
  scheduledDate: true,
  status: true,
} as const;

export type JobScopeRow = Prisma.JobGetPayload<{ select: typeof JOB_SCOPE_SELECT }>;

/**
 * The next-day dispatch window applied only to the retired Operations
 * Manager role. Admin sees every date, so it never applies now; kept as a
 * function so callers stay unchanged.
 */
export function dispatchWindowApplies(_user: SessionUser): boolean {
  return false;
}

function opsWindowBlocks(_user: SessionUser, _scheduledDate: string): boolean {
  return false;
}

/** Team member ids for TEAM-scoped queries. */
async function teamMemberIds(teamId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { teamId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Prisma `where` that limits jobs to the user's scope for the permission.
 * Returns `null` when the user has no access at all.
 */
export async function jobWhereFor(user: SessionUser, permission: Permission): Promise<Prisma.JobWhereInput | null> {
  const scope = scopeOf(user.role, permission);
  switch (scope) {
    case "ALL":
      return {};
    case "BRANCH":
    case "TEAM": {
      const ids = user.teamId ? await teamMemberIds(user.teamId) : [];
      const members = Array.from(new Set([...ids, user.id]));
      return {
        OR: [{ assignedManagerId: { in: members } }, { assignedStaffIds: { hasSome: members } }],
      };
    }
    case "ASSIGNED":
      return { OR: [{ assignedManagerId: user.id }, { assignedStaffIds: { has: user.id } }] };
    case "OWN":
      if (user.customerId) return { customerId: user.customerId };
      if (user.referralPartnerId) return { referralPartnerId: user.referralPartnerId };
      return { id: "__none__" };
    case "NONE":
    default:
      return null;
  }
}

/** Ids of every job the user may see — for scoping dependent collections. */
export async function visibleJobIds(user: SessionUser, permission: Permission = "jobs.view"): Promise<string[] | "ALL"> {
  const where = await jobWhereFor(user, permission);
  if (where === null) return [];
  if (Object.keys(where).length === 0 && !dispatchWindowApplies(user)) return "ALL";
  const rows = await prisma.job.findMany({ where, select: { id: true, scheduledDate: true } });
  return rows.filter((r) => !opsWindowBlocks(user, r.scheduledDate)).map((r) => r.id);
}

/** Resource reference for scope checks, including crew team ids. */
export async function jobResourceRef(job: JobScopeRow): Promise<ResourceRef> {
  const crew = [...(job.assignedStaffIds ?? []), ...(job.assignedManagerId ? [job.assignedManagerId] : [])];
  const teamIds =
    crew.length > 0
      ? (await prisma.user.findMany({ where: { id: { in: crew }, teamId: { not: null } }, select: { teamId: true } }))
          .map((u) => u.teamId)
          .filter((t): t is string => Boolean(t))
      : [];
  return {
    customerId: job.customerId,
    referralPartnerId: job.referralPartnerId,
    assignedManagerId: job.assignedManagerId,
    assignedStaffIds: job.assignedStaffIds,
    teamIds,
  };
}

/**
 * Record-level job authorization. Loads the job and checks that it lies
 * inside the user's scope for `permission`. 401 / 403 / 404 otherwise.
 */
export async function authorizeJob(
  jobId: string,
  permission: Permission
): Promise<PermissionContext & { job: JobScopeRow }> {
  const { user } = await requireUser();
  const scope = scopeOf(user.role, permission);
  if (scope === "NONE") {
    logger.warn("authz.permission_denied", { userId: user.id, role: user.role, permission, jobId });
    throw new HttpError(403, "Your role is not authorized for this action.");
  }
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: JOB_SCOPE_SELECT });
  if (!job) throw new HttpError(404, "Job not found.");

  const ref = scope === "TEAM" || scope === "BRANCH" ? await jobResourceRef(job) : (job as ResourceRef);
  const decision = authorize(user, permission, ref);
  if (!decision.allowed) {
    logger.warn("authz.job_access_denied", { userId: user.id, role: user.role, permission, jobId, scope });
    throw new HttpError(403, decision.reason ?? "You cannot access this job.");
  }
  if (opsWindowBlocks(user, job.scheduledDate)) {
    logger.warn("authz.ops_window_denied", { userId: user.id, jobId });
    throw new HttpError(403, "This job is not yet open for dispatch.");
  }
  return { user, permission, scope, job };
}

/** Backwards-compatible alias used by routes that only need "may see this job". */
export async function authorizeJobAccess(jobId: string, permission: Permission = "jobs.view") {
  return authorizeJob(jobId, permission);
}

/** True when the user is a directly-assigned worker or the manager on the job. */
export function isAssignedWorker(
  job: { assignedManagerId: string | null; assignedStaffIds: string[] },
  userId: string
): boolean {
  return matchesScope("ASSIGNED", { id: userId, role: "field_manager" }, job);
}

/** The lead on site: the assigned field manager, else the first crew member. */
export function isLeadWorker(
  job: { assignedManagerId?: string | null; assignedStaffIds: string[] },
  userId: string
): boolean {
  if (job.assignedManagerId) return job.assignedManagerId === userId;
  return Array.isArray(job.assignedStaffIds) && job.assignedStaffIds[0] === userId;
}

/* -------------------------------------------------------------------------- */
/* Generic resources                                                          */
/* -------------------------------------------------------------------------- */

/** Record-level check on any resource that carries scope fields. */
export function assertScope(user: SessionUser, permission: Permission, resource: ResourceRef): void {
  const decision = authorize(user, permission, resource);
  if (!decision.allowed) {
    logger.warn("authz.resource_denied", { userId: user.id, role: user.role, permission });
    throw new HttpError(403, decision.reason ?? "You cannot access this record.");
  }
}
