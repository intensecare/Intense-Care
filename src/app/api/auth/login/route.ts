import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { createSession } from "@/lib/server/session";
import { api, body, clientIp, HttpError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { homeFor } from "@/lib/server/auth";
import { logger } from "@/lib/server/logger";

const Schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

/** POST /api/auth/login — bcrypt check, then a signed session cookie. */
export const POST = api(async (request) => {
  const { email, password } = await body(request, Schema);
  const key = `${email.toLowerCase()}|${clientIp(request)}`;
  if (!rateLimit(`login:${key}`, 10, 15 * 60 * 1000)) throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid) {
    logger.warn("auth.login_failed", { email });
    throw new HttpError(401, "Wrong email or password.");
  }
  if (!user.active) throw new HttpError(403, "This account is disabled. Contact your admin.");

  await createSession(user.id);
  await prisma.activityLog.create({
    data: { actorId: user.id, actorName: user.name, actorRole: user.role, action: "SIGNED_IN", ipAddress: clientIp(request) },
  });
  return { home: homeFor(user.role) };
});
