import { z } from "zod";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { fail, ok, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { rejectAttempt, verifyAttempt } from "@/lib/server/payments";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), amount: z.number().min(0.01).max(100_000_000).optional(), utr: z.string().max(60).optional(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
]);

/**
 * POST /api/payments/upi/[id] — an authorised Admin (`payment.record`) settles a customer's UPI payment request.
 *   verify → "the money is in the bank": records the Payment on the invoice (once, row-locked). The amount defaults to the
 *            requested amount; enter what actually arrived for a part payment. A UTR is required.
 *   reject → "not received / wrong": the request is closed with a reason the customer can see.
 * Both are idempotent; every change is written to the attempt's audit trail and the audit log.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("payment.record");
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid request.", 400);
    const by = { id: user.id, name: user.name };
    if (parsed.data.action === "verify") {
      const r = await verifyAttempt(params.id, by, parsed.data);
      if (!r.replayed) void recordAudit({ actor: user, action: "UPI_PAYMENT_VERIFIED", entityType: "invoice", entityId: r.attempt.invoiceId, details: `₹${r.payment?.amount} ref ${r.attempt.utr}`, request });
      return ok({ status: r.attempt.status, invoiceStatus: "invoiceStatus" in r ? r.invoiceStatus : undefined, replayed: r.replayed });
    }
    const a = await rejectAttempt(params.id, by, parsed.data.reason);
    void recordAudit({ actor: user, action: "UPI_PAYMENT_REJECTED", entityType: "invoice", entityId: a.invoiceId, details: parsed.data.reason, request });
    return ok({ status: a.status });
  } catch (err) {
    return errorResponse(err, "payments.upi.action.route_error");
  }
}
