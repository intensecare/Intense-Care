import crypto from "crypto";
import { prisma } from "./prisma";
import { logger, maskToken } from "./logger";
import { invitePolicy, resolveBaseUrl } from "./policy";

/**
 * Completion handover service.
 *
 * When a job passes QC, a tokenized portal invite is minted (256-bit random
 * URL-safe token stored only as a SHA-256 hash). The operations desk shares
 * the /portal/[token] link with the customer (WhatsApp/SMS/any channel) —
 * there is no server-side messaging dependency by design. The link resolves
 * the customer handover page from any device; the page carries the sign-off
 * and the Google Business Review CTA.
 */

export interface InviteFailure {
  kind: "not_found" | "wrong_status" | "cooldown" | "rate_limited";
  message: string;
}

export interface InviteSuccess {
  inviteId: string;
  linkPath: string;
  /** Fully-qualified shareable URL (server-resolved base + linkPath). */
  linkUrl: string;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url"); // 256-bit, URL-safe
}

async function loadJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  return job;
}

const RATE_WINDOW_MS = 10 * 60 * 1000; // max invites per job per 10 minutes
const MAX_INVITES_PER_WINDOW = 3;

/**
 * Mints a fresh invite for a job that has passed QC. Each call creates a NEW
 * token (invalidating reliance on older links) and returns the link once —
 * the raw token is never stored server-side.
 */
export async function sendCompletionInvite(
  jobId: string,
  options: { baseUrl?: string } = {}
): Promise<{ success: true; data: InviteSuccess } | { success: false; failure: InviteFailure }> {
  const job = await loadJob(jobId);
  if (!job) {
    return { success: false, failure: { kind: "not_found", message: "Job not found." } };
  }
  // Link minting stays available through the customer-approval window —
  // including FEEDBACK_REQUESTED (the handover card is still shown and desks
  // often need to re-share the link at that stage). CLOSED/CANCELLED are too
  // late and stay rejected.
  const linkableStatuses = ["PASS", "CUSTOMER_APPROVAL", "COMPLETED", "FEEDBACK_REQUESTED"];
  if (!linkableStatuses.includes(job.status)) {
    return {
      success: false,
      failure: {
        kind: "wrong_status",
        message: `Completion link can only be created after QC passes (current: ${job.status}).`,
      },
    };
  }

  // Cooldown + rolling cap to prevent link-spamming abuse of the endpoint.
  const last = await prisma.completionInvite.findFirst({
    where: { jobId },
    orderBy: { createdAt: "desc" },
  });
  if (last && Date.now() - last.createdAt.getTime() < 60 * 1000) {
    const secondsLeft = Math.ceil(60 - (Date.now() - last.createdAt.getTime()) / 1000);
    return {
      success: false,
      failure: {
        kind: "cooldown",
        message: `Please wait ${secondsLeft}s before generating a new link.`,
      },
    };
  }

  const windowStart = new Date(Date.now() - RATE_WINDOW_MS);
  const recentCount = await prisma.completionInvite.count({
    where: { jobId, createdAt: { gt: windowStart } },
  });
  if (recentCount >= MAX_INVITES_PER_WINDOW) {
    return {
      success: false,
      failure: {
        kind: "rate_limited",
        message: "Too many links generated for this job recently. Try again later.",
      },
    };
  }

  const token = generateToken();
  const baseUrl = resolveBaseUrl(options.baseUrl ?? null);
  const linkPath = `/portal/${token}`;
  const linkUrl = `${baseUrl}${linkPath}`;

  const invite = await prisma.completionInvite.create({
    data: {
      tokenHash: hashToken(token),
      tokenLast4: token.slice(-4),
      jobId,
      customerId: job.customerId,
    },
  });

  logger.info("invite.minted", {
    jobId,
    inviteId: invite.id,
    token: maskToken(token),
  });

  return {
    success: true,
    data: {
      inviteId: invite.id,
      linkPath,
      linkUrl,
    },
  };
}

/**
 * Resolves a portal token to its invite + job. Tokens are looked up by hash;
 * raw tokens never appear in logs or responses beyond the masked tail.
 * Enforces the configured link expiry window.
 */
export async function resolveInviteByToken(token: string) {
  if (!token || token.length < 16) return null;
  const invite = await prisma.completionInvite.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invite) return null;

  // Link expiry: PORTAL_LINK_EXPIRY_DAYS from issuance.
  const expiryMs = invitePolicy.expiryDays() * 24 * 60 * 60 * 1000;
  if (Date.now() - invite.createdAt.getTime() > expiryMs) {
    logger.warn("invite.resolved_expired", { jobId: invite.jobId, inviteId: invite.id });
    return null;
  }

  const job = await prisma.job.findUnique({
    where: { id: invite.jobId },
    include: { service: { select: { name: true } } },
  });
  if (!job) return null;

  return { invite, job };
}

/**
 * Records the customer's digital sign-off from the portal.
 * Returns the updated invite or null when the token is unknown/expired.
 */
export async function recordSignOff(
  token: string,
  input: { decision: "APPROVED" | "ATTENTION_REQUESTED"; signatoryName: string; notes?: string; userAgent?: string; ipHash?: string }
) {
  const resolved = await resolveInviteByToken(token);
  if (!resolved) return null;
  const { invite, job } = resolved;

  if (invite.signStatus === "APPROVED") {
    return { invite, job, alreadySigned: true as const };
  }

  const updated = await prisma.completionInvite.update({
    where: { id: invite.id },
    data: {
      signStatus: input.decision,
      signedAt: input.decision === "APPROVED" ? new Date() : invite.signedAt,
      signatoryName: input.signatoryName,
      signUserAgent: input.userAgent?.slice(0, 500),
      signIpHash: input.ipHash,
    },
  });

  logger.info("invite.sign_off", {
    jobId: job.id,
    inviteId: invite.id,
    decision: input.decision,
    signatory: input.signatoryName,
  });

  return { invite: updated, job, alreadySigned: false as const };
}
