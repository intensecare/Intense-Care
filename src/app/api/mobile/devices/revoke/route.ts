import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireUser, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { revokeDevice, requireDevice, requireSecureTransport } from "@/lib/server/devices";
import { deleteDeviceContacts } from "@/lib/server/contact-sync";
import { can } from "@/lib/rbac";

const Body = z.object({
  /** The phone's own id (from the app), or … */
  deviceId: z.string().min(16).max(64).optional(),
  /** … an Admin removing a phone from the Contacts page. */
  rowId: z.string().min(1).max(64).optional(),
  /** Also delete the contacts this phone uploaded (customers and leads are never deleted). */
  deleteContacts: z.boolean().default(false),
});

/**
 * POST /api/mobile/devices/revoke — disconnect a phone: its sync token and push
 * registration stop working at once. Allowed for the phone itself (session cookie
 * or its own token — so it can disconnect even after the session expired) and for
 * an Admin with contacts.manage.
 */
export async function POST(request: Request) {
  try {
    requireSecureTransport(request);
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success || (!parsed.data.deviceId && !parsed.data.rowId)) return fail("Say which phone to disconnect.", 400);
    const { deviceId, rowId, deleteContacts } = parsed.data;

    let target;
    let actor: { id: string; name: string; role?: string };
    if (request.headers.get("authorization")) {
      const ctx = await requireDevice(request, "contacts.sync");
      target = ctx.device;
      actor = { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role };
    } else {
      const { user } = await requireUser();
      actor = user;
      target = rowId
        ? await prisma.mobileDevice.findUnique({ where: { id: rowId } })
        : await prisma.mobileDevice.findUnique({ where: { userId_deviceId: { userId: user.id, deviceId: deviceId! } } });
      if (!target) return fail("Phone not found.", 404);
      if (target.userId !== user.id && !can(user, "contacts.manage")) throw new HttpError(403, "Your role is not authorized for this action.");
    }
    await revokeDevice(target);
    const deleted = deleteContacts ? await deleteDeviceContacts(target.id) : 0;
    void recordAudit({ actor: actor as never, action: "DEVICE_SYNC_DISCONNECTED", entityType: "device", entityId: target.id, details: deleteContacts ? `contacts deleted: ${deleted}` : "contacts kept", request });
    return ok({ disconnected: true, contactsDeleted: deleted });
  } catch (err) {
    return errorResponse(err, "mobile.devices.revoke.route_error");
  }
}
