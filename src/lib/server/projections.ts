/**
 * Response projections by scope — "what the user can see" (RBAC rule 1).
 *
 * The same job row is served in four shapes:
 *   finance.view holders     → full row (amounts, payment status)
 *   internal roles without   → operational row (money redacted)
 *   customer login (OWN)     → customer-safe row (no notes/crew/phone)
 *   partner login (OWN)      → summary only (status, date, service)
 */
import type { SessionUser } from "./session";
import { scopeOf, can, partnerStageLabel, customerStageLabel } from "@/lib/rbac";
import { redactJobForOps, redactJobForCustomer, type SerializedJob } from "./serialize";

export type JobProjection =
  | (SerializedJob & { assignedStaffNames?: string[] })
  | ReturnType<typeof redactJobForOps>
  | ReturnType<typeof redactJobForCustomer>
  | PartnerJobSummary;

export interface PartnerJobSummary {
  id: string;
  status: string;
  stage: string;
  scheduledDate: string;
  serviceName: string | null;
  referralPartnerId?: string;
  createdAt: string;
  updatedAt: string;
}

export function projectJob<T extends SerializedJob>(user: SessionUser, job: T): JobProjection {
  const viewScope = scopeOf(user.role, "jobs.view");
  if (viewScope === "OWN" && user.referralPartnerId) {
    return {
      id: job.id,
      status: job.status,
      stage: partnerStageLabel(job.status),
      scheduledDate: job.scheduledDate,
      serviceName: job.service?.name ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
  if (viewScope === "OWN" && user.customerId) {
    return { ...redactJobForCustomer(job), stage: customerStageLabel(job.status) };
  }
  if (can(user, "finance.view")) return job;
  return redactJobForOps(job);
}
