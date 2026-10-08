import { prisma } from "@/lib/server/prisma";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/orders";
import { ServiceSchema } from "@/lib/server/schemas";

/** PATCH /api/services/[id] — admin edits price/details or deactivates. Existing orders keep their price snapshot. */
export const PATCH = api<{ params: { id: string } }>(async (request, { params }) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, ServiceSchema.partial());
  await prisma.$transaction(async (tx) => {
    const before = await tx.service.findUniqueOrThrow({ where: { id: params.id } });
    await tx.service.update({ where: { id: params.id }, data: { ...d, ...(d.description !== undefined ? { description: d.description || null } : {}) } });
    const priceNote = d.price !== undefined && d.price !== before.price ? ` price ${before.price}→${d.price} paise` : "";
    await logActivity(tx, { actor: actorOf(user, request), action: "SERVICE_UPDATED", details: `${before.name}:${priceNote} ${Object.keys(d).join(", ")}` });
  });
  return { updated: true };
});
