import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { errorResponse } from "@/lib/server/http";
import {
  serializePartner,
  serializeCommissionEntry,
  serializePayout,
} from "@/lib/server/serialize";
import { logger } from "@/lib/server/logger";

/**
 * GET /api/partner-portal/[code] — public, code-scoped partner dashboard data.
 *
 * The partner code acts as a capability token (same model as the portal handover
 * link): it resolves ONLY this partner's own aggregate stats, commission
 * ledger, and payout history. No cross-partner or operational data is exposed.
 */
export async function GET(
  _request: Request,
  { params }: { params: { code: string } }
) {
  try {
    const code = (params.code || "").trim();
    if (!code || code.length > 40) {
      return NextResponse.json({ success: false, error: "Invalid partner code." }, { status: 400 });
    }

    const partner = await prisma.referralPartner.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!partner) {
      return NextResponse.json({ success: false, error: "Partner not found." }, { status: 404 });
    }

    const [entries, payouts] = await Promise.all([
      prisma.commissionEntry.findMany({
        where: { partnerId: partner.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.payout.findMany({
        where: { partnerId: partner.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);

    logger.info("partner_portal.viewed", { partnerId: partner.id });

    return NextResponse.json({
      success: true,
      data: {
        partner: {
          name: partner.name,
          code: partner.code,
          partnerType: partner.partnerType,
          status: partner.status,
          totalReferrals: partner.totalReferrals,
          totalConversions: partner.totalConversions,
          totalRevenueGenerated: partner.totalRevenueGenerated,
          totalCommissionEarned: partner.totalCommissionEarned,
          totalCommissionPaid: partner.totalCommissionPaid,
          totalCommissionPending: partner.totalCommissionPending,
        },
        commissionEntries: entries.map(serializeCommissionEntry),
        payouts: payouts.map(serializePayout),
      },
    });
  } catch (err) {
    return errorResponse(err, "partner_portal.get.route_error");
  }
}
