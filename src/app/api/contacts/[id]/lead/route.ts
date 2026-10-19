import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { importContactAsLead, SyncRequestError } from "@/lib/server/contact-sync";

/** POST /api/contacts/[id]/lead — import one contact as a PHONE_CONTACT lead (idempotent; never for an existing customer). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("contacts.manage");
    await requirePermission("leads.manage");
    const out = await importContactAsLead(params.id, user, `imported by ${user.name}`);
    if (out.state === "ALREADY_CUSTOMER") return fail("This number already belongs to an existing customer, so it wasn't turned into a lead.", 409);
    if (out.state === "CREATED") void recordAudit({ actor: user, action: "CONTACT_IMPORTED_AS_LEAD", entityType: "contact", entityId: params.id, details: out.leadNumber, request });
    return ok(out, out.state === "CREATED" ? 201 : 200);
  } catch (err) {
    if (err instanceof SyncRequestError) return fail(err.message, 404);
    return errorResponse(err, "contacts.lead.route_error");
  }
}
