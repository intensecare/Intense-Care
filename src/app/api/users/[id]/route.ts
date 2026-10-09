import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, requireApproval, requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { recordAudit } from "@/lib/server/audit";
import { normalizeRole } from "@/lib/rbac";

const RoleSchema = z.enum(["admin", "field_manager", "qc_inspector", "tax_officer"]);

const UpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(5).max(32).optional(),
  role: RoleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  teamId: z.string().max(64).nullable().optional(),
  branchId: z.string().max(64).nullable().optional(),
});

function publicUser(u: {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  avatar: string | null;
  active: boolean;
  teamId: string | null;
  branchId: string | null;
  customerId: string | null;
  referralPartnerId: string | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: normalizeRole(u.role),
    avatar: u.avatar,
    active: u.active,
    teamId: u.teamId,
    branchId: u.branchId,
    customerId: u.customerId,
    referralPartnerId: u.referralPartnerId,
    createdAt: u.createdAt.toISOString(),
  };
}

/** GET /api/users/[id] */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("users.view");
    const user = await prisma.user.findUnique({ where: { id: params.id } });
    if (!user) return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    return NextResponse.json({ success: true, data: publicUser(user) });
  } catch (err) {
    return errorResponse(err, "users.id.get.route_error");
  }
}

/** PATCH /api/users/[id] */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user: acting } = await requirePermission("users.manage");
    const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid update payload." }, { status: 400 });
    }
    const { password, ...rest } = parsed.data;
    const id = params.id;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });

    if (rest.role !== undefined && (normalizeRole(user.role) === "admin" || id === acting.id)) {
      requireApproval(acting, "settings.critical");
      if (id === acting.id && rest.role !== "admin") {
        return NextResponse.json({ success: false, error: "You cannot change your own role." }, { status: 409 });
      }
    }

    const data: Record<string, unknown> = {};
    if (rest.name !== undefined) data.name = rest.name;
    if (rest.phone !== undefined) data.phone = rest.phone;
    if (rest.role !== undefined) data.role = rest.role;
    if (rest.active !== undefined) data.active = rest.active;
    if (rest.teamId !== undefined) data.teamId = rest.teamId;
    if (rest.branchId !== undefined) data.branchId = rest.branchId;
    if (password !== undefined) data.passwordHash = await bcrypt.hash(password, 12);

    if (rest.active === false && id === acting.id) {
      return NextResponse.json({ success: false, error: "You cannot deactivate your own account." }, { status: 409 });
    }

    const updated = await prisma.user.update({ where: { id }, data });
    logger.info("users.updated", { userId: id, fields: Object.keys(data), by: acting.id });
    void recordAudit({
      actor: acting,
      action: "USER_UPDATED",
      entityType: "user",
      entityId: id,
      previousState: rest.role !== undefined ? user.role : undefined,
      newState: rest.role !== undefined ? rest.role : undefined,
      details: Object.keys(data).filter((k) => k !== "passwordHash").join(",") + (password ? ",password" : ""),
      request,
    });
    return NextResponse.json({ success: true, data: publicUser(updated) });
  } catch (err) {
    return errorResponse(err, "users.id.patch.route_error");
  }
}

/** DELETE /api/users/[id] */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user: acting } = await requirePermission("users.delete");
    requireApproval(acting, "users.delete");
    const id = params.id;
    if (id === acting.id) return NextResponse.json({ success: false, error: "You cannot delete your own account." }, { status: 409 });

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });

    if (normalizeRole(target.role) === "admin") {
      const activeAdmins = await prisma.user.count({ where: { role: "admin", active: true, NOT: { id } } });
      if (activeAdmins === 0) {
        return NextResponse.json({ success: false, error: "Cannot delete the last active admin account." }, { status: 409 });
      }
    }

    const [assignedJobs, inspections, photos] = await Promise.all([
      prisma.job.count({ where: { OR: [{ assignedManagerId: id }, { assignedStaffIds: { has: id } }] } }),
      prisma.qualityCheck.count({ where: { inspectorId: id } }),
      prisma.jobPhoto.count({ where: { uploadedByUserId: id } }),
    ]);

    if (assignedJobs > 0 || inspections > 0 || photos > 0) {
      if (target.active) await prisma.user.update({ where: { id }, data: { active: false } });
      logger.info("users.retired_instead_of_deleted", { userId: id, assignedJobs, inspections, photos });
      void recordAudit({
        actor: acting,
        action: "USER_RETIRED",
        entityType: "user",
        entityId: id,
        previousState: "active",
        newState: "inactive",
        reason: "Referenced by operational history",
        request,
      });
      return NextResponse.json({ success: true, data: { id, retired: true } });
    }

    await prisma.user.delete({ where: { id } });
    logger.info("users.deleted", { userId: id, by: acting.id });
    void recordAudit({ actor: acting, action: "USER_DELETED", entityType: "user", entityId: id, previousState: target.role, request });
    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (err) {
    return errorResponse(err, "users.id.delete.route_error");
  }
}
