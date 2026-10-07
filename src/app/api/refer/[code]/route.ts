import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { rateLimit, clientIp } from "@/lib/server/qr-service";
import { recordAudit } from "@/lib/server/audit";
import { logger } from "@/lib/server/logger";

/**
 * Public referral link (§12): a partner shares /refer/{code}; a prospect
 * opens it and leaves name + phone → a LEAD (customer record attributed to
 * the partner) is created. No login, rate-limited, minimum data only.
 */
export async function GET(request: Request, { params }: { params: { code: string } }) {
  const rl = rateLimit(`refer:${clientIp(request)}`, 60, 60 * 1000);
  if (!rl.ok) return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
  const partner = await prisma.referralPartner.findUnique({ where: { code: params.code.toUpperCase() }, select: { name: true, status: true } });
  if (!partner || partner.status !== "active") return NextResponse.json({ success: false, error: "This referral link is not active." }, { status: 404 });
  return NextResponse.json({ success: true, data: { partnerName: partner.name, company: process.env.APP_COMPANY_NAME || "Intense Care" } });
}

const LeadSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(7).max(32),
  address: z.string().max(300).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: { code: string } }) {
  const rl = rateLimit(`refer-post:${clientIp(request)}`, 5, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ success: false, error: "Too many requests. Please try again later." }, { status: 429 });

  const parsed = LeadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Please enter your name and phone number." }, { status: 400 });
  const partner = await prisma.referralPartner.findUnique({ where: { code: params.code.toUpperCase() } });
  if (!partner || partner.status !== "active") return NextResponse.json({ success: false, error: "This referral link is not active." }, { status: 404 });

  const phone = parsed.data.phone.replace(/[^0-9+]/g, "");
  // Idempotent on phone: an existing customer is not duplicated or re-attributed.
  const existing = await prisma.customer.findFirst({ where: { phone } });
  if (existing) {
    return NextResponse.json({ success: true, data: { leadId: existing.id, existing: true } });
  }

  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        name: parsed.data.name,
        phone,
        address: parsed.data.address ?? "",
        notes: parsed.data.notes ? `Referral lead: ${parsed.data.notes}` : "Referral lead",
        source: "referral",
        referralPartnerId: partner.id,
        referralCode: partner.code,
      },
    });
    await tx.referralPartner.update({ where: { id: partner.id }, data: { totalReferrals: { increment: 1 } } });
    return created;
  });

  logger.info("referral.lead_created", { partnerId: partner.id, customerId: lead.id });
  void recordAudit({
    actor: { name: parsed.data.name, role: "customer" },
    action: "REFERRAL_LEAD_CREATED",
    entityType: "customer",
    entityId: lead.id,
    details: `via partner ${partner.code}`,
    request,
  });
  return NextResponse.json({ success: true, data: { leadId: lead.id, existing: false } }, { status: 201 });
}
