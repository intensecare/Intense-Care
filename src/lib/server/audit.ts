import { prisma } from "./prisma";
import { logger } from "./logger";
import type { SessionUser } from "./session";

/**
 * Audit log (§27) — every important action is recorded with:
 * user, role, action, resource, job id, timestamp, previous/new state,
 * reason (when required) and IP / device metadata.
 *
 * Writes are append-only and best-effort: a failed audit write is logged
 * but never fails the business action it describes. There is deliberately
 * NO delete helper — audit history cannot be removed through the app.
 */

export interface AuditInput {
  actor: Pick<SessionUser, "id" | "name" | "role"> | { id?: string | null; name: string; role: string };
  action: string;
  entityType: string;
  entityId: string;
  jobId?: string | null;
  previousState?: string | null;
  newState?: string | null;
  reason?: string | null;
  details?: string | null;
  request?: Request | null;
}

export function requestMeta(request?: Request | null): { ipAddress?: string; userAgent?: string } {
  if (!request) return {};
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    undefined;
  const ua = request.headers.get("user-agent")?.slice(0, 300) || undefined;
  return { ipAddress: ip, userAgent: ua };
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const meta = requestMeta(input.request);
    await prisma.auditLog.create({
      data: {
        entityType: input.entityType.slice(0, 40),
        entityId: input.entityId.slice(0, 64),
        action: input.action.slice(0, 80),
        performedBy: `${input.actor.id ?? "system"}:${input.actor.name}`,
        performedByRole: input.actor.role,
        jobId: input.jobId ?? null,
        oldState: input.previousState ?? null,
        newState: input.newState ?? null,
        reason: input.reason?.slice(0, 500) ?? null,
        details: input.details?.slice(0, 1000) ?? null,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
  } catch (e) {
    logger.error("audit.record_failed", {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
