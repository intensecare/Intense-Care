import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { istToday } from "@/lib/server/biz";
import { createSourceExpense } from "@/lib/server/expenses";
import { hydrateReferrals } from "@/lib/server/referrals";
import { PAYMENT_METHOD_KEYS } from "@/lib/business";

/** GET /api/referral-bonuses/[id] */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("referrals.approve");
    const r = await prisma.referral.findUnique({ where: { id: params.id } });
    if (!r) return fail("Referral not found.", 404);
    return ok((await hydrateReferrals([r]))[0]);
  } catch (err) {
    return errorResponse(err, "referrals.bonus.get_id_error");
  }
}

const PatchReferralSchema = z.object({
  notes: z.string().nullable().optional(),
  referrerContact: z.string().optional(),
  referredContact: z.string().optional(),
});

/** PATCH /api/referral-bonuses/[id] — update notes or contact info */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("referrals.manage");
    const rawBody = await readJson(request);
    const parsed = PatchReferralSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }
    const { notes, referrerContact, referredContact } = parsed.data;

    const r = await prisma.referral.findUnique({ where: { id: params.id } });
    if (!r) return fail("Referral not found.", 404);

    const updated = await prisma.referral.update({
      where: { id: params.id },
      data: {
        ...(notes !== undefined ? { notes } : {}),
        ...(referrerContact !== undefined ? { referrerContact } : {}),
        ...(referredContact !== undefined ? { referredContact } : {}),
      },
    });

    void recordAudit({
      actor: user,
      action: "REFERRAL_UPDATED",
      entityType: "referral",
      entityId: r.id,
      details: r.referralNumber,
      request,
    });

    return ok((await hydrateReferrals([updated]))[0]);
  } catch (err) {
    return errorResponse(err, "referrals.bonus.patch_error");
  }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3, "Say why it is rejected.").max(300) }),
  z.object({
    action: z.literal("pay"),
    paymentMethod: z.enum(PAYMENT_METHOD_KEYS),
    paymentReference: z.string().trim().max(120).optional(),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({ action: z.literal("note"), notes: z.string().trim().max(1000) }),
]);

/**
 * POST { action: approve | reject | pay | note } — Admin only.
 *  approve  BONUS_REVIEW → APPROVED, records who and when.
 *  pay      APPROVED + UNPAID → PAID, and adds the REFERRAL_BONUSES expense, in one transaction.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("referrals.approve");
    const parsed = Action.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Unknown action.", 400);
    const a = parsed.data;
    const r = await prisma.referral.findUnique({ where: { id: params.id } });
    if (!r) return fail("Referral not found.", 404);
    const by = `${user.id}:${user.name}`;

    if (a.action === "note") {
      await prisma.referral.update({ where: { id: r.id }, data: { notes: a.notes || null } });
    } else if (a.action === "approve") {
      if (!r.bonusAmount || r.bonusAmount <= 0) return fail("This referral has no bonus amount to approve.", 409);
      const u = await prisma.referral.updateMany({
        where: { id: r.id, status: "BONUS_REVIEW", approvalStatus: "PENDING", paymentStatus: "UNPAID" },
        data: { status: "APPROVED", approvalStatus: "APPROVED", approvedBy: by, approvedAt: new Date() },
      });
      if (u.count === 0) return fail("This referral is not waiting for review any more.", 409);
      void recordAudit({
        actor: user,
        action: "REFERRAL_BONUS_APPROVED",
        entityType: "referral",
        entityId: r.id,
        jobId: r.qualifyingJobId,
        previousState: "BONUS_REVIEW",
        newState: "APPROVED",
        details: `${r.referralNumber} ₹${r.bonusAmount}`,
        request,
      });
    } else if (a.action === "reject") {
      const u = await prisma.referral.updateMany({
        where: {
          id: r.id,
          paymentStatus: "UNPAID",
          status: { in: ["CREATED", "CUSTOMER_REGISTERED", "QUALIFYING_JOB_COMPLETED", "BONUS_REVIEW", "APPROVED"] },
        },
        data: { status: "REJECTED", approvalStatus: "REJECTED", rejectionReason: a.reason, approvedBy: by, approvedAt: new Date() },
      });
      if (u.count === 0) return fail("This referral can't be rejected now (it is paid or already closed).", 409);
      void recordAudit({
        actor: user,
        action: "REFERRAL_BONUS_REJECTED",
        entityType: "referral",
        entityId: r.id,
        previousState: r.status,
        newState: "REJECTED",
        reason: a.reason,
        details: r.referralNumber,
        request,
      });
    } else {
      if (!r.bonusAmount || r.bonusAmount <= 0) return fail("This referral has no bonus amount to pay.", 409);
      try {
        await prisma.$transaction(async (tx) => {
          const e = await createSourceExpense(tx, {
            sourceType: "REFERRAL",
            sourceId: r.id,
            category: "REFERRAL_BONUSES",
            amount: r.bonusAmount!,
            date: a.paidOn ?? istToday(),
            description: `Referral bonus ${r.referralNumber} — ${r.referrerName}`,
            paymentMethod: a.paymentMethod,
            reference: a.paymentReference ?? null,
            jobId: r.qualifyingJobId,
            paidBy: user.name,
            createdBy: user.id,
          });
          const claimed = await tx.referral.updateMany({
            where: { id: r.id, status: "APPROVED", approvalStatus: "APPROVED", paymentStatus: "UNPAID" },
            data: {
              paymentStatus: "PAID",
              status: "PAID",
              paidAt: new Date(),
              paidBy: by,
              paymentMethod: a.paymentMethod,
              paymentReference: a.paymentReference || null,
              expenseId: e.id,
            },
          });
          if (claimed.count === 0) throw Object.assign(new Error("not payable"), { code: "NOT_PAYABLE" });
        });
      } catch (e) {
        if (
          (e as { code?: string }).code === "NOT_PAYABLE" ||
          (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        )
          return fail("This bonus has already been paid, or isn't approved yet.", 409);
        throw e;
      }
      void recordAudit({
        actor: user,
        action: "REFERRAL_BONUS_PAID",
        entityType: "referral",
        entityId: r.id,
        jobId: r.qualifyingJobId,
        previousState: "APPROVED",
        newState: "PAID",
        details: `${r.referralNumber} ₹${r.bonusAmount} via ${a.paymentMethod}`,
        request,
      });
    }
    const fresh = await prisma.referral.findUniqueOrThrow({ where: { id: r.id } });
    return ok((await hydrateReferrals([fresh]))[0]);
  } catch (err) {
    return errorResponse(err, "referrals.bonus.action_error");
  }
}

/** DELETE /api/referral-bonuses/[id] — Admin deletes draft/unpaid referral */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("referrals.manage");
    const r = await prisma.referral.findUnique({ where: { id: params.id } });
    if (!r) return fail("Referral not found.", 404);

    if (r.paymentStatus === "PAID") {
      return fail("Paid referral bonuses cannot be deleted. Historical financial records must be preserved.", 400);
    }

    await prisma.referral.delete({ where: { id: params.id } });

    void recordAudit({
      actor: user,
      action: "REFERRAL_DELETED",
      entityType: "referral",
      entityId: r.id,
      previousState: `${r.referralNumber} (${r.status})`,
      details: "Referral deleted",
      request,
    });

    return ok({ success: true, message: `Referral ${r.referralNumber} deleted.` });
  } catch (err) {
    return errorResponse(err, "referrals.bonus.delete_error");
  }
}
