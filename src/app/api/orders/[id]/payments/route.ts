import { z } from "zod";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { recordPayment } from "@/lib/server/orders";

const Schema = z.object({
  amount: z.number().int().positive("Enter an amount").max(100000000),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"]),
  reference: z.string().max(120).optional(),
  idempotencyKey: z.string().uuid(),
});

/** POST /api/orders/[id]/payments — admin records a payment (idempotent per form submit). */
export const POST = api<{ params: { id: string } }>(async (request, { params }) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, Schema);
  const p = await recordPayment({ orderId: params.id, ...d, actor: actorOf(user, request) });
  return { id: p.id };
});
