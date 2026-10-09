import { prisma } from "@/lib/server/prisma";
import { requirePermission, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { EmployeeInput, SENSITIVE_FIELDS, findDuplicateEmployee, serializeEmployees, teamEmployeeIds } from "@/lib/server/hr";
import { can } from "@/lib/rbac";

/** GET — one staff member, their assignments and (hr.sensitive only) documents. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, scope } = await requirePermission("hr.view");
    const sensitive = can(user, "hr.sensitive");
    if (scope !== "ALL" && !(await teamEmployeeIds(user.id)).includes(params.id)) return fail("Staff member not found.", 404);
    const e = await prisma.employee.findUnique({ where: { id: params.id } });
    if (!e) return fail("Staff member not found.", 404);
    const [assignments, documents] = await Promise.all([
      prisma.jobAssignment.findMany({
        where: { employeeId: e.id, ...(scope === "ALL" ? {} : { job: { assignedManagerId: user.id } }) },
        orderBy: { assignedAt: "desc" },
        take: 100,
        select: { id: true, jobId: true, role: true, status: true, rateType: true, rate: sensitive ? true : false, assignedAt: true, job: { select: { jobSerial: true, scheduledDate: true, scheduledTimeSlot: true, status: true, service: { select: { name: true } }, customer: { select: { name: true } } } } },
      }),
      sensitive ? prisma.storedFile.findMany({ where: { ownerType: "employee", ownerId: e.id }, orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, mimeType: true, category: true, label: true, expiresOn: true, createdAt: true, sizeBytes: true } }) : [],
    ]);
    return ok({
      employee: (await serializeEmployees([e], { sensitive }))[0],
      assignments: assignments.map((a) => ({ id: a.id, jobId: a.jobId, jobNumber: a.job.jobSerial, date: a.job.scheduledDate, timeSlot: a.job.scheduledTimeSlot, jobStatus: a.job.status, service: a.job.service.name, customer: scope === "ALL" ? a.job.customer.name : null, role: a.role, status: a.status, rateType: a.rateType, rate: sensitive ? a.rate : null })),
      documents,
    });
  } catch (err) {
    return errorResponse(err, "hr.employee.get_error");
  }
}

/** PATCH — edit a staff record. Compensation and personal details need hr.sensitive; every change is audited (old → new, without compensation values). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("hr.manage");
    const e = await prisma.employee.findUnique({ where: { id: params.id } });
    if (!e) return fail("Staff member not found.", 404);
    const body = (await readJson(request)) ?? {};
    // Validate the merged record so partial edits can't leave an invalid combination.
    const merged = { ...e, ...body, skills: body.skills ?? e.skills, serviceCategories: body.serviceCategories ?? e.serviceCategories };
    const parsed = EmployeeInput.safeParse(merged);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid employee.", 400);
    const d = parsed.data;
    const touched = Object.keys(body).filter((k) => k in d);
    if (!can(user, "hr.sensitive") && touched.some((k) => (SENSITIVE_FIELDS as readonly string[]).includes(k))) throw new HttpError(403, "Only an authorized user can change compensation and personal details.");
    if (touched.includes("phone") && d.phone !== e.phone && (await findDuplicateEmployee(d.phone, e.id))) return fail("Another staff member already has this phone number.", 409);
    if (touched.includes("employmentType") && d.employmentType !== e.employmentType) {
      const used = await prisma.jobAssignment.count({ where: { employeeId: e.id } });
      if (used > 0 && (d.employmentType === "FREELANCE" || e.employmentType === "FREELANCE")) return fail("This person already has job assignments, so they can't be switched to or from freelance.", 409);
    }
    if (touched.includes("userId") && d.userId && d.userId !== e.userId && (await prisma.employee.findUnique({ where: { userId: d.userId }, select: { id: true } }))) return fail("That login is already linked to another staff record.", 409);
    if (touched.includes("managerUserId") && d.managerUserId && !(await prisma.user.findFirst({ where: { id: d.managerUserId, active: true, role: { in: ["field_manager", "admin"] } }, select: { id: true } }))) return fail("Pick an active Field Manager or Admin as the manager.", 400);

    const data: Record<string, unknown> = {};
    for (const k of touched) data[k] = typeof (d as Record<string, unknown>)[k] === "string" && (d as Record<string, unknown>)[k] === "" ? null : (d as Record<string, unknown>)[k];
    const changed = Object.keys(data).filter((k) => JSON.stringify((e as Record<string, unknown>)[k]) !== JSON.stringify(data[k]));
    if (!changed.length) return ok((await serializeEmployees([e], { sensitive: can(user, "hr.sensitive") }))[0]);
    const updated = await prisma.employee.update({ where: { id: e.id }, data });
    const safe = (k: string) => !(SENSITIVE_FIELDS as readonly string[]).includes(k);
    void recordAudit({
      actor: user, action: "EMPLOYEE_UPDATED", entityType: "employee", entityId: e.id,
      previousState: JSON.stringify(Object.fromEntries(changed.filter(safe).map((k) => [k, (e as Record<string, unknown>)[k]]))).slice(0, 480),
      newState: JSON.stringify(Object.fromEntries(changed.filter(safe).map((k) => [k, data[k]]))).slice(0, 480),
      details: `${e.employeeCode}: ${changed.join(", ")}${changed.some((k) => !safe(k)) ? " (includes compensation / personal details)" : ""}`, request,
    });
    return ok((await serializeEmployees([updated], { sensitive: can(user, "hr.sensitive") }))[0]);
  } catch (err) {
    return errorResponse(err, "hr.employee.patch_error");
  }
}
