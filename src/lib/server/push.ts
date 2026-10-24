import { createSign } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { FIELD_OPS_STORED_ROLES } from "@/lib/rbac/roles";
import { safeRoute, type PushMessage } from "@/lib/push-messages";

/**
 * Push notifications (Firebase Cloud Messaging, HTTP v1) for the Android app.
 *
 *  - Privacy: titles and bodies are generic ("New job assigned"). They never contain a customer's name,
 *    phone, address, Job ID (which embeds the customer name) or any amount. The only data sent is an
 *    in-app route, and the app opens it through the normal, authorised ERP screen.
 *  - No duplicates: every event writes a PushNotification row first; the unique (userId, dedupeKey)
 *    makes a second attempt for the same event a no-op. The device also replaces a notification that
 *    carries the same tag.
 *  - Server-side only: the Firebase service account never leaves the server (FCM_SERVICE_ACCOUNT_JSON).
 */

/* -------------------------------------------------------------------------- */
/* FCM transport                                                              */
/* -------------------------------------------------------------------------- */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let parsedAccount: ServiceAccount | null | undefined;
function account(): ServiceAccount | null {
  if (parsedAccount !== undefined && process.env.NODE_ENV === "production") return parsedAccount;
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  parsedAccount = null;
  if (raw) {
    try {
      const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
      const a = JSON.parse(json) as ServiceAccount;
      if (a.project_id && a.client_email && a.private_key) parsedAccount = a;
    } catch {
      logger.error("push.service_account_invalid");
    }
  }
  return parsedAccount;
}

export const pushConfigured = () => !!account();

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(a: ServiceAccount): Promise<string> {
  if (tokenCache && tokenCache.exp - 60_000 > Date.now()) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const uri = process.env.FCM_TOKEN_URL || a.token_uri || "https://oauth2.googleapis.com/token";
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: a.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: uri, iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(a.private_key, "base64url");
  const res = await fetch(uri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }) });
  const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !j?.access_token) throw new Error(`FCM sign-in failed (${res.status})`);
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

export type SendOutcome = { ok: true } | { ok: false; invalidToken: boolean; detail: string };

export async function sendToToken(deviceToken: string, msg: PushMessage, dedupeKey: string): Promise<SendOutcome> {
  const a = account();
  if (!a) return { ok: false, invalidToken: false, detail: "push_not_configured" };
  const base = (process.env.FCM_API_BASE || "https://fcm.googleapis.com").replace(/\/$/, "");
  const body = {
    message: {
      token: deviceToken,
      notification: { title: msg.title, body: msg.body },
      data: { route: safeRoute(msg.route), type: msg.type },
      android: { priority: "HIGH", notification: { channel_id: "erp_default", tag: dedupeKey.slice(0, 100), visibility: "PRIVATE" } },
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}/v1/projects/${a.project_id}/messages:send`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await accessToken(a)}` }, body: JSON.stringify(body) });
      if (res.ok) return { ok: true };
      const err = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null;
      const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode ?? err?.error?.status ?? String(res.status);
      // A token Firebase says is dead must not be tried again.
      if (res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") return { ok: false, invalidToken: true, detail: code };
      if (res.status === 401) tokenCache = null;
      if ((res.status === 429 || res.status >= 500 || res.status === 401) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      return { ok: false, invalidToken: false, detail: code };
    } catch (e) {
      if (attempt === 1) return { ok: false, invalidToken: false, detail: "network_error" };
    }
  }
  return { ok: false, invalidToken: false, detail: "failed" };
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                   */
/* -------------------------------------------------------------------------- */

export type PushResult = "SENT" | "FAILED" | "SKIPPED" | "DUPLICATE";

/** Sends one event to one user's phones. Never throws: a failed push must not break the business action. */
export async function pushToUser(userId: string, msg: PushMessage, dedupeKey: string): Promise<PushResult> {
  try {
    let row;
    try {
      row = await prisma.pushNotification.create({ data: { userId, dedupeKey, type: msg.type, title: msg.title, body: msg.body, route: safeRoute(msg.route) } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "DUPLICATE";
      throw e;
    }
    const finish = (status: "SENT" | "FAILED" | "SKIPPED", detail?: string) => prisma.pushNotification.update({ where: { id: row.id }, data: { status, detail: detail?.slice(0, 200) ?? null } }).catch(() => {});
    if (!pushConfigured()) {
      await finish("SKIPPED", "push_not_configured");
      return "SKIPPED";
    }
    const devices = await prisma.mobileDevice.findMany({ where: { userId, revokedAt: null, pushToken: { not: null }, notificationsEnabled: true } });
    if (!devices.length) {
      await finish("SKIPPED", "no_device");
      return "SKIPPED";
    }
    let sent = 0;
    const failures: string[] = [];
    for (const d of devices) {
      const out = await sendToToken(d.pushToken!, msg, dedupeKey);
      if (out.ok) sent++;
      else {
        failures.push(out.detail);
        if (out.invalidToken) await prisma.mobileDevice.updateMany({ where: { id: d.id, pushToken: d.pushToken }, data: { pushToken: null, pushTokenUpdatedAt: new Date() } });
      }
    }
    await finish(sent ? "SENT" : "FAILED", sent ? `${sent}/${devices.length} phones` : failures.join(","));
    return sent ? "SENT" : "FAILED";
  } catch (e) {
    logger.warn("push.failed", { error: e instanceof Error ? e.message : String(e) });
    return "FAILED";
  }
}

/** Same event to several users. Fire-and-forget safe. */
export async function pushToUsers(userIds: string[], msg: PushMessage, keyFor: (userId: string) => string): Promise<Record<PushResult, number>> {
  const out: Record<PushResult, number> = { SENT: 0, FAILED: 0, SKIPPED: 0, DUPLICATE: 0 };
  for (const id of Array.from(new Set(userIds))) out[await pushToUser(id, msg, keyFor(id))]++;
  return out;
}

/** Active users of the given roles. */
export async function userIdsWithRole(roles: string[]): Promise<string[]> {
  return (await prisma.user.findMany({ where: { role: { in: roles.flatMap((r) => (r === "field_operations_manager" ? FIELD_OPS_STORED_ROLES : [r])) }, active: true }, select: { id: true } })).map((u) => u.id);
}

export { messages, safeRoute, bucket, dayKey } from "@/lib/push-messages";
export type { PushMessage, PushType } from "@/lib/push-messages";
