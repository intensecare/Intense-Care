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
  JOB_PROPERTY_SELECT,
  ok,
  readJson,
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
            property: { select: JOB_PROPERTY_SELECT },
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
        quotes: quotes.map((q) => serializeQuote(q)),
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

/** PATCH /api/customers/[id] — update customer by URL param */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user, scope } = await requirePermission("customers.update");
    const { id } = params;
    if (scope === "OWN" && id !== user.customerId) return fail("You can only update your own profile.", 403);

    const body = await readJson(request);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (v !== undefined && k !== "id") data[k] = v;
    }
    if (scope === "OWN") {
      for (const k of ["referralPartnerId", "source", "status", "notes"]) delete data[k];
    }

    if (Object.prototype.hasOwnProperty.call(data, "referralPartnerId")) {
      const nextPartnerId = (data.referralPartnerId as string | null) || null;
      const existing = await prisma.customer.findUnique({ where: { id } });
      if (!existing) return fail("Customer not found.", 404);
      const prevPartnerId = existing.referralPartnerId || null;

      if (nextPartnerId !== prevPartnerId) {
        if (nextPartnerId) {
          const partner = await prisma.referralPartner.findUnique({ where: { id: nextPartnerId } });
          if (!partner) return fail("Referral partner not found.", 404);
          data.referralCode = partner.code;
        } else {
          data.referralCode = null;
        }
        const counterOps = [];
        if (prevPartnerId) {
          counterOps.push(
            prisma.referralPartner.update({
              where: { id: prevPartnerId },
              data: { totalReferrals: { decrement: 1 } },
            })
          );
        }
        if (nextPartnerId) {
          counterOps.push(
            prisma.referralPartner.update({
              where: { id: nextPartnerId },
              data: { totalReferrals: { increment: 1 } },
            })
          );
        }
        if (counterOps.length > 0) await prisma.$transaction(counterOps);
      }
    }

    const updated = await prisma.customer.update({ where: { id }, data });
    return ok(serializeCustomer(updated));
  } catch (err) {
    return errorResponse(err, "customers.patch_one.route_error");
  }
}

/** DELETE /api/customers/[id] — remove customer by URL param */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requirePermission("customers.delete");
    const { id } = params;
    if (!id) return fail("Customer id is required.", 400);

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return fail("Customer not found.", 404);

    const jobCount = await prisma.job.count({ where: { customerId: id } });
    if (jobCount > 0) {
      return fail(
        `Customer has ${jobCount} job record(s) on file. Deactivate the customer instead of deleting to preserve booking history.`,
        409
      );
    }

    await prisma.customer.delete({ where: { id } });

    if (customer.referralPartnerId) {
      await prisma.referralPartner.update({
        where: { id: customer.referralPartnerId },
        data: { totalReferrals: { decrement: 1 } },
      }).catch(() => null);
    }

    return ok({ id, deleted: true });
  } catch (err) {
    return errorResponse(err, "customers.delete_one.route_error");
  }
}
