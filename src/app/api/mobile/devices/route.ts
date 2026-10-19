import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { DeviceInput, registerDevice, requireSecureTransport } from "@/lib/server/devices";

/**
 * POST /api/mobile/devices — the signed-in app registers this phone.
 *   { deviceId, label?, appVersion?, syncToken?: true }
 * With syncToken the response carries a NEW contact-sync token — shown once, the
 * server keeps only its hash. The app stores it in Android Keystore-backed storage.
 */
export async function POST(request: Request) {
  try {
    requireSecureTransport(request);
    const { user } = await requireUser();
    const parsed = DeviceInput.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid device.", 400);
    const { device, token } = await registerDevice(user, parsed.data);
    if (token) void recordAudit({ actor: user, action: "DEVICE_SYNC_CONNECTED", entityType: "device", entityId: device.id, details: device.label ?? undefined, request });
    return ok({ id: device.id, deviceId: device.deviceId, syncPaused: device.syncPaused, notificationsEnabled: device.notificationsEnabled, hasPushToken: !!device.pushToken, syncToken: token ?? undefined }, token ? 201 : 200);
  } catch (err) {
    return errorResponse(err, "mobile.devices.post.route_error");
  }
}

const Patch = z.object({
  deviceId: z.string().min(16).max(64),
  syncPaused: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  /** FCM registration token; null removes it. */
  pushToken: z.string().min(20).max(4096).nullable().optional(),
  label: z.string().trim().max(120).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

/** PATCH /api/mobile/devices — pause / resume contact sync, push token (and its refresh), notification switch. */
export async function PATCH(request: Request) {
  try {
    requireSecureTransport(request);
    const { user } = await requireUser();
    const parsed = Patch.safeParse(await readJson(request));
    if (!parsed.success) return fail("Invalid device update.", 400);
    const { deviceId, pushToken, ...rest } = parsed.data;
    const device = await prisma.mobileDevice.findUnique({ where: { userId_deviceId: { userId: user.id, deviceId } } });
    if (!device || device.revokedAt) return fail("This phone isn't registered. Sign in to the app again.", 404);
    const updated = await prisma.$transaction(async (tx) => {
      if (pushToken) {
        // A token belongs to one phone and one account: when the same phone signs in as someone else, it moves.
        await tx.mobileDevice.updateMany({ where: { pushToken, id: { not: device.id } }, data: { pushToken: null, pushTokenUpdatedAt: new Date() } });
      }
      return tx.mobileDevice.update({
        where: { id: device.id },
        data: { ...rest, ...(pushToken !== undefined ? { pushToken, pushTokenUpdatedAt: new Date() } : {}), lastSeenAt: new Date() },
      });
    });
    if (rest.syncPaused !== undefined && rest.syncPaused !== device.syncPaused) {
      void recordAudit({ actor: user, action: rest.syncPaused ? "DEVICE_SYNC_PAUSED" : "DEVICE_SYNC_RESUMED", entityType: "device", entityId: device.id, request });
    }
    return ok({ syncPaused: updated.syncPaused, notificationsEnabled: updated.notificationsEnabled, hasPushToken: !!updated.pushToken });
  } catch (err) {
    return errorResponse(err, "mobile.devices.patch.route_error");
  }
}
