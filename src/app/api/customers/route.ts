import { prisma } from "@/lib/server/prisma";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/orders";
import { normalizePhone } from "@/lib/format";
import { CustomerSchema } from "@/lib/server/schemas";

/** GET /api/customers?q= — admin search by name or phone (order form). */
export const GET = api(async (request) => {
  await requireApiUser(["ADMIN"]);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const digits = q.replace(/\D/g, "");
  const rows = await prisma.customer.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }
      : undefined,
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, name: true, phone: true, address: true },
  });
  return rows;
});

/** POST /api/customers — admin adds a customer (one per phone number). */
export const POST = api(async (request) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, CustomerSchema);
  const c = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: { name: d.name, phone: normalizePhone(d.phone), address: d.address, email: d.email || null, notes: d.notes || null },
    });
    await logActivity(tx, { actor: actorOf(user, request), action: "CUSTOMER_CREATED", details: `${created.name} (${created.id})` });
    return created;
  });
  return { id: c.id };
});
