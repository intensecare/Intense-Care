import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { serializeConversations } from "@/lib/server/whatsapp/serialize";
import { phoneKey } from "@/lib/leads";

export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/conversations — the WhatsApp inbox (Lead Management). Needs `leads.view`.
 * ?filter=all|unread|unassigned|mine  ?q=name / phone / last message  ?page=1
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("leads.view");
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") ?? "all";
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const and: Prisma.WhatsAppContactWhereInput[] = [];
    const leadId = url.searchParams.get("leadId");
    if (leadId) and.push({ leadId: leadId.slice(0, 64) });
    if (filter === "unread") and.push({ unreadCount: { gt: 0 } });
    if (filter === "unassigned" || filter === "mine") {
      const leads = await prisma.lead.findMany({ where: filter === "mine" ? { assignedUserId: user.id } : { assignedUserId: null, status: { notIn: ["WON", "LOST"] } }, select: { id: true } });
      and.push({ leadId: { in: leads.map((l) => l.id) } });
    }
    if (q) {
      const d = q.replace(/\D/g, "");
      const byName = await prisma.lead.findMany({ where: { customerName: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 200 });
      const byText = await prisma.whatsAppMessage.findMany({ where: { body: { contains: q, mode: "insensitive" } }, select: { contactId: true }, distinct: ["contactId"], take: 200 });
      and.push({ OR: [{ id: { in: byText.map((m) => m.contactId) } }, { profileName: { contains: q, mode: "insensitive" } }, { lastPreview: { contains: q, mode: "insensitive" } }, ...(d.length >= 3 ? [{ waId: { contains: d } }, ...(d.length >= 6 ? [{ phoneKey: phoneKey(d) }] : [])] : []), { leadId: { in: byName.map((l) => l.id) } }] });
    }
    const where: Prisma.WhatsAppContactWhereInput = and.length ? { AND: and } : {};
    const [rows, total, unread] = await Promise.all([
      prisma.whatsAppContact.findMany({ where, orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }], skip: (page - 1) * 50, take: 50 }),
      prisma.whatsAppContact.count({ where }),
      prisma.whatsAppContact.count({ where: { unreadCount: { gt: 0 } } }),
    ]);
    return ok({ rows: await serializeConversations(rows), total, page, unreadConversations: unread }, 200);
  } catch (err) {
    return errorResponse(err, "whatsapp.conversations.route_error");
  }
}
