import { prisma } from "@/lib/server/prisma";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/orders";
import { ServiceSchema } from "@/lib/server/schemas";

/** POST /api/services — admin adds a service with its price (in paise). */
export const POST = api(async (request) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, ServiceSchema);
  const s = await prisma.$transaction(async (tx) => {
    const created = await tx.service.create({ data: { ...d, description: d.description || null } });
    await logActivity(tx, { actor: actorOf(user, request), action: "SERVICE_CREATED", details: `${created.name} @ ${created.price} paise/${created.unit}` });
    return created;
  });
  return { id: s.id };
});
