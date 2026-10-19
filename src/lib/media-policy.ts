import {
  MEDIA_CATEGORIES,
  MEDIA_TYPES,
  type MediaItem,
  type MediaQuotaView,
  type ProtectionLevel,
} from "@/lib/media";

/**
 * Media protection and listing rules — pure (no database), so every rule is unit-tested directly.
 * See src/lib/server/media.ts for how they are applied to real files.
 */

export const DAY = 86400000;
/** A file younger than this is never treated as "unreferenced": its record may still be being saved. */
export const UNREFERENCED_GRACE_MS = DAY;

export const retention = () => ({
  /** Job evidence is kept this long after the job finishes before it can be removed with a plain confirmation. */
  evidenceDays: Number(process.env.MEDIA_EVIDENCE_RETENTION_DAYS) > 0 ? Number(process.env.MEDIA_EVIDENCE_RETENTION_DAYS) : 365,
  /** Financial documents (expense receipts): tax record-keeping period. */
  financialDays: Number(process.env.MEDIA_FINANCIAL_RETENTION_DAYS) > 0 ? Number(process.env.MEDIA_FINANCIAL_RETENTION_DAYS) : 2190,
});

const FINISHED_JOB = new Set(["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"]);

export interface JobFacts {
  status: string;
  finishedAt: Date;
  openComplaint: boolean;
  unpaidInvoice: boolean;
}

function level(l: ProtectionLevel, ...reasons: string[]) {
  return { level: l, reasons };
}

/** The protection of one job photo. Pure: every input is passed in. */
export function photoProtection(photoType: string, job: JobFacts | null, now: Date, days = retention().evidenceDays) {
  if (!job) return level("FREE", "Its job no longer exists.");
  if (job.status === "CANCELLED") return level("FREE", "The job was cancelled.");
  if (!FINISHED_JOB.has(job.status)) return level("LOCKED", "The job is still in progress — its photos are needed for QC and the customer.");
  if (job.openComplaint) return level("LOCKED", "The customer has an open complaint on this job.");
  if (job.unpaidInvoice) return level("LOCKED", "The job's invoice isn't fully paid — photos can be needed in a dispute.");
  const ageDays = (now.getTime() - job.finishedAt.getTime()) / DAY;
  const kind = photoType === "qc" || photoType === "rework" ? "QC evidence" : `${photoType} photo`;
  if (ageDays < days) return level("PROTECTED", `${kind[0].toUpperCase()}${kind.slice(1)} of a finished job, kept for ${days} days (${Math.ceil(days - ageDays)} days left).`);
  return level("CONFIRM", `The job finished more than ${days} days ago.`);
}

/** The protection of one stored receipt. */
export function receiptProtection(
  r: { createdAt: Date },
  expense: { approvalStatus: string; voidedAt: Date | null; sourceType: string | null; date: string } | null,
  now: Date,
  days = retention().financialDays
) {
  if (!expense) {
    if (now.getTime() - r.createdAt.getTime() < UNREFERENCED_GRACE_MS) return level("LOCKED", "Uploaded in the last 24 hours — its expense may still be being saved.");
    return level("FREE", "No expense uses this file.");
  }
  if (expense.sourceType) return level("LOCKED", "It belongs to an automatic payroll, freelance or referral payment record.");
  if (expense.voidedAt) return level("CONFIRM", "The expense was voided.");
  if (expense.approvalStatus === "PENDING_APPROVAL") return level("LOCKED", "The expense is waiting for approval.");
  const ageDays = (now.getTime() - new Date(`${expense.date}T00:00:00Z`).getTime()) / DAY;
  if (ageDays < days) return level("PROTECTED", `A financial record, kept for ${Math.round(days / 365)} years (${Math.ceil(days - ageDays)} days left).`);
  return level("CONFIRM", "Past the financial retention period.");
}

export interface MediaQuery {
  category?: string | null;
  type?: string | null;
  q?: string | null;
  minBytes?: number | null;
  from?: string | null;
  to?: string | null;
  referenced?: "yes" | "no" | null;
  protection?: string | null;
  sort?: string | null;
  page: number;
  pageSize: number;
}

export function filterItems(items: MediaItem[], q: MediaQuery): MediaItem[] {
  const text = q.q?.trim().toLowerCase();
  const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? new Date(`${q.from}T00:00:00+05:30`).getTime() : null;
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? new Date(`${q.to}T00:00:00+05:30`).getTime() + DAY : null;
  return items.filter((i) => {
    if (q.category && (MEDIA_CATEGORIES as readonly string[]).includes(q.category) && i.category !== q.category) return false;
    if (q.type && (MEDIA_TYPES as readonly string[]).includes(q.type) && i.type !== q.type) return false;
    if (q.minBytes && (i.bytes ?? 0) < q.minBytes) return false;
    if (q.referenced === "yes" && !i.referenced) return false;
    if (q.referenced === "no" && i.referenced) return false;
    if (q.protection && i.protection.level !== q.protection) return false;
    const t = i.uploadedAt ? new Date(i.uploadedAt).getTime() : 0;
    if (from !== null && t < from) return false;
    if (to !== null && t >= to) return false;
    if (text && ![i.name, i.jobSerial, i.customerName, i.uploadedBy].some((v) => (v ?? "").toLowerCase().includes(text))) return false;
    return true;
  });
}

export function sortItems(items: MediaItem[], sort?: string | null): MediaItem[] {
  const time = (i: MediaItem) => (i.uploadedAt ? new Date(i.uploadedAt).getTime() : 0);
  const by: Record<string, (a: MediaItem, b: MediaItem) => number> = {
    largest: (a, b) => (b.bytes ?? 0) - (a.bytes ?? 0),
    smallest: (a, b) => (a.bytes ?? 0) - (b.bytes ?? 0),
    oldest: (a, b) => time(a) - time(b),
    newest: (a, b) => time(b) - time(a),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return items.slice().sort(by[sort ?? "newest"] ?? by.newest);
}


export const WARN_PERCENT = () => (Number(process.env.MEDIA_WARN_PERCENT) > 0 && Number(process.env.MEDIA_WARN_PERCENT) < 100 ? Number(process.env.MEDIA_WARN_PERCENT) : 80);

/** Pure: turns usage + limit into the figure and warning shown to the Admin. Never invents a limit. */
export function quotaView(input: { usedBytes: number | null; providerLimit: number | null; configuredLimit: number | null; estimateBytes: number; providerError: string | null; warnPercent: number }): MediaQuotaView {
  const limit = input.providerLimit ?? input.configuredLimit;
  const limitSource = input.providerLimit ? ("provider" as const) : input.configuredLimit ? ("configured" as const) : null;
  const used = input.usedBytes ?? input.estimateBytes;
  const pct = limit ? Math.round((used / limit) * 1000) / 10 : null;
  let lvl: MediaQuotaView["level"] = "UNKNOWN";
  let message: string | null = null;
  if (pct !== null) {
    lvl = pct >= 95 ? "FULL" : pct >= input.warnPercent ? "WARN" : "OK";
    if (lvl !== "OK") message = "Storage is almost full. Review large files or remove unnecessary media.";
  } else {
    message = input.providerError
      ? input.providerError
      : "The storage provider doesn't report a limit for this plan. Set MEDIA_STORAGE_QUOTA_MB to get warnings.";
  }
  return { usedBytes: used, limitBytes: limit, limitSource, usedPercent: pct, level: lvl, message };
}

