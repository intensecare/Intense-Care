import { z } from "zod";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { assignTask } from "@/lib/server/orders";

const Schema = z.object({
  kind: z.enum(["pickup", "delivery"]),
  userId: z.string().min(1).max(64),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/** POST /api/orders/[id]/assign — admin assigns/reassigns a pickup or delivery. */
export const POST = api<{ params: { id: string } }>(async (request, { params }) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, Schema);
  await assignTask({
    orderId: params.id,
    kind: d.kind,
    userId: d.userId,
    scheduledAt: d.scheduledAt === undefined ? undefined : d.scheduledAt ? new Date(d.scheduledAt) : null,
    actor: actorOf(user, request),
  });
  return { assigned: true };
});
