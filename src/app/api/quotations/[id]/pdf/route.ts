import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { getSystemSettings } from "@/lib/server/settings";
import { quoteDocument } from "@/lib/server/quotations";
import { buildQuotePdf } from "@/lib/server/pdf/documents";
import { pdfResponse } from "@/lib/server/pdf/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/quotations/[id]/pdf — the quotation as a PDF (?inline=1 to view in the browser). Needs `quotes.manage`. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("quotes.manage");
    const settings = await getSystemSettings();
    const doc = await quoteDocument(params.id, settings);
    return pdfResponse(await buildQuotePdf(doc, settings), `${doc.q.quoteNumber}.pdf`, request);
  } catch (err) {
    return errorResponse(err, "quotations.pdf.route_error");
  }
}
