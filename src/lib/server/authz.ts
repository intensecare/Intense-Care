/**
 * Server-side authorization helpers for API routes.
 *
 * Roles follow the ERP model: "super_admin", "ops_manager", "staff".
 * - super_admin: unrestricted.
 * - ops_manager: must be explicitly allowed.
 * - staff: may only act on jobs they are DIRECTLY assigned to — either as an
 *   entry in the job's `assignedStaffIds` array or as the job's manager
 *   (`assignedManagerId`). There is no team/squad concept: assignments are
 *   always per-worker, and the first entry of `assignedStaffIds` is the lead
 *   worker.
 */

import { getSessionUser, SessionUser } from "./session";
import { prisma } from "./prisma";
import { logger } from "./logger";
import type { UserRole } from "../types";

export interface AuthContext {
  user: SessionUser;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves the signed-in user or throws 401. The ERP client identifies users
 * from its localStorage directory; the server session must already exist
 * (established by POST /api/auth/session) or the call is rejected.
 */
export async function requireUser(): Promise<AuthContext> {
  const user = await getSessionUser();
  if (!user) {
    throw new HttpError(401, "Authentication required. Please sign in again.");
  }
  return { user };
}

export async function requireRole(allowed: UserRole[]): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.user.role !== "super_admin" && !allowed.includes(ctx.user.role as UserRole)) {
    logger.warn("authz.role_denied", { userId: ctx.user.id, role: ctx.user.role });
    throw new HttpError(403, "Your role is not authorized for this action.");
  }
  return ctx;
}

export function isManagerRole(role: string): boolean {
  return role === "super_admin" || role === "ops_manager";
}

/** True when the staff user is a directly-assigned worker on the job. */
export function isAssignedWorker(
  job: { assignedManagerId: string | null; assignedStaffIds: string[] },
  userId: string
): boolean {
  return (
    job.assignedManagerId === userId ||
    (Array.isArray(job.assignedStaffIds) && job.assignedStaffIds.includes(userId))
  );
}

/** True when the staff user is the lead (first-assigned) worker on the job. */
export function isLeadWorker(
  job: { assignedStaffIds: string[] },
  userId: string
): boolean {
  return Array.isArray(job.assignedStaffIds) && job.assignedStaffIds[0] === userId;
}

/**
 * Ensures the acting user may operate on this job. Staff may only act on jobs
 * they are directly assigned to (as worker or manager); managers/admins on all.
 * Throws 401/403 otherwise.
 */
export async function authorizeJobAccess(jobId: string): Promise<AuthContext> {
  const ctx = await requireUser();
  if (isManagerRole(ctx.user.role)) {
    return ctx;
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (job && isAssignedWorker(job, ctx.user.id)) {
    return ctx;
  }

  logger.warn("authz.job_access_denied", {
    userId: ctx.user.id,
    role: ctx.user.role,
    jobId,
  });
  throw new HttpError(403, "You are not assigned to this job.");
}

/**
 * Ensures the acting staff user is allowed to transition this job to the
 * target status. Directly-assigned workers may execute their work (arrive,
 * start, complete, rework); managers/admins may do all.
 */
export async function authorizeJobTransition(
  jobId: string,
  nextStatus: string
): Promise<AuthContext> {
  const ctx = await requireUser();
  if (isManagerRole(ctx.user.role)) {
    return ctx;
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new HttpError(404, "Job not found.");
  }
  if (!isAssignedWorker(job, ctx.user.id)) {
    logger.warn("authz.transition_not_assigned", {
      userId: ctx.user.id,
      jobId,
      nextStatus,
    });
    throw new HttpError(403, "You are not assigned to this job.");
  }
  return ctx;
}
