import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, requireApproval, requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { recordAudit } from "@/lib/server/audit";
import { ASSIGNABLE_ROLES, normalizeRole, scopeOf } from "@/lib/rbac";

/** Only the three sign-in roles can be given an account. Customers use their service link. */
const RoleSchema = z.enum(["admin", "field_manager", "qc_inspector"]);

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().min(5).max(32),
  role: RoleSchema,
  password: z.string().min(8).max(200),
  teamId: z.string().max(64).nullable().optional(),
  branchId: z.string().max(64).nullable().optional(),
});

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

/**
 * GET /api/users — the user directory.
 *   users.manage (Admin)  → every account with contact details
 *   users.view            → Field Manager accounts only (name, phone, active)
 */
export async function GET() {
  try {
    const { user, permission } = await (async () => {
      const ctx = await requireUser();
      if (scopeOf(ctx.user.role, "users.manage") !== "NONE") return { user: ctx.user, permission: "users.manage" as const };
      const p = await requirePermission("users.view");
      return { user: p.user, permission: "users.view" as const };
    })();

    if (permission === "users.manage") {
      const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
      return NextResponse.json({ success: true, data: users.map(publicUser) });
    }
    const staff = await prisma.user.findMany({
      where: { role: { in: ASSIGNABLE_ROLES } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    logger.debug("users.directory_scoped", { by: user.id });
    return NextResponse.json({
      success: true,
      data: staff.map((u) => ({ ...publicUser(u), email: "" })),
    });
  } catch (err) {
    return errorResponse(err, "users.get.route_error");
  }
}

/** POST /api/users — creates a user with a bcrypt-hashed password (users.manage). */
export async function POST(request: Request) {
  try {
    const { user: acting } = await requirePermission("users.manage");
    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid user payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email: d.email.toLowerCase() } });
    if (existing) {
      return NextResponse.json({ success: false, error: "A user with this email already exists." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(d.password, 12);
    const user = await prisma.user.create({
      data: {
        name: d.name,
        email: d.email.toLowerCase(),
        phone: d.phone,
        role: d.role,
        passwordHash,
        active: true,
        teamId: d.teamId ?? null,
        branchId: d.branchId ?? null,
      },
    });

    logger.info("users.created", { userId: user.id, role: user.role, by: acting.id });
    void recordAudit({ actor: acting, action: "USER_CREATED", entityType: "user", entityId: user.id, newState: user.role, request });
    return NextResponse.json({ success: true, data: publicUser(user) });
  } catch (err) {
    return errorResponse(err, "users.post.route_error");
  }
}

/**
 * PUT /api/users — assignable field roster (name/phone/team/active) for the
 * dispatch desk (users.view). Kept for backwards compatibility with the
 * client store; GET already returns the same scoped set for non-admins.
 */
export async function PUT() {
  try {
    await requirePermission("users.view");
    const staff = await prisma.user.findMany({
      where: { role: { in: ASSIGNABLE_ROLES }, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, active: true, role: true, teamId: true },
    });
    return NextResponse.json({ success: true, data: staff });
  } catch (err) {
    return errorResponse(err, "users.staff_directory.route_error");
  }
}

/** PATCH /api/users — updates an existing user (users.manage). Password optional. */
export async function PATCH(request: Request) {
  try {
    const { user: acting } = await requirePermission("users.manage");
    const parsed = UpdateSchema.and(z.object({ id: z.string().min(1).max(64) })).safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid update payload." }, { status: 400 });
    }
    const { id, password, ...rest } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });

    // Role changes on admin accounts and self-demotion are critical configuration.
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
    return errorResponse(err, "users.patch.route_error");
  }
}

export async function OPTIONS() {
  const ctx = await requireUser().catch(() => null);
  return NextResponse.json({ success: true, authenticated: !!ctx });
}

/**
 * DELETE /api/users — remove a user account. Approval authority:
 * Admin only (users.delete). Accounts referenced by operational history are
 * deactivated instead of deleted so names still resolve; the acting admin
 * cannot delete themselves and the last active admin is protected.
 */
export async function DELETE(request: Request) {
  try {
    const { user: acting } = await requirePermission("users.delete");
    requireApproval(acting, "users.delete");
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ success: false, error: "User id is required." }, { status: 400 });
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
      void recordAudit({ actor: acting, action: "USER_RETIRED", entityType: "user", entityId: id, previousState: "active", newState: "inactive", reason: "Referenced by operational history", request });
      return NextResponse.json({ success: true, data: { id, retired: true } });
    }

    await prisma.user.delete({ where: { id } });
    logger.info("users.deleted", { userId: id, by: acting.id });
    void recordAudit({ actor: acting, action: "USER_DELETED", entityType: "user", entityId: id, previousState: target.role, request });
    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (err) {
    return errorResponse(err, "users.delete.route_error");
  }
}
