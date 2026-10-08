import { prisma } from "@/lib/server/prisma";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/orders";
import { normalizePhone } from "@/lib/format";
import { CustomerSchema } from "@/lib/server/schemas";

/** PATCH /api/customers/[id] — admin edits a customer. */
export const PATCH = api<{ params: { id: string } }>(async (request, { params }) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, CustomerSchema.partial());
  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.phone !== undefined ? { phone: normalizePhone(d.phone) } : {}),
        ...(d.address !== undefined ? { address: d.address } : {}),
        ...(d.email !== undefined ? { email: d.email || null } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      },
    });
    await logActivity(tx, { actor: actorOf(user, request), action: "CUSTOMER_UPDATED", details: `${params.id}: ${Object.keys(d).join(", ")}` });
  });
  return { updated: true };
});
