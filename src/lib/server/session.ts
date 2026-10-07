import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { normalizeRole, type Role } from "@/lib/rbac/roles";

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
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);

function getSessionSecret(): string {
  const secret = process.env.ERP_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "ERP_SESSION_SECRET is not set. Generate one with: openssl rand -hex 32"
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "ERP_SESSION_SECRET must be at least 32 characters long for security. Generate a stronger secret with: openssl rand -hex 32"
    );
  }
  const uniqueChars = new Set(secret.split(""));
  if (uniqueChars.size < 16) {
    throw new Error(
      "ERP_SESSION_SECRET appears to have low entropy. Generate a stronger secret with: openssl rand -hex 32"
    );
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
  const payload = JSON.stringify({ uid: userId, iat: issuedAtMs, exp: expiresAtMs });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function verifyToken(token: string): { uid: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!sign(encoded) || !safeEqual(sign(encoded), sig)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof payload.uid !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { uid: payload.uid };
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
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor((expiresAtMs - now) / 1000),
  });

  logger.info("session.created", { userId: user.id, role: user.role });
}

/** Clears the session cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
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

  const { uid } = verifyToken(token) || {};
  if (!uid) return null;

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user || !user.active) return null;

  return toSessionUser(user);
}
