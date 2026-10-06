import crypto from "crypto";
import { prisma } from "./prisma";
import { logger, maskToken } from "./logger";

/**
 * Customer secure link service — ONE link per job, for the whole journey.
 *
 * The customer link is minted when the job is created (or a quotation is
 * converted) and stays valid until revoked or regenerated. The SAME link:
 *   1. lets the customer confirm the team's arrival,
 *   2. shows live progress (checklist + photos) through the service,
 *   3. carries the final sign-off (approve / report an issue),
 *   4. shows the final report, rating and the Google-review step.
 *
 * Design rules:
 *  - The raw token is a 256-bit URL-safe random value. Only its SHA-256 hash
 *    is used for verification; an AES-256-GCM encrypted copy (tokenEnc) lets
 *    the desk re-show/QR the SAME link without rotating it.
 *  - Regen replaces: minting again supersedes (auto-revokes) the previous
 *    link so exactly ONE active link exists per job.
 *  - Revoke is the kill switch; usage is audited on every resolve.
 */

export type QrPurpose = "CUSTOMER_JOB";

export const QR_PURPOSES: QrPurpose[] = ["CUSTOMER_JOB"];

export const PURPOSE_LABEL: Record<QrPurpose, string> = {
  CUSTOMER_JOB: "Customer Link",
};

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/* ------------------------------------------------------------------ */
/* Encrypted at-rest copy of the raw token (AES-256-GCM).              */
/* The hash verifies; tokenEnc lets the desk re-show the SAME link.    */
/* ------------------------------------------------------------------ */

function encKey(): Buffer {
  const secret = process.env.ERP_SESSION_SECRET ?? "";
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function encryptToken(raw: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

function decryptToken(enc: string): string | null {
  try {
    const [ivB64, tagB64, ctB64] = enc.split(".");
    if (!ivB64 || !tagB64 || !ctB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Decrypt a stored token row to its raw value (desk re-show only). */
export function rawTokenOfRow(row: { tokenEnc: string | null }): string | null {
  return row.tokenEnc ? decryptToken(row.tokenEnc) : null;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url"); // 256-bit, URL-safe
}

/** Resolve the shareable base URL (APP_BASE_URL → Vercel → localhost). */
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

export function buildLinkPath(token: string): string {
  return `/customer/job/${token}`;
}

export function buildLinkUrl(token: string): string {
  return `${baseUrl()}${buildLinkPath(token)}`;
}

/** Short alias scanned from the physical QR — redirects to the customer page. */
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

export interface LinkInfo {
  tokenId: string;
  purpose: QrPurpose;
  linkPath: string;
  linkUrl: string;
  shortUrl: string;
  expiresAt: string | null;
}

/**
 * The ONE customer link for a job: mint-once, reuse forever. Returns the
 * existing live link (decrypted) or mints a fresh one when none exists.
 * Never rotates an existing link — regeneration is an explicit desk action.
 */
export async function ensureCustomerLink(
  jobId: string,
  actor: { id?: string; name?: string } = {}
): Promise<{ success: true; data: LinkInfo; created: boolean } | { success: false; failure: MintFailure }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { success: false, failure: { kind: "not_found", message: "Job not found." } };
  }

  const live = await prisma.qrToken.findFirst({
    where: { jobId, purpose: "CUSTOMER_JOB", revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (live) {
    const raw = rawTokenOfRow(live);
    if (raw) {
      return {
        success: true,
        created: false,
        data: {
          tokenId: live.id,
          purpose: "CUSTOMER_JOB",
          linkPath: buildLinkPath(raw),
          linkUrl: buildLinkUrl(raw),
          shortUrl: buildShortUrl(raw),
          expiresAt: live.expiresAt?.toISOString() ?? null,
        },
      };
    }
    // Unreadable legacy row (pre-encryption): revoke and fall through to mint.
    await prisma.qrToken.update({
      where: { id: live.id },
      data: { revokedAt: new Date(), revokedReason: "Superseded — legacy token re-issued" },
    });
  }

  return mintCustomerLink(jobId, actor);
}

/**
 * Mint a fresh customer link for (jobId), superseding any previous one.
 * The old link dies instantly — regeneration is the explicit rotate action.
 */
export async function mintCustomerLink(
  jobId: string,
  actor: { id?: string; name?: string } = {}
): Promise<{ success: true; data: LinkInfo; created: true } | { success: false; failure: MintFailure }> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { success: false, failure: { kind: "not_found", message: "Job not found." } };
  }

  // Rate limit per job: cooldown + rolling cap (guards token spam).
  const last = await prisma.qrToken.findFirst({
    where: { jobId, purpose: "CUSTOMER_JOB" },
    orderBy: { createdAt: "desc" },
  });
  if (last && Date.now() - last.createdAt.getTime() < MINT_COOLDOWN_MS) {
    const secs = Math.ceil((MINT_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000);
    return {
      success: false,
      failure: { kind: "cooldown", message: `Please wait ${secs}s before generating a new customer link.` },
    };
  }
  const windowStart = new Date(Date.now() - MINT_WINDOW_MS);
  const recent = await prisma.qrToken.count({
    where: { jobId, purpose: "CUSTOMER_JOB", createdAt: { gt: windowStart } },
  });
  if (recent >= MAX_MINTS_PER_WINDOW) {
    return {
      success: false,
      failure: { kind: "rate_limited", message: "Too many customer links generated for this job. Try again later." },
    };
  }

  const token = generateToken();
  // Optional env-set expiry in days; the sole link stays valid until revoked by default.
  const daysRaw = process.env.QR_CUSTOMER_LINK_DAYS ? Number.parseInt(process.env.QR_CUSTOMER_LINK_DAYS, 10) : NaN;
  const expiresAt = Number.isFinite(daysRaw) && daysRaw > 0 ? new Date(Date.now() + daysRaw * 24 * 3600 * 1000) : null;

  const row = await prisma.qrToken.create({
    data: {
      tokenHash: hashToken(token),
      tokenEnc: encryptToken(token),
      tokenLast4: token.slice(-4),
      purpose: "CUSTOMER_JOB",
      jobId,
      expiresAt,
      createdBy: actor.id ?? null,
      createdByName: actor.name ?? "system",
    },
  });

  // Supersede: kill older live tokens of this job so only the fresh link stays active.
  const superseded = await prisma.qrToken.updateMany({
    where: { jobId, purpose: "CUSTOMER_JOB", id: { not: row.id }, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: actor.id ?? null, revokedReason: "Superseded by a newly minted link" },
  });

  logger.info("qr.customer_link_minted", {
    jobId,
    tokenId: row.id,
    token: maskToken(token),
    expiresAt: expiresAt?.toISOString() ?? null,
    supersededCount: superseded.count,
  });

  return {
    success: true,
    created: true,
    data: {
      tokenId: row.id,
      purpose: "CUSTOMER_JOB",
      linkPath: buildLinkPath(token),
      linkUrl: buildLinkUrl(token),
      shortUrl: buildShortUrl(token),
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  };
}

export type ResolveFailureKind =
  | "not_found" // unknown token (404)
  | "expired" // 410
  | "revoked" // 410
  | "wrong_status"; // link valid but the job cannot act right now (409)

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

/**
 * The full validation chain, server-side on EVERY request:
 *   token hash → revocation → expiry → job existence → minimum-info projection.
 * The customer link never gates on job status at resolve time — the journey
 * page adapts to the stage; individual actions enforce their own gates.
 */
export async function resolveQrToken(
  rawToken: string
): Promise<{ ok: true; data: ResolvedQrToken } | { ok: false; failure: ResolveFailure }> {
  if (!rawToken || rawToken.length < 16 || rawToken.length > 200) {
    return { ok: false, failure: { kind: "not_found", message: "This link is invalid or has expired." } };
  }

  const row = await prisma.qrToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row) {
    logger.warn("qr.resolve.unknown_token");
    return { ok: false, failure: { kind: "not_found", message: "This link is invalid or has expired." } };
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

  // Usage audit — best-effort, never blocks a legitimate use.
  void prisma.qrToken
    .update({
      where: { id: row.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    })
    .catch(() => {});

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

/** Revoke one token (by id) — the kill switch. */
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

/** Revoke every live customer link of a job (compromise response). */
export async function revokeAllForJob(jobId: string, reason = "Revoked") {
  const row = await prisma.qrToken.updateMany({
    where: { jobId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  logger.info("qr.revoked_all", { jobId, count: row.count });
  return row.count;
}

/* ------------------------------------------------------------------ */
/* Rate limiting for public token endpoints (per-IP, in-memory).       */
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

/** Serialize a QrToken row for the desk table — raw token never leaves. */
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
    purpose: "CUSTOMER_JOB" as QrPurpose,
    purposeLabel: PURPOSE_LABEL.CUSTOMER_JOB,
    scope: "customer",
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
