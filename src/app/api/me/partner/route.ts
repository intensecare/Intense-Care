import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { resolveBaseUrl } from "@/lib/server/policy";
import { partnerStageLabel } from "@/lib/rbac";

/**
 * GET /api/me/partner — the Referral Partner workspace ("My Referrals").
 *
 * Only for a partner login (referrals.view = OWN with a linked partner).
 * Exposes the partner's OWN funnel, commission ledger, payouts and referral
 * link. Referred jobs appear at summary level only (stage + date) — never
 * operations, QC, staff or company finance.
 */
export async function GET(request: Request) {
  try {
    const { user, scope } = await requirePermission("referrals.view");
    if (scope !== "OWN" || !user.referralPartnerId) {
      return NextResponse.json({ success: false, error: "This workspace is for referral partner accounts." }, { status: 403 });
    }
    const partner = await prisma.referralPartner.findUnique({ where: { id: user.referralPartnerId } });
    if (!partner) return NextResponse.json({ success: false, error: "Partner not found." }, { status: 404 });

    const [entries, payouts, leads, referredJobs] = await Promise.all([
      prisma.commissionEntry.findMany({ where: { partnerId: partner.id }, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.payout.findMany({ where: { partnerId: partner.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.customer.count({ where: { referralPartnerId: partner.id } }),
      prisma.job.findMany({
        where: { referralPartnerId: partner.id },
        orderBy: { scheduledDate: "desc" },
        take: 200,
        select: { id: true, status: true, scheduledDate: true, service: { select: { name: true } } },
      }),
    ]);

    const origin = resolveBaseUrl(new URL(request.url).origin);
    const booked = referredJobs.filter((j) => j.status !== "CANCELLED").length;
    const completed = referredJobs.filter((j) => ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"].includes(j.status)).length;

    return NextResponse.json({
      success: true,
      data: {
        partner: { name: partner.name, code: partner.code, partnerType: partner.partnerType, status: partner.status },
        referralLink: `${origin}/partner-portal/${partner.code}`,
        bookingLink: `${origin}/refer/${encodeURIComponent(partner.code)}`,
        funnel: { leads: Math.max(leads, partner.totalReferrals), booked, completed },
        money: {
          revenue: partner.totalRevenueGenerated,
          commission: partner.totalCommissionEarned,
          pending: partner.totalCommissionPending,
          paid: partner.totalCommissionPaid,
        },
        jobs: referredJobs.map((j) => ({ id: j.id, stage: partnerStageLabel(j.status), scheduledDate: j.scheduledDate, serviceName: j.service?.name ?? null })),
        commissionEntries: entries.map((e) => ({
          id: e.id,
          jobId: e.jobId,
          bookingAmount: e.bookingAmount,
          commissionAmount: e.commissionAmount,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
          approvedAt: e.approvedAt?.toISOString() ?? null,
        })),
        payouts: payouts.map((p) => ({ id: p.id, amount: p.amount, method: p.payoutMethod, reference: p.referenceNumber, status: p.status, paidAt: p.paidAt.toISOString() })),
      },
    });
  } catch (err) {
    return errorResponse(err, "me.partner.route_error");
  }
}
