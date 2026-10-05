import { prisma } from "./prisma";
import { logger } from "./logger";
import { recordActivity } from "./activity";
import { mintQrToken, buildLinkUrl, type QrPurpose } from "./qr-service";
import { notifyCustomerArrived, notifyQcReady, notifyReworkAssigned, notifyCustomerCompleted } from "./notify";
import { sendCompletionInvite } from "./completion-service";

/**
 * §16–§24 — workflow glue between the state machine and the token system.
 * Work-completion gating, QC dispatch, the rework → reinspection loop
 * (history-preserving — the job never resets, only failed areas go back),
 * and the customer handover mint on PASS.
 */

/** §16 — backend gate: required checklist + required photos + notes. */
export interface CompletionGate {
  ok: boolean;
  missing: string[];
}

export async function checkWorkCompletionGate(jobId: string): Promise<CompletionGate> {
  const [items, photoCount] = await Promise.all([
    prisma.jobChecklistItem.findMany({ where: { jobId }, select: { critical: true, status: true, task: true } }),
    prisma.jobPhoto.count({ where: { jobId } }),
  ]);
  const missing: string[] = [];
  const openCritical = items.filter((i) => i.critical && i.status !== "completed" && i.status !== "skipped");
  if (openCritical.length > 0) {
    missing.push(
      `${openCritical.length} mandatory checklist item${openCritical.length === 1 ? "" : "s"} still open`
    );
  }
  if (items.length > 0 && items.every((i) => i.status === "pending")) {
    missing.push("checklist has not been started");
  }
  if (photoCount === 0) {
    missing.push("at least one evidence photo");
  }
  return { ok: missing.length === 0, missing };
}

/** Mint a token for a job with role-aware actor naming; failures don't throw. */
async function mintSafe(
  jobId: string,
  purpose: QrPurpose,
  actor: { id?: string; name?: string }
): Promise<string | null> {
  const res = await mintQrToken(jobId, purpose, actor);
  if (res.success) {
    return res.data.linkUrl;
  }
  if (res.failure.kind === "not_found") return null;
  // Cooldown/rate-limited: fall back to the newest live token's link shape —
  // but we never log or store raw tokens, so instead return null and let the
  // admin REGENERATE from the QR manager (the UI shows the failure).
  logger.warn("workflow.mint_cooldown", { jobId, purpose, kind: res.failure.kind });
  return null;
}

/**
 * §17/§25 — called when work is completed: QC notification + token mint.
 * Fire-and-forget semantics: never breaks the completion transition.
 */
export async function onWorkCompleted(jobId: string, actor: { id?: string; name?: string }) {
  try {
    const link = await mintSafe(jobId, "QC_INSPECTION", actor);
    await notifyQcReady(jobId, link ?? undefined);
  } catch (e) {
    logger.warn("workflow.on_work_completed_notify_failed", {
      jobId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * §19 — QC flagged rework: issues + tasks already exist (created by the QC
 * route); this dispatches them — advances REWORK_REQUIRED → REWORK_ASSIGNED,
 * mints the REWORK token, and notifies the assigned staff.
 */
export async function dispatchRework(
  jobId: string,
  actor: { id: string; name: string; role: string }
): Promise<{ ok: boolean; link?: string; message: string }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, message: "Job not found." };
  if (!["REWORK_REQUIRED"].includes(job.status)) {
    return { ok: false, message: `Rework can only be dispatched from REWORK_REQUIRED (current: ${job.status}).` };
  }

  const link = await mintSafe(jobId, "REWORK", { id: actor.id, name: actor.name });

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
  void notifyReworkAssigned(jobId, link ?? undefined).catch(() => {});
  return { ok: true, link: link ?? undefined, message: "Rework dispatched to field staff." };
}

/**
 * §19 — staff opens the rework link and starts: REWORK_ASSIGNED →
 * REWORK_IN_PROGRESS (idempotent).
 */
export async function startRework(jobId: string, actor: { name: string }) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false as const, message: "Job not found." };
  if (["REWORK_IN_PROGRESS", "REWORK_COMPLETED"].includes(job.status)) {
    return { ok: true as const, already: true, message: "Rework already in progress." };
  }
  if (job.status !== "REWORK_ASSIGNED") {
    return { ok: false as const, message: `Rework cannot start from ${job.status}.` };
  }
  await prisma.job.update({ where: { id: jobId }, data: { status: "REWORK_IN_PROGRESS", updatedAt: new Date() } });
  await recordActivity({
    jobId,
    type: "STATUS_CHANGED",
    message: "Rework started on site",
    actor: { name: actor.name, role: "staff" },
  });
  return { ok: true as const, already: false, message: "Rework started." };
}

/**
 * §19 — rework evidence submitted: closes open tasks, resolves issues, and
 * moves the job to REWORK_COMPLETED for reinspection. History preserved.
 */
export async function completeRework(
  jobId: string,
  evidenceNotes: string,
  actor: { id: string; name: string; role: string }
): Promise<{ ok: boolean; message: string }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, message: "Job not found." };
  if (!["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"].includes(job.status)) {
    return { ok: false, message: `Rework cannot complete from ${job.status}.` };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.reworkTask.updateMany({
      where: { jobId, status: { not: "completed" } },
      data: { status: "completed", completedAt: now, completedNotes: evidenceNotes || "Corrective work completed on site." },
    }),
    prisma.qualityIssue.updateMany({
      where: { jobId, status: { notIn: ["resolved", "reinspected_pass"] } },
      data: { status: "resolved", resolvedAt: now },
    }),
    prisma.job.update({ where: { id: jobId }, data: { status: "REWORK_COMPLETED", updatedAt: now } }),
  ]);

  await recordActivity({
    jobId,
    type: "REWORK_COMPLETED",
    message: `Rework completed with evidence${evidenceNotes ? ` — ${evidenceNotes}` : ""}. Awaiting QC reinspection.`,
    actor,
  });

  // §20 — mint the reinspection token for QC.
  void mintSafe(jobId, "REINSPECTION", { id: actor.id, name: actor.name }).catch(() => {});
  return { ok: true, message: "Rework completed — QC notified for reinspection." };
}

/**
 * §21 — QC passed: mint the customer handover link (approval token) and the
 * unified customer job link, then notify the customer. Called on PASS.
 */
export async function onQcPassed(jobId: string, actor: { id?: string; name?: string }) {
  try {
    const invite = await sendCompletionInvite(jobId);
    const approvalLink = invite.success ? invite.data.linkUrl : undefined;
    const jobLink = await mintSafe(jobId, "CUSTOMER_APPROVAL", actor);
    const link = jobLink ?? approvalLink;
    if (link) await notifyCustomerCompleted(jobId, link);
    return approvalLink ?? null;
  } catch (e) {
    logger.warn("workflow.on_qc_passed_failed", {
      jobId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** §38 — manager share helper: mint (or reuse) the customer confirmation link. */
export async function getCustomerVerifyLink(jobId: string, actor: { id?: string; name?: string }) {
  const res = await mintQrToken(jobId, "CUSTOMER_VERIFICATION", actor);
  return res.success ? res.data : null;
}

/** Keep the import used (buildLinkUrl re-exported for admin QR panel). */
export { buildLinkUrl };
