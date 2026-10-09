import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, jobWhereFor } from "@/lib/server/authz";
import { recordAudit } from "@/lib/server/audit";
import { errorResponse } from "@/lib/server/http";
import { serializeProperty, ok, fail, readJson } from "@/lib/server/serialize";
import { PATCH as patchProperty } from "../route";

/** GET /api/properties/[id] — get a single property */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user, scope } = await requirePermission("properties.view");
    const { id } = params;
    const property = await prisma.property.findUnique({
      where: { id },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    });
    if (!property) return fail("Property not found.", 404);

    if (scope === "OWN" && property.customerId !== user.customerId) {
      return fail("Property not found.", 404);
    }
    if (scope === "ASSIGNED" || scope === "TEAM" || scope === "BRANCH") {
      const jobWhere = await jobWhereFor(user, "jobs.view");
      const job = await prisma.job.findFirst({
        where: { ...(jobWhere ?? { id: "__none__" }), propertyId: id },
      });
      if (!job) return fail("Property not found in your assignments.", 403);
    }

    return ok(serializeProperty(property));
  } catch (err) {
    return errorResponse(err, "properties.get_one.route_error");
  }
}

/**
 * PATCH /api/properties/[id] — same rules as PATCH /api/properties (one
 * implementation): only known fields, a map pin is a full valid pair, empty
 * values never wipe a saved pin, and open jobs follow a moved pin.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  const forwarded = new Request(request.url, {
    method: "PATCH",
    headers: request.headers,
    body: JSON.stringify({ ...(body && typeof body === "object" ? body : {}), id: params.id }),
  });
  return patchProperty(forwarded);
}

/** DELETE /api/properties/[id] — delete property by URL param */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requirePermission("properties.delete");
    const { id } = params;
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
    return errorResponse(err, "properties.delete_one.route_error");
  }
}
