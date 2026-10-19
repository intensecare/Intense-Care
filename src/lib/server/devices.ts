import { timingSafeEqual } from "node:crypto";
import type { MobileDevice } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { HttpError } from "./authz";
import { logger } from "./logger";
import { newDeviceToken, sha256, TOKEN_PREFIX } from "@/lib/device-token";
import { rateLimit, clientIp } from "./qr-service";
import { toSessionUser, type SessionUser } from "./session";
import { can, type Permission } from "@/lib/rbac";

/**
 * Android devices and the scoped token the background contact worker uses.
 *
 * The app's WebView signs in with the normal session cookie. The native
 * WorkManager job runs without the WebView, so it can't use that cookie — and
 * shouldn't: it gets its OWN token, bound to one device and one scope
 * (contact sync only), revocable at any time, stored only as a SHA-256 hash
 * here and in Android Keystore-encrypted storage on the phone. A stolen token
 * can upload contacts for that device and nothing else; it cannot read the ERP.
 */

export const DeviceInput = z.object({
  deviceId: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid device id."),
  label: z.string().trim().max(120).optional(),
  appVersion: z.string().trim().max(40).optional(),
  /** Ask for a contact-sync token (Admin only). */
  syncToken: z.boolean().optional(),
});

/** Registers (or re-registers after sign-in) this phone for the signed-in user. */
export async function registerDevice(user: SessionUser, input: z.infer<typeof DeviceInput>) {
  const wantsToken = input.syncToken === true;
  if (wantsToken && !can(user, "contacts.sync")) throw new HttpError(403, "Your role can't synchronise phone contacts.");
  const token = wantsToken ? newDeviceToken() : null;
  const device = await prisma.mobileDevice.upsert({
    where: { userId_deviceId: { userId: user.id, deviceId: input.deviceId } },
    create: {
      userId: user.id,
      deviceId: input.deviceId,
      label: input.label ?? null,
      appVersion: input.appVersion ?? null,
      lastSeenAt: new Date(),
      ...(token ? { syncTokenHash: sha256(token), syncTokenIssuedAt: new Date() } : {}),
    },
    update: {
      label: input.label ?? undefined,
      appVersion: input.appVersion ?? undefined,
      lastSeenAt: new Date(),
      revokedAt: null,
      // A new token replaces the old one (rotation); without the flag the existing token stays valid.
      ...(token ? { syncTokenHash: sha256(token), syncTokenIssuedAt: new Date() } : {}),
    },
  });
  return { device, token };
}

/** Stops a phone's token and push registration. Contacts it uploaded are handled separately (retention policy). */
export async function revokeDevice(device: Pick<MobileDevice, "id">) {
  await prisma.mobileDevice.update({
    where: { id: device.id },
    data: { syncTokenHash: null, syncTokenIssuedAt: null, pushToken: null, pushTokenUpdatedAt: null, revokedAt: new Date(), syncPaused: false },
  });
}

function isLoopback(host: string | null): boolean {
  const h = (host ?? "").split(":")[0].toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

/** Device endpoints carry contact data: production traffic must be HTTPS (loopback is exempt for local tests). */
export function requireSecureTransport(request: Request) {
  if (process.env.NODE_ENV !== "production") return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (isLoopback(host)) return;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  if (proto.split(",")[0].trim() !== "https") throw new HttpError(400, "This endpoint is available over HTTPS only.");
}

export interface DeviceContext {
  device: MobileDevice;
  user: SessionUser;
}

/**
 * Authenticates a request that carries `Authorization: Bearer icd_…`.
 * Checks, every time: token matches a non-revoked device, the user is still
 * active and still holds the permission the endpoint needs, and the device
 * isn't hammering the API.
 */
export async function requireDevice(request: Request, permission: Permission): Promise<DeviceContext> {
  requireSecureTransport(request);
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer (icd_[A-Za-z0-9_-]{20,80})$/.exec(header);
  if (!m) throw new HttpError(401, "Device token required.");
  const hash = sha256(m[1]);
  const device = await prisma.mobileDevice.findUnique({ where: { syncTokenHash: hash } });
  // Constant-time confirmation on top of the unique-index lookup.
  if (!device?.syncTokenHash || device.revokedAt || !timingSafeEqual(Buffer.from(device.syncTokenHash), Buffer.from(hash))) {
    logger.warn("device.token_rejected", { ip: clientIp(request) });
    throw new HttpError(401, "This phone's connection is no longer valid. Sign in to the app again.");
  }
  const row = await prisma.user.findUnique({ where: { id: device.userId } });
  if (!row || !row.active) throw new HttpError(401, "This account is no longer active.");
  const user = toSessionUser(row);
  if (!can(user, permission)) throw new HttpError(403, "Your role is not authorized for this action.");
  if (!rateLimit(`device:${device.id}`, 240, 10 * 60 * 1000).ok) throw new HttpError(429, "Too many requests from this phone. Try again in a few minutes.");
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000) {
    void prisma.mobileDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return { device, user };
}

export { newDeviceToken, hashDeviceToken, TOKEN_PREFIX } from "@/lib/device-token";
