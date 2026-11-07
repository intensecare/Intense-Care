import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { getSystemSettings } from "@/lib/server/settings";
import { rateLimit, clientIp } from "@/lib/server/qr-service";
import { quoteByToken, quoteDocument } from "@/lib/server/quotations";
import { buildQuotePdf } from "@/lib/server/pdf/documents";
import { pdfResponse } from "@/lib/server/pdf/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/quote/[token]/pdf — the customer downloads their own quotation from the share link (no login). */
export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    if (!rateLimit(`quote-pdf:${clientIp(request)}`, 20, 60_000).ok) return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    const q = await quoteByToken(params.token);
    if (!q) return NextResponse.json({ success: false, error: "This quotation link is not valid." }, { status: 404 });
    const settings = await getSystemSettings();
    const doc = await quoteDocument(q.id, settings);
    return pdfResponse(await buildQuotePdf(doc, settings), `${doc.q.quoteNumber}.pdf`, request);
  } catch (err) {
    return errorResponse(err, "quote.public.pdf_error");
  }
}
