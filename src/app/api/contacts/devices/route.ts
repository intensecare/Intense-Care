import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { syncStatus } from "@/lib/server/contact-sync";

/** GET /api/contacts/devices — the phones that sync contacts, with their last run and counts (contacts.view). */
export async function GET() {
  try {
    await requirePermission("contacts.view");
    // Phones that are connected, plus disconnected ones that still hold contacts (so they can be cleaned up).
    const withContacts = (await prisma.phoneContact.groupBy({ by: ["deviceRowId"] })).map((g) => g.deviceRowId);
    const devices = await prisma.mobileDevice.findMany({
      where: { OR: [{ syncTokenHash: { not: null } }, { id: { in: withContacts } }] },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
    });
    const users = await prisma.user.findMany({ where: { id: { in: devices.map((d) => d.userId) } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    const rows = await Promise.all(devices.map(async (d) => ({ id: d.id, owner: name.get(d.userId) ?? "—", appVersion: d.appVersion, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, status: await syncStatus(d) })));
    return ok(rows);
  } catch (err) {
    return errorResponse(err, "contacts.devices.route_error");
  }
}
