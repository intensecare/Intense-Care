import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { csvResponse, isDay, nextReferralNumber, parsePaging, istToday } from "@/lib/server/biz";
import { hydrateReferrals, referralStats, syncReferrals } from "@/lib/server/referrals";
import { getSystemSettings } from "@/lib/server/settings";
import { phoneKey, referralStatusLabel, methodLabel } from "@/lib/business";

/**
 * GET /api/referral-bonuses — referrals, their bonus state, conversion / cost / revenue
 * figures and the bonus rules (Admin). Filters: status, q, from, to, page. `?format=csv` exports.
 * Open referrals are re-checked against customers and jobs on every load.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePermission("referrals.approve");
    const url = new URL(request.url);
    await syncReferrals(user);
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q")?.trim();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const where: Prisma.ReferralWhereInput = {
      AND: [
        status ? { status } : {},
        isDay(from) ? { referralDate: { gte: from } } : {},
        isDay(to) ? { referralDate: { lte: to } } : {},
        q ? { OR: [{ referrerName: { contains: q, mode: "insensitive" } }, { referredName: { contains: q, mode: "insensitive" } }, { referralNumber: { contains: q, mode: "insensitive" } }, { referredContact: { contains: q } }, { referrerContact: { contains: q } }] } : {},
      ],
    };
    if (url.searchParams.get("format") === "csv") {
      const rows = await hydrateReferrals(await prisma.referral.findMany({ where, orderBy: { createdAt: "desc" }, take: 5000 }));
      void recordAudit({ actor: user, action: "REFERRALS_EXPORTED", entityType: "referral", entityId: "export", details: `${rows.length} rows`, request });
      return csvResponse("referrals", rows.map((r) => ({ "Referral ID": r.referralNumber, "Referral date": r.referralDate, Referrer: r.referrerName, "Referrer contact": r.referrerContact, "Referred customer": r.referredName, "Referred contact": r.referredContact, Source: r.source, Status: referralStatusLabel(r.status), "Qualifying job": r.qualifyingJobNumber ?? "", "Bonus type": r.bonusType ?? "", "Bonus value": r.bonusValue ?? "", "Bonus amount": r.bonusAmount ?? "", Approval: r.approvalStatus, "Approved by": r.approvedBy ?? "", Payment: r.paymentStatus, "Payment date": r.paidAt?.slice(0, 10) ?? "", "Payment method": methodLabel(r.paymentMethod), "Revenue generated": r.revenueGenerated, Notes: r.notes ?? "" })));
    }
    const { page, pageSize, skip, take } = parsePaging(url);
    const [rows, total, stats, settings] = await Promise.all([
      prisma.referral.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      prisma.referral.count({ where }),
      referralStats(),
      getSystemSettings(),
    ]);
    return ok({ rows: await hydrateReferrals(rows), total, page, pageSize, stats, rules: settings.referralRules });
  } catch (err) {
    return errorResponse(err, "referrals.bonus.get_error");
  }
}

const Create = z.object({
  referrerName: z.string().trim().min(2, "Enter the referrer's name.").max(160),
  referrerContact: z.string().trim().max(60).default(""),
  referrerCustomerId: z.string().max(64).optional().nullable(),
  referredName: z.string().trim().min(2, "Enter the referred customer's name.").max(160),
  referredContact: z.string().trim().min(7, "Enter the referred customer's phone number.").max(60),
  referralDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the referral date."),
  source: z.enum(["customer", "staff", "partner", "online", "other"]).default("customer"),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/** POST — { action: "sync" } re-checks eligibility now; otherwise records a new referral. */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("referrals.manage");
    const body = await readJson(request);
    if (body?.action === "sync") {
      return ok({ changed: await syncReferrals(user) });
    }
    const parsed = Create.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid referral.", 400);
    const d = parsed.data;
    if (d.referralDate > istToday(new Date(Date.now() + 86400000))) return fail("The referral date can't be in the future.", 400);
    const key = phoneKey(d.referredContact);
    if (!key) return fail("Enter a valid phone number for the referred customer.", 400);
    if (phoneKey(d.referrerContact) === key) return fail("A customer can't refer themselves.", 400);
    if (d.referrerCustomerId) {
      const c = await prisma.customer.findUnique({ where: { id: d.referrerCustomerId }, select: { phone: true } });
      if (!c) return fail("The referring customer doesn't exist.", 404);
      if (phoneKey(c.phone) === key) return fail("A customer can't refer themselves.", 400);
    }
    // The same person is referred once; the first referral keeps the credit.
    const dup = await prisma.referral.findUnique({ where: { referredPhoneKey: key }, select: { referralNumber: true } });
    if (dup) return fail(`This person was already referred (${dup.referralNumber}). Only one referral can earn a bonus per customer.`, 409);

    const created = await prisma.referral.create({
      data: { referralNumber: await nextReferralNumber(), ...d, referrerCustomerId: d.referrerCustomerId || null, notes: d.notes || null, referredPhoneKey: key, createdBy: user.id },
    });
    void recordAudit({ actor: user, action: "REFERRAL_CREATED", entityType: "referral", entityId: created.id, newState: "CREATED", details: `${created.referralNumber} ${d.referrerName} → ${d.referredName}`, request });
    await syncReferrals(user);
    const fresh = await prisma.referral.findUniqueOrThrow({ where: { id: created.id } });
    return ok((await hydrateReferrals([fresh]))[0], 201);
  } catch (err) {
    return errorResponse(err, "referrals.bonus.post_error");
  }
}
