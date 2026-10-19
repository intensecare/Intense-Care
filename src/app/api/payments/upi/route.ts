import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";

/**
 * GET /api/payments/upi?status=SUBMITTED|INITIATED|VERIFIED|REJECTED|CANCELLED|ALL&invoiceId=…
 * UPI payment requests for review (Admin — `payment.record`). Newest submissions first.
 */
export async function GET(request: Request) {
  try {
    await requirePermission("payment.record");
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "SUBMITTED";
    const invoiceId = url.searchParams.get("invoiceId");
    const rows = await prisma.upiPaymentAttempt.findMany({
      where: { ...(status !== "ALL" ? { status } : {}), ...(invoiceId ? { invoiceId } : {}) },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { events: { orderBy: { at: "asc" } } },
    });
    const invoices = await prisma.invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId) } }, select: { id: true, invoiceNumber: true, invoiceType: true, total: true, balanceDue: true, status: true, job: { select: { jobSerial: true, customer: { select: { name: true } } } } } });
    const byId = new Map(invoices.map((i) => [i.id, i]));
    return ok(
      rows.map((r) => {
        const i = byId.get(r.invoiceId);
        return {
          id: r.id,
          status: r.status,
          reference: r.reference,
          amount: r.amount,
          utr: r.utr,
          payerNote: r.payerNote,
          payeeVpa: r.payeeVpa,
          createdAt: r.createdAt.toISOString(),
          submittedAt: r.submittedAt?.toISOString() ?? null,
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          reviewedByName: r.reviewedByName,
          reviewNote: r.reviewNote,
          invoice: i ? { id: i.id, number: i.invoiceNumber, type: i.invoiceType, total: i.total, balanceDue: i.balanceDue, status: i.status } : null,
          jobSerial: i?.job.jobSerial ?? null,
          customerName: i?.job.customer.name ?? null,
          events: r.events.map((e) => ({ at: e.at.toISOString(), from: e.fromStatus, to: e.toStatus, by: e.actorType === "ADMIN" ? e.actorName : e.actorType === "CUSTOMER" ? "Customer" : "System", note: e.note })),
        };
      })
    );
  } catch (err) {
    return errorResponse(err, "payments.upi.list.route_error");
  }
}
