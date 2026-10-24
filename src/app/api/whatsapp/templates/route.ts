import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";

export const dynamic = "force-dynamic";

/** GET /api/whatsapp/templates — approved, active templates the inbox may send. */
export async function GET() {
  try {
    await requirePermission("leads.view");
    const rows = await prisma.whatsAppTemplate.findMany({ where: { status: "APPROVED", active: true }, orderBy: [{ name: "asc" }, { language: "asc" }] });
    return ok(rows.map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category, bodyPreview: t.bodyPreview, paramCount: t.paramCount })));
  } catch (err) {
    return errorResponse(err, "whatsapp.templates.route_error");
  }
}
