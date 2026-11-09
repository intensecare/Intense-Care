import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { maskPhone } from "../logger";
import { HttpError } from "../authz";
import { recordAudit } from "../audit";
import type { SessionUser } from "../session";
import { canSendTemplate, canSendText, windowClosesAt, type ApiFailure } from "@/lib/whatsapp";
import { graph, resolvedIds, sendReady } from "./config";

/**
 * Outgoing WhatsApp through the official Cloud API.
 *
 *  - A message row is written FIRST (PENDING) and keyed by `clientRequestId`, so a double-click or a retry of the
 *    same request is one message, never two.
 *  - When Meta accepts the request the row becomes ACCEPTED — which only means "handed to WhatsApp". It moves to
 *    SENT / DELIVERED / READ / FAILED only when Meta's status webhooks say so (see ingest.ts).
 *  - Free text only inside the 24-hour window; otherwise an approved template. Opted-out customers get nothing.
 */

const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").replace(/ {4,}/g, "   ").trim();

export class SendError extends HttpError {
  constructor(status: number, message: string, readonly code: string, readonly retryAfterSec: number | null = null) {
    super(status, message);
  }
}

const statusFor = (f: ApiFailure) => (f.kind === "RATE_LIMIT" ? 429 : f.kind === "TOKEN" || f.kind === "NUMBER" ? 503 : f.kind === "TRANSIENT" ? 502 : 422);

interface Common {
  contactId: string;
  clientRequestId: string;
  actor: Pick<SessionUser, "id" | "name" | "role">;
  request?: Request | null;
}

async function loadContact(contactId: string) {
  const c = await prisma.whatsAppContact.findUnique({ where: { id: contactId } });
  if (!c) throw new HttpError(404, "Conversation not found.");
  return c;
}

/** Creates the PENDING row; a repeated clientRequestId returns the message that already exists. */
async function reserve(c: Common, lead: string | null, data: { type: string; body: string; templateName?: string }) {
  try {
    return { row: await prisma.whatsAppMessage.create({ data: { contactId: c.contactId, leadId: lead, direction: "OUT", type: data.type, body: data.body, templateName: data.templateName ?? null, status: "PENDING", clientRequestId: c.clientRequestId, sentBy: c.actor.id } }), duplicate: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await prisma.whatsAppMessage.findUnique({ where: { clientRequestId: c.clientRequestId } });
      if (row && row.contactId === c.contactId) return { row, duplicate: true };
    }
    throw e;
  }
}

async function dispatch(rowId: string, payload: Record<string, unknown>, c: Common, lead: string | null, summary: string) {
  const ids = await resolvedIds();
  const r = await graph<{ messages?: { id?: string }[] }>(`${ids.phoneNumberId}/messages`, { method: "POST", body: payload });
  if (!r.ok) {
    const f = r.failure!;
    await prisma.whatsAppMessage.update({ where: { id: rowId }, data: { status: "FAILED", failedAt: new Date(), errorCode: f.code, errorMessage: f.message.slice(0, 300) } });
    void recordAudit({ actor: c.actor, action: "WHATSAPP_SEND_FAILED", entityType: lead ? "lead" : "whatsapp", entityId: lead ?? c.contactId, details: `${f.kind} ${f.code}` , request: c.request });
    throw new SendError(statusFor(f), f.message, f.kind === "WINDOW" ? "WINDOW_CLOSED" : f.kind, r.retryAfterSec);
  }
  const wamid = r.json?.messages?.[0]?.id;
  if (!wamid) {
    await prisma.whatsAppMessage.update({ where: { id: rowId }, data: { status: "FAILED", failedAt: new Date(), errorMessage: "WhatsApp answered without a message id." } });
    throw new SendError(502, "WhatsApp answered without a message id; treat the message as not sent.", "NO_MESSAGE_ID");
  }
  // The status webhook can beat us here: only a still-PENDING row becomes ACCEPTED, and the id is stored either way.
  await prisma.$transaction([
    prisma.whatsAppMessage.update({ where: { id: rowId }, data: { providerMessageId: wamid } }),
    prisma.whatsAppMessage.updateMany({ where: { id: rowId, status: "PENDING" }, data: { status: "ACCEPTED" } }),
    prisma.whatsAppContact.update({ where: { id: c.contactId }, data: { lastMessageAt: new Date(), lastPreview: summary.slice(0, 140), lastDirection: "OUT", unreadCount: 0 } }),
    ...(lead
      ? [
          prisma.leadActivity.create({ data: { leadId: lead, type: "WHATSAPP_MESSAGE", message: `WhatsApp (sent): ${summary}`.slice(0, 2000), externalId: `wa:${wamid}`, actorId: c.actor.id, actorName: c.actor.name } }),
          prisma.lead.update({ where: { id: lead }, data: { lastContactedAt: new Date() } }),
        ]
      : []),
  ]);
  void recordAudit({ actor: c.actor, action: "WHATSAPP_MESSAGE_SENT", entityType: lead ? "lead" : "whatsapp", entityId: lead ?? c.contactId, details: `to ${maskPhone((await prisma.whatsAppContact.findUnique({ where: { id: c.contactId }, select: { waId: true } }))?.waId ?? "")}`, request: c.request });
  return prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: rowId } });
}

export async function sendText(c: Common & { text: string }) {
  const text = c.text.trim();
  if (!text) throw new HttpError(400, "Write a message first.");
  if (text.length > 4096) throw new HttpError(400, "A WhatsApp message can be at most 4096 characters.");
  const contact = await loadContact(c.contactId);
  const block = canSendText({ configured: await sendReady(), optedOut: contact.optedOut, lastInboundAt: contact.lastInboundAt, marketingConsent: contact.marketingConsent });
  if (block) throw new SendError(block.code === "NOT_CONFIGURED" ? 503 : 422, block.message, block.code);
  const { row, duplicate } = await reserve(c, contact.leadId, { type: "text", body: text });
  if (duplicate) return { message: row, duplicate: true };
  const message = await dispatch(row.id, { messaging_product: "whatsapp", recipient_type: "individual", to: contact.waId, type: "text", text: { body: text, preview_url: false } }, c, contact.leadId, text);
  return { message, duplicate: false };
}

export async function sendTemplate(c: Common & { templateId: string; params: string[] }) {
  const tpl = await prisma.whatsAppTemplate.findUnique({ where: { id: c.templateId } });
  if (!tpl) throw new HttpError(404, "Template not found.");
  const contact = await loadContact(c.contactId);
  const block = canSendTemplate({ configured: await sendReady(), optedOut: contact.optedOut, lastInboundAt: contact.lastInboundAt, marketingConsent: contact.marketingConsent }, tpl);
  if (block) throw new SendError(block.code === "NOT_CONFIGURED" ? 503 : 422, block.message, block.code);
  const params = c.params.map((p) => clean(String(p))).slice(0, 20);
  if (params.length !== tpl.paramCount || params.some((p) => !p)) throw new HttpError(400, `This template needs ${tpl.paramCount} value${tpl.paramCount === 1 ? "" : "s"}, all filled in.`);
  const summary = (tpl.bodyPreview ?? `[template ${tpl.name}]`).replace(/\{\{(\d+)\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? "");
  const { row, duplicate } = await reserve(c, contact.leadId, { type: "template", body: summary, templateName: tpl.name });
  if (duplicate) return { message: row, duplicate: true };
  const payload = {
    messaging_product: "whatsapp", recipient_type: "individual", to: contact.waId, type: "template",
    template: { name: tpl.name, language: { code: tpl.language }, ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}) },
  };
  const message = await dispatch(row.id, payload, c, contact.leadId, summary);
  return { message, duplicate: false };
}

/** Customer-facing automatic messages (job updates). Honours opt-outs; the outcome is a real, trackable message row. */
export async function sendAutomatic(phone: string, body: string, templateName: string | null, language: string): Promise<{ queued: boolean; reason?: string }> {
  if (!(await sendReady())) return { queued: false, reason: "provider_not_configured" };
  const waId = phone.replace(/\D/g, "");
  if (waId.length < 8) return { queued: false, reason: "no_phone" };
  const contact = await prisma.whatsAppContact.upsert({ where: { waId }, create: { waId, phoneKey: waId.slice(-10) }, update: {} });
  if (contact.optedOut) return { queued: false, reason: "opted_out" };
  const row = await prisma.whatsAppMessage.create({ data: { contactId: contact.id, leadId: contact.leadId, direction: "OUT", type: templateName ? "template" : "text", body: body.slice(0, 1500), templateName, status: "PENDING" } });
  const ids = await resolvedIds();
  const payload = templateName
    ? { messaging_product: "whatsapp", recipient_type: "individual", to: waId, type: "template", template: { name: templateName, language: { code: language }, components: [{ type: "body", parameters: [{ type: "text", text: clean(body).slice(0, 1000) }] }] } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to: waId, type: "text", text: { body, preview_url: false } };
  const r = await graph<{ messages?: { id?: string }[] }>(`${ids.phoneNumberId}/messages`, { method: "POST", body: payload });
  const wamid = r.json?.messages?.[0]?.id;
  if (!r.ok || !wamid) {
    await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: "FAILED", failedAt: new Date(), errorCode: r.failure?.code ?? null, errorMessage: (r.failure?.message ?? "No message id").slice(0, 300) } });
    return { queued: false, reason: "send_failed" };
  }
  await prisma.$transaction([
    prisma.whatsAppMessage.update({ where: { id: row.id }, data: { providerMessageId: wamid } }),
    prisma.whatsAppMessage.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "ACCEPTED" } }),
  ]);
  return { queued: true };
}

/* ---------------------------------------------------------------------------------------- templates */

interface MetaTemplate { name?: string; language?: string; category?: string; status?: string; components?: { type?: string; text?: string }[] }

/** Pulls the business account's templates from Meta (needs the WABA ID). Rows Meta no longer lists are switched off, not deleted. */
export async function syncTemplates(): Promise<{ synced: number; deactivated: number }> {
  const { wabaId } = await resolvedIds();
  if (!wabaId) throw new HttpError(400, "Enter the WhatsApp Business Account ID first.");
  let after: string | null = null;
  const seen: string[] = [];
  let synced = 0;
  for (let page = 0; page < 10; page++) {
    const r: Awaited<ReturnType<typeof graph<{ data?: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>>> = await graph(`${wabaId}/message_templates`, { query: { limit: "100", fields: "name,language,category,status,components", ...(after ? { after } : {}) } });
    if (!r.ok) throw new SendError(r.failure ? statusFor(r.failure) : 502, r.failure?.message ?? "Could not read templates from WhatsApp.", r.failure?.kind ?? "OTHER");
    for (const t of r.json?.data ?? []) {
      if (!t.name || !t.language) continue;
      const body = t.components?.find((x) => x.type === "BODY")?.text ?? null;
      const paramCount = body ? new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1])).size : 0;
      const category = ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(t.category ?? "") ? (t.category as string) : "MARKETING";
      const row = await prisma.whatsAppTemplate.upsert({ where: { name_language: { name: t.name, language: t.language } }, create: { name: t.name, language: t.language, category, status: t.status ?? "PENDING", bodyPreview: body, paramCount, syncedAt: new Date() }, update: { category, status: t.status ?? "PENDING", bodyPreview: body, paramCount, syncedAt: new Date() } });
      seen.push(row.id);
      synced++;
    }
    after = r.json?.paging?.next ? r.json?.paging?.cursors?.after ?? null : null;
    if (!after) break;
  }
  const off = await prisma.whatsAppTemplate.updateMany({ where: { id: { notIn: seen }, syncedAt: { not: null }, active: true }, data: { active: false } });
  return { synced, deactivated: off.count };
}

export const windowInfo = (c: { lastInboundAt: Date | null }) => ({ open: !!c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < 86400e3, closesAt: windowClosesAt(c.lastInboundAt) });
