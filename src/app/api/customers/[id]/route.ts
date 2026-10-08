import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, dispatchWindowApplies } from "@/lib/server/authz";
import { can } from "@/lib/rbac";
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
 * booking history, financial transactions (Admin ONLY), referral
 * attribution and support issues.
 *
 * ops_manager receives a financially redacted projection consistent with the
 * directory endpoint (no invoices/payments/quotes, no amounts) and, matching
 * the jobs API, only bookings inside the dispatch visibility window.
 */

/** Role-safe AMC summary attached to the 360° customer file. */
function serializeAmcContractSummary(c: {
  id: string;
  contractNumber: string;
  status: string;
  paymentStatus: string;
  startDate: string;
  endDate: string;
  contractValue: number;
  visitCount: number;
  frequency: string;
  serviceId: string | null;
  visits: { id: string; visitNumber: number; scheduledDate: string; status: string; jobId: string | null }[];
}) {
  return {
    id: c.id,
    contractNumber: c.contractNumber,
    status: c.status,
    paymentStatus: c.paymentStatus,
    startDate: c.startDate,
    endDate: c.endDate,
    contractValue: c.contractValue,
    visitCount: c.visitCount,
    frequency: c.frequency,
    serviceId: c.serviceId,
    visits: c.visits.map((v) => ({
      id: v.id,
      visitNumber: v.visitNumber,
      scheduledDate: v.scheduledDate,
      status: v.status,
      jobId: v.jobId,
    })),
  };
}
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user, scope } = await requirePermission("customers.view");
    const { id } = params;
    // OWN scope (customer login) may open only their own file.
    if (scope === "OWN" && id !== user.customerId) return fail("Customer not found.", 404);
    if (scope === "ASSIGNED" || scope === "TEAM" || scope === "BRANCH") {
      return fail("Customer files are not available in the field app.", 403);
    }

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return fail("Customer not found.", 404);

    const [properties, jobRows, invoices, payments, quotes, complaints, partner, amcContracts] =
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
        prisma.amcContract.findMany({
          where: { customerId: id },
          orderBy: { createdAt: "desc" },
          include: { visits: { orderBy: { visitNumber: "asc" } } },
        }),
      ]);

    // Financial detail follows finance.view, never a role name.
    const isSuper = can(user, "finance.view");

    // Ops managers operate inside the dispatch visibility window on every
    // route — the customer file's booking history is no exception.
    let visibleJobs = jobRows;
    if (dispatchWindowApplies(user)) {
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

    // Worker names resolved server-side so booking rows stay accurate for ops
    // managers (who cannot read the user directory).
    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const finalizeJob = (j: (typeof visibleJobs)[number]) =>
      withStaffNames(
        isSuper ? serializeJob(j) : redactJobForOps(serializeJob(j)),
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
          // Same redaction posture as the job rows: ops never receives the
          // contract's financial value.
          amcContracts: amcContracts.map((c) => {
            const s = serializeAmcContractSummary(c);
            return { ...s, contractValue: undefined };
          }),
          complaints: complaints.map(serializeComplaint),
          partner: partnerSummary,
          stats,
        },
      });
    }

    // Financial truth for the Admin: lifetime revenue from the
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
        amcContracts: amcContracts.map(serializeAmcContractSummary),
        stats,
      },
    });
  } catch (err) {
    return errorResponse(err, "customers.get_one.route_error");
  }
}
