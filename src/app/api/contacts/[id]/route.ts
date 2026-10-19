import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { serializeContacts } from "@/lib/server/contacts-directory";

async function load(id: string) {
  return prisma.phoneContact.findUnique({ where: { id }, include: { numbers: true } });
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("contacts.view");
    const c = await load(params.id);
    if (!c) return fail("Contact not found.", 404);
    return ok((await serializeContacts([c]))[0]);
  } catch (err) {
    return errorResponse(err, "contacts.get_one.route_error");
  }
}

const Patch = z.object({
  /** Link to this customer (it must share a phone number with the contact). null unlinks. */
  customerId: z.string().max(64).nullable().optional(),
  importState: z.enum(["NONE", "IGNORED"]).optional(),
});

/** PATCH /api/contacts/[id] — choose the customer an ambiguous contact belongs to, or mark it "not a lead". */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("contacts.manage");
    const parsed = Patch.safeParse(await readJson(request));
    if (!parsed.success) return fail("Invalid update.", 400);
    const c = await load(params.id);
    if (!c) return fail("Contact not found.", 404);
    const data: Record<string, unknown> = {};
    if (parsed.data.customerId !== undefined) {
      if (parsed.data.customerId) {
        const keys = c.numbers.map((n) => n.phoneKey);
        const match = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Customer" WHERE id = ${parsed.data.customerId} AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ANY(${keys}::text[])`;
        if (!match.length) return fail("That customer doesn't have any of this contact's phone numbers.", 400);
      }
      data.customerId = parsed.data.customerId;
    }
    if (parsed.data.importState !== undefined) {
      if (c.leadId && parsed.data.importState === "IGNORED") return fail("This contact is already a lead.", 409);
      data.importState = parsed.data.importState;
    }
    await prisma.phoneContact.update({ where: { id: c.id }, data });
    void recordAudit({ actor: user, action: "CONTACT_UPDATED", entityType: "contact", entityId: c.id, details: Object.keys(data).join(","), request });
    return ok((await serializeContacts([(await load(c.id))!]))[0]);
  } catch (err) {
    return errorResponse(err, "contacts.patch.route_error");
  }
}

/** DELETE /api/contacts/[id] — remove one contact from the directory (the customer / lead it was linked to is untouched). */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("contacts.manage");
    const c = await load(params.id);
    if (!c) return fail("Contact not found.", 404);
    await prisma.phoneContact.delete({ where: { id: c.id } });
    void recordAudit({ actor: user, action: "CONTACT_DELETED", entityType: "contact", entityId: c.id, request });
    return ok({ deleted: true });
  } catch (err) {
    return errorResponse(err, "contacts.delete_one.route_error");
  }
}
