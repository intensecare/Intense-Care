import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { api, body, HttpError } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { rotateCustomerLink } from "@/lib/server/orders";
import { notifyOrder } from "@/lib/server/notify";
import { customerLink } from "@/lib/server/customer-link";

const Schema = z.object({ action: z.enum(["send", "reset"]) });

/** POST /api/orders/[id]/link — admin re-sends the customer link on WhatsApp, or revokes it and issues a new one. */
export const POST = api<{ params: { id: string } }>(async (request, { params }) => {
  const user = await requireApiUser(["ADMIN"]);
  const { action } = await body(request, Schema);
  const exists = await prisma.order.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!exists) throw new HttpError(404, "Order not found.");
  if (action === "reset") await rotateCustomerLink(params.id, actorOf(user, request));
  await notifyOrder(params.id, ["ORDER_LINK"]);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: params.id } });
  const last = await prisma.notification.findFirst({ where: { orderId: params.id }, orderBy: { createdAt: "desc" } });
  return { link: customerLink(order), whatsapp: last?.status ?? "SKIPPED" };
});
