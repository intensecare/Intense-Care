import { z } from "zod";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { transitionOrder } from "@/lib/server/orders";
import { ORDER_STATUSES } from "@/lib/workflow";

const Schema = z.object({
  to: z.enum(ORDER_STATUSES),
  reason: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
  payment: z
    .object({
      amount: z.number().int().min(0).max(100000000),
      method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"]),
      reference: z.string().max(120).optional(),
      idempotencyKey: z.string().uuid().optional(),
    })
    .optional(),
});

/**
 * POST /api/orders/[id]/transition — the ONLY way an order changes status.
 * Role, assignment and the workflow table are all checked server-side
 * (src/lib/server/orders.ts); the client only says where it wants to go.
 */
export const POST = api<{ params: { id: string } }>(async (request, { params }) => {
  const user = await requireApiUser(["ADMIN", "FIELD_MANAGER", "QC"]);
  const d = await body(request, Schema);
  return transitionOrder({ orderId: params.id, to: d.to, reason: d.reason, notes: d.notes, payment: d.payment, actor: actorOf(user, request) });
});
