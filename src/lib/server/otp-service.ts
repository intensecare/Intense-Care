import crypto from "crypto";
import { prisma } from "./prisma";
import { logger, maskPhone } from "./logger";
import { otpPolicy } from "./policy";
import {
  isTwoFactorConfigured,
  sendOtpAutogen,
  verifyOtpSession,
  toSubscriberNumber,
} from "./twofactor";

/**
 * Server-authoritative OTP lifecycle for job arrival verification.
 *
 * Delivery uses 2Factor AUTOGEN: the provider generates the code and sends it
 * through their pre-approved DLT OTP template (max deliverability without our
 * own DLT registration). Verification calls the provider session endpoint;
 * our own policy (expiry, attempt budget, lockout, cooldown, hourly caps) is
 * enforced in the database on top, and no plaintext code is ever persisted.
 */

export interface SendFailure {
  kind:
    | "not_found"
    | "invalid_phone"
    | "wrong_status"
    | "cooldown"
    | "rate_limited"
    | "already_verified"
    | "provider_error";
  message: string;
}

export interface VerifyFailure {
  kind: "not_found" | "invalid_code" | "expired" | "locked" | "wrong_status" | "provider_error";
  message: string;
}

export interface SendOtpSuccess {
  challengeId: string;
  expiresAt: string;
  cooldownSeconds: number;
  maskedPhone: string;
  sentVia: "2factor";
}

export interface VerifyOtpSuccess {
  verifiedAt: string;
  challengeId: string;
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function loadJobWithCustomer(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  const customer = await prisma.customer.findUnique({ where: { id: job.customerId } });
  return { job, customer };
}

async function enforceSendRateLimits(
  jobId: string,
  phone: string
): Promise<SendFailure | null> {
  const cooldownCutoff = new Date(Date.now() - otpPolicy.resendCooldownSeconds() * 1000);
  const lastSend = await prisma.smsLog.findFirst({
    where: {
      jobId,
      purpose: "OTP_VERIFICATION",
      createdAt: { gt: cooldownCutoff },
    },
    orderBy: { createdAt: "desc" },
  });
  if (lastSend) {
    const secondsLeft = Math.ceil(
      (lastSend.createdAt.getTime() + otpPolicy.resendCooldownSeconds() * 1000 - Date.now()) / 1000
    );
    logger.warn("otp.send.cooldown", { jobId, secondsLeft });
    return {
      kind: "cooldown",
      message: `Please wait ${secondsLeft}s before requesting another OTP.`,
    };
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [perJob, perPhone] = await Promise.all([
    prisma.smsLog.count({
      where: { jobId, purpose: "OTP_VERIFICATION", createdAt: { gt: hourAgo } },
    }),
    prisma.smsLog.count({
      where: { phone, purpose: "OTP_VERIFICATION", createdAt: { gt: hourAgo } },
    }),
  ]);

  if (perJob >= otpPolicy.maxSendsPerJobPerHour()) {
    return {
      kind: "rate_limited",
      message: "Too many OTP requests for this job. Contact operations if this persists.",
    };
  }
  if (perPhone >= otpPolicy.maxSendsPerPhonePerHour()) {
    return {
      kind: "rate_limited",
      message: "Too many OTP requests to this phone number. Try again later.",
    };
  }
  return null;
}

async function cancelPreviousChallenges(jobId: string) {
  // Only the newest challenge may ever verify; supersede older pending ones.
  await prisma.otpChallenge.updateMany({
    where: { jobId, status: "PENDING" },
    data: { status: "CANCELLED", updatedAt: new Date() },
  });
}

/**
 * Core send flow shared by first-send and resend:
 * validates state, enforces cooldown + hourly caps, supersedes stale
 * challenges, creates the challenge, and dispatches via 2Factor AUTOGEN.
 */
async function dispatchArrivalOtp(
  jobId: string,
  actor: { id: string; role: string }
): Promise<{ success: true; data: SendOtpSuccess } | { success: false; failure: SendFailure }> {
  const loaded = await loadJobWithCustomer(jobId);
  if (!loaded) {
    return { success: false, failure: { kind: "not_found", message: "Job not found." } };
  }
  const { job, customer } = loaded;

  if (job.status !== "ARRIVED") {
    return {
      success: false,
      failure: {
        kind: "wrong_status",
        message: `OTP verification applies only while the job is ARRIVED (current: ${job.status}).`,
      },
    };
  }

  if (!customer || !toSubscriberNumber(customer.phone)) {
    return {
      success: false,
      failure: {
        kind: "invalid_phone",
        message: "The registered customer phone number is missing or invalid.",
      },
    };
  }

  const alreadyVerified = await prisma.otpChallenge.findFirst({
    where: { jobId, status: "VERIFIED" },
  });
  if (alreadyVerified) {
    return {
      success: false,
      failure: {
        kind: "already_verified",
        message: "Customer OTP was already verified for this job.",
      },
    };
  }

  const rateFailure = await enforceSendRateLimits(jobId, customer.phone);
  if (rateFailure) return { success: false, failure: rateFailure };

  await cancelPreviousChallenges(jobId);

  const expiryMinutes = otpPolicy.expiryMinutes();
  const challenge = await prisma.otpChallenge.create({
    data: {
      jobId,
      codeHash: null, // provider-managed (AUTOGEN) — no local hash
      providerManaged: true,
      phone: customer.phone,
      phoneLast4: customer.phone.replace(/[^0-9]/g, "").slice(-4),
      status: "PENDING",
      attempts: 0,
      maxAttempts: otpPolicy.maxAttempts(),
      expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
      createdByUserId: actor.id,
      createdByRole: actor.role,
    },
  });

  const configured = isTwoFactorConfigured();
  const smsLog = await prisma.smsLog.create({
    data: {
      jobId,
      phone: customer.phone,
      phoneLast4: customer.phone.replace(/[^0-9]/g, "").slice(-4),
      purpose: "OTP_VERIFICATION",
      provider: configured ? "2factor" : "none",
      status: "QUEUED",
    },
  });

  if (!configured) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { status: "FAILED", errorMessage: "provider_not_configured" },
    });
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { status: "CANCELLED", updatedAt: new Date() },
    });
    logger.error("otp.send.provider_not_configured", { jobId, phone: maskPhone(customer.phone) });
    return {
      success: false,
      failure: {
        kind: "provider_error",
        message:
          "SMS gateway is not configured on the server (missing TWOFACTOR_API_KEY). The OTP was NOT delivered.",
      },
    };
  }

  const result = await sendOtpAutogen(customer.phone);
  if (!result.ok || !result.sessionId) {
    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { status: "FAILED", errorMessage: result.error ?? "provider_error" },
    });
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { status: "CANCELLED", updatedAt: new Date() },
    });
    logger.error("otp.send.provider_failed", {
      jobId,
      phone: maskPhone(customer.phone),
      error: result.error,
    });
    return {
      success: false,
      failure: {
        kind: "provider_error",
        message: "SMS gateway rejected the OTP request. Please retry shortly.",
      },
    };
  }

  await prisma.smsLog.update({
    where: { id: smsLog.id },
    data: { status: "SENT", providerRef: result.sessionId },
  });
  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { providerSessionId: result.sessionId, updatedAt: new Date() },
  });

  logger.info("otp.send.dispatched", {
    jobId,
    phone: maskPhone(customer.phone),
    expiryMinutes,
    challengeId: challenge.id,
  });

  return {
    success: true,
    data: {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt.toISOString(),
      cooldownSeconds: otpPolicy.resendCooldownSeconds(),
      maskedPhone: maskPhone(customer.phone),
      sentVia: "2factor",
    },
  };
}

/** First send on arrival. */
export function sendArrivalOtp(jobId: string, actor: { id: string; role: string }) {
  return dispatchArrivalOtp(jobId, actor);
}

/** Resend — same policy, same envelope. */
export function resendArrivalOtp(jobId: string, actor: { id: string; role: string }) {
  return dispatchArrivalOtp(jobId, actor);
}

/**
 * Verifies a submitted OTP code for a job:
 *  1. our policy first — expiry / attempt budget / lockout on the newest challenge;
 *  2. then provider session verification (2Factor AUTOGEN VERIFY);
 *  3. attempt counters increment locally on every failed provider response.
 */
export async function verifyArrivalOtp(
  jobId: string,
  submittedCode: string
): Promise<{ success: true; data: VerifyOtpSuccess } | { success: false; failure: VerifyFailure }> {
  const code = submittedCode.replace(/[^0-9]/g, "");
  if (code.length !== 6) {
    return {
      success: false,
      failure: { kind: "invalid_code", message: "Enter the complete 6-digit code." },
    };
  }

  const challenge = await prisma.otpChallenge.findFirst({
    where: { jobId },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    return {
      success: false,
      failure: {
        kind: "not_found",
        message: "No OTP has been sent for this job yet.",
      },
    };
  }

  if (challenge.status === "VERIFIED") {
    return {
      success: false,
      failure: { kind: "wrong_status", message: "OTP already verified for this job." },
    };
  }
  if (challenge.status === "LOCKED") {
    return {
      success: false,
      failure: {
        kind: "locked",
        message: "This OTP is locked after too many failed attempts. Request a new one.",
      },
    };
  }
  if (challenge.status !== "PENDING") {
    return {
      success: false,
      failure: {
        kind: "wrong_status",
        message: "This OTP is no longer valid. Request a new one.",
      },
    };
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { status: "EXPIRED", updatedAt: new Date() },
    });
    logger.info("otp.verify.expired", { jobId, challengeId: challenge.id });
    return {
      success: false,
      failure: { kind: "expired", message: "This OTP has expired. Request a new one." },
    };
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { status: "LOCKED", updatedAt: new Date() },
    });
    return {
      success: false,
      failure: {
        kind: "locked",
        message: "Too many incorrect attempts. This OTP is locked — request a new one.",
      },
    };
  }

  if (!challenge.providerManaged || !challenge.providerSessionId) {
    return {
      success: false,
      failure: {
        kind: "wrong_status",
        message: "This OTP has no active provider session. Request a new one.",
      },
    };
  }

  if (!isTwoFactorConfigured()) {
    return {
      success: false,
      failure: {
        kind: "provider_error",
        message: "SMS gateway is not configured on the server. Contact support.",
      },
    };
  }

  const provider = await verifyOtpSession(challenge.providerSessionId, code);
  if (!provider.ok) {
    // Transport-level failure (timeout, 5xx) — do NOT burn an attempt.
    logger.error("otp.verify.provider_error", {
      jobId,
      challengeId: challenge.id,
      error: provider.error,
    });
    return {
      success: false,
      failure: {
        kind: "provider_error",
        message: "Could not reach the verification service. Please try again.",
      },
    };
  }

  if (!provider.matched) {
    // The provider session itself is gone (expired / superseded / unknown).
    // Mark the challenge dead and tell the user to request a fresh OTP —
    // retrying the same code can never succeed.
    if (provider.sessionError) {
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { status: "EXPIRED", updatedAt: new Date() },
      });
      logger.warn("otp.verify.session_dead", {
        jobId,
        challengeId: challenge.id,
        providerDetail: provider.sessionError,
      });
      return {
        success: false,
        failure: {
          kind: "expired",
          message: "This OTP session is no longer valid at the SMS gateway. Request a new OTP.",
        },
      };
    }

    const attempts = challenge.attempts + 1;
    const locked = attempts >= challenge.maxAttempts;
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { status: locked ? "LOCKED" : "PENDING", attempts, updatedAt: new Date() },
    });
    logger.warn("otp.verify.failed", { jobId, challengeId: challenge.id, attempts, locked });
    return {
      success: false,
      failure: {
        kind: "invalid_code",
        message: locked
          ? "Incorrect code — all attempts used. This OTP is locked; request a new one."
          : `Incorrect code. ${challenge.maxAttempts - attempts} attempt(s) remaining.`,
      },
    };
  }

  // Success: consume atomically so a raced double-verify cannot both pass.
  const consumed = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, status: "PENDING" },
    data: { status: "VERIFIED", consumedAt: new Date(), updatedAt: new Date() },
  });
  if (consumed.count === 0) {
    return {
      success: false,
      failure: {
        kind: "wrong_status",
        message: "This OTP was just used or invalidated. Request a new one.",
      },
    };
  }

  logger.info("otp.verify.success", { jobId, challengeId: challenge.id });
  return {
    success: true,
    data: { verifiedAt: new Date().toISOString(), challengeId: challenge.id },
  };
}

/**
 * Cancels all pending challenges for a job — used when the job leaves ARRIVED
 * without verification (e.g. cancellation).
 */
export async function cancelJobOtps(jobId: string) {
  await prisma.otpChallenge.updateMany({
    where: { jobId, status: "PENDING" },
    data: { status: "CANCELLED", updatedAt: new Date() },
  });
}

/** Latest OTP delivery status for a job (used for ops diagnostics). */
export async function lastOtpDeliveryStatus(jobId: string) {
  const log = await prisma.smsLog.findFirst({
    where: { jobId, purpose: "OTP_VERIFICATION" },
    orderBy: { createdAt: "desc" },
  });
  return log
    ? { status: log.status, provider: log.provider, error: log.errorMessage, sentAt: log.createdAt }
    : null;
}
