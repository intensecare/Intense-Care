import { z } from "zod";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { updateOrder } from "@/lib/server/orders";

const Schema = z.object({
  items: z
    .array(
      z.object({
        serviceId: z.string().min(1).max(64),
        itemName: z.string().max(120).default(""),
        quantity: z.number().positive().max(10000),
      })
    )
    .max(100)
    .optional(),
  discount: z.number().int().min(0).max(100000000).optional(),
  pickupAddress: z.string().trim().min(5).max(500).optional(),
  deliveryAddress: z.string().trim().min(5).max(500).optional(),
  specialInstructions: z.string().max(1000).nullable().optional(),
});

/** PATCH /api/orders/[id] — admin edits items, discount, addresses, instructions. */
export const PATCH = api<{ params: { id: string } }>(async (request, { params }) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, Schema);
  await updateOrder({ orderId: params.id, ...d, actor: actorOf(user, request) });
  return { updated: true };
});
