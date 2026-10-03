import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import {
  serializePartner,
  serializeCommissionRule,
  serializeCommissionEntry,
  serializePayout,
  ok,
  fail,
  readJson,
} from "@/lib/server/serialize";
import { logger } from "@/lib/server/logger";

/**
 * GET /api/referrals — the full referral ledger hydrated in one call:
 * partners, commission rules, commission entries, payouts (super_admin ONLY;
 * commission amounts are financial data).
 */
export async function GET() {
  try {
    await requireRole(["super_admin"]);
    const [partners, rules, entries, payouts] = await Promise.all([
      prisma.referralPartner.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.commissionRule.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.commissionEntry.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.payout.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    ]);
    return ok({
      partners: partners.map(serializePartner),
      commissionRules: rules.map(serializeCommissionRule),
      commissionEntries: entries.map(serializeCommissionEntry),
      payouts: payouts.map(serializePayout),
    });
  } catch (err) {
    return errorResponse(err, "referrals.get.route_error");
  }
}

const PartnerSchema = z.object({
  action: z.literal("create-partner"),
  name: z.string().min(2).max(160),
  partnerType: z
    .enum(["customer", "employee", "real_estate_agent", "interior_designer", "corporate_partner", "influencer"])
    .default("interior_designer"),
  email: z.string().max(200).default(""),
  phone: z.string().max(32).default(""),
  code: z.string().max(40).optional(),
  commissionRuleId: z.string().max(64).optional(),
});

const RuleSchema = z.object({
  action: z.literal("create-rule"),
  name: z.string().min(2).max(160),
  partnerType: z
    .enum(["customer", "employee", "real_estate_agent", "interior_designer", "corporate_partner", "influencer"])
    .default("interior_designer"),
  calculationType: z.enum(["percentage", "fixed", "tiered", "service_specific"]).default("percentage"),
  value: z.number().min(0).max(10000000),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

const UpdateRuleSchema = z.object({
  action: z.literal("update-rule"),
  id: z.string().min(1).max(64),
  name: z.string().min(2).max(160).optional(),
  value: z.number().min(0).max(10000000).optional(),
  active: z.boolean().optional(),
});

const UpdatePartnerSchema = z.object({
  action: z.literal("update-partner"),
  id: z.string().min(1).max(64),
  name: z.string().min(2).max(160).optional(),
  partnerType: z
    .enum(["customer", "employee", "real_estate_agent", "interior_designer", "corporate_partner", "influencer"])
    .optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(32).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  commissionRuleId: z.string().max(64).nullable().optional(),
});

const DeletePartnerSchema = z.object({
  action: z.literal("delete-partner"),
  id: z.string().min(1).max(64),
});

const DeleteRuleSchema = z.object({
  action: z.literal("delete-rule"),
  id: z.string().min(1).max(64),
});

const ApproveSchema = z.object({
  action: z.literal("approve-entry"),
  id: z.string().min(1).max(64),
});

const PayoutSchema = z.object({
  action: z.literal("create-payout"),
  partnerId: z.string().min(1).max(64),
  amount: z.number().min(0.01).max(100000000),
  payoutMethod: z.enum(["bank_transfer", "upi", "cheque", "wallet"]),
  referenceNumber: z.string().min(1).max(120),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/referrals — write-through referral actions (admins):
 * register partners, create/update commission rules, approve entries, disburse payouts.
 */
export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);
    const body = await readJson(request);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "create-partner") {
      const parsed = PartnerSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid partner payload.", 400);
      const d = parsed.data;

      const code =
        d.code ||
        (d.name.replace(/\s+/g, "").substring(0, 5).toUpperCase() + Math.floor(100 + Math.random() * 900));

      const clash = await prisma.referralPartner.findUnique({ where: { code } });
      if (clash) return fail("A partner with this referral code already exists.", 409);

      const created = await prisma.referralPartner.create({
        data: {
          name: d.name,
          code,
          partnerType: d.partnerType,
          email: d.email,
          phone: d.phone,
          commissionRuleId: d.commissionRuleId || null,
        },
      });
      logger.info("referrals.partner_created", { partnerId: created.id });
      return ok(serializePartner(created), 201);
    }

    if (action === "create-rule") {
      const parsed = RuleSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid commission rule payload.", 400);
      const { action: _action, ...d } = parsed.data;
      const created = await prisma.commissionRule.create({ data: { ...d, tierRules: undefined } });
      return ok(serializeCommissionRule(created), 201);
    }

    if (action === "update-rule") {
      const parsed = UpdateRuleSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid rule update.", 400);
      const { action: _action, id, ...rest } = parsed.data;
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) data[k] = v;
      const updated = await prisma.commissionRule.update({ where: { id }, data });
      return ok(serializeCommissionRule(updated));
    }

    if (action === "update-partner") {
      const parsed = UpdatePartnerSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid partner update.", 400);
      const { action: _action, id, ...rest } = parsed.data;
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) data[k] = v;
      const updated = await prisma.referralPartner.update({ where: { id }, data });
      logger.info("referrals.partner_updated", { partnerId: id, fields: Object.keys(data) });
      return ok(serializePartner(updated));
    }

    if (action === "delete-partner") {
      const parsed = DeletePartnerSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid partner delete payload.", 400);
      const { id } = parsed.data;

      const partner = await prisma.referralPartner.findUnique({ where: { id } });
      if (!partner) return fail("Partner not found.", 404);

      // Hard delete only for partners with no financial footprint; ledger rows
      // and attributed jobs are history and must survive the partner.
      const [entryCount, attributedJobs] = await Promise.all([
        prisma.commissionEntry.count({ where: { partnerId: id } }),
        prisma.job.count({ where: { referralPartnerId: id } }),
      ]);
      if (entryCount > 0 || attributedJobs > 0 || partner.totalCommissionPaid > 0 || partner.totalCommissionEarned > 0) {
        return fail(
          "Partner has commission history or attributed jobs and cannot be deleted. Set the partner to INACTIVE instead.",
          409
        );
      }

      // Detach customer attribution before removing the partner record.
      await prisma.$transaction([
        prisma.customer.updateMany({
          where: { referralPartnerId: id },
          data: { referralPartnerId: null, referralCode: null },
        }),
        prisma.referralPartner.delete({ where: { id } }),
      ]);
      logger.info("referrals.partner_deleted", { partnerId: id });
      return ok({ id, deleted: true });
    }

    if (action === "delete-rule") {
      const parsed = DeleteRuleSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid rule delete payload.", 400);
      const { id } = parsed.data;

      const inUse = await prisma.referralPartner.count({ where: { commissionRuleId: id } });
      if (inUse > 0) {
        return fail(
          `${inUse} partner(s) are assigned to this rule. Reassign them or deactivate the rule instead.`,
          409
        );
      }

      await prisma.commissionRule.delete({ where: { id } });
      logger.info("referrals.rule_deleted", { ruleId: id });
      return ok({ id, deleted: true });
    }

    if (action === "approve-entry") {
      const parsed = ApproveSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid approve payload.", 400);
      const updated = await prisma.commissionEntry.update({
        where: { id: parsed.data.id },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      return ok(serializeCommissionEntry(updated));
    }

    if (action === "create-payout") {
      const parsed = PayoutSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payout payload.", 400);
      const d = parsed.data;

      const partner = await prisma.referralPartner.findUnique({ where: { id: d.partnerId } });
      if (!partner) return fail("Partner not found.", 404);
      if (d.amount > partner.totalCommissionPending + 0.001) {
        return fail(`Payout exceeds pending commission (₹${partner.totalCommissionPending.toFixed(2)}).`, 400);
      }

      const payout = await prisma.payout.create({
        data: {
          partnerId: d.partnerId,
          partnerName: partner.name,
          amount: d.amount,
          payoutMethod: d.payoutMethod,
          referenceNumber: d.referenceNumber,
          notes: d.notes,
        },
      });

      // Mark approved entries as paid and settle partner counters atomically.
      await prisma.$transaction([
        prisma.commissionEntry.updateMany({
          where: { partnerId: d.partnerId, status: "APPROVED" },
          data: { status: "PAID", payoutId: payout.id },
        }),
        prisma.referralPartner.update({
          where: { id: d.partnerId },
          data: {
            totalCommissionPaid: { increment: d.amount },
            totalCommissionPending: { decrement: d.amount },
          },
        }),
      ]);

      return ok(serializePayout(payout), 201);
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "referrals.post.route_error");
  }
}
