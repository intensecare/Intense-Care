import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { createSession, toSessionUser } from "@/lib/server/session";
import { recordAudit } from "@/lib/server/audit";
import { grantsFor, workspaceFor, navFor, ROLE_LABELS, canSignIn } from "@/lib/rbac";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

const BodySchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

// Simple in-memory login rate limiting (per email + per IP bucket).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
}

/**
 * POST /api/auth/login — verifies email + bcrypt password hash against the
 * database User record and issues the signed httpOnly session cookie.
 * This replaces the legacy client-side role switcher; users exist only in
 * the database (seeded via prisma/seed.ts or the user-management UI).
 */
export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Email and password are required." },
        { status: 400 }
      );
    }

    const email = parsed.data.email.toLowerCase().trim();
    // Use multiple headers for IP detection to prevent spoofing
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      request.headers.get("cf-connecting-ip")?.trim() ||
      "unknown";
    if (rateLimited(`${email}|${ip}`)) {
      logger.warn("auth.login.rate_limited", { email, ip });
      return NextResponse.json(
        { success: false, error: "Too many sign-in attempts. Try again later." },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      // Same message for unknown email and missing password — no enumeration.
      return NextResponse.json(
        { success: false, error: "Invalid email or password." },
        { status: 401 }
      );
    }
    if (!user.active) {
      return NextResponse.json(
        { success: false, error: "This account is disabled. Contact an administrator." },
        { status: 403 }
      );
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      logger.warn("auth.login.failed", { email });
      return NextResponse.json(
        { success: false, error: "Invalid email or password." },
        { status: 401 }
      );
    }

    if (!canSignIn(user.role)) {
      return NextResponse.json(
        { success: false, error: "This account type does not sign in. Customers use the secure service link sent to them." },
        { status: 403 }
      );
    }

    const session = toSessionUser(user);
    await createSession(session);

    logger.info("auth.login.success", { userId: user.id, role: session.role });
    void recordAudit({
      actor: session,
      action: "LOGIN",
      entityType: "user",
      entityId: user.id,
      request,
    });

    const ws = workspaceFor(session.role);
    return NextResponse.json({
      success: true,
      data: {
        ...session,
        avatar: user.avatar,
        roleLabel: ROLE_LABELS[session.role],
        grants: grantsFor(session.role),
        workspace: { title: ws.title, home: ws.home, queue: ws.queue, layout: ws.layout, nav: navFor(session.role) },
      },
    });
  } catch (err) {
    return errorResponse(err, "auth.login.route_error");
  }
}
