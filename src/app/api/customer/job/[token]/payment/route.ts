import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { getSystemSettings, resolveVisibility } from "@/lib/server/settings";
import { prisma } from "@/lib/server/prisma";
import { HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { cancelAttempt, paymentBlock, startAttempt, submitAttempt, payableInvoice } from "@/lib/server/payments";
import { recordAudit } from "@/lib/server/audit";
import { readJson } from "@/lib/server/serialize";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("submit"), attemptId: z.string().min(1).max(64), utr: z.string().min(1).max(60), payerNote: z.string().max(200).optional() }),
  z.object({ action: z.literal("cancel"), attemptId: z.string().min(1).max(64) }),
]);

const json = (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status, headers: { "Cache-Control": "no-store" } });
const err = (message: string, status: number) => NextResponse.json({ success: false, error: message }, { status });

/**
 * POST /api/customer/job/[token]/payment — the customer's "Pay now" for THEIR job's invoice (the secure link is the credential).
 *   start   → creates (or reuses) a payment request for the invoice's outstanding balance and returns the UPI link.
 *             The browser sends NO amount: the server reads it from the invoice.
 *   submit  → the customer reports the UTR from their UPI app. This does NOT mark anything paid — an Admin verifies it.
 *   cancel  → "I didn't pay".
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    if (!rateLimit(`pay:${clientIp(request)}`, 40, 10 * 60 * 1000).ok) return err("Too many attempts. Please wait a few minutes.", 429);
    const resolved = await resolveQrToken(params.token);
    if (!resolved.ok) return err(resolved.failure.message, resolved.failure.kind === "not_found" ? 404 : 410);
    const job = resolved.data.job;
    // Same visibility rule as the invoice itself: a customer who isn't shown the invoice can't pay it from here either.
    const [settings, jobRow] = await Promise.all([getSystemSettings(), prisma.job.findUnique({ where: { id: job.id }, select: { customerVisibility: true } })]);
    if (!resolveVisibility(settings.customerVisibility, jobRow?.customerVisibility).invoice) return err("There is no invoice to pay on this link.", 404);

    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) return err("Invalid payment request.", 400);
    const body = parsed.data;

    if (body.action === "start") {
      const r = await startAttempt(job.id);
      void recordAudit({ actor: { id: "customer", name: job.customerName, role: "customer" }, action: "UPI_PAYMENT_INITIATED", entityType: "invoice", entityId: r.invoice.id, jobId: job.id, details: `₹${r.attempt.amount} ref ${r.attempt.reference}${r.reused ? " (reused)" : ""}`, request });
      return json({ attemptId: r.attempt.id, reference: r.attempt.reference, amount: r.attempt.amount, payeeName: r.attempt.payeeName, vpa: r.attempt.payeeVpa, upiUri: r.upiUri, invoiceNumber: r.invoice.invoiceNumber });
    }
    if (body.action === "submit") {
      const r = await submitAttempt(job.id, body.attemptId, body.utr, body.payerNote);
      if (!r.replayed) void recordAudit({ actor: { id: "customer", name: job.customerName, role: "customer" }, action: "UPI_PAYMENT_SUBMITTED", entityType: "invoice", entityId: r.attempt.invoiceId, jobId: job.id, details: `ref ${r.attempt.reference} utr …${r.attempt.utr?.slice(-4)}`, request });
    } else {
      await cancelAttempt(job.id, body.attemptId);
    }
    const inv = await payableInvoice(job.id);
    return json({ payment: inv ? await paymentBlock(inv) : null });
  } catch (e) {
    if (e instanceof HttpError) return err(e.message, e.status);
    return errorResponse(e, "customer.payment.route_error");
  }
}
