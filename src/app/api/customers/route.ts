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

    // Referral re-attribution must keep the partner lead counters honest:
    // decrement the previous partner, increment the new one, and sync the
    // stored referral code with the partner's actual code (the create path
    // does this; the update path used to silently skip it).
    if (Object.prototype.hasOwnProperty.call(data, "referralPartnerId")) {
      const nextPartnerId = (data.referralPartnerId as string | null) || null;
      const existing = await prisma.customer.findUnique({ where: { id } });
      if (!existing) return fail("Customer not found.", 404);
      const prevPartnerId = existing.referralPartnerId || null;

      if (nextPartnerId !== prevPartnerId) {
        if (nextPartnerId) {
          const partner = await prisma.referralPartner.findUnique({ where: { id: nextPartnerId } });
          if (!partner) return fail("Referral partner not found.", 404);
          data.referralCode = partner.code;
        } else {
          data.referralCode = null;
        }
        const counterOps = [];
        if (prevPartnerId) {
          counterOps.push(
            prisma.referralPartner.update({
              where: { id: prevPartnerId },
              data: { totalReferrals: { decrement: 1 } },
            })
          );
        }
        if (nextPartnerId) {
          counterOps.push(
            prisma.referralPartner.update({
              where: { id: nextPartnerId },
              data: { totalReferrals: { increment: 1 } },
            })
          );
        }
        if (counterOps.length > 0) await prisma.$transaction(counterOps);
      }
    }

    const updated = await prisma.customer.update({ where: { id }, data });
    return ok(serializeCustomer(updated));
  } catch (err) {
    return errorResponse(err, "customers.patch.route_error");
  }
}

/**
 * DELETE /api/customers — remove a customer (super_admin ONLY). Customers with
 * job history are rejected (FK-restricted + financial records must survive);
 * deactivate them via PATCH { status: "inactive" } instead. Jobless customers
 * hard-delete together with their property records (schema cascade).
 */
export async function DELETE(request: Request) {
  try {
    await requireRole(["super_admin"]);
    const body = await readJson(request);
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return fail("Customer id is required.", 400);

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return fail("Customer not found.", 404);

    const jobCount = await prisma.job.count({ where: { customerId: id } });
    if (jobCount > 0) {
      return fail(
        `Customer has ${jobCount} job record(s) on file. Deactivate the customer instead of deleting to preserve booking history.`,
        409
      );
    }

    await prisma.customer.delete({ where: { id } });

    // Keep the attribution counter honest (properties cascade with the customer).
    if (customer.referralPartnerId) {
      await prisma.referralPartner.update({
        where: { id: customer.referralPartnerId },
        data: { totalReferrals: { decrement: 1 } },
      }).catch(() => null);
    }

    logger.info("customers.deleted", { customerId: id });
    return ok({ id, deleted: true });
  } catch (err) {
    return errorResponse(err, "customers.delete.route_error");
  }
}
