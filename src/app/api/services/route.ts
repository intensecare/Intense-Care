import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/server/authz";
import { recordAudit } from "@/lib/server/audit";
import { can } from "@/lib/rbac";
import { errorResponse } from "@/lib/server/http";
import { serializeService, ok, fail, readJson } from "@/lib/server/serialize";
import { logger } from "@/lib/server/logger";

const ChecklistItemSchema = z.object({
  area: z.string().min(1).max(120),
  task: z.string().min(1).max(300),
  critical: z.boolean().default(false),
});

const CreateSchema = z.object({
  name: z.string().min(2).max(160),
  category: z.enum(["residential", "commercial", "specialized"]).default("residential"),
  description: z.string().max(2000).default(""),
  basePrice: z.number().min(0).max(10000000),
  estimatedDurationHours: z.number().min(0.5).max(72),
  checklistTemplate: z.array(ChecklistItemSchema).max(200).default([]),
});

const UpdateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(2).max(160).optional(),
  category: z.enum(["residential", "commercial", "specialized"]).optional(),
  description: z.string().max(2000).optional(),
  basePrice: z.number().min(0).max(10000000).optional(),
  estimatedDurationHours: z.number().min(0.5).max(72).optional(),
  active: z.boolean().optional(),
});

const AddItemSchema = z.object({
  serviceId: z.string().min(1).max(64),
  area: z.string().min(1).max(120),
  task: z.string().min(1).max(300),
  critical: z.boolean().default(false),
});

const RemoveItemSchema = z.object({
  serviceId: z.string().min(1).max(64),
  itemId: z.string().min(1).max(64),
});

const SERVICE_INCLUDE = { checklistTemplate: true } as const;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `service-${Date.now()}`
  );
}

/**
 * GET /api/services — company-authored service catalog with rubrics.
 * Staff may read (they see rubrics on their jobs); only managers/admins
 * receive inactive entries too.
 */
export async function GET() {
  try {
    const { user } = await requirePermission("services.view");
    // Only catalog managers see inactive packages.
    const rows = await prisma.service.findMany({
      where: can(user, "services.manage") || can(user, "checklist.manage") ? undefined : { active: true },
      include: SERVICE_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    return ok(rows.map(serializeService));
  } catch (err) {
    return errorResponse(err, "services.get.route_error");
  }
}

/** POST /api/services — create a service package with its rubric (admins). */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("services.manage");
    const parsed = CreateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid service payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    let slug = slugify(d.name);
    const clash = await prisma.service.findUnique({ where: { slug } });
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const created = await prisma.service.create({
      data: {
        name: d.name,
        slug,
        category: d.category,
        description: d.description,
        basePrice: d.basePrice,
        estimatedDurationHours: d.estimatedDurationHours,
        checklistTemplate: {
          create: d.checklistTemplate.map((item, idx) => ({
            area: item.area,
            task: item.task,
            critical: item.critical,
            position: idx,
          })),
        },
      },
      include: SERVICE_INCLUDE,
    });

    logger.info("services.created", { serviceId: created.id, by: user.id });
    void recordAudit({ actor: user, action: "SERVICE_CREATED", entityType: "service", entityId: created.id, request });
    return ok(serializeService(created), 201);
  } catch (err) {
    return errorResponse(err, "services.post.route_error");
  }
}

/** PATCH /api/services — update pricing/details or toggle active (admins). */
export async function PATCH(request: Request) {
  try {
    const { user } = await requirePermission("services.manage");
    const parsed = UpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid service update." }, { status: 400 });
    }
    const { id, ...rest } = parsed.data;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) data[k] = v;
    }
    const updated = await prisma.service.update({ where: { id }, data, include: SERVICE_INCLUDE });
    void recordAudit({ actor: user, action: "SERVICE_UPDATED", entityType: "service", entityId: id, details: Object.keys(data).join(","), request });
    return ok(serializeService(updated));
  } catch (err) {
    return errorResponse(err, "services.patch.route_error");
  }
}

/** PUT /api/services — rubric mutation: add or remove a checklist item (admins). */
export async function PUT(request: Request) {
  try {
    // Checklist rubrics are operational configuration (checklist.manage);
    // pricing/packages stay with services.manage.
    const { user } = await requireAnyPermission(["checklist.manage", "services.manage"]);
    const body = await readJson(request);
    const addParsed = AddItemSchema.safeParse(body);
    if (addParsed.success) {
      const d = addParsed.data;
      const count = await prisma.serviceChecklistItem.count({ where: { serviceId: d.serviceId } });
      await prisma.serviceChecklistItem.create({
        data: { serviceId: d.serviceId, area: d.area, task: d.task, critical: d.critical, position: count },
      });
      const updated = await prisma.service.findUnique({ where: { id: d.serviceId }, include: SERVICE_INCLUDE });
      if (!updated) return fail("Service not found.", 404);
      void recordAudit({ actor: user, action: "CHECKLIST_ITEM_ADDED", entityType: "service", entityId: d.serviceId, details: `${d.area}: ${d.task}`, request });
      return ok(serializeService(updated));
    }

    const removeParsed = RemoveItemSchema.safeParse(body);
    if (removeParsed.success) {
      const d = removeParsed.data;
      await prisma.serviceChecklistItem.deleteMany({ where: { id: d.itemId, serviceId: d.serviceId } });
      const updated = await prisma.service.findUnique({ where: { id: d.serviceId }, include: SERVICE_INCLUDE });
      if (!updated) return fail("Service not found.", 404);
      return ok(serializeService(updated));
    }

    return fail("Expected rubric add/remove payload.", 400);
  } catch (err) {
    return errorResponse(err, "services.put.route_error");
  }
}

/** DELETE /api/services — remove a service package and its rubric (admins). */
export async function DELETE(request: Request) {
  try {
    const { user } = await requirePermission("services.manage");
    const body = await readJson(request);
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return fail("Service id is required.", 400);
    void recordAudit({ actor: user, action: "SERVICE_DELETED", entityType: "service", entityId: id, request });

    const inUse = await prisma.job.count({ where: { serviceId: id } });
    if (inUse > 0) {
      // Preserve job history: retire the catalog entry instead of hard delete.
      const updated = await prisma.service.update({
        where: { id },
        data: { active: false },
        include: SERVICE_INCLUDE,
      });
      return ok({ ...serializeService(updated), retired: true });
    }

    await prisma.service.delete({ where: { id } });
    return ok({ id, deleted: true });
  } catch (err) {
    return errorResponse(err, "services.delete.route_error");
  }
}
