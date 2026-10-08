import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getSessionUser, type SessionUser } from "./session";
import { HttpError } from "./http";

/** The ONE home of each staff role. */
export function homeFor(role: Role): string {
  return role === "ADMIN" ? "/admin" : role === "FIELD_MANAGER" ? "/field" : "/qc";
}

/** Server pages/layouts: signed in with one of `roles`, else redirect. */
export async function requirePageUser(roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** API routes: signed in with one of `roles`, else 401/403. */
export async function requireApiUser(roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Please sign in again.");
  if (!roles.includes(user.role)) throw new HttpError(403, "You are not allowed to do this.");
  return user;
}

/** The acting user as recorded in the activity log. */
export function actorOf(user: SessionUser, request?: Request) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    ip: request ? request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") : null,
  };
}
