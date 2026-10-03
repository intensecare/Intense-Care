import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { serializeProperty, ok, fail, readJson } from "@/lib/server/serialize";

const CreateSchema = z.object({
  customerId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  propertyType: z
    .enum(["apartment", "villa", "office", "penthouse", "commercial", "duplex"])
    .optional()
    .default("apartment"),
  city: z.string().max(120).optional().default(""),
  postalCode: z.string().max(16).optional(),
  bedrooms: z.number().int().min(0).max(50).optional().default(1),
  bathrooms: z.number().int().min(0).max(50).optional().default(1),
  carpetAreaSqFt: z.number().int().min(0).max(1000000).optional().default(1000),
  accessNotes: z.string().max(1000).optional(),
  parkingInstructions: z.string().max(1000).optional(),
  preferredTime: z.string().max(80).optional(),
  recurringService: z.boolean().optional().default(false),
  recurringFrequency: z.enum(["weekly", "biweekly", "monthly", "quarterly"]).optional(),
});

const UpdateSchema = z.object({
  id: z.string().min(1).max(64),
  customerId: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(200).optional(),
  address: z.string().min(1).max(500).optional(),
  propertyType: z.enum(["apartment", "villa", "office", "penthouse", "commercial", "duplex"]).optional(),
  city: z.string().max(120).optional(),
  postalCode: z.string().max(16).nullable().optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  carpetAreaSqFt: z.number().int().min(0).max(1000000).optional(),
  accessNotes: z.string().max(1000).nullable().optional(),
  parkingInstructions: z.string().max(1000).nullable().optional(),
  preferredTime: z.string().max(80).nullable().optional(),
  recurringService: z.boolean().optional(),
  recurringFrequency: z.enum(["weekly", "biweekly", "monthly", "quarterly"]).nullable().optional(),
});

/** GET /api/properties — all properties (managers/admins). */
export async function GET() {
  try {
    await requireRole(["super_admin", "ops_manager"]);
    const rows = await prisma.property.findMany({ orderBy: { createdAt: "desc" } });
    return ok(rows.map(serializeProperty));
  } catch (err) {
    return errorResponse(err, "properties.get.route_error");
  }
}

/** POST /api/properties — register a property (managers/admins). */
export async function POST(request: Request) {
  try {
    await requireRole(["super_admin", "ops_manager"]);
    const parsed = CreateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid property payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const customer = await prisma.customer.findUnique({ where: { id: d.customerId } });
    if (!customer) return fail("Customer not found.", 404);

    const created = await prisma.property.create({
      data: {
        customerId: d.customerId,
        title: d.title,
        address: d.address,
        propertyType: d.propertyType,
        city: d.city || "",
        postalCode: d.postalCode,
        bedrooms: d.bedrooms,
        bathrooms: d.bathrooms,
        areaSqFt: d.carpetAreaSqFt,
        accessNotes: d.accessNotes,
        parkingInstructions: d.parkingInstructions,
        preferredTime: d.preferredTime,
        recurringService: d.recurringService,
        recurringFrequency: d.recurringService ? d.recurringFrequency : undefined,
      },
    });
    return ok(serializeProperty(created), 201);
  } catch (err) {
    return errorResponse(err, "properties.post.route_error");
  }
}

/** PATCH /api/properties — update an existing property (managers/admins). */
export async function PATCH(request: Request) {
  try {
    await requireRole(["super_admin", "ops_manager"]);
    const parsed = UpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid property update." },
        { status: 400 }
      );
    }
    const { id, ...rest } = parsed.data;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      if (k === "customerId") {
        // Ownership reassignment requires the target customer to exist.
        const customer = await prisma.customer.findUnique({ where: { id: String(v) } });
        if (!customer) return fail("Customer not found.", 404);
      }
      data[k === "carpetAreaSqFt" ? "areaSqFt" : k] = v;
    }
    const updated = await prisma.property.update({ where: { id }, data });
    return ok(serializeProperty(updated));
  } catch (err) {
    return errorResponse(err, "properties.patch.route_error");
  }
}

/**
 * DELETE /api/properties — remove a property (super_admin ONLY). Properties
 * tied to booked jobs are rejected (FK-restricted job history must survive).
 */
export async function DELETE(request: Request) {
  try {
    await requireRole(["super_admin"]);
    const body = await readJson(request);
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return fail("Property id is required.", 400);

    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) return fail("Property not found.", 404);

    const jobCount = await prisma.job.count({ where: { propertyId: id } });
    if (jobCount > 0) {
      return fail(
        `Property has ${jobCount} scheduled/completed job(s) linked to it and cannot be deleted.`,
        409
      );
    }

    await prisma.property.delete({ where: { id } });
    return ok({ id, deleted: true });
  } catch (err) {
    return errorResponse(err, "properties.delete.route_error");
  }
}
