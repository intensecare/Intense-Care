import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { logger, maskPhone } from "../logger";
import { recordAudit } from "../audit";
import { nextLeadNumber } from "../leads";
import { bucket, messages as pushMessages, pushToUsers } from "../push";
import { OPEN_LEAD_STATUSES, phoneKey } from "@/lib/leads";
import { checkMedia, eventKey, nextStatus, optIntent, MEDIA_MAX_BYTES, type InboundMessage, type StatusUpdate, type WaEvent } from "@/lib/whatsapp";
import { accessToken, graph, graphBase } from "./config";

const SYSTEM = { id: null, name: "WhatsApp", role: "system" } as const;
const MAX_ATTEMPTS = 12;

/* ---------------------------------------------------------------------------------------- store */

/** Writes the events (once each) before any processing, so Meta can be answered immediately and nothing is lost. */
export async function storeEvents(events: WaEvent[]): Promise<{ stored: number; duplicates: number }> {
  let stored = 0, duplicates = 0;
  for (const e of events) {
    try {
      await prisma.whatsAppEvent.create({ data: { dedupeKey: eventKey(e), kind: e.kind, payload: JSON.parse(JSON.stringify(e)) as Prisma.InputJsonValue } });
      stored++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") duplicates++;
      else throw err;
    }
  }
  return { stored, duplicates };
}

/** Processes events that are waiting (new, or earlier attempts failed). Safe to run concurrently with itself. */
export async function processPending(limit = 50): Promise<{ done: number; failed: number }> {
  const rows = await prisma.whatsAppEvent.findMany({ where: { state: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS } }, orderBy: { receivedAt: "asc" }, take: limit });
  let done = 0, failed = 0;
  for (const row of rows) {
    // claim: only one worker advances a row
    const claimed = await prisma.whatsAppEvent.updateMany({ where: { id: row.id, state: { in: ["PENDING", "FAILED"] }, attempts: row.attempts }, data: { attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      const ev = reviveEvent(row.payload);
      const outcome = ev.kind === "MESSAGE" ? await processMessage(ev) : await processStatus(ev);
      await prisma.whatsAppEvent.update({ where: { id: row.id }, data: { state: outcome === "IGNORED" ? "IGNORED" : "DONE", processedAt: new Date(), lastError: null } });
      await prisma.whatsAppIntegration.updateMany({ where: { id: "singleton" }, data: { lastProcessedAt: new Date() } });
      done++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      const final = row.attempts + 1 >= MAX_ATTEMPTS;
      logger.warn("whatsapp.event.failed", { kind: row.kind, attempts: row.attempts + 1, error: msg.slice(0, 200) });
      await prisma.whatsAppEvent.update({ where: { id: row.id }, data: { state: final ? "FAILED" : "PENDING", lastError: msg.slice(0, 300) } });
    }
  }
  return { done, failed };
}

function reviveEvent(payload: unknown): WaEvent {
  const e = payload as WaEvent & { timestamp: string };
  return { ...e, timestamp: new Date(e.timestamp) } as WaEvent;
}

/* ---------------------------------------------------------------------------------------- messages */

const preview = (e: InboundMessage) => (e.text ?? `[${e.type}]`).replace(/\s+/g, " ").slice(0, 140);
const leadText = (e: InboundMessage) => (e.text ?? (e.mediaId ? `[${e.type}${e.filename ? `: ${e.filename}` : ""}]` : `[${e.type}]`)).slice(0, 1500);

async function processMessage(e: InboundMessage): Promise<"DONE" | "IGNORED"> {
  const wa = e.from;
  const key = phoneKey(`+${wa}`);
  const result = await prisma.$transaction(async (tx) => {
    // One conversation per phone number at a time: concurrent first messages cannot create two leads.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wa:" + key}))`;
    if (await tx.whatsAppMessage.findUnique({ where: { providerMessageId: e.id }, select: { id: true } })) return null; // already stored
    const contact = await tx.whatsAppContact.upsert({
      where: { waId: wa },
      create: { waId: wa, phoneKey: key, profileName: e.profileName },
      update: e.profileName ? { profileName: e.profileName } : {},
    });
    const open = await tx.lead.findMany({ where: { phoneKey: key, status: { in: OPEN_LEAD_STATUSES } }, orderBy: { createdAt: "desc" }, take: 1 });
    let lead = open[0] ?? null;
    let created = false;
    const text = leadText(e);
    if (!lead) {
      lead = await tx.lead.create({
        data: { leadNumber: await nextLeadNumber(tx), customerName: e.profileName || `WhatsApp ${wa.slice(-4)}`, phone: `+${wa}`, phoneKey: key, source: "WHATSAPP", status: "NEW", sourceDetails: "Incoming WhatsApp Business message", notes: text || null },
      });
      created = true;
    }
    await tx.leadActivity.create({ data: { leadId: lead.id, type: "WHATSAPP_MESSAGE", message: `WhatsApp: ${text}`.slice(0, 2000), externalId: `wa:${e.id}`, actorId: null, actorName: "WhatsApp" } });
    const hasMedia = !!e.mediaId;
    const msg = await tx.whatsAppMessage.create({
      data: {
        contactId: contact.id, leadId: lead.id, providerMessageId: e.id, direction: "IN", type: e.type, body: e.text, status: "RECEIVED", providerTimestamp: e.timestamp,
        mediaProviderId: e.mediaId, mediaMime: e.mediaMime, mediaFilename: e.filename, mediaStatus: hasMedia ? "PENDING" : "NONE",
      },
    });
    const intent = optIntent(e.type === "text" ? e.text : null);
    const newest = !contact.lastInboundAt || e.timestamp > contact.lastInboundAt;
    await tx.whatsAppContact.update({
      where: { id: contact.id },
      data: {
        leadId: lead.id, unreadCount: { increment: 1 },
        ...(newest ? { lastInboundAt: e.timestamp, lastMessageAt: e.timestamp, lastPreview: preview(e), lastDirection: "IN" } : {}),
        ...(intent === "OUT" ? { optedOut: true, optedOutAt: new Date(), marketingConsent: false } : intent === "IN" ? { optedOut: false, optedOutAt: null } : {}),
      },
    });
    if (intent) await tx.leadActivity.create({ data: { leadId: lead.id, type: "NOTE", message: intent === "OUT" ? "Customer opted out of WhatsApp messages." : "Customer opted back in to WhatsApp messages.", actorName: "WhatsApp" } });
    await tx.lead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } }); // only the timestamp: name, status and details are never overwritten
    return { contactId: contact.id, leadId: lead.id, assignedUserId: lead.assignedUserId, created, messageId: msg.id, hasMedia, intent };
  });
  if (!result) return "IGNORED";

  logger.info("whatsapp.message.stored", { phone: maskPhone(wa), type: e.type, newLead: result.created });
  if (result.intent) void recordAudit({ actor: SYSTEM, action: result.intent === "OUT" ? "WHATSAPP_OPT_OUT" : "WHATSAPP_OPT_IN", entityType: "lead", entityId: result.leadId, details: `Customer ${maskPhone(wa)} sent a ${result.intent === "OUT" ? "stop" : "start"} request` });
  if (result.created) void recordAudit({ actor: SYSTEM, action: "LEAD_CREATED_FROM_WHATSAPP", entityType: "lead", entityId: result.leadId, details: `Source WHATSAPP, message ${e.id}` });
  await notifyStaff(result);
  if (result.hasMedia) void downloadMedia(result.messageId).catch((err) => logger.warn("whatsapp.media.error", { error: err instanceof Error ? err.message : String(err) }));
  return "DONE";
}

/** Assigned admin, otherwise every active admin (the existing lead policy: leads belong to Admin users). */
async function notifyStaff(r: { contactId: string; leadId: string; assignedUserId: string | null; created: boolean }) {
  try {
    const targets = r.assignedUserId ? [r.assignedUserId] : (await prisma.user.findMany({ where: { role: "admin", active: true }, select: { id: true } })).map((u) => u.id);
    if (!targets.length) return;
    if (r.created) await pushToUsers(targets, pushMessages.newEnquiry(), (u) => `wa-lead:${r.leadId}:${u}`);
    else await pushToUsers(targets, pushMessages.whatsappMessage(r.contactId), (u) => `wa-chat:${r.contactId}:${u}:${bucket(5 * 60 * 1000)}`);
  } catch (err) {
    logger.warn("whatsapp.notify.failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/* ---------------------------------------------------------------------------------------- statuses */

async function processStatus(s: StatusUpdate): Promise<"DONE" | "IGNORED"> {
  const msg = await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: s.id } });
  if (!msg || msg.direction !== "OUT") throw new Error("status for a message we have not stored yet"); // retried; our own send may still be committing
  const status = nextStatus(msg.status, s.status);
  if (status === msg.status && s.status !== "FAILED") return "DONE";
  const at = s.timestamp;
  await prisma.whatsAppMessage.update({
    where: { id: msg.id },
    data: {
      status,
      ...(s.status === "SENT" ? { sentAt: msg.sentAt ?? at } : {}),
      ...(s.status === "DELIVERED" ? { deliveredAt: msg.deliveredAt ?? at, sentAt: msg.sentAt ?? at } : {}),
      ...(s.status === "READ" ? { readAt: msg.readAt ?? at, deliveredAt: msg.deliveredAt ?? at, sentAt: msg.sentAt ?? at } : {}),
      ...(s.status === "FAILED" && status === "FAILED" ? { failedAt: at, errorCode: s.errorCode, errorMessage: s.errorMessage } : {}),
    },
  });
  if (s.status === "FAILED" && status === "FAILED") logger.warn("whatsapp.message.failed", { code: s.errorCode });
  return "DONE";
}

/* ---------------------------------------------------------------------------------------- media */

/** Hosts a media download may use: Meta's CDNs, plus the configured Graph host (tests / proxies). The token goes nowhere else. */
function mediaHostAllowed(url: URL): boolean {
  if (url.protocol !== "https:" && url.host !== new URL(graphBase()).host) return false;
  if (url.host === new URL(graphBase()).host) return true;
  return /(^|\.)(fbcdn\.net|fbsbx\.com|facebook\.com|whatsapp\.net|whatsapp\.com)$/i.test(url.hostname);
}

/** Downloads a customer's attachment once, validates it and stores it. Transient trouble leaves it PENDING for the next retry. */
export async function downloadMedia(messageId: string): Promise<void> {
  const msg = await prisma.whatsAppMessage.findUnique({ where: { id: messageId } });
  if (!msg || !msg.mediaProviderId || msg.mediaStatus === "STORED" || msg.mediaStatus === "SKIPPED") return;
  const mark = (mediaStatus: string, mediaNote: string | null) => prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { mediaStatus, mediaNote, mediaAttempts: { increment: 1 } } });
  if (!accessToken()) { await mark("PENDING", "Access token not configured; will retry."); return; }
  const meta = await graph<{ url?: string; mime_type?: string; sha256?: string; file_size?: number }>(msg.mediaProviderId);
  if (!meta.ok || !meta.json?.url) {
    const retry = !meta.failure || meta.failure.retryable || meta.failure.kind === "TOKEN" || meta.status === 0;
    await mark(retry && msg.mediaAttempts < 5 ? "PENDING" : "FAILED", meta.failure?.message ?? "Media not available from WhatsApp.");
    return;
  }
  if (typeof meta.json.file_size === "number" && meta.json.file_size > MEDIA_MAX_BYTES) { await mark("SKIPPED", "File is larger than 16 MB and was not stored."); return; }
  let url: URL;
  try { url = new URL(meta.json.url); } catch { await mark("FAILED", "WhatsApp returned an invalid media address."); return; }
  if (!mediaHostAllowed(url)) { await mark("FAILED", "Media address is not a WhatsApp host; refused."); return; }
  let bytes: Uint8Array;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken()}` }, redirect: "error", signal: AbortSignal.timeout(30000), cache: "no-store" });
    if (!res.ok) { await mark(res.status >= 500 || res.status === 429 || res.status === 401 ? "PENDING" : "FAILED", `Download failed (${res.status}).`); return; }
    bytes = await readLimited(res, MEDIA_MAX_BYTES);
  } catch (err) {
    const tooBig = err instanceof Error && err.message === "TOO_BIG";
    await mark(tooBig ? "SKIPPED" : msg.mediaAttempts < 5 ? "PENDING" : "FAILED", tooBig ? "File is larger than 16 MB and was not stored." : "Download interrupted.");
    return;
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (meta.json.sha256 && meta.json.sha256.toLowerCase() !== sha) { await mark("FAILED", "Downloaded file did not match WhatsApp's checksum; discarded."); return; }
  const verdict = checkMedia(meta.json.mime_type ?? msg.mediaMime, bytes);
  if (!verdict.ok) { await mark("SKIPPED", verdict.reason); return; }
  await prisma.$transaction([
    prisma.whatsAppMedia.upsert({ where: { messageId: msg.id }, create: { messageId: msg.id, mime: verdict.mime, bytes: Buffer.from(bytes), size: bytes.length, sha256: sha }, update: {} }),
    prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { mediaStatus: "STORED", mediaMime: verdict.mime, mediaNote: null, mediaAttempts: { increment: 1 } } }),
  ]);
}

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new Error("TOO_BIG");
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => {}); throw new Error("TOO_BIG"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Maintenance: retry media that was still pending (transient failures) and drop long-finished events. */
export async function retryMedia(limit = 20): Promise<number> {
  const rows = await prisma.whatsAppMessage.findMany({ where: { mediaStatus: "PENDING", mediaAttempts: { lt: 5 } }, select: { id: true }, take: limit, orderBy: { createdAt: "asc" } });
  for (const r of rows) await downloadMedia(r.id).catch(() => {});
  return rows.length;
}
export async function purgeOldEvents(days = 30): Promise<number> {
  return (await prisma.whatsAppEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - days * 86400e3) }, state: { in: ["DONE", "IGNORED"] } } })).count;
}
