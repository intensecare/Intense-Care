import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { requireRole, requireUser } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().min(5).max(32),
  role: z.enum(["super_admin", "ops_manager", "staff"]),
  password: z.string().min(6).max(200),
});

const UpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(5).max(32).optional(),
  role: z.enum(["super_admin", "ops_manager", "staff"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(200).optional(),
});

function publicUser(u: {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  avatar: string | null;
  active: boolean;
  createdAt: Date;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    avatar: u.avatar,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * GET /api/users — directory of users (super_admin ONLY). The ops_manager
 * dispatch tower resolves worker names from the assignment-scoped endpoint
 * below instead; the full directory includes emails/phones of every account.
 */
export async function GET() {
  try {
    await requireRole(["super_admin"]);
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ success: true, data: users.map(publicUser) });
  } catch (err) {
    return errorResponse(err, "users.get.route_error");
  }
}

/** POST /api/users — creates a user with a bcrypt-hashed password (admin only). */
export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);
    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid user payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { name, email, phone, role, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "A user with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email: email.toLowerCase(), phone, role, passwordHash, active: true },
    });

    logger.info("users.created", { userId: user.id, role: user.role });
    return NextResponse.json({ success: true, data: publicUser(user) });
  } catch (err) {
    return errorResponse(err, "users.post.route_error");
  }
}

/**
 * GET /api/users/staff-directory — active field workers (name/phone/active)
 * for the ops_manager dispatch tower: who can be assigned, and how to reach
 * them. No emails, no roles beyond "staff", no inactive accounts.
 */
export async function PUT() {
  try {
    const { user } = await requireRole(["super_admin", "ops_manager"]);
    if (user.role !== "ops_manager" && user.role !== "super_admin") {
      return NextResponse.json({ success: false, error: "Not authorized." }, { status: 403 });
    }
    const staff = await prisma.user.findMany({
      where: { role: "staff", active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, active: true },
    });
    return NextResponse.json({ success: true, data: staff });
  } catch (err) {
    return errorResponse(err, "users.staff_directory.route_error");
  }
}

/** PATCH /api/users — updates an existing user (admin only). Password optional. */
export async function PATCH(request: Request) {
  try {
    await requireRole(["super_admin"]);
    const parsed = UpdateSchema.and(z.object({ id: z.string().min(1).max(64) })).safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid update payload." },
        { status: 400 }
      );
    }
    const { id, password, ...rest } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (rest.name !== undefined) data.name = rest.name;
    if (rest.phone !== undefined) data.phone = rest.phone;
    if (rest.role !== undefined) data.role = rest.role;
    if (rest.active !== undefined) data.active = rest.active;
    if (password !== undefined) data.passwordHash = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({ where: { id }, data });

    logger.info("users.updated", { userId: id, fields: Object.keys(data) });
    return NextResponse.json({ success: true, data: publicUser(updated) });
  } catch (err) {
    return errorResponse(err, "users.patch.route_error");
  }
}

/**
 * GET /api/users/me — lightweight current-session identity used by the client
 * after login (kept separate so the directory endpoint stays manager-only).
 */
export async function OPTIONS() {
  const ctx = await requireUser().catch(() => null);
  return NextResponse.json({ success: true, authenticated: !!ctx });
}

/**
 * DELETE /api/users — remove a user account (super_admin ONLY). Guarded like
 * the service catalog: accounts referenced by job assignments, inspections, or
 * photo uploads are deactivated instead of deleted so operational history
 * still resolves names; unreferenced accounts hard-delete. The acting admin
 * cannot delete themselves, and the last active super_admin is protected.
 */
export async function DELETE(request: Request) {
  try {
    const { user: acting } = await requireRole(["super_admin"]);
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) {
      return NextResponse.json({ success: false, error: "User id is required." }, { status: 400 });
    }
    if (id === acting.id) {
      return NextResponse.json(
        { success: false, error: "You cannot delete your own account." },
        { status: 409 }
      );
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ success: false, error: "User not found." }, { status: 404 });
    }

    if (target.role === "super_admin") {
      const activeSuperAdmins = await prisma.user.count({
        where: { role: "super_admin", active: true, NOT: { id } },
      });
      if (activeSuperAdmins === 0) {
        return NextResponse.json(
          { success: false, error: "Cannot delete the last active super_admin account." },
          { status: 409 }
        );
      }
    }

    const [assignedJobs, inspections, photos] = await Promise.all([
      prisma.job.count({
        where: { OR: [{ assignedManagerId: id }, { assignedStaffIds: { has: id } }] },
      }),
      prisma.qualityCheck.count({ where: { inspectorId: id } }),
      prisma.jobPhoto.count({ where: { uploadedByUserId: id } }),
    ]);

    if (assignedJobs > 0 || inspections > 0 || photos > 0) {
      if (target.active) {
        await prisma.user.update({ where: { id }, data: { active: false } });
      }
      logger.info("users.retired_instead_of_deleted", { userId: id, assignedJobs, inspections, photos });
      return NextResponse.json({
        success: true,
        data: { id, retired: true },
      });
    }

    await prisma.user.delete({ where: { id } });
    logger.info("users.deleted", { userId: id });
    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (err) {
    return errorResponse(err, "users.delete.route_error");
  }
}
