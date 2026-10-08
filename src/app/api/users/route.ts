import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/orders";
import { normalizePhone } from "@/lib/format";

const Schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(200),
  phone: z.string().trim().min(10, "Enter a valid phone number").max(20),
  role: z.enum(["ADMIN", "FIELD_MANAGER", "QC"]),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

/** POST /api/users — admin creates a staff account (admin, field manager or QC). */
export const POST = api(async (request) => {
  const actor = await requireApiUser(["ADMIN"]);
  const d = await body(request, Schema);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: d.name, email: d.email.toLowerCase(), phone: normalizePhone(d.phone), role: d.role, passwordHash: await bcrypt.hash(d.password, 12) },
    });
    await logActivity(tx, { actor: actorOf(actor, request), action: "USER_CREATED", details: `${created.name} as ${created.role}` });
    return created;
  });
  return { id: user.id };
});
