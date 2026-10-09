import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { recordAudit } from "./audit";
import { getSystemSettings } from "./settings";
import { istToday } from "./biz";
import { phoneKey, round2, type ReferralRow, type ReferralRules } from "@/lib/business";

/**
 * Referral eligibility — the one place that decides when a referral earns a bonus.
 *
 * A referral qualifies when ALL of these hold (rules are set by Admin under
 * Referrals → Rules; the bonus is a snapshot of the rules at that moment):
 *   1. the referred person became a customer, and had NO job before the referral date;
 *   2. their first job to qualify is completed (customer-approved, status COMPLETED or later)
 *      within `eligibilityDays` of the referral date;
 *   3. that job's value before GST is at least `minJobValue`;
 *   4. if `requirePaid`: its invoice(s) are fully paid.
 * Then the referral moves to BONUS REVIEW. Only Admin can approve; paying creates
 * the REFERRAL_BONUSES expense exactly once. Nothing is ever marked paid automatically.
 */

const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
const OPEN_STATUSES = ["CREATED", "CUSTOMER_REGISTERED"];

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function computeBonus(rules: ReferralRules, taxableValue: number): number {
  let amount = rules.bonusType === "PERCENT" ? (taxableValue * rules.bonusValue) / 100 : rules.bonusValue;
  if (rules.maxBonus > 0) amount = Math.min(amount, rules.maxBonus);
  return round2(Math.max(0, amount));
}

/** Value of a job before GST, and whether it is fully paid, from its live invoices. */
async function jobFigures(jobId: string) {
  const inv = await prisma.invoice.findMany({ where: { jobId, status: { not: "CANCELLED" } }, select: { subtotal: true, discount: true, total: true, balanceDue: true } });
  const taxable = round2(inv.reduce((a, i) => a + (i.subtotal - i.discount), 0));
  const paid = inv.length > 0 && inv.every((i) => i.total > 0 && i.balanceDue <= 0.009);
  return { taxable, paid, hasInvoice: inv.length > 0 };
}

/** Re-checks open referrals against customers and jobs. Safe to call any time. */
export async function syncReferrals(actor: { id: string; name: string; role: string } = { id: "system", name: "System", role: "system" }): Promise<number> {
  const settings = await getSystemSettings();
  const rules = settings.referralRules;
  const open = await prisma.referral.findMany({ where: { status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "asc" }, take: 500 });
  let changed = 0;
  const today = istToday();

  for (const r of open) {
    // 1. Find the customer once they register.
    let customerId = r.referredCustomerId;
    if (!customerId && r.referredPhoneKey) {
      const cands = await prisma.customer.findMany({ where: { phone: { contains: r.referredPhoneKey.slice(-6) } }, select: { id: true, phone: true, createdAt: true } });
      const hit = cands.find((c) => phoneKey(c.phone) === r.referredPhoneKey);
      if (hit) {
        const taken = await prisma.referral.findFirst({ where: { referredCustomerId: hit.id, id: { not: r.id } }, select: { id: true } });
        if (!taken) {
          const u = await prisma.referral.updateMany({ where: { id: r.id, referredCustomerId: null, status: "CREATED" }, data: { referredCustomerId: hit.id, status: "CUSTOMER_REGISTERED" } });
          if (u.count) {
            customerId = hit.id;
            changed++;
            void recordAudit({ actor, action: "REFERRAL_CUSTOMER_REGISTERED", entityType: "referral", entityId: r.id, previousState: "CREATED", newState: "CUSTOMER_REGISTERED", details: r.referralNumber });
          }
        }
      }
    }
    if (!customerId) {
      if (today > addDays(r.referralDate, rules.eligibilityDays) && (await prisma.referral.updateMany({ where: { id: r.id, status: "CREATED" }, data: { status: "EXPIRED" } })).count) {
        changed++;
        void recordAudit({ actor, action: "REFERRAL_EXPIRED", entityType: "referral", entityId: r.id, previousState: "CREATED", newState: "EXPIRED", details: r.referralNumber });
      }
      continue;
    }

    // 2. A customer who was already booking before the referral is not a new customer.
    const earlier = await prisma.job.findFirst({ where: { customerId, scheduledDate: { lt: r.referralDate }, status: { not: "CANCELLED" } }, select: { id: true } });
    if (earlier) {
      const u = await prisma.referral.updateMany({ where: { id: r.id, status: { in: OPEN_STATUSES } }, data: { status: "REJECTED", approvalStatus: "REJECTED", rejectionReason: "The customer already had a booking before this referral, so they are not a new customer." } });
      if (u.count) {
        changed++;
        void recordAudit({ actor, action: "REFERRAL_REJECTED", entityType: "referral", entityId: r.id, newState: "REJECTED", reason: "Existing customer", details: r.referralNumber });
      }
      continue;
    }
    if (!rules.enabled) continue;

    // 3. The first completed job inside the window that meets the rules.
    const deadline = addDays(r.referralDate, rules.eligibilityDays);
    const jobs = await prisma.job.findMany({ where: { customerId, status: { in: DONE } }, orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }], select: { id: true, completedAt: true, approvedAt: true, scheduledDate: true } });
    let qualifying: { id: string; taxable: number } | null = null;
    for (const j of jobs) {
      const doneDay = (j.approvedAt ?? j.completedAt)?.toISOString().slice(0, 10) ?? j.scheduledDate;
      if (doneDay > deadline) continue;
      const fig = await jobFigures(j.id);
      if (!fig.hasInvoice || fig.taxable < rules.minJobValue) continue;
      if (rules.requirePaid && !fig.paid) continue;
      qualifying = { id: j.id, taxable: fig.taxable };
      break;
    }
    if (!qualifying) {
      if (today > deadline && (await prisma.referral.updateMany({ where: { id: r.id, status: { in: OPEN_STATUSES } }, data: { status: "EXPIRED" } })).count) {
        changed++;
        void recordAudit({ actor, action: "REFERRAL_EXPIRED", entityType: "referral", entityId: r.id, newState: "EXPIRED", details: r.referralNumber });
      }
      continue;
    }
    const taken = await prisma.referral.findFirst({ where: { qualifyingJobId: qualifying.id, id: { not: r.id } }, select: { id: true } });
    if (taken) continue;
    const amount = computeBonus(rules, qualifying.taxable);
    const u = await prisma.referral.updateMany({
      where: { id: r.id, status: { in: OPEN_STATUSES }, qualifyingJobId: null },
      data: { qualifyingJobId: qualifying.id, status: "BONUS_REVIEW", bonusType: rules.bonusType, bonusValue: rules.bonusValue, bonusAmount: amount },
    });
    if (u.count) {
      changed++;
      void recordAudit({ actor, action: "REFERRAL_QUALIFIED", entityType: "referral", entityId: r.id, jobId: qualifying.id, previousState: r.status, newState: "BONUS_REVIEW", details: `${r.referralNumber} bonus ₹${amount} (${rules.bonusType} ${rules.bonusValue})` });
    }
  }
  return changed;
}

type RefRecord = Prisma.ReferralGetPayload<object>;

export async function hydrateReferrals(rows: RefRecord[]): Promise<ReferralRow[]> {
  const jobIds = rows.map((r) => r.qualifyingJobId).filter((x): x is string => !!x);
  const expIds = rows.map((r) => r.expenseId).filter((x): x is string => !!x);
  const custIds = rows.map((r) => r.referredCustomerId).filter((x): x is string => !!x);
  const [jobs, exps, invs] = await Promise.all([
    jobIds.length ? prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobSerial: true } }) : [],
    expIds.length ? prisma.expense.findMany({ where: { id: { in: expIds } }, select: { id: true, expenseNumber: true } }) : [],
    custIds.length ? prisma.invoice.findMany({ where: { customerId: { in: custIds }, status: { not: "CANCELLED" } }, select: { customerId: true, subtotal: true, discount: true, total: true, amountPaid: true } }) : [],
  ]);
  const jm = new Map(jobs.map((j) => [j.id, j.jobSerial]));
  const em = new Map(exps.map((e) => [e.id, e.expenseNumber]));
  const rev = new Map<string, number>();
  for (const i of invs) {
    // Taxable value of what the customer has actually paid (pro-rata for part payments).
    const share = i.total > 0 ? Math.min(1, i.amountPaid / i.total) : 0;
    rev.set(i.customerId, round2((rev.get(i.customerId) ?? 0) + (i.subtotal - i.discount) * share));
  }
  return rows.map((r) => ({
    id: r.id,
    referralNumber: r.referralNumber,
    referrerName: r.referrerName,
    referrerContact: r.referrerContact,
    referrerCustomerId: r.referrerCustomerId,
    referredCustomerId: r.referredCustomerId,
    referredName: r.referredName,
    referredContact: r.referredContact,
    referralDate: r.referralDate,
    source: r.source,
    qualifyingJobId: r.qualifyingJobId,
    qualifyingJobNumber: r.qualifyingJobId ? jm.get(r.qualifyingJobId) ?? null : null,
    status: r.status,
    bonusType: r.bonusType,
    bonusValue: r.bonusValue,
    bonusAmount: r.bonusAmount,
    approvalStatus: r.approvalStatus,
    approvedBy: r.approvedBy ? r.approvedBy.slice(r.approvedBy.indexOf(":") + 1) : null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    paymentStatus: r.paymentStatus,
    paidAt: r.paidAt?.toISOString() ?? null,
    paymentMethod: r.paymentMethod,
    paymentReference: r.paymentReference,
    expenseNumber: r.expenseId ? em.get(r.expenseId) ?? null : null,
    revenueGenerated: r.referredCustomerId ? rev.get(r.referredCustomerId) ?? 0 : 0,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Conversion, bonus cost and revenue — used by the Referrals page and Reports. */
export async function referralStats(where: Prisma.ReferralWhereInput = {}) {
  const rows = await prisma.referral.findMany({ where, select: { id: true, status: true, bonusAmount: true, paymentStatus: true, referredCustomerId: true, qualifyingJobId: true, expenseId: true } });
  const hydrated = await hydrateReferrals(await prisma.referral.findMany({ where: { id: { in: rows.map((r) => r.id) } } }));
  const paidIds = rows.filter((r) => r.paymentStatus === "PAID" && r.expenseId).map((r) => r.expenseId as string);
  const paid = paidIds.length ? await prisma.expense.aggregate({ where: { id: { in: paidIds }, ...{ voidedAt: null } }, _sum: { amount: true } }) : { _sum: { amount: 0 } };
  const total = rows.length;
  const converted = rows.filter((r) => r.qualifyingJobId).length;
  const liability = rows.filter((r) => ["BONUS_REVIEW", "APPROVED"].includes(r.status) && r.paymentStatus === "UNPAID").reduce((a, r) => a + (r.bonusAmount ?? 0), 0);
  return {
    total,
    registered: rows.filter((r) => r.referredCustomerId).length,
    converted,
    conversionPercent: total ? Math.round((converted / total) * 100) : 0,
    byStatus: Object.fromEntries(Array.from(new Set(rows.map((r) => r.status))).map((s) => [s, rows.filter((r) => r.status === s).length])),
    bonusPaid: round2(paid._sum.amount ?? 0),
    bonusPending: round2(liability),
    revenueGenerated: round2(hydrated.filter((h) => h.qualifyingJobId).reduce((a, h) => a + h.revenueGenerated, 0)),
  };
}
