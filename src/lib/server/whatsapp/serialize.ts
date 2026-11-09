import type { WhatsAppContact, WhatsAppMessage } from "@prisma/client";
import { prisma } from "../prisma";
import { MEDIA_ALLOWED, windowClosesAt, windowOpen } from "@/lib/whatsapp";

export interface WaMessageRow {
  id: string;
  direction: "IN" | "OUT";
  type: string;
  body: string | null;
  templateName: string | null;
  /** IN: RECEIVED. OUT: PENDING | ACCEPTED (handed to WhatsApp, NOT delivered) | SENT | DELIVERED | READ | FAILED */
  status: string;
  error: string | null;
  at: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  sentByName: string | null;
  media: null | { status: string; mime: string | null; filename: string | null; previewable: boolean; url: string | null; note: string | null };
}

export interface WaConversationRow {
  id: string;
  waId: string;
  phone: string;
  name: string;
  profileName: string | null;
  leadId: string | null;
  leadNumber: string | null;
  leadStatus: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  unreadCount: number;
  lastPreview: string | null;
  lastDirection: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  windowOpen: boolean;
  windowClosesAt: string | null;
  optedOut: boolean;
  marketingConsent: boolean;
}

export async function serializeMessages(rows: WhatsAppMessage[]): Promise<WaMessageRow[]> {
  const ids = Array.from(new Set(rows.map((r) => r.sentBy).filter((x): x is string => !!x)));
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nm = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((m) => ({
    id: m.id,
    direction: m.direction as "IN" | "OUT",
    type: m.type,
    body: m.body,
    templateName: m.templateName,
    status: m.status,
    error: m.status === "FAILED" ? m.errorMessage ?? "WhatsApp could not deliver this message." : null,
    at: (m.providerTimestamp ?? m.createdAt).toISOString(),
    sentAt: m.sentAt?.toISOString() ?? null,
    deliveredAt: m.deliveredAt?.toISOString() ?? null,
    readAt: m.readAt?.toISOString() ?? null,
    sentByName: m.sentBy ? nm.get(m.sentBy) ?? null : null,
    media: m.mediaStatus === "NONE" ? null : { status: m.mediaStatus, mime: m.mediaMime, filename: m.mediaFilename, previewable: m.mediaStatus === "STORED" && !!m.mediaMime && !!MEDIA_ALLOWED[m.mediaMime]?.inline, url: m.mediaStatus === "STORED" ? `/api/whatsapp/media/${m.id}` : null, note: m.mediaNote },
  }));
}

export async function serializeConversations(rows: WhatsAppContact[]): Promise<WaConversationRow[]> {
  const leadIds = Array.from(new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x)));
  const leads = leadIds.length ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, leadNumber: true, status: true, customerName: true, assignedUserId: true } }) : [];
  const users = leads.map((l) => l.assignedUserId).filter((x): x is string => !!x);
  const people = users.length ? await prisma.user.findMany({ where: { id: { in: users } }, select: { id: true, name: true } }) : [];
  const L = new Map(leads.map((l) => [l.id, l]));
  const P = new Map(people.map((u) => [u.id, u.name]));
  return rows.map((c) => {
    const lead = c.leadId ? L.get(c.leadId) : undefined;
    return {
      id: c.id, waId: c.waId, phone: `+${c.waId}`, name: lead?.customerName || c.profileName || `+${c.waId}`, profileName: c.profileName,
      leadId: c.leadId, leadNumber: lead?.leadNumber ?? null, leadStatus: lead?.status ?? null,
      assignedUserId: lead?.assignedUserId ?? null, assignedUserName: lead?.assignedUserId ? P.get(lead.assignedUserId) ?? null : null,
      unreadCount: c.unreadCount, lastPreview: c.lastPreview, lastDirection: c.lastDirection,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null, lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
      windowOpen: windowOpen(c.lastInboundAt), windowClosesAt: windowClosesAt(c.lastInboundAt),
      optedOut: c.optedOut, marketingConsent: c.marketingConsent,
    };
  });
}
