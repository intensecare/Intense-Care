import { createHash } from "node:crypto";
import { Prisma, type MobileDevice, type PhoneContact } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { getSystemSettings } from "./settings";
import { createLead, addActivity, actorOf } from "./leads";
import { prepareContact, type Prepared } from "@/lib/contact-clean";
import { OPEN_LEAD_STATUSES } from "@/lib/leads";
import {
  SYNC_LIMITS,
  SYNC_TRIGGERS,
  type ContactSyncStatus,
  type RecordFailureCode,
  type SyncBatchResult,
} from "@/lib/contacts";
import type { SessionUser } from "./session";

/**
 * Contact synchronisation — the server side.
 *
 * Rules this file enforces:
 *  - A device contact id maps to exactly one PhoneContact row (deviceRowId + deviceContactId), so
 *    syncing again UPDATES it; it never creates a second row, customer or lead.
 *  - Contacts are matched to customers and leads by normalised phone number — never by name.
 *    One person may have many numbers, one number may belong to many contacts: nothing is merged.
 *  - A contact removed from the phone is marked REMOVED. No customer or lead is ever deleted by sync.
 *  - A bad record fails alone (reported by device id only); the rest of the batch still saves.
 *  - Batches are idempotent: replaying one returns its stored result without touching the data.
 *  - Logs and run records carry counts and codes, never names or numbers.
 */

const BatchEnvelope = z.object({
  runId: z.string().min(8).max(64),
  trigger: z.enum(SYNC_TRIGGERS),
  batchIndex: z.number().int().min(0).max(100000),
  batchCount: z.number().int().min(1).max(100000),
  idempotencyKey: z.string().min(8).max(128),
  scannedTotal: z.number().int().min(0).max(500000),
  contacts: z.array(z.unknown()).max(SYNC_LIMITS.maxContactsPerBatch),
  removedIds: z.array(z.string().min(1).max(128)).max(SYNC_LIMITS.maxRemovedPerBatch).default([]),
  failedLocal: z.number().int().min(0).max(500000).optional(),
  final: z.boolean(),
});

export class SyncPausedError extends Error {}
export class SyncRequestError extends Error {
  status = 400;
}

/* -------------------------------------------------------------------------- */
/* Matching against the ERP                                                   */
/* -------------------------------------------------------------------------- */

/** Customer ids per phone key (last 10 digits). */
async function customersByKey(keys: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!keys.length) return out;
  const rows = await prisma.$queryRaw<{ id: string; k: string }[]>`
    SELECT id, right(regexp_replace(phone, '\\D', '', 'g'), 10) AS k
    FROM "Customer"
    WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = ANY(${keys}::text[]) AND status <> 'inactive'`;
  for (const r of rows) out.set(r.k, [...(out.get(r.k) ?? []), r.id]);
  return out;
}

/** Sets PhoneContact.customerId = the ONE customer sharing a number with the contact (null when none or several). */
export async function relinkCustomers(contactIds: string[]) {
  if (!contactIds.length) return;
  await prisma.$executeRaw`
    UPDATE "PhoneContact" pc SET "customerId" = m.cid
    FROM (
      SELECT n."contactId" AS id, CASE WHEN count(DISTINCT c.id) = 1 THEN min(c.id) END AS cid
      FROM "PhoneContactNumber" n
      JOIN "Customer" c ON right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = n."phoneKey" AND c.status <> 'inactive'
      WHERE n."contactId" = ANY(${contactIds}::text[])
      GROUP BY n."contactId"
    ) m
    WHERE pc.id = m.id AND pc."customerId" IS DISTINCT FROM m.cid`;
  await prisma.$executeRaw`
    UPDATE "PhoneContact" pc SET "customerId" = NULL
    WHERE pc.id = ANY(${contactIds}::text[]) AND pc."customerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "PhoneContactNumber" n JOIN "Customer" c ON right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = n."phoneKey" AND c.status <> 'inactive'
        WHERE n."contactId" = pc.id)`;
}

async function openLeadsByKey(keys: string[]) {
  const out = new Map<string, { id: string; leadNumber: string }>();
  if (!keys.length) return out;
  const rows = await prisma.lead.findMany({
    where: { phoneKey: { in: keys }, status: { in: OPEN_LEAD_STATUSES } },
    select: { id: true, leadNumber: true, phoneKey: true },
    orderBy: { createdAt: "desc" },
  });
  for (const r of rows) if (!out.has(r.phoneKey)) out.set(r.phoneKey, { id: r.id, leadNumber: r.leadNumber });
  return out;
}

/* -------------------------------------------------------------------------- */
/* Lead import                                                                */
/* -------------------------------------------------------------------------- */

export type LeadImportOutcome =
  | { state: "CREATED"; leadId: string; leadNumber: string }
  | { state: "LINKED"; leadId: string; leadNumber: string }
  | { state: "ALREADY_IMPORTED"; leadId: string }
  | { state: "ALREADY_CUSTOMER"; customerIds: string[] };

/**
 * Turns a contact into a PHONE_CONTACT lead — once. An existing customer is never turned into a lead
 * (and never duplicated); an open lead with the same number is linked instead of copied.
 */
export async function importContactAsLead(contactId: string, actor: { id: string; name: string }, via: string): Promise<LeadImportOutcome> {
  const contact = await prisma.phoneContact.findUnique({ where: { id: contactId }, include: { numbers: true } });
  if (!contact) throw new SyncRequestError("Contact not found.");
  if (contact.leadId) return { state: "ALREADY_IMPORTED", leadId: contact.leadId };
  const keys = contact.numbers.map((n) => n.phoneKey);
  const customers = await customersByKey(keys);
  const customerIds = Array.from(new Set(Array.from(customers.values()).flat()));
  if (customerIds.length) return { state: "ALREADY_CUSTOMER", customerIds };
  const open = await openLeadsByKey(keys);
  const existing = keys.map((k) => open.get(k)).find(Boolean);
  if (existing) {
    await prisma.phoneContact.update({ where: { id: contact.id }, data: { leadId: existing.id, importState: "LEAD" } });
    await addActivity(existing.id, { type: "UPDATED", message: `Linked to a phone contact (${via})`, ...actorOf(actor) });
    return { state: "LINKED", leadId: existing.id, leadNumber: existing.leadNumber };
  }
  const primary = contact.numbers[0];
  const device = await prisma.mobileDevice.findUnique({ where: { id: contact.deviceRowId }, select: { label: true } });
  const lead = await createLead(
    {
      customerName: contact.displayName || primary.e164,
      phone: primary.e164,
      email: contact.emails[0] ?? null,
      source: "PHONE_CONTACT",
      sourceDetails: `Phone contact${device?.label ? ` on ${device.label}` : ""} — ${via}`,
      status: "NEW",
    },
    actorOf(actor),
    { type: "CREATED", message: `Lead created from a phone contact (${via}). Source: Phone contact — qualify it before contacting.` }
  );
  await prisma.phoneContact.update({ where: { id: contact.id }, data: { leadId: lead.id, importState: "LEAD" } });
  return { state: "CREATED", leadId: lead.id, leadNumber: lead.leadNumber };
}

/* -------------------------------------------------------------------------- */
/* Batch processing                                                           */
/* -------------------------------------------------------------------------- */

const AUTO_LEAD_CAP_PER_BATCH = 25;

export async function processSyncBatch(device: MobileDevice, user: SessionUser, body: unknown): Promise<SyncBatchResult> {
  if (device.syncPaused) throw new SyncPausedError();
  const parsed = BatchEnvelope.safeParse(body);
  if (!parsed.success) throw new SyncRequestError(parsed.error.issues[0]?.message ? `Invalid sync batch: ${parsed.error.issues[0].path.join(".")} ${parsed.error.issues[0].message}` : "Invalid sync batch.");
  const b = parsed.data;

  // 1. Replay: the same batch twice must not change anything.
  const done = await prisma.contactSyncBatch.findUnique({ where: { deviceRowId_idempotencyKey: { deviceRowId: device.id, idempotencyKey: b.idempotencyKey } } });
  if (done) return { ...(done.result as unknown as SyncBatchResult), replayed: true };

  const settings = (await getSystemSettings()).contactSync;
  const run = await prisma.contactSyncRun.upsert({
    where: { deviceRowId_clientRunId: { deviceRowId: device.id, clientRunId: b.runId } },
    create: { deviceRowId: device.id, ownerUserId: user.id, clientRunId: b.runId, trigger: b.trigger },
    update: {},
  });

  const result: SyncBatchResult = { ok: true, replayed: false, runId: run.id, added: 0, updated: 0, unchanged: 0, removed: 0, skipped: 0, duplicates: 0, failed: [], paused: false, nextBatchAllowed: true };

  // 2. Clean every record on its own so one bad contact can't fail the rest.
  const prepared: Prepared[] = [];
  const skippedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const raw of b.contacts) {
    const r = prepareContact(raw);
    if (!r.ok) {
      if (r.code === "SKIP") {
        result.skipped++;
        if (r.id) skippedIds.push(r.id);
      } else result.failed.push({ id: r.id ?? "?", code: r.code });
      continue;
    }
    if (seenIds.has(r.contact.id)) continue; // the same contact twice in one batch
    seenIds.add(r.contact.id);
    prepared.push(r.contact);
  }

  const existing = await prisma.phoneContact.findMany({
    where: { deviceRowId: device.id, deviceContactId: { in: [...prepared.map((p) => p.id), ...skippedIds] } },
    include: { numbers: { select: { phoneKey: true } } },
  });
  const byDeviceId = new Map(existing.map((e) => [e.deviceContactId, e]));

  const changed = prepared.filter((p) => {
    const e = byDeviceId.get(p.id);
    return !e || e.contentHash !== p.hash || e.status !== "ACTIVE";
  });
  const keys = Array.from(new Set(changed.flatMap((p) => p.numbers.map((n) => n.key))));
  const customers = await customersByKey(keys);
  const openLeads = await openLeadsByKey(keys);
  const autoLeads = settings.leadPolicy === "AUTO_NEW_CONTACTS" && settings.autoLeadApprovedAt && b.trigger !== "INITIAL";
  const approvedAt = settings.autoLeadApprovedAt ? new Date(settings.autoLeadApprovedAt) : null;
  let autoCreated = 0;
  const touched: string[] = [];
  const now = new Date();

  for (const p of prepared) {
    const e = byDeviceId.get(p.id);
    try {
      if (e && e.contentHash === p.hash && e.status === "ACTIVE") {
        result.unchanged++;
        continue;
      }
      const numbersCreate = p.numbers.map((n) => ({ e164: n.e164, phoneKey: n.key }));
      if (!e) {
        const row = await prisma.phoneContact.create({
          data: {
            deviceRowId: device.id,
            ownerUserId: user.id,
            deviceContactId: p.id,
            displayName: p.name,
            emails: p.emails,
            contentHash: p.hash,
            deviceUpdatedAt: p.updatedAt,
            firstSyncedAt: now,
            lastSyncedAt: now,
            numbers: { create: numbersCreate },
          },
        });
        result.added++;
        touched.push(row.id);
        // Automatic leads only for contacts that appeared AFTER approval, from incremental syncs,
        // that are not already a customer or an open lead.
        const hasCustomer = p.numbers.some((n) => customers.has(n.key));
        const openLead = p.numbers.map((n) => openLeads.get(n.key)).find(Boolean);
        if (openLead) await prisma.phoneContact.update({ where: { id: row.id }, data: { leadId: openLead.id, importState: "LEAD" } });
        else if (autoLeads && approvedAt && row.firstSyncedAt >= approvedAt && !hasCustomer && autoCreated < AUTO_LEAD_CAP_PER_BATCH) {
          const out = await importContactAsLead(row.id, { id: user.id, name: `${user.name} (auto)` }, "automatic, approved by " + (settings.autoLeadApprovedBy ?? "Admin"));
          if (out.state === "CREATED") autoCreated++;
        }
      } else {
        await prisma.$transaction([
          prisma.phoneContactNumber.deleteMany({ where: { contactId: e.id } }),
          prisma.phoneContact.update({
            where: { id: e.id },
            data: {
              displayName: p.name,
              emails: p.emails,
              contentHash: p.hash,
              deviceUpdatedAt: p.updatedAt,
              status: "ACTIVE",
              removedAt: null,
              dupDismissedAt: null,
              lastSyncedAt: now,
              numbers: { create: numbersCreate },
            },
          }),
        ]);
        result.updated++;
        touched.push(e.id);
      }
    } catch (err) {
      // Only the code goes into the result and the log — never the contact's data.
      logger.warn("contact_sync.record_failed", { deviceId: device.id, error: err instanceof Prisma.PrismaClientKnownRequestError ? err.code : "UNKNOWN" });
      result.failed.push({ id: p.id, code: "SAVE_FAILED" });
    }
  }

  // Unchanged contacts still prove they were seen in this run.
  const unchangedIds = prepared.filter((p) => { const e = byDeviceId.get(p.id); return e && e.contentHash === p.hash && e.status === "ACTIVE"; }).map((p) => byDeviceId.get(p.id)!.id);
  if (unchangedIds.length) await prisma.phoneContact.updateMany({ where: { id: { in: unchangedIds } }, data: { lastSyncedAt: now } });

  // A contact that lost its last number is no longer useful: treat it as removed from the directory.
  const lostNumbers = skippedIds.map((id) => byDeviceId.get(id)).filter((e): e is NonNullable<typeof e> => !!e && e.status === "ACTIVE");
  const removeNow = [...b.removedIds, ...lostNumbers.map((e) => e.deviceContactId)];
  if (removeNow.length) {
    const r = await prisma.phoneContact.updateMany({ where: { deviceRowId: device.id, deviceContactId: { in: removeNow }, status: "ACTIVE" }, data: { status: "REMOVED", removedAt: now } });
    result.removed = r.count;
  }

  await relinkCustomers(touched);

  // Contacts of THIS phone that share a number with another active contact of this phone.
  if (touched.length) {
    const dup = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT n."contactId") AS n
      FROM "PhoneContactNumber" n
      JOIN "PhoneContact" c ON c.id = n."contactId" AND c.status = 'ACTIVE' AND c."deviceRowId" = ${device.id}
      WHERE n."contactId" = ANY(${touched}::text[])
        AND EXISTS (
          SELECT 1 FROM "PhoneContactNumber" n2 JOIN "PhoneContact" c2 ON c2.id = n2."contactId" AND c2.status = 'ACTIVE' AND c2."deviceRowId" = ${device.id}
          WHERE n2."phoneKey" = n."phoneKey" AND n2."contactId" <> n."contactId")`;
    result.duplicates = Number(dup[0]?.n ?? 0);
  }

  // 3. Run totals (increments, so the batches of one run add up) and, on the last batch, the verdict.
  const counts = { added: result.added, updated: result.updated, unchanged: result.unchanged, removed: result.removed, skipped: result.skipped, failed: result.failed.length + (b.final ? b.failedLocal ?? 0 : 0), duplicates: result.duplicates };
  const updatedRun = await prisma.contactSyncRun.update({
    where: { id: run.id },
    data: {
      added: { increment: counts.added },
      updated: { increment: counts.updated },
      unchanged: { increment: counts.unchanged },
      removed: { increment: counts.removed },
      skipped: { increment: counts.skipped },
      failed: { increment: counts.failed },
      duplicates: { set: Math.max(run.duplicates, counts.duplicates) },
      scanned: b.scannedTotal,
    },
  });
  if (b.final) {
    await prisma.contactSyncRun.update({
      where: { id: run.id },
      data: { status: updatedRun.failed > 0 ? "PARTIAL" : "COMPLETED", finishedAt: new Date() },
    });
  }

  await prisma.contactSyncBatch.create({ data: { deviceRowId: device.id, idempotencyKey: b.idempotencyKey, result: result as unknown as Prisma.InputJsonValue } }).catch(() => {
    // A concurrent identical batch stored it first — that's fine.
  });
  logger.info("contact_sync.batch", { deviceId: device.id, run: b.batchIndex + 1 + "/" + b.batchCount, added: result.added, updated: result.updated, removed: result.removed, failed: result.failed.length });
  return result;
}

/** The phone reports a run that failed before or between batches (permission lost, read error, no network after retries). */
export async function recordRunFailure(device: MobileDevice, user: SessionUser, input: { runId: string; trigger: string; errorCode: string; scanned?: number }) {
  const code = input.errorCode.replace(/[^A-Z_]/g, "").slice(0, 40) || "UNKNOWN";
  const trigger = (SYNC_TRIGGERS as readonly string[]).includes(input.trigger) ? input.trigger : "SCHEDULED";
  await prisma.contactSyncRun.upsert({
    where: { deviceRowId_clientRunId: { deviceRowId: device.id, clientRunId: input.runId.slice(0, 64) } },
    create: { deviceRowId: device.id, ownerUserId: user.id, clientRunId: input.runId.slice(0, 64), trigger, status: "FAILED", errorCode: code, scanned: input.scanned ?? 0, finishedAt: new Date() },
    update: { status: "FAILED", errorCode: code, finishedAt: new Date() },
  });
}

/* -------------------------------------------------------------------------- */
/* Status, duplicates, retention                                              */
/* -------------------------------------------------------------------------- */

export async function duplicateCount(deviceRowId?: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT n."contactId") AS n
    FROM "PhoneContactNumber" n
    JOIN "PhoneContact" c ON c.id = n."contactId" AND c.status = 'ACTIVE' AND c."dupDismissedAt" IS NULL
    WHERE (${deviceRowId ?? null}::text IS NULL OR c."deviceRowId" = ${deviceRowId ?? null})
      AND EXISTS (
        SELECT 1 FROM "PhoneContactNumber" n2 JOIN "PhoneContact" c2 ON c2.id = n2."contactId" AND c2.status = 'ACTIVE'
        WHERE n2."phoneKey" = n."phoneKey" AND n2."contactId" <> n."contactId" AND c2."deviceRowId" = c."deviceRowId")`;
  return Number(rows[0]?.n ?? 0);
}

export async function syncStatus(device: MobileDevice | null): Promise<ContactSyncStatus> {
  const settings = (await getSystemSettings()).contactSync;
  if (!device) {
    return { connected: false, paused: false, deviceLabel: null, lastRun: null, lastSuccessAt: null, activeContacts: 0, removedContacts: 0, potentialDuplicates: 0, policy: settings };
  }
  const [last, ok, active, removed, dups] = await Promise.all([
    prisma.contactSyncRun.findFirst({ where: { deviceRowId: device.id }, orderBy: { startedAt: "desc" } }),
    prisma.contactSyncRun.findFirst({ where: { deviceRowId: device.id, status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { finishedAt: "desc" } }),
    prisma.phoneContact.count({ where: { deviceRowId: device.id, status: "ACTIVE" } }),
    prisma.phoneContact.count({ where: { deviceRowId: device.id, status: "REMOVED" } }),
    duplicateCount(device.id),
  ]);
  return {
    connected: !device.revokedAt && !!device.syncTokenHash,
    paused: device.syncPaused,
    deviceLabel: device.label,
    lastRun: last
      ? { id: last.id, trigger: last.trigger, status: last.status, startedAt: last.startedAt.toISOString(), finishedAt: last.finishedAt?.toISOString() ?? null, scanned: last.scanned, added: last.added, updated: last.updated, unchanged: last.unchanged, removed: last.removed, skipped: last.skipped, failed: last.failed, duplicates: last.duplicates, errorCode: last.errorCode }
      : null,
    lastSuccessAt: ok?.finishedAt?.toISOString() ?? null,
    activeContacts: active,
    removedContacts: removed,
    potentialDuplicates: dups,
    policy: settings,
  };
}

/** Deletes contacts of a phone (disconnect with "delete synced contacts", or the retention purge). Customers and leads stay. */
export async function deleteDeviceContacts(deviceRowId: string): Promise<number> {
  const r = await prisma.phoneContact.deleteMany({ where: { deviceRowId } });
  return r.count;
}

/** Retention: contacts removed from the phone more than N days ago are deleted; old batch / run records are trimmed. */
export async function purgeExpiredContacts(): Promise<{ contacts: number; batches: number; runs: number }> {
  const { removedRetentionDays } = (await getSystemSettings()).contactSync;
  const cutoff = new Date(Date.now() - removedRetentionDays * 86400000);
  const [c, b, r] = await Promise.all([
    prisma.phoneContact.deleteMany({ where: { status: "REMOVED", removedAt: { lt: cutoff } } }),
    prisma.contactSyncBatch.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 14 * 86400000) } } }),
    prisma.contactSyncRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - 180 * 86400000) } } }),
  ]);
  return { contacts: c.count, batches: b.count, runs: r.count };
}

export type { PhoneContact };
