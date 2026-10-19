import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { csvResponse, parsePaging } from "@/lib/server/biz";
import { contactWhere, serializeContacts } from "@/lib/server/contacts-directory";
import { deleteDeviceContacts } from "@/lib/server/contact-sync";

/**
 * GET /api/contacts — the Contacts directory (contacts.view, Admin).
 * Filters: q (name / number / email), status=ACTIVE|REMOVED|ALL, link=customer|lead|none, deviceId (row id), dup=1;
 * sort=name|synced|added; page / pageSize. ?format=csv exports the filtered list.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("contacts.view");
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k);
    const where = await contactWhere({ q: g("q"), status: g("status"), link: g("link"), deviceRowId: g("deviceId"), dup: g("dup") === "1" });
    const sort = g("sort");
    const orderBy = sort === "synced" ? [{ lastSyncedAt: "desc" as const }] : sort === "added" ? [{ firstSyncedAt: "desc" as const }] : [{ displayName: "asc" as const }];
    if (g("format") === "csv") {
      const rows = await serializeContacts(await prisma.phoneContact.findMany({ where, orderBy, take: 10000, include: { numbers: true } }));
      void recordAudit({ actor: user, action: "CONTACTS_EXPORTED", entityType: "contact", entityId: "export", details: `${rows.length} rows`, request });
      return csvResponse("phone_contacts", rows.map((r) => ({ Name: r.name, Phones: r.phones.join(" / "), Emails: r.emails.join(" / "), Status: r.status, Customer: r.customer?.name ?? "", Lead: r.lead?.leadNumber ?? "", "Last synced": r.lastSyncedAt.slice(0, 10), Phone: r.deviceLabel ?? "" })));
    }
    const { page, pageSize, skip, take } = parsePaging(url, 50, 200);
    const [rows, total] = await Promise.all([prisma.phoneContact.findMany({ where, orderBy, skip, take, include: { numbers: true } }), prisma.phoneContact.count({ where })]);
    return ok({ rows: await serializeContacts(rows), total, page, pageSize });
  } catch (err) {
    return errorResponse(err, "contacts.get.route_error");
  }
}

const PurgeBody = z.object({ deviceId: z.string().min(1).max(64), confirm: z.literal(true) });

/** DELETE /api/contacts — delete every contact a phone uploaded ({deviceId: row id, confirm: true}). Customers and leads stay. */
export async function DELETE(request: Request) {
  try {
    const { user } = await requirePermission("contacts.manage");
    const parsed = PurgeBody.safeParse(await readJson(request));
    if (!parsed.success) return fail("Confirm which phone's contacts to delete.", 400);
    const device = await prisma.mobileDevice.findUnique({ where: { id: parsed.data.deviceId } });
    if (!device) return fail("Phone not found.", 404);
    const n = await deleteDeviceContacts(device.id);
    void recordAudit({ actor: user, action: "CONTACTS_DELETED", entityType: "device", entityId: device.id, details: `${n} contacts`, request });
    return ok({ deleted: n });
  } catch (err) {
    return errorResponse(err, "contacts.delete.route_error");
  }
}
