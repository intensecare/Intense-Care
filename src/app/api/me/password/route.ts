import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { api, body, HttpError } from "@/lib/server/http";
import { requireApiUser } from "@/lib/server/auth";

const Schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8, "Use at least 8 characters").max(200) });

/** POST /api/me/password — any signed-in staff member changes their own password. */
export const POST = api(async (request) => {
  const user = await requireApiUser(["ADMIN", "FIELD_MANAGER", "QC"]);
  const d = await body(request, Schema);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await bcrypt.compare(d.currentPassword, row.passwordHash))) throw new HttpError(400, "Current password is wrong.");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(d.newPassword, 12) } });
  await prisma.activityLog.create({ data: { actorId: user.id, actorName: user.name, actorRole: user.role, action: "PASSWORD_CHANGED" } });
  return { changed: true };
});
