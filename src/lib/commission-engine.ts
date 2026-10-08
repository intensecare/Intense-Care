import { CommissionRule, CommissionEntry, ReferralPartner, Job, CommissionStatus } from "./types";
import { generateId } from "./utils";

export function calculateCommissionAmount(
  rule: CommissionRule,
  bookingAmount: number,
  serviceId?: string
): { amount: number; ruleApplied: string } {
  if (!rule || !rule.active) {
    return { amount: 0, ruleApplied: "No active commission rule" };
  }

  // 1. Service Specific Override
  if (rule.calculationType === "service_specific" && serviceId && rule.serviceOverrides?.[serviceId]) {
    const rate = rule.serviceOverrides[serviceId];
    const amount = Math.round((bookingAmount * rate) / 100);
    return {
      amount,
      ruleApplied: `${rule.name}: ${rate}% for service override`,
    };
  }

  // 2. Tiered Rules
  if (rule.calculationType === "tiered" && rule.tierRules && rule.tierRules.length > 0) {
    const matchingTier = rule.tierRules.find(
      (tier) => bookingAmount >= tier.minAmount && bookingAmount <= tier.maxAmount
    );
    if (matchingTier) {
      const amount = Math.round((bookingAmount * matchingTier.rate) / 100);
      return {
        amount,
        ruleApplied: `${rule.name}: Tier (${matchingTier.minAmount}-${matchingTier.maxAmount}) @ ${matchingTier.rate}%`,
      };
    }
  }

  // 3. Percentage Rule
  if (rule.calculationType === "percentage") {
    const amount = Math.round((bookingAmount * rule.value) / 100);
    return {
      amount,
      ruleApplied: `${rule.name}: ${rule.value}% of booking`,
    };
  }

  // 4. Fixed Rule
  if (rule.calculationType === "fixed") {
    return {
      amount: rule.value,
      ruleApplied: `${rule.name}: Flat ₹${rule.value}`,
    };
  }

  // Default fallback if no rule conditions matched
  return {
    amount: 0,
    ruleApplied: `${rule.name}: No matching rule tier or override condition (0%)`,
  };
}

export function createCommissionEntryForJob(
  job: Job,
  partner: ReferralPartner,
  rule: CommissionRule
): CommissionEntry {
  const { amount: commissionAmount, ruleApplied } = calculateCommissionAmount(
    rule,
    job.amount ?? 0,
    job.serviceId
  );

  return {
    id: generateId("COMM"),
    partnerId: partner.id,
    referralId: generateId("REF"),
    jobId: job.id,
    bookingAmount: job.amount ?? 0,
    commissionAmount,
    ruleApplied,
    status: "COMMISSION_PENDING",
    createdAt: new Date().toISOString(),
  };
}
