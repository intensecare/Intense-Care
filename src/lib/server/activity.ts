import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";

/** Discriminated activity event types shown in the live pipeline feed. */
export type ActivityType =
  | "STATUS_CHANGED"
  | "STAFF_ASSIGNED"
  | "OTP_SENT"
  | "OTP_VERIFIED"
  | "CHECKLIST_UPDATED"
  | "PHOTO_UPLOADED"
  | "QC_SUBMITTED"
  | "REWORK_ASSIGNED"
  | "REWORK_COMPLETED"
  | "CUSTOMER_SIGNED"
  | "ATTENTION_REQUESTED"
  | "FEEDBACK_RECORDED"
  | "GOOGLE_REVIEW_CLICKED";

export interface ActivityActor {
  id?: string | null;
  name: string;
  role: string;
}

/**
 * Records a pipeline activity event (best-effort: never throws into the
 * calling route — a failed feed write must not fail the user's action).
 * Written server-side ONLY so every viewer of the job sees the same
 * authoritative feed, and so the audit tab reflects real database history.
 */
export async function recordActivity(params: {
  jobId: string;
  type: ActivityType;
  message: string;
  actor: ActivityActor;
}): Promise<void> {
  try {
    await prisma.jobActivityEvent.create({
      data: {
        jobId: params.jobId,
        type: params.type,
        message: params.message,
        actorId: params.actor.id ?? null,
        actorName: params.actor.name,
        actorRole: params.actor.role,
      },
    });
  } catch (e) {
    logger.error("activity.record_failed", {
      jobId: params.jobId,
      type: params.type,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Serialized shape consumed by /api/activity and the job audit tab. */
export function serializeActivityEvent(row: {
  id: string;
  jobId: string;
  type: string;
  message: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    jobId: row.jobId,
    type: row.type,
    message: row.message,
    actorId: row.actorId,
    actorName: row.actorName,
    actorRole: row.actorRole,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SerializedActivityEvent = ReturnType<typeof serializeActivityEvent>;
