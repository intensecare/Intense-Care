import { prisma } from "./prisma";
import { logger } from "./logger";
import { calculateCommissionAmount } from "@/lib/commission-engine";
import type { CommissionRule } from "@/lib/types";

/**
 * Server-authoritative commission settlement for a completed referred job.
 *
 * Idempotent: if an entry already exists for the job, this is a no-op that
 * returns the existing entry. Resolves the partner's rule (falling back to the
 * first active rule), computes the amount via the shared commission engine,
 * creates the entry, and increments the partner aggregates.
 *
 * Called from POST /api/audit (action "settle-commission") and automatically
 * from PATCH /api/jobs/[id] when a job transitions to COMPLETED with referral
 * attribution — settlement never depends on a client-side call firing.
 */
export async function settleCommissionForJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found.");
  if (!job.referralPartnerId) throw new Error("Job has no referral attribution.");

  const already = await prisma.commissionEntry.findFirst({ where: { jobId } });
  if (already) return already; // idempotent

  const partner = await prisma.referralPartner.findUnique({
    where: { id: job.referralPartnerId },
  });
  if (!partner) throw new Error("Referral partner not found.");

  const ruleRow = partner.commissionRuleId
    ? await prisma.commissionRule.findUnique({ where: { id: partner.commissionRuleId } })
    : await prisma.commissionRule.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  if (!ruleRow) {
    throw new Error("No commission rule configured. Create one on the Referrals page.");
  }

  const rule: CommissionRule = {
    id: ruleRow.id,
    name: ruleRow.name,
    partnerType: ruleRow.partnerType as CommissionRule["partnerType"],
    calculationType: ruleRow.calculationType as CommissionRule["calculationType"],
    value: ruleRow.value,
    tierRules: (ruleRow.tierRules as unknown as CommissionRule["tierRules"]) ?? undefined,
    serviceOverrides: (ruleRow.serviceOverrides as unknown as CommissionRule["serviceOverrides"]) ?? undefined,
    isDefault: ruleRow.isDefault,
    active: ruleRow.active,
  };

  const { amount, ruleApplied } = calculateCommissionAmount(rule, job.amount, job.serviceId);

  const entry = await prisma.commissionEntry.create({
    data: {
      partnerId: partner.id,
      jobId,
      bookingAmount: job.amount,
      commissionAmount: amount,
      ruleApplied,
    },
  });

  await prisma.referralPartner.update({
    where: { id: partner.id },
    data: {
      totalConversions: { increment: 1 },
      totalRevenueGenerated: { increment: job.amount },
      totalCommissionEarned: { increment: amount },
      totalCommissionPending: { increment: amount },
    },
  });

  logger.info("commission.settled", { jobId, partnerId: partner.id, amount });
  return entry;
}
