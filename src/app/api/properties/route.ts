import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, jobWhereFor } from "@/lib/server/authz";
import { recordAudit } from "@/lib/server/audit";
import { errorResponse } from "@/lib/server/http";
import { serializeProperty, ok, fail, readJson } from "@/lib/server/serialize";
import { LOCATION_SOURCES, normalizeCoords } from "@/lib/location";
import { syncOpenJobsToProperty } from "@/lib/server/locations";

const blank = (v: string | null | undefined) => (v ?? "").trim() || null;

/** Both or neither; a half pair or (0,0) is refused instead of saved. */
function pinFrom(lat: number | null | undefined, lng: number | null | undefined): { ok: true; pin: { lat: number; lng: number } | null } | { ok: false; error: string } {
  const none = (lat === null || lat === undefined) && (lng === null || lng === undefined);
  if (none) return { ok: true, pin: null };
  const pin = normalizeCoords(lat, lng);
  if (!pin) return { ok: false, error: "The map location needs both latitude and longitude (and can't be 0, 0). Pick the spot on the map again." };
  return { ok: true, pin };
}

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
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  addressLine: z.string().max(300).nullable().optional(),
  locality: z.string().max(120).nullable().optional(),
  state: z.string().max(120).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  locationNotes: z.string().max(1000).nullable().optional(),
  locationSource: z.enum(LOCATION_SOURCES).nullable().optional(),
  /** PATCH only: remove the saved pin on purpose (null lat/lng alone never clears it). */
  clearLocation: z.boolean().optional(),
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
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  addressLine: z.string().max(300).nullable().optional(),
  locality: z.string().max(120).nullable().optional(),
  state: z.string().max(120).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  locationNotes: z.string().max(1000).nullable().optional(),
  locationSource: z.enum(LOCATION_SOURCES).nullable().optional(),
  /** PATCH only: remove the saved pin on purpose (null lat/lng alone never clears it). */
  clearLocation: z.boolean().optional(),
});

/** GET /api/properties — all properties (managers/admins). */
export async function GET() {
  try {
    const { user, scope } = await requirePermission("properties.view");
    let where: Record<string, unknown> | undefined;
    if (scope === "OWN") {
      where = { customerId: user.customerId ?? "__none__" };
    } else if (scope === "ASSIGNED" || scope === "TEAM" || scope === "BRANCH") {
      // Field roles see the properties of the jobs they are on — nothing else.
      const jobWhere = await jobWhereFor(user, "jobs.view");
      const jobs = await prisma.job.findMany({ where: jobWhere ?? { id: "__none__" }, select: { propertyId: true } });
      where = { id: { in: Array.from(new Set(jobs.map((j) => j.propertyId))) } };
    }
    const rows = await prisma.property.findMany({ where, orderBy: { createdAt: "desc" } });
    return ok(rows.map(serializeProperty));
  } catch (err) {
    return errorResponse(err, "properties.get.route_error");
  }
}

/** POST /api/properties — register a property (managers/admins). */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("properties.create");
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
    const pin = pinFrom(d.lat, d.lng);
    if (!pin.ok) return fail(pin.error, 400);

    const created = await prisma.property.create({
      data: {
        customerId: d.customerId,
        title: d.title,
        address: d.address,
        propertyType: d.propertyType,
        city: d.city || "",
        postalCode: blank(d.postalCode),
        addressLine: blank(d.addressLine),
        locality: blank(d.locality),
        state: blank(d.state),
        country: blank(d.country),
        locationNotes: blank(d.locationNotes),
        bedrooms: d.bedrooms,
        bathrooms: d.bathrooms,
        areaSqFt: d.carpetAreaSqFt,
        accessNotes: d.accessNotes,
        parkingInstructions: d.parkingInstructions,
        preferredTime: d.preferredTime,
        recurringService: d.recurringService,
        recurringFrequency: d.recurringService ? d.recurringFrequency : undefined,
        lat: pin.pin?.lat ?? null,
        lng: pin.pin?.lng ?? null,
        locationSource: pin.pin ? d.locationSource ?? "MAP_PIN" : null,
        locationUpdatedAt: pin.pin ? new Date() : null,
      },
    });
    void recordAudit({ actor: user, action: "PROPERTY_CREATED", entityType: "property", entityId: created.id, details: pin.pin ? `pin=${pin.pin.lat},${pin.pin.lng} source=${created.locationSource}` : "no pin", request });
    return ok(serializeProperty(created), 201);
  } catch (err) {
    return errorResponse(err, "properties.post.route_error");
  }
}

/** PATCH /api/properties — update an existing property (managers/admins). */
export async function PATCH(request: Request) {
  try {
    const { user } = await requirePermission("properties.update");
    const parsed = UpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid property update." },
        { status: 400 }
      );
    }
    const { id, lat, lng, clearLocation, locationSource, ...rest } = parsed.data;
    const current = await prisma.property.findUnique({ where: { id } });
    if (!current) return fail("Property not found.", 404);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      if (k === "customerId") {
        // Ownership reassignment requires the target customer to exist.
        const customer = await prisma.customer.findUnique({ where: { id: String(v) } });
        if (!customer) return fail("Customer not found.", 404);
      }
      data[k === "carpetAreaSqFt" ? "areaSqFt" : k] = typeof v === "string" && k !== "address" && k !== "title" ? blank(v) ?? (k === "city" ? "" : null) : v;
    }

    // The pin: a new valid pair replaces it; empty values never wipe a saved
    // pin (only an explicit clearLocation does).
    const pin = pinFrom(lat, lng);
    if (!pin.ok) return fail(pin.error, 400);
    const before = normalizeCoords(current.lat, current.lng);
    let moved = false;
    if (pin.pin) {
      moved = !before || Math.abs(before.lat - pin.pin.lat) > 1e-6 || Math.abs(before.lng - pin.pin.lng) > 1e-6;
      if (moved) {
        Object.assign(data, { lat: pin.pin.lat, lng: pin.pin.lng, locationSource: locationSource ?? "MAP_PIN", locationUpdatedAt: new Date(), locationVerifiedAt: null });
      }
    } else if (clearLocation && before) {
      moved = true;
      Object.assign(data, { lat: null, lng: null, locationSource: null, locationUpdatedAt: new Date(), locationVerifiedAt: null });
    }

    const updated = await prisma.property.update({ where: { id }, data });
    // Open jobs that follow this property go to the new spot too.
    const synced = moved || data.address !== undefined || data.city !== undefined ? await syncOpenJobsToProperty(id) : 0;
    void recordAudit({
      actor: user,
      action: moved ? "PROPERTY_LOCATION_CHANGED" : "PROPERTY_UPDATED",
      entityType: "property",
      entityId: id,
      previousState: moved ? (before ? `${before.lat},${before.lng}` : "no pin") : undefined,
      newState: moved ? (updated.lat !== null ? `${updated.lat},${updated.lng}` : "no pin") : undefined,
      details: `${Object.keys(data).join(",")}${synced ? ` · ${synced} open job(s) updated` : ""}`,
      request,
    });
    return ok(serializeProperty(updated));
  } catch (err) {
    return errorResponse(err, "properties.patch.route_error");
  }
}

/**
 * DELETE /api/properties — remove a property (Admin ONLY). Properties
 * tied to booked jobs are rejected (FK-restricted job history must survive).
 */
export async function DELETE(request: Request) {
  try {
    const { user } = await requirePermission("properties.delete");
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
    void recordAudit({ actor: user, action: "PROPERTY_DELETED", entityType: "property", entityId: id, request });
    return ok({ id, deleted: true });
  } catch (err) {
    return errorResponse(err, "properties.delete.route_error");
  }
}
