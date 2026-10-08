import { prisma } from "./prisma";
import { logger } from "./logger";
import { recordActivity } from "./activity";
import { ensureCustomerLink } from "./qr-service";
import { notifyQcReady, notifyReworkAssigned, notifyCustomerCompleted } from "./notify";

/**
 * Workflow side-effects driven purely by the role-based ERP:
 *   - field staff drive arrival/checklist/photos/completion (field app),
 *   - the QC desk drives pass/rework/reinspection (quality API),
 *   - the customer acts only through the ONE secure link (qr-service).
 *
 * These helpers notify people and keep the customer link's handover moments
 * (arrival → share, QC pass → approval opens) — no per-role token minting.
 */

/**
 * Called when work is completed: notify the QC desk (fire-and-forget).
 */
export async function onWorkCompleted(jobId: string, _actor: { id?: string; name?: string }) {
  try {
    await notifyQcReady(jobId);
  } catch (e) {
    logger.warn("workflow.on_work_completed_notify_failed", {
      jobId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * QC flagged rework: issues + tasks already exist (created by the quality
 * route); this advances REWORK_REQUIRED → REWORK_ASSIGNED and notifies the
 * assigned staff (they act in the field app, not on a token link).
 */
export async function dispatchRework(
  jobId: string,
  actor: { id: string; name: string; role: string }
): Promise<{ ok: boolean; message: string }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, message: "Job not found." };
  if (!["REWORK_REQUIRED"].includes(job.status)) {
    return { ok: false, message: `Rework can only be dispatched from REWORK_REQUIRED (current: ${job.status}).` };
  }

  const lead = job.assignedStaffIds[0];
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "REWORK_ASSIGNED", updatedAt: new Date() },
  });
  await recordActivity({
    jobId,
    type: "REWORK_ASSIGNED",
    message: `Rework dispatched to field staff${lead ? "" : " (no lead worker — assign staff first)"}`,
    actor,
  });
  void notifyReworkAssigned(jobId).catch(() => {});
  return { ok: true, message: "Rework dispatched to field staff." };
}

/**
 * QC passed (first pass or reinspection): open the handover — the customer's
 * ONE link becomes the approval page, and the customer is notified.
 */
export async function onQcPassed(jobId: string, actor: { id?: string; name?: string }) {
  try {
    const link = await ensureCustomerLink(jobId, actor);
    if (link.success) await notifyCustomerCompleted(jobId, link.data.linkUrl);
    return link.success ? link.data.linkUrl : null;
  } catch (e) {
    logger.warn("workflow.on_qc_passed_failed", {
      jobId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Manager share helper: the job's single customer link (idempotent). */
export async function getCustomerVerifyLink(jobId: string, actor: { id?: string; name?: string }) {
  const res = await ensureCustomerLink(jobId, actor);
  return res.success ? res.data : null;
}
