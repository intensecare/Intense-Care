import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { recordAudit } from "@/lib/server/audit";
import { errorResponse } from "@/lib/server/http";
import { serializeService, ok, fail, readJson } from "@/lib/server/serialize";

const SERVICE_INCLUDE = { checklistTemplate: true } as const;

/** GET /api/services/[id] — get a single service package */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requirePermission("services.view");
    const service = await prisma.service.findUnique({
      where: { id: params.id },
      include: SERVICE_INCLUDE,
    });
    if (!service) return fail("Service not found.", 404);
    return ok(serializeService(service));
  } catch (err) {
    return errorResponse(err, "services.get_one.route_error");
  }
}

/** PATCH /api/services/[id] — update service by URL param */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requirePermission("services.manage");
    const { id } = params;
    const body = await readJson(request);

    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) return fail("Service not found.", 404);

    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (v !== undefined && k !== "id" && k !== "checklistTemplate") data[k] = v;
    }

    const updated = await prisma.service.update({
      where: { id },
      data,
      include: SERVICE_INCLUDE,
    });
    void recordAudit({ actor: user, action: "SERVICE_UPDATED", entityType: "service", entityId: id, details: Object.keys(data).join(","), request });
    return ok(serializeService(updated));
  } catch (err) {
    return errorResponse(err, "services.patch_one.route_error");
  }
}

/** DELETE /api/services/[id] — delete or deactivate service by URL param */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requirePermission("services.manage");
    const { id } = params;
    if (!id) return fail("Service id is required.", 400);

    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) return fail("Service not found.", 404);

    const inUse = await prisma.job.count({ where: { serviceId: id } });
    if (inUse > 0) {
      const updated = await prisma.service.update({
        where: { id },
        data: { active: false },
        include: SERVICE_INCLUDE,
      });
      void recordAudit({ actor: user, action: "SERVICE_DEACTIVATED", entityType: "service", entityId: id, reason: "In use by existing jobs", request });
      return ok({ ...serializeService(updated), retired: true });
    }

    await prisma.service.delete({ where: { id } });
    void recordAudit({ actor: user, action: "SERVICE_DELETED", entityType: "service", entityId: id, request });
    return ok({ id, deleted: true });
  } catch (err) {
    return errorResponse(err, "services.delete_one.route_error");
  }
}
