import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { fail, ok, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { serializeConversations, serializeMessages } from "@/lib/server/whatsapp/serialize";
import { validateRefs } from "@/lib/server/leads";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const c = await prisma.whatsAppContact.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Conversation not found.");
  return c;
}

/** GET — one customer's messages, oldest first (the newest 300; ?before=<message id> pages back). Only this customer's messages are ever returned. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("leads.view");
    const contact = await load(params.id);
    const before = new URL(request.url).searchParams.get("before");
    const anchor = before ? await prisma.whatsAppMessage.findFirst({ where: { id: before, contactId: contact.id }, select: { createdAt: true } }) : null;
    const rows = await prisma.whatsAppMessage.findMany({ where: { contactId: contact.id, ...(anchor ? { createdAt: { lt: anchor.createdAt } } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
    const [conversation] = await serializeConversations([contact]);
    return ok({ conversation, messages: await serializeMessages(rows.reverse()), hasMore: rows.length === 300 });
  } catch (err) {
    return errorResponse(err, "whatsapp.conversation.get_error");
  }
}

const Patch = z.object({
  read: z.literal(true).optional(),
  optedOut: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
  assignedUserId: z.string().max(64).nullable().optional(),
});

/** PATCH — mark read, assign the lead, record an opt-out / consent. Needs `leads.manage` (marking read needs only view). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = Patch.safeParse(await readJson(request));
    if (!body.success) return fail("Invalid update.", 400);
    const d = body.data;
    const { user } = await requirePermission(Object.keys(d).every((k) => k === "read") ? "leads.view" : "leads.manage");
    const contact = await load(params.id);
    if (d.read) await prisma.whatsAppContact.update({ where: { id: contact.id }, data: { unreadCount: 0 } });
    if (d.assignedUserId !== undefined) {
      if (!contact.leadId) return fail("This conversation has no lead to assign.", 400);
      await validateRefs({ assignedUserId: d.assignedUserId });
      await prisma.lead.update({ where: { id: contact.leadId }, data: { assignedUserId: d.assignedUserId } });
      await prisma.leadActivity.create({ data: { leadId: contact.leadId, type: "ASSIGNED", message: d.assignedUserId ? "Assigned from the WhatsApp inbox." : "Unassigned from the WhatsApp inbox.", actorId: user.id, actorName: user.name } });
      void recordAudit({ actor: user, action: "LEAD_ASSIGNED", entityType: "lead", entityId: contact.leadId, details: "WhatsApp inbox", request });
    }
    if (d.optedOut !== undefined || d.marketingConsent !== undefined) {
      const optedOut = d.optedOut ?? contact.optedOut;
      await prisma.whatsAppContact.update({ where: { id: contact.id }, data: { optedOut, optedOutAt: optedOut ? contact.optedOutAt ?? new Date() : null, marketingConsent: optedOut ? false : d.marketingConsent ?? contact.marketingConsent } });
      if (contact.leadId) await prisma.leadActivity.create({ data: { leadId: contact.leadId, type: "NOTE", message: [d.optedOut !== undefined ? (optedOut ? "Recorded: customer opted out of WhatsApp messages." : "Recorded: customer opted back in to WhatsApp messages.") : "", d.marketingConsent !== undefined && !optedOut ? (d.marketingConsent ? "Recorded: customer consented to marketing WhatsApp messages." : "Marketing consent withdrawn.") : ""].filter(Boolean).join(" "), actorId: user.id, actorName: user.name } });
      void recordAudit({ actor: user, action: "WHATSAPP_CONSENT_CHANGED", entityType: "whatsapp", entityId: contact.id, details: `optedOut=${optedOut}${d.marketingConsent !== undefined ? ` marketingConsent=${d.marketingConsent}` : ""}`, request });
    }
    const fresh = await load(contact.id);
    return ok({ conversation: (await serializeConversations([fresh]))[0] });
  } catch (err) {
    return errorResponse(err, "whatsapp.conversation.patch_error");
  }
}
