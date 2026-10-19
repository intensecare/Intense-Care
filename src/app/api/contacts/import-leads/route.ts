import { z } from "zod";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { importContactAsLead } from "@/lib/server/contact-sync";

const Body = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) });

/** POST /api/contacts/import-leads — import the selected contacts (up to 100) as leads. Existing customers are skipped, not duplicated. */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("contacts.manage");
    await requirePermission("leads.manage");
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) return fail("Select 1 to 100 contacts.", 400);
    const summary = { created: 0, linked: 0, alreadyImported: 0, alreadyCustomer: 0, failed: 0 };
    for (const id of Array.from(new Set(parsed.data.ids))) {
      try {
        const out = await importContactAsLead(id, user, `imported by ${user.name}`);
        if (out.state === "CREATED") summary.created++;
        else if (out.state === "LINKED") summary.linked++;
        else if (out.state === "ALREADY_IMPORTED") summary.alreadyImported++;
        else summary.alreadyCustomer++;
      } catch {
        summary.failed++;
      }
    }
    void recordAudit({ actor: user, action: "CONTACTS_IMPORTED_AS_LEADS", entityType: "contact", entityId: "bulk", details: JSON.stringify(summary), request });
    return ok(summary);
  } catch (err) {
    return errorResponse(err, "contacts.import_leads.route_error");
  }
}
