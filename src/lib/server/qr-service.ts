import crypto from "crypto";
import { prisma } from "./prisma";
import { logger, maskToken } from "./logger";

/**
 * Unified QR + Secure Link token service (§3–§6, §27, §29, §36).
 *
 * ONE centralized registry of dynamic tokens. Every QR code and secure link
 * in the platform mints here; every resolution validates here. Design rules:
 *
 *  - The raw token is a 256-bit URL-safe random value. ONLY its SHA-256 hash
 *    is stored, so a database leak can never mint working links.
 *  - Purpose-scoped expiry: customer verification links are short-lived;
 *    QC/reinspection links live until inspection completes or the token is
 *    revoked; manager links ride the job's active window.
 *  - Revoke → regenerate is instant: revoked hashes resolve to HTTP 410.
 *  - Usage is audited (usageCount / lastUsedAt) on every successful resolve.
 */

export type QrPurpose =
  | "CUSTOMER_JOB"
  | "CUSTOMER_VERIFICATION"
  | "CUSTOMER_APPROVAL"
  | "MANAGER_JOB"
  | "QC_INSPECTION"
  | "REWORK"
  | "REINSPECTION";

export const QR_PURPOSES: QrPurpose[] = [
  "CUSTOMER_JOB",
  "CUSTOMER_VERIFICATION",
  "CUSTOMER_APPROVAL",
  "MANAGER_JOB",
  "QC_INSPECTION",
  "REWORK",
  "REINSPECTION",
];

/** §27 — the route scope each purpose unlocks. Never trust the URL alone:
 *  the SCOPE is derived from the token record, not from the path alone. */
export const PURPOSE_SCOPE: Record<QrPurpose, string> = {
  CUSTOMER_JOB: "customer",
  CUSTOMER_VERIFICATION: "customer",
  CUSTOMER_APPROVAL: "approval",
  MANAGER_JOB: "manager",
  QC_INSPECTION: "qc",
  REWORK: "rework",
  REINSPECTION: "qc",
};

export const PURPOSE_LABEL: Record<QrPurpose, string> = {
  CUSTOMER_JOB: "Customer Job Link",
  CUSTOMER_VERIFICATION: "Customer Verification Link",
  CUSTOMER_APPROVAL: "Customer Approval Link",
  MANAGER_JOB: "Manager Job Link",
  QC_INSPECTION: "QC Inspection Link",
  REWORK: "Rework Link",
  REINSPECTION: "Reinspection Link",
};

/** §6 — purpose-scoped expiry (hours). Env-overridable, clamped. */
function hoursFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function qrExpiryHours(purpose: QrPurpose): number | null {
  switch (purpose) {
    case "CUSTOMER_VERIFICATION":
      return hoursFromEnv("QR_CUSTOMER_VERIFICATION_HOURS", 24, 1, 24 * 30); // short-lived verification window
    case "CUSTOMER_JOB":
      return hoursFromEnv("QR_CUSTOMER_JOB_HOURS", 24 * 30, 1, 24 * 365);
    case "CUSTOMER_APPROVAL":
      return hoursFromEnv("QR_CUSTOMER_APPROVAL_HOURS", 24 * 14, 1, 24 * 365);
    case "MANAGER_JOB":
      return hoursFromEnv("QR_MANAGER_JOB_HOURS", 24 * 7, 1, 24 * 90);
    case "QC_INSPECTION":
    case "REINSPECTION":
      return null; // valid until inspection completed or token revoked
    case "REWORK":
      return hoursFromEnv("QR_REWORK_HOURS", 24 * 7, 1, 24 * 90);
    default:
      return null;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url"); // 256-bit, URL-safe
}

/** Resolve the shareable base URL exactly like the completion-invite flow. */
function baseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured && /^https?:\/\//.test(configured)) return configured.replace(/\/$/, "");
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProduction && !vercelProduction.startsWith("localhost")) {
    return `https://${vercelProduction.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export function buildLinkPath(purpose: QrPurpose, token: string): string {
  const scope = PURPOSE_SCOPE[purpose];
  if (scope === "approval") return `/approval/${token}`;
  if (scope === "manager") return `/manager/job/${token}`;
  if (scope === "qc") return `/qc/job/${token}`;
  if (scope === "rework") return `/rework/${token}`;
  return `/customer/job/${token}`;
}

export function buildLinkUrl(purpose: QrPurpose, token: string): string {
  return `${baseUrl()}${buildLinkPath(purpose, token)}`;
}

/** §27 short alias scanned from the physical QR — resolves to the real scope. */
export function buildShortUrl(token: string): string {
  return `${baseUrl()}/q/${token}`;
}

export interface MintFailure {
  kind: "not_found" | "cooldown" | "rate_limited";
  message: string;
}

const MINT_COOLDOWN_MS = 15 * 1000;
const MINT_WINDOW_MS = 10 * 60 * 1000;
const MAX_MINTS_PER_WINDOW = 8;

export interface MintSuccess {
  tokenId: string;
  purpose: QrPurpose;
  linkPath: string;
  linkUrl: string;
  shortUrl: string;
  expiresAt: string | null;
}

/**
 * Mints a fresh token for (jobId, purpose). Each call creates a NEW token —
 * older tokens of the same purpose keep working until revoked/expired so a
 * re-shared link never orphans a customer mid-flow; REVOKE is the kill switch.
 */
export async function mintQrToken(
  jobId: string,
  purpose: QrPurpose,
  actor: { id?: string; name?: string } = {}
): Promise<{ success: true; data: MintSuccess } | { success: false; failure: MintFailure }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { success: false, failure: { kind: "not_found", message: "Job not found." } };
  }

  // Rate limit per (job, purpose): cooldown + rolling cap.
  const last = await prisma.qrToken.findFirst({
    where: { jobId, purpose },
    orderBy: { createdAt: "desc" },
  });
  if (last && Date.now() - last.createdAt.getTime() < MINT_COOLDOWN_MS) {
    const secs = Math.ceil((MINT_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000);
    return {
      success: false,
      failure: { kind: "cooldown", message: `Please wait ${secs}s before generating another ${PURPOSE_LABEL[purpose]}.` },
    };
  }
  const windowStart = new Date(Date.now() - MINT_WINDOW_MS);
  const recent = await prisma.qrToken.count({
    where: { jobId, purpose, createdAt: { gt: windowStart } },
  });
  if (recent >= MAX_MINTS_PER_WINDOW) {
    return {
      success: false,
      failure: { kind: "rate_limited", message: `Too many ${PURPOSE_LABEL[purpose]} tokens generated for this job. Try again later.` },
    };
  }

  const token = generateToken();
  const hours = qrExpiryHours(purpose);
  const expiresAt = hours ? new Date(Date.now() + hours * 3600 * 1000) : null;

  const row = await prisma.qrToken.create({
    data: {
      tokenHash: hashToken(token),
      tokenLast4: token.slice(-4),
      purpose,
      jobId,
      expiresAt,
      createdBy: actor.id ?? null,
      createdByName: actor.name ?? "system",
    },
  });

  logger.info("qr.minted", {
    jobId,
    purpose,
    tokenId: row.id,
    token: maskToken(token),
    expiresAt: expiresAt?.toISOString() ?? null,
  });

  return {
    success: true,
    data: {
      tokenId: row.id,
      purpose,
      linkPath: buildLinkPath(purpose, token),
      linkUrl: buildLinkUrl(purpose, token),
      shortUrl: buildShortUrl(token),
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  };
}

/** What mintQrToken returns must NEVER include the raw token; callers share
 *  linkUrl/shortUrl once and the QR image is fetched separately. */

export type ResolveFailureKind =
  | "not_found" // unknown token (404)
  | "expired" // 410
  | "revoked" // 410
  | "forbidden" // purpose mismatch — wrong scope for this route (403)
  | "wrong_status"; // token valid but the job cannot use this purpose now (409)

export interface ResolveFailure {
  kind: ResolveFailureKind;
  message: string;
}

export interface ResolvedQrToken {
  tokenRow: {
    id: string;
    purpose: QrPurpose;
    jobId: string;
    expiresAt: Date | null;
    usageCount: number;
    lastUsedAt: Date | null;
  };
  job: {
    id: string;
    status: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    serviceId: string;
    propertyName: string;
    propertyAddress: string;
    scheduledDate: string;
    scheduledTimeSlot: string;
  };
}

/** Job statuses each purpose may operate on (§27 "Job status check"). */
function purposeAllowedStatuses(purpose: QrPurpose): string[] | null {
  switch (purpose) {
    case "CUSTOMER_JOB":
      return ["SCHEDULED", "ASSIGNED", "ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS", "WORK_COMPLETED", "QUALITY_CHECK", "PASS", "REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_COMPLETED", "REINSPECTION", "CUSTOMER_APPROVAL", "COMPLETED", "FEEDBACK_REQUESTED"];
    case "CUSTOMER_VERIFICATION":
      // §30: stays valid after confirmation so a second tap still resolves
      // (the confirm action itself answers idempotently). Only rejects once
      // work has begun in earnest.
      return ["SCHEDULED", "ASSIGNED", "ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS"];
    case "CUSTOMER_APPROVAL":
      return ["PASS", "CUSTOMER_APPROVAL", "COMPLETED", "FEEDBACK_REQUESTED"];
    case "MANAGER_JOB":
      return ["SCHEDULED", "ASSIGNED", "ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS", "REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];
    case "QC_INSPECTION":
      // Stays valid through the whole rework loop so QC can re-flag issues
      // idempotently (§30) without a fresh link each cycle.
      return ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_COMPLETED", "REINSPECTION"];
    case "REWORK":
      return ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];
    case "REINSPECTION":
      return ["REWORK_COMPLETED", "REINSPECTION"];
    default:
      return null;
  }
}

/**
 * The full §27 validation chain, server-side on EVERY request:
 *   token hash → revocation → expiry → job existence → purpose/job-status
 *   compatibility → (caller-supplied role check) → minimum-info projection.
 * Returns a discriminated result; routes translate to status codes.
 */
export async function resolveQrToken(
  rawToken: string,
  expectedPurpose?: QrPurpose | QrPurpose[]
): Promise<{ ok: true; data: ResolvedQrToken } | { ok: false; failure: ResolveFailure }> {
  if (!rawToken || rawToken.length < 16 || rawToken.length > 200) {
    return { ok: false, failure: { kind: "not_found", message: "This QR code is invalid or has expired." } };
  }

  const row = await prisma.qrToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row) {
    logger.warn("qr.resolve.unknown_token");
    return { ok: false, failure: { kind: "not_found", message: "This QR code is invalid or has expired." } };
  }

  if (row.revokedAt) {
    logger.warn("qr.resolve.revoked", { tokenId: row.id, jobId: row.jobId });
    return {
      ok: false,
      failure: { kind: "revoked", message: "This link is no longer active. Please request a new link." },
    };
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      failure: { kind: "expired", message: "This link has expired. Please request a new one." },
    };
  }

  const expectedList = expectedPurpose
    ? Array.isArray(expectedPurpose)
      ? expectedPurpose
      : [expectedPurpose]
    : null;
  if (expectedList && !expectedList.includes(row.purpose as QrPurpose)) {
    // §28 permission failure BEFORE any job-status probing — a manager token
    // probing the customer route must read as "no permission", not "bad stage".
    logger.warn("qr.resolve.purpose_mismatch", { tokenId: row.id, expected: expectedList.join(","), actual: row.purpose });
    return {
      ok: false,
      failure: { kind: "forbidden", message: "You don't have permission to access this job with this link." },
    };
  }

  const job = await prisma.job.findUnique({
    where: { id: row.jobId },
    include: {
      customer: { select: { name: true, phone: true } },
      property: { select: { title: true, address: true } },
      service: { select: { name: true } },
    },
  });
  if (!job) {
    return { ok: false, failure: { kind: "not_found", message: "The job for this link no longer exists." } };
  }

  const allowed = purposeAllowedStatuses(row.purpose as QrPurpose);
  if (allowed && !allowed.includes(job.status)) {
    logger.warn("qr.resolve.status_rejected", { tokenId: row.id, purpose: row.purpose, jobStatus: job.status });
    return {
      ok: false,
      failure: {
        kind: "wrong_status",
        message:
          row.purpose === "CUSTOMER_VERIFICATION"
            ? "This confirmation link is only active while the team is arriving or on site."
            : "This link is not active for the job's current stage.",
      },
    };
  }

  // Usage audit — best-effort, never blocks a legitimate use.
  void prisma.qrToken
    .update({
      where: { id: row.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    })
    .catch(() => {});

  const service = await prisma.service.findUnique({ where: { id: job.serviceId }, select: { name: true } });

  return {
    ok: true,
    data: {
      tokenRow: {
        id: row.id,
        purpose: row.purpose as QrPurpose,
        jobId: row.jobId,
        expiresAt: row.expiresAt,
        usageCount: row.usageCount,
        lastUsedAt: row.lastUsedAt,
      },
      job: {
        id: job.id,
        status: job.status,
        customerId: job.customerId,
        customerName: job.customer?.name ?? "Customer",
        customerPhone: job.customer?.phone ?? "",
        serviceId: job.serviceId,
        propertyName: job.property?.title ?? "Property",
        propertyAddress: job.property?.address ?? "",
        scheduledDate: job.scheduledDate,
        scheduledTimeSlot: job.scheduledTimeSlot,
      },
    },
  };
}

/** Revoke one token (by id) — the §5 kill switch. */
export async function revokeQrToken(
  tokenId: string,
  actor: { id?: string; name?: string },
  reason?: string
) {
  const row = await prisma.qrToken.updateMany({
    where: { id: tokenId, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: actor.id ?? null, revokedReason: reason ?? "Revoked by admin" },
  });
  logger.info("qr.revoked", { tokenId, by: actor.id ?? "system", count: row.count });
  return row.count > 0;
}

/** Revoke every live token of a purpose for a job (e.g. compromise response). */
export async function revokeAllForJob(jobId: string, purpose?: QrPurpose, reason = "Revoked") {
  const row = await prisma.qrToken.updateMany({
    where: { jobId, revokedAt: null, ...(purpose ? { purpose } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  logger.info("qr.revoked_all", { jobId, purpose: purpose ?? "all", count: row.count });
  return row.count;
}

/* ------------------------------------------------------------------ */
/* §36 rate limiting for public token endpoints (per-IP, in-memory).   */
/* ------------------------------------------------------------------ */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSecs: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSecs: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSecs: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSecs: 0 };
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

/** Serialize a QrToken row for the admin table — hashes stay server-side. */
export function serializeQrToken(row: {
  id: string;
  purpose: string;
  jobId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  createdByName: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    purpose: row.purpose as QrPurpose,
    purposeLabel: PURPOSE_LABEL[row.purpose as QrPurpose] ?? row.purpose,
    scope: PURPOSE_SCOPE[row.purpose as QrPurpose] ?? "customer",
    jobId: row.jobId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedReason: row.revokedReason ?? null,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdByName: row.createdByName ?? "system",
    createdAt: row.createdAt.toISOString(),
  };
}
