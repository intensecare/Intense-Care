import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { errorResponse } from "@/lib/server/http";
import { serializeQuote } from "@/lib/server/serialize";
import { getSystemSettings } from "@/lib/server/settings";
import { rateLimit, clientIp } from "@/lib/server/qr-service";
import { quoteByToken, quoteDocument } from "@/lib/server/quotations";
import { recordActivity } from "@/lib/server/activity";

/**
 * The customer's view of ONE quotation, by its share token (no login).
 * Returns only what is printed on the quotation; accept / decline once.
 */
export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    if (!rateLimit(`quote-view:${clientIp(request)}`, 60, 60_000).ok) return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    const q = await quoteByToken(params.token);
    if (!q) return NextResponse.json({ success: false, error: "This quotation link is not valid." }, { status: 404 });
    const doc = await quoteDocument(q.id, await getSystemSettings());
    const quote = serializeQuote(doc.q, { customerName: doc.customer.name, propertyTitle: doc.property?.title });
    return NextResponse.json(
      {
        success: true,
        data: {
          quote: { ...quote, jobId: undefined, customerId: undefined, propertyId: undefined },
          customer: { name: doc.customer.name, address: doc.customer.address, gstin: quote.quoteType === "GST" ? doc.customer.gstin : null },
          property: doc.property,
          company: doc.company,
        },
      },
      { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }
    );
  } catch (err) {
    return errorResponse(err, "quote.public.get_error");
  }
}

const ActSchema = z.object({ action: z.enum(["accept", "decline"]), name: z.string().trim().min(2).max(120) });

export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    if (!rateLimit(`quote-act:${clientIp(request)}`, 10, 60_000).ok) return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
    const q = await quoteByToken(params.token);
    if (!q) return NextResponse.json({ success: false, error: "This quotation link is not valid." }, { status: 404 });
    const parsed = ActSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Please type your name." }, { status: 400 });
    const status = serializeQuote(q).status;
    if (status !== "sent" && status !== "draft") {
      return NextResponse.json({ success: false, error: status === "expired" ? "This quotation has expired. Please ask us for a new one." : "This quotation has already been answered." }, { status: 409 });
    }
    await prisma.quote.update({
      where: { id: q.id },
      data: parsed.data.action === "accept" ? { status: "accepted", acceptedAt: new Date(), acceptedBy: parsed.data.name } : { status: "declined", acceptedBy: parsed.data.name },
    });
    if (q.jobId) {
      await recordActivity({ jobId: q.jobId, type: "STATUS_CHANGED", message: `Customer ${parsed.data.action === "accept" ? "accepted" : "declined"} quotation ${q.quoteNumber}`, actor: { name: parsed.data.name, role: "customer" } }).catch(() => {});
    }
    return NextResponse.json({ success: true, data: { status: parsed.data.action === "accept" ? "accepted" : "declined" } });
  } catch (err) {
    return errorResponse(err, "quote.public.post_error");
  }
}
