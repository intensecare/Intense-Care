import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";

/**
 * GET /api/contacts/duplicates — what needs a person's eye. Nothing here is merged automatically:
 *  sharedNumbers      contacts on the SAME phone that share a number (a duplicate card, or one number for two people)
 *  multipleCustomers  a contact whose number matches more than one ERP customer
 */
export async function GET() {
  try {
    await requirePermission("contacts.view");
    const shared = await prisma.$queryRaw<{ phoneKey: string; e164: string; contactId: string; name: string; deviceRowId: string }[]>`
      SELECT n."phoneKey", n.e164, c.id AS "contactId", c."displayName" AS name, c."deviceRowId"
      FROM "PhoneContactNumber" n
      JOIN "PhoneContact" c ON c.id = n."contactId" AND c.status = 'ACTIVE' AND c."dupDismissedAt" IS NULL
      WHERE (SELECT count(DISTINCT n2."contactId") FROM "PhoneContactNumber" n2 JOIN "PhoneContact" c2 ON c2.id = n2."contactId" AND c2.status = 'ACTIVE'
             WHERE n2."phoneKey" = n."phoneKey" AND c2."deviceRowId" = c."deviceRowId") > 1
      ORDER BY n."phoneKey", c."displayName" LIMIT 2000`;
    const groups = new Map<string, { phone: string; contacts: { id: string; name: string }[] }>();
    for (const r of shared) {
      const k = `${r.deviceRowId}:${r.phoneKey}`;
      const g = groups.get(k) ?? { phone: r.e164, contacts: [] };
      if (!g.contacts.some((c) => c.id === r.contactId)) g.contacts.push({ id: r.contactId, name: r.name });
      groups.set(k, g);
    }
    const multi = await prisma.$queryRaw<{ contactId: string; name: string; customerId: string; customerName: string }[]>`
      SELECT c.id AS "contactId", c."displayName" AS name, cu.id AS "customerId", cu.name AS "customerName"
      FROM "PhoneContact" c
      JOIN "PhoneContactNumber" n ON n."contactId" = c.id
      JOIN "Customer" cu ON right(regexp_replace(cu.phone, '\\D', '', 'g'), 10) = n."phoneKey" AND cu.status <> 'inactive'
      WHERE c.status = 'ACTIVE' AND c."customerId" IS NULL
        AND (SELECT count(DISTINCT cu2.id) FROM "PhoneContactNumber" n2 JOIN "Customer" cu2 ON right(regexp_replace(cu2.phone, '\\D', '', 'g'), 10) = n2."phoneKey" AND cu2.status <> 'inactive' WHERE n2."contactId" = c.id) > 1
      ORDER BY c."displayName" LIMIT 2000`;
    const byContact = new Map<string, { id: string; name: string; customers: { id: string; name: string }[] }>();
    for (const r of multi) {
      const e = byContact.get(r.contactId) ?? { id: r.contactId, name: r.name, customers: [] };
      if (!e.customers.some((c) => c.id === r.customerId)) e.customers.push({ id: r.customerId, name: r.customerName });
      byContact.set(r.contactId, e);
    }
    return ok({ sharedNumbers: Array.from(groups.values()), multipleCustomers: Array.from(byContact.values()) });
  } catch (err) {
    return errorResponse(err, "contacts.duplicates.route_error");
  }
}

const Dismiss = z.object({ contactIds: z.array(z.string().min(1).max(64)).min(1).max(200) });

/** POST /api/contacts/duplicates — "these are not duplicates": hides them from the review until the contact changes. */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("contacts.manage");
    const parsed = Dismiss.safeParse(await readJson(request));
    if (!parsed.success) return fail("Choose the contacts to dismiss.", 400);
    const r = await prisma.phoneContact.updateMany({ where: { id: { in: parsed.data.contactIds } }, data: { dupDismissedAt: new Date() } });
    void recordAudit({ actor: user, action: "CONTACT_DUPLICATES_DISMISSED", entityType: "contact", entityId: "bulk", details: `${r.count}`, request });
    return ok({ dismissed: r.count });
  } catch (err) {
    return errorResponse(err, "contacts.duplicates.post.route_error");
  }
}
