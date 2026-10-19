import { prisma } from "@/lib/server/prisma";
import { requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { requireDevice, requireSecureTransport } from "@/lib/server/devices";
import { syncStatus } from "@/lib/server/contact-sync";

/**
 * GET /api/mobile/contacts/status[?deviceId=…] — sync status for the Contact Sync screen:
 * the phone's own token, or the signed-in user's session plus this phone's deviceId.
 */
export async function GET(request: Request) {
  try {
    requireSecureTransport(request);
    if (request.headers.get("authorization")) {
      const { device } = await requireDevice(request, "contacts.sync");
      return ok(await syncStatus(device));
    }
    const { user } = await requireUser();
    const deviceId = new URL(request.url).searchParams.get("deviceId");
    const device = deviceId ? await prisma.mobileDevice.findUnique({ where: { userId_deviceId: { userId: user.id, deviceId } } }) : null;
    return ok(await syncStatus(device && !device.revokedAt ? device : null));
  } catch (err) {
    return errorResponse(err, "mobile.contacts.status.route_error");
  }
}
