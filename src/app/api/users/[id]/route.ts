import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { api, body, HttpError } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/orders";
import { normalizePhone } from "@/lib/format";

const Schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(10).max(20).optional(),
  role: z.enum(["ADMIN", "FIELD_MANAGER", "QC"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "Use at least 8 characters").max(200).optional(),
});

/** PATCH /api/users/[id] — admin edits, resets the password of, or deactivates a staff account. */
export const PATCH = api<{ params: { id: string } }>(async (request, { params }) => {
  const actor = await requireApiUser(["ADMIN"]);
  const d = await body(request, Schema);
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) throw new HttpError(404, "User not found.");

  if (target.id === actor.id && (d.active === false || (d.role && d.role !== "ADMIN"))) {
    throw new HttpError(409, "You cannot deactivate yourself or remove your own admin role.");
  }
  if (target.role === "ADMIN" && (d.active === false || (d.role && d.role !== "ADMIN"))) {
    const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: target.id } } });
    if (otherAdmins === 0) throw new HttpError(409, "There must always be at least one active admin.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.phone !== undefined ? { phone: normalizePhone(d.phone) } : {}),
        ...(d.role !== undefined ? { role: d.role } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
        ...(d.password !== undefined ? { passwordHash: await bcrypt.hash(d.password, 12) } : {}),
      },
    });
    const changed = Object.keys(d).map((k) => (k === "password" ? "password reset" : k));
    await logActivity(tx, { actor: actorOf(actor, request), action: "USER_UPDATED", details: `${target.name}: ${changed.join(", ")}` });
  });
  return { updated: true };
});
