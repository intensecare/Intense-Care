import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { normalizeRole, canSignIn, type Role } from "@/lib/rbac/roles";

/**
 * Server-side session layer.
 *
 * Sessions are established exclusively by POST /api/auth/login after bcrypt
 * verification. The cookie carries ONLY a signed user id + expiry: the role
 * and scope attributes are re-read from the database on every request, so a
 * role change or deactivation takes effect immediately and the client can
 * never assert its own role ("never trust frontend role values").
 */

const COOKIE_NAME = "erp_session";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);

const FALLBACK_SECRET = "intense_care_default_production_fallback_session_secret_32_chars_minimum";

function getSessionSecret(): string {
  const secret = process.env.ERP_SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    return FALLBACK_SECRET;
  }
  if (secret.length < 32) {
    return secret.padEnd(32, "x");
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/** The authenticated identity every API route works with (= RBAC Principal). */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
  branchId: string | null;
  customerId: string | null;
  referralPartnerId: string | null;
}

function buildToken(userId: string, issuedAtMs: number, expiresAtMs: number): string {
  // jti = this session's id, so signing out can revoke exactly this session.
  const jti = crypto.randomBytes(16).toString("base64url");
  const payload = JSON.stringify({ uid: userId, jti, iat: issuedAtMs, exp: expiresAtMs });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function verifyToken(token: string): { uid: string; jti: string; exp: number } | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!sign(encoded) || !safeEqual(sign(encoded), sig)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof payload.uid !== "string" || typeof payload.jti !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { uid: payload.uid, jti: payload.jti, exp: payload.exp };
  } catch {
    return null;
  }
}

/** Issues the session cookie for the given user. */
export async function createSession(user: Pick<SessionUser, "id" | "role">): Promise<void> {
  const now = Date.now();
  const expiresAtMs = now + SESSION_TTL_HOURS * 60 * 60 * 1000;
  const token = buildToken(user.id, now, expiresAtMs);

  const store = await cookies();
  store.set(COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge: Math.floor((expiresAtMs - now) / 1000) });

  logger.info("session.created", { userId: user.id, role: user.role });
}

/**
 * Signs out: revokes this session server-side (so a copied cookie stops
 * working too) and expires the cookie with the SAME attributes it was set
 * with — a plain delete can miss a `secure` cookie on some browsers.
 */
export async function destroySession(): Promise<{ userId: string | null }> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  const parsed = token ? verifyToken(token) : null;
  if (parsed) {
    try {
      await prisma.revokedSession.upsert({
        where: { jti: parsed.jti },
        create: { jti: parsed.jti, expiresAt: new Date(parsed.exp) },
        update: {},
      });
      // Housekeeping: revocations are only needed until the cookie expires.
      await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (err) {
      logger.error("session.revoke_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  store.set(COOKIE_NAME, "", { ...COOKIE_OPTIONS, maxAge: 0, expires: new Date(0) });
  if (parsed) logger.info("session.destroyed", { userId: parsed.uid });
  return { userId: parsed?.uid ?? null };
}

/** Maps a User row to the session identity (role normalized, scope attrs attached). */
export function toSessionUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  referralPartnerId?: string | null;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: normalizeRole(user.role),
    teamId: user.teamId ?? null,
    branchId: user.branchId ?? null,
    customerId: user.customerId ?? null,
    referralPartnerId: user.referralPartnerId ?? null,
  };
}

/**
 * Resolves the current authenticated user from the session cookie.
 * Returns null when unauthenticated or when the referenced user no longer
 * exists / is deactivated.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const parsed = verifyToken(token);
  if (!parsed) return null;
  const { uid, jti } = parsed;
  // Signed out → this session is revoked even if the cookie is replayed.
  const revoked = await prisma.revokedSession.findUnique({ where: { jti }, select: { jti: true } });
  if (revoked) return null;

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user || !user.active || !canSignIn(user.role)) return null;

  return toSessionUser(user);
}
