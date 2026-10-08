import { prisma } from "./prisma";
import { logger } from "./logger";
import { getSettings } from "./settings";
import { customerLink, baseUrl } from "./customer-link";
import { money, formatDateTime } from "@/lib/format";

/**
 * WhatsApp notifications. Delivery uses the WhatsApp Business Cloud API when
 * WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID are set; otherwise the
 * message is recorded as SKIPPED so the admin can see exactly what would
 * have been sent. Every attempt is stored in the Notification table and a
 * failure never breaks the order action that triggered it.
 */

export type NotifyEvent =
  | "ORDER_CREATED"
  | "PICKUP_ASSIGNED"
  | "PICKED_UP"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "PAYMENT_RECEIVED"
  | "ORDER_LINK"
  | "FM_PICKUP"
  | "FM_DELIVERY";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function sendWhatsApp(to: string, text: string): Promise<{ status: "SENT" | "FAILED" | "SKIPPED"; ref?: string; error?: string }> {
  if (!whatsappConfigured()) return { status: "SKIPPED", error: "WhatsApp not configured" };
  const digits = to.replace(/\D/g, "");
  if (digits.length < 10) return { status: "SKIPPED", error: "No valid phone number" };
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const payload = template
    ? {
        messaging_product: "whatsapp",
        to: digits,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
          components: [{ type: "body", parameters: [{ type: "text", text }] }],
        },
      }
    : { messaging_product: "whatsapp", to: digits, type: "text", text: { body: text, preview_url: true } };
  try {
    const res = await fetch(
      `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v20.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      }
    );
    const json = (await res.json().catch(() => null)) as { messages?: { id: string }[]; error?: { message?: string } } | null;
    if (!res.ok) return { status: "FAILED", error: json?.error?.message || `HTTP ${res.status}` };
    return { status: "SENT", ref: json?.messages?.[0]?.id };
  } catch (e) {
    return { status: "FAILED", error: e instanceof Error ? e.message : String(e) };
  }
}

async function deliver(orderId: string | null, recipient: string, event: NotifyEvent, message: string) {
  const r = await sendWhatsApp(recipient, message);
  await prisma.notification.create({
    data: { orderId, recipient, event, message, status: r.status, error: r.error ?? null, providerRef: r.ref ?? null },
  });
  if (r.status === "FAILED") logger.warn("notify.failed", { orderId, event, error: r.error });
}

/** Sends the messages for the statuses an order just entered (best effort). */
export async function notifyOrder(orderId: string, events: NotifyEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const [settings, order] = await Promise.all([
      getSettings(),
      prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
          pickup: { include: { assignedTo: true } },
          delivery: { include: { assignedTo: true } },
        },
      }),
    ]);
    if (!order) return;
    const biz = settings.businessName;
    const link = customerLink(order);
    const first = order.customer.name.split(" ")[0];
    const due = order.total - order.amountPaid;

    const customerText: Partial<Record<NotifyEvent, string>> = {
      ORDER_CREATED: `${biz}: Hi ${first}, your order ${order.orderNumber} is confirmed. Track it here: ${link}`,
      PICKUP_ASSIGNED: `${biz}: Pickup for order ${order.orderNumber} is scheduled${order.pickup?.scheduledAt ? ` for ${formatDateTime(order.pickup.scheduledAt)}` : ""}. ${link}`,
      PICKED_UP: `${biz}: We have picked up order ${order.orderNumber}. We'll let you know when it's ready. ${link}`,
      READY: `${biz}: Good news ${first}! Order ${order.orderNumber} is cleaned, quality checked and ready.${due > 0 ? ` Amount due: ${money(due)}.` : ""} ${link}`,
      OUT_FOR_DELIVERY: `${biz}: Order ${order.orderNumber} is out for delivery and will reach you soon. ${link}`,
      DELIVERED: `${biz}: Order ${order.orderNumber} has been delivered. Thank you!${due > 0 ? ` Balance due: ${money(due)}.` : ""} ${link}`,
      CANCELLED: `${biz}: Order ${order.orderNumber} has been cancelled. Questions? Reply to this message.`,
      PAYMENT_RECEIVED: `${biz}: Payment received for order ${order.orderNumber}. Paid ${money(order.amountPaid)} of ${money(order.total)}. ${link}`,
      ORDER_LINK: `${biz}: Track order ${order.orderNumber} here: ${link}`,
    };

    for (const event of events) {
      if (event === "FM_PICKUP" && order.pickup?.assignedTo) {
        await deliver(order.id, order.pickup.assignedTo.phone, event, `${biz}: New pickup ${order.orderNumber} — ${order.customer.name}, ${order.pickupAddress}. ${baseUrl()}/field/pickups`);
        continue;
      }
      if (event === "FM_DELIVERY" && order.delivery?.assignedTo) {
        await deliver(order.id, order.delivery.assignedTo.phone, event, `${biz}: New delivery ${order.orderNumber} — ${order.customer.name}, ${order.deliveryAddress}. ${baseUrl()}/field/deliveries`);
        continue;
      }
      const text = customerText[event];
      if (!text) continue;
      if (!settings.notifyCustomers && event !== "ORDER_LINK") continue;
      await deliver(order.id, order.customer.phone, event, text);
    }
  } catch (e) {
    logger.error("notify.order_failed", { orderId, error: e instanceof Error ? e.message : String(e) });
  }
}
