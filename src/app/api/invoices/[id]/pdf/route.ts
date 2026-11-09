import { requireAnyPermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { getSystemSettings } from "@/lib/server/settings";
import { loadInvoiceDetail } from "@/lib/server/invoice-detail";
import { buildInvoicePdf } from "@/lib/server/pdf/documents";
import { pdfResponse } from "@/lib/server/pdf/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/invoices/[id]/pdf — the invoice as a PDF. Same access rules as the invoice page: a Tax Officer can only
 * open GST invoices (a Non-GST id answers 404), and contact details are Admin-only.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireAnyPermission(["finance.view", "gst.view"]);
    const detail = await loadInvoiceDetail(user, params.id);
    return pdfResponse(await buildInvoicePdf(detail, await getSystemSettings()), `${detail.invoice.invoiceNumber}.pdf`, request);
  } catch (err) {
    return errorResponse(err, "invoices.pdf.route_error");
  }
}
