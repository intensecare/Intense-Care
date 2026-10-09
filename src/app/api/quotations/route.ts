import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson, serializeQuote } from "@/lib/server/serialize";
import { getSystemSettings } from "@/lib/server/settings";
import { recordAudit } from "@/lib/server/audit";
import { QuoteInputSchema, buildQuoteData, nextQuoteNumber } from "@/lib/server/quotations";

/** GET /api/quotations — every quotation, newest first (Admin). */
export async function GET() {
  try {
    await requirePermission("quotes.manage");
    const rows = await prisma.quote.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    const [customers, properties] = await Promise.all([
      prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } }),
      prisma.property.findMany({ where: { id: { in: rows.map((r) => r.propertyId).filter((x): x is string => !!x) } }, select: { id: true, title: true } }),
    ]);
    const cn = new Map(customers.map((c) => [c.id, c.name]));
    const pn = new Map(properties.map((p) => [p.id, p.title]));
    return ok(rows.map((r) => serializeQuote(r, { customerName: cn.get(r.customerId), propertyTitle: r.propertyId ? pn.get(r.propertyId) : undefined })));
  } catch (err) {
    return errorResponse(err, "quotations.get.route_error");
  }
}

/** POST /api/quotations — create a quotation (draft or sent). */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("quotes.manage");
    const parsed = QuoteInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid quotation.", 400);
    const settings = await getSystemSettings();
    const data = await buildQuoteData(parsed.data, settings);
    const created = await prisma.quote.create({ data: { ...data, quoteNumber: await nextQuoteNumber(), status: parsed.data.status } });
    void recordAudit({ actor: user, action: "QUOTE_CREATED", entityType: "quote", entityId: created.id, details: `${created.quoteNumber} ₹${created.total}`, request });
    return ok(serializeQuote(created), 201);
  } catch (err) {
    return errorResponse(err, "quotations.post.route_error");
  }
}
