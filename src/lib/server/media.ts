import { prisma } from "./prisma";
import { logger } from "./logger";
import { providerUsage, listRemoteAssets, destroyRemoteAsset } from "./media-provider";
import { PHOTO_FOLDER } from "./cloudinary";
import {
  DAY,
  UNREFERENCED_GRACE_MS,
  WARN_PERCENT,
  photoProtection,
  quotaView,
  receiptProtection,
  retention,
  type JobFacts,
} from "@/lib/media-policy";

import {
  MEDIA_CATEGORIES,
  MEDIA_TYPES,
  PROTECTED_DELETE_PHRASE,
  type MediaCategory,
  type MediaItem,
  type MediaQuotaView,
  type MediaSummary,
  type MediaType,
  type ProtectionLevel,
} from "@/lib/media";

/**
 * Media & Storage — what the ERP has uploaded, what protects it, and how it can be removed.
 *
 * Managed files: job evidence photos (Cloudinary) and expense receipts (database files).
 * HR documents are NOT listed here — they are personal records managed under HR.
 *
 * A file is only ever removed after the server re-checks its protection level at the moment
 * of deletion; the list the browser showed earlier proves nothing.
 */

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

const MAX_ROWS = 20000;

function photoType(format: string | null): MediaType {
  return format && /^(mp4|mov|webm|avi|mkv)$/i.test(format) ? "video" : "image";
}

export async function loadManagedItems(now = new Date()): Promise<MediaItem[]> {
  const days = retention();
  const photos = await prisma.jobPhoto.findMany({
    orderBy: { uploadedAt: "desc" },
    take: MAX_ROWS,
    select: { id: true, jobId: true, area: true, photoType: true, cloudinaryPublicId: true, photoUrl: true, thumbnailUrl: true, bytes: true, format: true, uploadedByName: true, uploadedAt: true, job: { select: { jobSerial: true, status: true, completedAt: true, updatedAt: true, customer: { select: { name: true } } } } },
  });
  const jobIds = Array.from(new Set(photos.map((p) => p.jobId)));
  const [complaints, unpaid] = await Promise.all([
    jobIds.length ? prisma.complaint.findMany({ where: { jobId: { in: jobIds }, status: { not: "resolved" } }, select: { jobId: true } }) : [],
    jobIds.length ? prisma.invoice.findMany({ where: { jobId: { in: jobIds }, status: { in: ["UNPAID", "PARTIAL"] } }, select: { jobId: true } }) : [],
  ]);
  const openComplaint = new Set(complaints.map((c) => c.jobId));
  const unpaidJob = new Set(unpaid.map((i) => i.jobId));

  const items: MediaItem[] = photos.map((p) => {
    const facts: JobFacts | null = p.job ? { status: p.job.status, finishedAt: p.job.completedAt ?? p.job.updatedAt, openComplaint: openComplaint.has(p.jobId), unpaidInvoice: unpaidJob.has(p.jobId) } : null;
    const prot = photoProtection(p.photoType, facts, now, days.evidenceDays);
    return {
      id: `jp:${p.id}`,
      kind: "JOB_PHOTO",
      category: p.photoType === "before" ? "BEFORE" : p.photoType === "after" ? "AFTER" : "QC",
      type: photoType(p.format),
      name: `${p.area} (${p.photoType})${p.format ? `.${p.format}` : ""}`,
      format: p.format,
      bytes: p.bytes,
      uploadedAt: p.uploadedAt.toISOString(),
      uploadedBy: p.uploadedByName,
      jobId: p.jobId,
      jobSerial: p.job?.jobSerial ?? null,
      customerName: p.job?.customer?.name ?? null,
      thumbnailUrl: `/api/photos/${p.id}/image?s=thumb`,
      url: `/api/photos/${p.id}/image`,
      referenced: !!p.job,
      references: p.job ? [`Job ${p.job.jobSerial} (${p.job.status.replace(/_/g, " ").toLowerCase()})`] : [],
      protection: prot,
    };
  });

  const files = await prisma.storedFile.findMany({
    where: { ownerType: "expense" },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedBy: true },
  });
  if (files.length) {
    const ids = files.map((f) => f.id);
    const [expenses, users] = await Promise.all([
      prisma.expense.findMany({ where: { receiptFileId: { in: ids } }, select: { receiptFileId: true, expenseNumber: true, approvalStatus: true, voidedAt: true, sourceType: true, date: true, jobId: true } }),
      prisma.user.findMany({ where: { id: { in: Array.from(new Set(files.map((f) => f.uploadedBy))) } }, select: { id: true, name: true } }),
    ]);
    const jobs = await prisma.job.findMany({ where: { id: { in: expenses.map((e) => e.jobId).filter((x): x is string => !!x) } }, select: { id: true, jobSerial: true, customer: { select: { name: true } } } });
    const byFile = new Map(expenses.map((e) => [e.receiptFileId as string, e]));
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const uname = new Map(users.map((u) => [u.id, u.name]));
    for (const f of files) {
      const e = byFile.get(f.id) ?? null;
      const j = e?.jobId ? jobById.get(e.jobId) : undefined;
      items.push({
        id: `rc:${f.id}`,
        kind: "EXPENSE_RECEIPT",
        category: "FINANCIAL_DOCUMENT",
        type: f.mimeType === "application/pdf" ? "document" : "image",
        name: f.fileName,
        format: f.mimeType.split("/")[1] ?? null,
        bytes: f.sizeBytes,
        uploadedAt: f.createdAt.toISOString(),
        uploadedBy: uname.get(f.uploadedBy) ?? null,
        jobId: e?.jobId ?? null,
        jobSerial: j?.jobSerial ?? null,
        customerName: j?.customer?.name ?? null,
        thumbnailUrl: null,
        url: `/api/files/${f.id}`,
        referenced: !!e,
        references: e ? [`Expense ${e.expenseNumber ?? ""}${e.voidedAt ? " (voided)" : ""}`.trim()] : [],
        protection: receiptProtection({ createdAt: f.createdAt }, e, now, days.financialDays),
      });
    }
  }
  return items;
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Summary & quota                                                            */
/* -------------------------------------------------------------------------- */

let usageCache: { at: number; value: Awaited<ReturnType<typeof providerUsage>> } | null = null;
export function resetUsageCache() {
  usageCache = null;
}
async function cachedUsage(fresh = false) {
  if (!fresh && usageCache && Date.now() - usageCache.at < 60_000) return usageCache.value;
  const value = await providerUsage();
  usageCache = { at: Date.now(), value };
  return value;
}

export async function mediaSummary(opts: { refreshProvider?: boolean } = {}): Promise<MediaSummary> {
  const items = await loadManagedItems();
  const usage = await cachedUsage(opts.refreshProvider);
  const byCategory = Object.fromEntries(MEDIA_CATEGORIES.map((c) => [c, { files: 0, bytes: 0 }])) as MediaSummary["managed"]["byCategory"];
  const byType = Object.fromEntries(MEDIA_TYPES.map((t) => [t, { files: 0, bytes: 0 }])) as MediaSummary["managed"]["byType"];
  let bytes = 0;
  for (const i of items) {
    const b = i.bytes ?? 0;
    bytes += b;
    byCategory[i.category].files++;
    byCategory[i.category].bytes += b;
    byType[i.type].files++;
    byType[i.type].bytes += b;
  }
  const configuredMb = Number(process.env.MEDIA_STORAGE_QUOTA_MB);
  const quota = quotaView({
    usedBytes: usage.usageBytes,
    providerLimit: usage.limitBytes,
    configuredLimit: configuredMb > 0 ? Math.round(configuredMb * 1024 * 1024) : null,
    estimateBytes: bytes,
    providerError: usage.error,
    warnPercent: WARN_PERCENT(),
  });

  const sum = (f: (i: MediaItem) => boolean) => items.filter(f).reduce((a, i) => ({ files: a.files + 1, bytes: a.bytes + (i.bytes ?? 0) }), { files: 0, bytes: 0 });
  const free = sum((i) => i.protection.level === "FREE");
  const confirm = sum((i) => i.protection.level === "CONFIRM");
  const unreferenced = sum((i) => !i.referenced);
  const recommendations: MediaSummary["recommendations"] = [];
  if (free.files) recommendations.push({ key: "free", title: "Files nothing depends on", detail: "Photos of cancelled jobs, receipts of voided or missing expenses — safe to review and remove.", ...free, filter: "protection=FREE" });
  if (confirm.files) recommendations.push({ key: "past-retention", title: "Past the retention period", detail: "Evidence and documents of closed records older than their retention period.", ...confirm, filter: "protection=CONFIRM" });
  if (unreferenced.files) recommendations.push({ key: "unreferenced", title: "Not referenced by any record", detail: "Uploaded but never attached to a job or expense.", ...unreferenced, filter: "referenced=no" });
  recommendations.push({ key: "cloud-scan", title: "Check the cloud for stray files", detail: "Finds files in cloud storage that the ERP has no record of (for example from an upload that failed halfway).", files: 0, bytes: 0, filter: "scan=cloud" });

  return {
    managed: { files: items.length, bytes, byCategory, byType },
    provider: { name: "Cloudinary", configured: usage.configured, usageBytes: usage.usageBytes, plan: usage.plan, error: usage.error, fetchedAt: usage.fetchedAt },
    estimateBytes: bytes,
    quota,
    largest: items.slice().sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 10),
    recommendations,
  };
}

/* -------------------------------------------------------------------------- */
/* Unreferenced scan                                                          */
/* -------------------------------------------------------------------------- */

export interface UnreferencedScan {
  items: MediaItem[];
  /** Photo records whose cloud file is gone (their links would show a broken image). */
  brokenReferences: MediaItem[];
  cloudChecked: boolean;
  truncated: boolean;
  error: string | null;
}

export async function scanUnreferenced(now = new Date()): Promise<UnreferencedScan> {
  const managed = await loadManagedItems(now);
  const items: MediaItem[] = managed.filter((i) => i.kind === "EXPENSE_RECEIPT" && !i.referenced && i.protection.level === "FREE");
  const remote = await listRemoteAssets();
  let brokenReferences: MediaItem[] = [];
  if (!remote.error) {
    const known = new Set((await prisma.jobPhoto.findMany({ select: { cloudinaryPublicId: true } })).map((p) => p.cloudinaryPublicId));
    for (const a of remote.assets) {
      const created = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      if (known.has(a.publicId) || now.getTime() - created < UNREFERENCED_GRACE_MS) continue;
      items.push({
        id: `cl:${a.publicId}`,
        kind: "CLOUD_ORPHAN",
        category: "OTHER",
        type: "image",
        name: a.publicId.split("/").pop() ?? a.publicId,
        format: a.format,
        bytes: a.bytes,
        uploadedAt: a.createdAt,
        uploadedBy: null,
        jobId: null,
        jobSerial: null,
        customerName: null,
        thumbnailUrl: a.url,
        url: a.url,
        referenced: false,
        references: [],
        protection: { level: "FREE", reasons: ["Cloud storage has this file but no job photo record refers to it."] },
      });
    }
    if (!remote.truncated) {
      const remoteIds = new Set(remote.assets.map((a) => a.publicId));
      const photos = await prisma.jobPhoto.findMany({ select: { id: true, cloudinaryPublicId: true } });
      const missing = new Set(photos.filter((p) => !remoteIds.has(p.cloudinaryPublicId)).map((p) => `jp:${p.id}`));
      brokenReferences = managed.filter((i) => missing.has(i.id));
    }
  }
  return { items, brokenReferences, cloudChecked: !remote.error && !!remote.assets, truncated: remote.truncated, error: remote.error };
}

/* -------------------------------------------------------------------------- */
/* Deleting                                                                   */
/* -------------------------------------------------------------------------- */

export interface DeleteOutcome {
  id: string;
  name: string;
  outcome: "DELETED" | "REFUSED" | "FAILED" | "NOT_FOUND";
  reason?: string;
  level?: ProtectionLevel;
}

export interface DeleteInput {
  ids: string[];
  /** Required for PROTECTED media: a written reason and the typed phrase. */
  override?: { reason: string; phrase: string } | null;
  actor: { id: string; name: string };
}

export async function deleteMedia(input: DeleteInput, now = new Date()): Promise<DeleteOutcome[]> {
  const results: DeleteOutcome[] = [];
  const overrideOk = !!input.override && input.override.reason.trim().length >= 10 && input.override.phrase === PROTECTED_DELETE_PHRASE;
  // Load once for the DB-backed kinds; cloud orphans are verified one by one.
  const managed = await loadManagedItems(now);
  const managedById = new Map(managed.map((i) => [i.id, i]));
  let scan: UnreferencedScan | null = null;

  for (const id of Array.from(new Set(input.ids)).slice(0, 100)) {
    let item = managedById.get(id) ?? null;
    if (!item && id.startsWith("cl:")) {
      if (!scan) scan = await scanUnreferenced(now);
      item = scan.items.find((i) => i.id === id) ?? null;
    }
    if (!item) {
      results.push({ id, name: id, outcome: "NOT_FOUND", reason: "That file no longer exists or is no longer unreferenced." });
      continue;
    }
    const { level: lvl, reasons } = item.protection;
    if (lvl === "LOCKED") {
      results.push({ id, name: item.name, outcome: "REFUSED", level: lvl, reason: reasons[0] });
      continue;
    }
    if (lvl === "PROTECTED" && !overrideOk) {
      results.push({ id, name: item.name, outcome: "REFUSED", level: lvl, reason: `${reasons[0]} Removing it needs a written reason and the confirmation phrase.` });
      continue;
    }
    try {
      const outcome = await removeOne(item, lvl === "PROTECTED", input);
      results.push(outcome.ok ? { id, name: item.name, outcome: "DELETED", level: lvl } : { id, name: item.name, outcome: "FAILED", level: lvl, reason: outcome.error });
    } catch (err) {
      logger.error("media.delete_failed", { id, error: err instanceof Error ? err.message : String(err) });
      results.push({ id, name: item.name, outcome: "FAILED", level: lvl, reason: "Couldn't remove it. Nothing was changed." });
    }
  }
  resetUsageCache();
  return results;
}

async function removeOne(item: MediaItem, wasProtected: boolean, input: DeleteInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const snapshot = {
    assetKind: item.kind,
    assetId: item.id.slice(3),
    category: item.category,
    fileName: item.name,
    mimeType: item.format,
    bytes: item.bytes,
    jobId: item.jobId,
    jobSerial: item.jobSerial,
    uploadedBy: item.uploadedBy,
    uploadedAt: item.uploadedAt ? new Date(item.uploadedAt) : null,
    protectedOverride: wasProtected,
    reason: wasProtected ? input.override?.reason.trim().slice(0, 500) : null,
    deletedBy: input.actor.id,
    deletedByName: input.actor.name,
  };

  if (item.kind === "JOB_PHOTO") {
    const photo = await prisma.jobPhoto.findUnique({ where: { id: snapshot.assetId } });
    if (!photo) return { ok: true };
    // The cloud file goes first. If the provider refuses, the record stays — never a record without its file, or a file nobody knows about.
    const remote = await destroyRemoteAsset(photo.cloudinaryPublicId);
    if (!remote.ok) return { ok: false, error: remote.error };
    await prisma.$transaction([
      // Anything that pointed at the photo must not be left pointing at nothing.
      prisma.jobChecklistItem.updateMany({ where: { jobId: photo.jobId, photoEvidence: { in: [photo.photoUrl, photo.id, photo.cloudinaryPublicId] } }, data: { photoEvidence: null } }),
      prisma.jobPhoto.delete({ where: { id: photo.id } }),
      prisma.mediaDeletion.create({ data: { ...snapshot, remoteDeleted: remote.found } }),
    ]);
    return { ok: true };
  }

  if (item.kind === "EXPENSE_RECEIPT") {
    await prisma.$transaction([
      prisma.expense.updateMany({ where: { receiptFileId: snapshot.assetId }, data: { receiptFileId: null } }),
      prisma.storedFile.delete({ where: { id: snapshot.assetId } }),
      prisma.mediaDeletion.create({ data: { ...snapshot, remoteDeleted: false } }),
    ]);
    return { ok: true };
  }

  // CLOUD_ORPHAN
  const publicId = item.id.slice(3);
  const remote = await destroyRemoteAsset(publicId);
  if (!remote.ok) return { ok: false, error: remote.error };
  await prisma.mediaDeletion.create({ data: { ...snapshot, assetId: publicId, remoteDeleted: remote.found } });
  return { ok: true };
}


export { filterItems, sortItems, quotaView, photoProtection, receiptProtection, retention, UNREFERENCED_GRACE_MS } from "@/lib/media-policy";
export type { MediaQuery } from "@/lib/media-policy";
