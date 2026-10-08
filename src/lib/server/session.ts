import crypto from "crypto";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Staff sessions: an HMAC-signed, httpOnly cookie that carries ONLY the user
 * id and expiry. Role and active flag are re-read from the database on every
 * request, so the browser can never assert a role and a deactivated user is
 * locked out immediately.
 */

const COOKIE = "lx_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.ERP_SESSION_SECRET;
  if (!secret || secret.length < 32 || new Set(secret).size < 16) {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters (openssl rand -hex 32).");
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
}

export async function createSession(userId: string): Promise<void> {
  const exp = Date.now() + TTL_HOURS * 3600 * 1000;
  const body = Buffer.from(JSON.stringify({ uid: userId, exp })).toString("base64url");
  cookies().set(COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_HOURS * 3600,
  });
}

export function destroySession(): void {
  cookies().delete(COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  if (!safeEqual(sign(body), token.slice(dot + 1))) return null;
  let uid: string;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    uid = payload.uid;
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
}
