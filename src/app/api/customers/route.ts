import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { serializeCustomer, ok, fail, readJson } from "@/lib/server/serialize";
import { logger } from "@/lib/server/logger";

const CreateSchema = z.object({
  name: z.string().min(2).max(160),
  phone: z.string().min(7).max(32),
  email: z.string().max(200).optional().default(""),
  address: z.string().max(500).optional().default(""),
  whatsapp: z.string().max(32).optional(),
  notes: z.string().max(2000).optional(),
  source: z.string().max(40).optional().default("direct"),
  referralPartnerId: z.string().max(64).optional(),
});

const UpdateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(2).max(160).optional(),
  phone: z.string().min(7).max(32).optional(),
  email: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  source: z.string().max(40).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  referralPartnerId: z.string().max(64).nullable().optional(),
});

/**
 * GET /api/customers — full directory (managers/admins). ops_manager receives
 * contact/dispatch fields only; lifetime value (financial) is super_admin-only.
 */
export async function GET() {
  try {
    const { user } = await requireRole(["super_admin", "ops_manager"]);
    const rows = await prisma.customer.findMany({ orderBy: { createdAt: "desc" } });
    const mapped = rows.map(serializeCustomer);
    if (user.role === "super_admin") return ok(mapped);
    return ok(
      mapped.map((c) => ({
        ...c,
        lifetimeRevenue: undefined,
        totalBookings: c.totalBookings,
      }))
    );
  } catch (err) {
    return errorResponse(err, "customers.get.route_error");
  }
}

/** POST /api/customers — register a customer (managers/admins). */
export async function POST(request: Request) {
  try {
    await requireRole(["super_admin", "ops_manager"]);
    const parsed = CreateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid customer payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;

    let referralCode: string | undefined;
    if (data.referralPartnerId) {
      const partner = await prisma.referralPartner.findUnique({ where: { id: data.referralPartnerId } });
      if (!partner) return fail("Referral partner not found.", 404);
      referralCode = partner.code;
    }

    const created = await prisma.customer.create({
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email || "",
        address: data.address || "",
        notes: data.notes,
        source: data.source || "direct",
        referralPartnerId: data.referralPartnerId,
        referralCode,
      },
    });

    if (data.referralPartnerId) {
      await prisma.referralPartner.update({
        where: { id: data.referralPartnerId },
        data: { totalReferrals: { increment: 1 } },
      });
    }

    logger.info("customers.created", { customerId: created.id, by: "api" });
    return ok(serializeCustomer(created), 201);
  } catch (err) {
    return errorResponse(err, "customers.post.route_error");
  }
}

/** PATCH /api/customers — update an existing customer (managers/admins). */
export async function PATCH(request: Request) {
  try {
    await requireRole(["super_admin", "ops_manager"]);
    const parsed = UpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid customer update." },
        { status: 400 }
      );
    }
    const { id, ...rest } = parsed.data;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) data[k] = v;
    }
    const updated = await prisma.customer.update({ where: { id }, data });
    return ok(serializeCustomer(updated));
  } catch (err) {
    return errorResponse(err, "customers.patch.route_error");
  }
}
