import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { getOpsDateVisibility } from "@/lib/ops-visibility";
import { dispatchCutoffTime } from "@/lib/server/policy";
import {
  serializeCustomer,
  serializeProperty,
  serializeJob,
  redactJobForOps,
  serializeInvoice,
  serializePayment,
  serializeQuote,
  serializeComplaint,
  withStaffNames,
  fail,
} from "@/lib/server/serialize";

/**
 * GET /api/customers/[id] — the full 360° customer file: profile, properties,
 * booking history, financial transactions (super_admin ONLY), referral
 * attribution and support issues.
 *
 * ops_manager receives a financially redacted projection consistent with the
 * directory endpoint (no invoices/payments/quotes, no amounts) and, matching
 * the jobs API, only bookings inside the dispatch visibility window.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requireRole(["super_admin", "ops_manager"]);
    const { id } = params;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return fail("Customer not found.", 404);

    const [properties, jobRows, invoices, payments, quotes, complaints, partner] =
      await Promise.all([
        prisma.property.findMany({
          where: { customerId: id },
          orderBy: { createdAt: "desc" },
        }),
        prisma.job.findMany({
          where: { customerId: id },
          orderBy: { createdAt: "desc" },
          include: {
            customer: { select: { name: true, phone: true } },
            property: { select: { title: true, address: true } },
            service: {
              select: { id: true, name: true, basePrice: true, estimatedDurationHours: true },
            },
          },
        }),
        prisma.invoice.findMany({
          where: { customerId: id },
          orderBy: { issuedAt: "desc" },
        }),
        prisma.payment.findMany({
          where: { customerId: id },
          orderBy: { paidAt: "desc" },
        }),
        prisma.quote.findMany({
          where: { customerId: id },
          orderBy: { createdAt: "desc" },
        }),
        prisma.complaint.findMany({
          where: { customerId: id },
          orderBy: { createdAt: "desc" },
        }),
        customer.referralPartnerId
          ? prisma.referralPartner.findUnique({ where: { id: customer.referralPartnerId } })
          : Promise.resolve(null),
      ]);

    const isSuper = user.role === "super_admin";

    // Ops managers operate inside the dispatch visibility window on every
    // route — the customer file's booking history is no exception.
    let visibleJobs = jobRows;
    if (user.role === "ops_manager") {
      const visibility = getOpsDateVisibility(new Date(), {
        nextDayDispatchTime: dispatchCutoffTime(),
      });
      visibleJobs = jobRows.filter((j) => visibility.isDateVisible(j.scheduledDate));
    }

    const terminal = ["COMPLETED", "CANCELLED", "CLOSED"];
    const stats: Record<string, number> = {
      totalBookings: customer.totalBookings,
      completedJobs: visibleJobs.filter(
        (j) => j.status === "COMPLETED" || j.status === "CLOSED"
      ).length,
      activeJobs: visibleJobs.filter((j) => !terminal.includes(j.status)).length,
    };

    const partnerSummary = partner
      ? { id: partner.id, name: partner.name, code: partner.code, status: partner.status }
      : null;

    // Worker names + OTP verification state resolved server-side so booking
    // rows stay accurate for ops managers (who cannot read the user directory).
    const [users, verifiedChallenges] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true } }),
      prisma.otpChallenge.findMany({
        where: { jobId: { in: visibleJobs.map((j) => j.id) }, status: "VERIFIED" },
        select: { jobId: true, updatedAt: true, createdByUserId: true },
      }),
    ]);
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const verifiedByJob = new Map(
      verifiedChallenges.map((c) => [
        c.jobId,
        {
          status: "verified" as const,
          verifiedAt: c.updatedAt.toISOString(),
          verifiedBy: c.createdByUserId,
        },
      ])
    );
    const finalizeJob = (j: (typeof visibleJobs)[number]) =>
      withStaffNames(
        isSuper ? serializeJob(j, verifiedByJob.get(j.id)) : redactJobForOps(serializeJob(j, verifiedByJob.get(j.id))),
        nameById
      );

    if (!isSuper) {
      const customerData = serializeCustomer(customer);
      return NextResponse.json({
        success: true,
        data: {
          customer: { ...customerData, lifetimeRevenue: undefined },
          properties: properties.map(serializeProperty),
          jobs: visibleJobs.map(finalizeJob),
          complaints: complaints.map(serializeComplaint),
          partner: partnerSummary,
          stats,
        },
      });
    }

    // Financial truth for the super_admin: lifetime revenue from the
    // maintained counter, billing/collection/outstanding from the ledgers
    // (cancelled/refunded invoices excluded from the operating figures).
    const openInvoices = invoices.filter(
      (i) => i.status !== "CANCELLED" && i.status !== "REFUNDED"
    );
    stats.lifetimeRevenue = customer.lifetimeRevenue;
    stats.billedTotal = openInvoices.reduce((acc, i) => acc + i.total, 0);
    stats.collected = openInvoices.reduce((acc, i) => acc + i.amountPaid, 0);
    stats.outstanding = openInvoices.reduce((acc, i) => acc + i.balanceDue, 0);

    return NextResponse.json({
      success: true,
      data: {
        customer: serializeCustomer(customer),
        properties: properties.map(serializeProperty),
        jobs: visibleJobs.map(finalizeJob),
        invoices: invoices.map(serializeInvoice),
        payments: payments.map(serializePayment),
        quotes: quotes.map(serializeQuote),
        complaints: complaints.map(serializeComplaint),
        partner: partnerSummary,
        stats,
      },
    });
  } catch (err) {
    return errorResponse(err, "customers.get_one.route_error");
  }
}
