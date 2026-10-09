import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { csvResponse, nextEmployeeCode, parsePaging } from "@/lib/server/biz";
import { EmployeeInput, SENSITIVE_FIELDS, findDuplicateEmployee, serializeEmployees, teamEmployeeIds } from "@/lib/server/hr";
import { can } from "@/lib/rbac";
import { employmentLabel } from "@/lib/business";

/**
 * GET /api/hr/employees — the staff directory. Admin sees everyone; a Field
 * Manager sees only staff on their own jobs and never compensation, address or
 * documents. Filters: type, status, q, skill, page. `?format=csv` (Admin).
 */
export async function GET(request: Request) {
  try {
    const { user, scope } = await requirePermission("hr.view");
    const url = new URL(request.url);
    const sensitive = can(user, "hr.sensitive");
    const g = (k: string) => url.searchParams.get(k);
    const q = g("q")?.trim();
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        scope === "ALL" ? {} : { id: { in: await teamEmployeeIds(user.id) } },
        g("type") ? { employmentType: g("type")! } : {},
        g("status") ? { status: g("status")! } : {},
        g("skill") ? { skills: { has: g("skill")! } } : {},
        q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { employeeCode: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { designation: { contains: q, mode: "insensitive" } }] } : {},
      ],
    };
    if (g("format") === "csv") {
      if (!sensitive) return fail("Your role is not authorized for this action.", 403);
      const rows = await serializeEmployees(await prisma.employee.findMany({ where, orderBy: { employeeCode: "asc" }, take: 5000 }), { sensitive });
      void recordAudit({ actor: user, action: "EMPLOYEES_EXPORTED", entityType: "employee", entityId: "export", details: `${rows.length} rows`, request });
      return csvResponse("employees", rows.map((r) => ({ "Employee ID": r.employeeCode, Name: r.fullName, Type: employmentLabel(r.employmentType), Status: r.status, Phone: r.phone, Email: r.email ?? "", Department: r.department ?? "", Designation: r.designation ?? "", Joined: r.joiningDate ?? "", Manager: r.managerName ?? "", Skills: r.skills.join("; "), Verification: r.verificationStatus })));
    }
    const { page, pageSize, skip, take } = parsePaging(url, 25, 200);
    const [rows, total] = await Promise.all([prisma.employee.findMany({ where, orderBy: [{ status: "asc" }, { fullName: "asc" }], skip, take }), prisma.employee.count({ where })]);
    return ok({ rows: await serializeEmployees(rows, { sensitive }), total, page, pageSize });
  } catch (err) {
    return errorResponse(err, "hr.employees.get_error");
  }
}

/** POST — add an employee, contract worker or freelancer (employmentType). Phone numbers can't be registered twice. */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("hr.manage");
    const parsed = EmployeeInput.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid employee.", 400);
    const d = parsed.data;
    if (!can(user, "hr.sensitive") && SENSITIVE_FIELDS.some((k) => d[k] !== undefined && d[k] !== null)) return fail("Only an authorized user can enter compensation and personal details.", 403);
    const dup = await findDuplicateEmployee(d.phone);
    if (dup) return fail(`${dup.fullName} (${dup.employeeCode}) already has this phone number.`, 409);
    if (d.userId) {
      const u = await prisma.user.findUnique({ where: { id: d.userId }, select: { id: true } });
      if (!u) return fail("That login doesn't exist.", 404);
      if (await prisma.employee.findUnique({ where: { userId: d.userId }, select: { id: true } })) return fail("That login is already linked to another staff record.", 409);
    }
    if (d.managerUserId && !(await prisma.user.findFirst({ where: { id: d.managerUserId, active: true, role: { in: ["field_manager", "admin"] } }, select: { id: true } }))) return fail("Pick an active Field Manager or Admin as the manager.", 400);

    const created = await prisma.employee.create({
      data: {
        employeeCode: await nextEmployeeCode(d.employmentType),
        ...d,
        email: d.email || null,
        joiningDate: d.joiningDate || null,
        managerUserId: d.managerUserId || null,
        userId: d.userId || null,
        createdBy: user.id,
      },
    });
    void recordAudit({ actor: user, action: "EMPLOYEE_CREATED", entityType: "employee", entityId: created.id, details: `${created.employeeCode} ${created.fullName} (${created.employmentType})`, request });
    return ok((await serializeEmployees([created], { sensitive: true }))[0], 201);
  } catch (err) {
    return errorResponse(err, "hr.employees.post_error");
  }
}
