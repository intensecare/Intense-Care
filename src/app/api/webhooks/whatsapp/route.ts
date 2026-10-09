import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { addActivity, createLead, openDuplicates } from "@/lib/server/leads";
import { phoneKey } from "@/lib/leads";
import { validSignature } from "@/lib/server/webhook-signature";

/**
 * WhatsApp Business Platform (Cloud API) webhook — the official, verified
 * integration only. Personal WhatsApp / WhatsApp Web is never automated.
 *
 * Configure in Meta for Developers → your app → WhatsApp → Configuration:
 *   Callback URL  = APP_BASE_URL/api/webhooks/whatsapp
 *   Verify token  = WHATSAPP_WEBHOOK_VERIFY_TOKEN
 *   Subscribe to the "messages" field.
 * Every POST must carry Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw
 * body with WHATSAPP_APP_SECRET); anything else is rejected. Without both
 * variables set the endpoint answers 503 and stores nothing.
 *
 * An incoming customer message creates a WHATSAPP lead, or is added to the
 * history of that phone's open lead. A webhook retry (same message id) is
 * stored once. Delivery/read status callbacks are ignored.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return new NextResponse("Not configured", { status: 503 });
  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected) {
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

interface WaMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}
interface WaValue {
  messaging_product?: string;
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
}

function textOf(m: WaMessage): string {
  if (m.type === "text") return m.text?.body ?? "";
  if (m.type === "button") return m.button?.text ?? "[button]";
  if (m.type === "interactive") return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[interactive reply]";
  if (m.type === "location") return `[location] ${[m.location?.name, m.location?.address].filter(Boolean).join(", ") || `${m.location?.latitude},${m.location?.longitude}`}`;
  return `[${m.type} message — open WhatsApp Business to view]`;
}

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) return new NextResponse("Not configured", { status: 503 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return new NextResponse("Too large", { status: 413 });
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    logger.warn("whatsapp.webhook.bad_signature");
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let body: { object?: string; entry?: { changes?: { field?: string; value?: WaValue }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  if (body.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });

  let stored = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value ?? {};
      for (const m of value.messages ?? []) {
        try {
          if (!m?.id || !m.from) continue;
          if (await prisma.leadActivity.findUnique({ where: { externalId: `wa:${m.id}` }, select: { id: true } })) continue; // retry
          const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.trim();
          const phone = `+${m.from.replace(/\D/g, "")}`;
          const text = textOf(m).slice(0, 1500);
          const actor = { actorId: null, actorName: "WhatsApp" };
          const open = await openDuplicates(phoneKey(phone));
          if (open.length) {
            await addActivity(open[0].id, { type: "WHATSAPP_MESSAGE", message: `WhatsApp: ${text}`, externalId: `wa:${m.id}`, ...actor });
            await prisma.lead.update({ where: { id: open[0].id }, data: { updatedAt: new Date() } });
          } else {
            await createLead(
              { customerName: name || `WhatsApp ${phone.slice(-4)}`, phone, source: "WHATSAPP", sourceDetails: "Incoming WhatsApp Business message", notes: text || null },
              actor,
              { type: "WHATSAPP_MESSAGE", message: `WhatsApp: ${text}`, externalId: `wa:${m.id}` }
            );
          }
          stored++;
        } catch (e) {
          // A unique-id clash means a concurrent retry already stored it.
          logger.warn("whatsapp.webhook.message_skipped", { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  }
  return NextResponse.json({ ok: true, stored });
}
