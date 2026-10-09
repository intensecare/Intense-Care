import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { authorizeJob, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { ACTIVE_ASSIGNMENT, conflictsForMany, logAssignment, syncFreelancePayments, toAssignmentRow } from "@/lib/server/assignments";
import { notifyJobAssigned, notifyStaffAssignment } from "@/lib/server/notify";
import { can } from "@/lib/rbac";
import { round2 } from "@/lib/business";

const CLOSED = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED", "CANCELLED"];
const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
const include = { employee: { select: { fullName: true, employeeCode: true, employmentType: true, phone: true } } } as const;

/**
 * GET /api/jobs/[id]/team — who is on the job.
 *   Admin: the team with agreed rates, the assignment history, conflicts, and
 *          with ?candidates=1 the people who could be added and whether they are free.
 *   Field Manager (own jobs): the team's names, roles, status and phone numbers — no rates, no history.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await authorizeJob(params.id, "jobs.view");
    if (!can(user, "hr.view")) throw new HttpError(403, "Your role is not authorized for this action.");
    const admin = can(user, "jobs.assign");
    const job = await prisma.job.findUniqueOrThrow({ where: { id: params.id }, select: { id: true, scheduledDate: true, scheduledTimeSlot: true, status: true, requiredSkills: true, expectedDurationHours: true, specialInstructions: true, assignmentConfirmedAt: true, assignedManagerId: true, service: { select: { name: true, category: true } } } });
    if (admin) await syncFreelancePayments(user);
    const rows = await prisma.jobAssignment.findMany({ where: { jobId: job.id }, orderBy: [{ status: "asc" }, { assignedAt: "asc" }], include });
    const active = rows.filter((r) => ACTIVE_ASSIGNMENT.includes(r.status));
    const conflicts = admin ? await conflictsForMany(active.map((r) => r.employeeId), job) : new Map();
    const base = {
      job: { requiredSkills: job.requiredSkills, expectedDurationHours: job.expectedDurationHours, specialInstructions: job.specialInstructions, confirmedAt: job.assignmentConfirmedAt?.toISOString() ?? null, closed: CLOSED.includes(job.status) },
      assignments: rows.map((r) => ({ ...toAssignmentRow(r, { withMoney: can(user, "hr.sensitive") }), conflicts: conflicts.get(r.employeeId) ?? [] })),
    };
    if (!admin) return ok({ ...base, assignments: base.assignments.filter((a) => a.status !== "REMOVED" && a.status !== "DECLINED") });

    const history = await prisma.jobAssignmentEvent.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "desc" }, take: 100 });
    const names = new Map(rows.map((r) => [r.employeeId, r.employee.fullName]));
    let candidates: unknown[] | undefined;
    if (new URL(request.url).searchParams.get("candidates") === "1") {
      const people = await prisma.employee.findMany({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } }, orderBy: { fullName: "asc" }, take: 300 });
      const c = await conflictsForMany(people.map((p) => p.id), job);
      const onJob = new Set(active.map((r) => r.employeeId));
      candidates = people.filter((p) => !onJob.has(p.id)).map((p) => {
        const cs = c.get(p.id) ?? [];
        const missing = job.requiredSkills.filter((k) => !p.skills.map((x) => x.toLowerCase()).includes(k.toLowerCase()));
        const blockedFreelance = p.employmentType === "FREELANCE" && p.verificationStatus !== "VERIFIED";
        return { id: p.id, name: p.fullName, code: p.employeeCode, employmentType: p.employmentType, skills: p.skills, availabilityNotes: p.availabilityNotes, payType: can(user, "hr.sensitive") ? p.payType : null, payRate: can(user, "hr.sensitive") ? p.payRate : null, free: cs.length === 0 && !blockedFreelance && p.status === "ACTIVE", conflicts: [...cs, ...(blockedFreelance ? [{ kind: "status", blocking: true, message: "Freelancer is not verified yet." }] : []), ...(p.status === "ON_LEAVE" ? [{ kind: "status", blocking: false, message: "Marked on leave." }] : [])], missingSkills: missing };
      });
    }
    return ok({ ...base, history: history.map((h) => ({ id: h.id, action: h.action, employeeName: h.employeeId ? names.get(h.employeeId) ?? null : null, actor: h.actorName, detail: h.detail, at: h.createdAt.toISOString() })), candidates });
  } catch (err) {
    return errorResponse(err, "jobs.team.get_error");
  }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), employeeId: z.string().min(1).max(64), role: z.enum(["LEAD", "MEMBER"]).default("MEMBER"), rateType: z.enum(["FIXED", "HOURLY"]).optional(), rate: z.number().min(0).max(10_000_000).optional(), expectedHours: z.number().min(0).max(100).optional(), acknowledgeConflict: z.boolean().default(false) }),
  z.object({ action: z.literal("remove"), employeeId: z.string().min(1).max(64), reason: z.string().trim().min(3, "Say why they are being removed.").max(300) }),
  z.object({ action: z.literal("set-lead"), employeeId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("respond"), employeeId: z.string().min(1).max(64), response: z.enum(["ACCEPTED", "DECLINED"]) }),
  z.object({ action: z.literal("complete"), employeeId: z.string().min(1).max(64), actualHours: z.number().min(0).max(100).optional() }),
  z.object({ action: z.literal("details"), requiredSkills: z.array(z.string().trim().min(1).max(40)).max(20).default([]), expectedDurationHours: z.number().min(0).max(100).nullable().optional(), specialInstructions: z.string().trim().max(1000).nullable().optional() }),
  z.object({ action: z.literal("confirm") }),
]);

/** POST — Admin changes the team. Each action is checked against the job's state and written to the assignment history. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await authorizeJob(params.id, "jobs.assign");
    if (!can(user, "hr.view")) throw new HttpError(403, "Your role is not authorized for this action.");
    const parsed = Action.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Check the details and try again.", 400);
    const a = parsed.data;
    const job = await prisma.job.findUniqueOrThrow({ where: { id: params.id }, select: { id: true, jobSerial: true, status: true, scheduledDate: true, scheduledTimeSlot: true, requiredSkills: true, assignedManagerId: true, assignmentConfirmedAt: true, startedAt: true } });
    const actor = { id: user.id, name: user.name };
    const confirmed = !!job.assignmentConfirmedAt;

    if (a.action === "details") {
      if (CLOSED.includes(job.status)) return fail("This job is closed.", 409);
      await prisma.job.update({ where: { id: job.id }, data: { requiredSkills: a.requiredSkills, expectedDurationHours: a.expectedDurationHours ?? null, specialInstructions: a.specialInstructions || null } });
      void recordAudit({ actor: user, action: "JOB_STAFFING_UPDATED", entityType: "job", entityId: job.id, jobId: job.id, details: `skills: ${a.requiredSkills.join(", ") || "none"}`, request });
      return ok({ updated: true });
    }

    if (a.action === "confirm") {
      const n = await prisma.jobAssignment.count({ where: { jobId: job.id, status: { in: ["ASSIGNED", "ACCEPTED"] } } });
      if (!job.assignedManagerId && n === 0) return fail("Assign a Field Manager or at least one cleaner before confirming.", 409);
      if (CLOSED.includes(job.status)) return fail("This job is closed.", 409);
      await prisma.job.update({ where: { id: job.id }, data: { assignmentConfirmedAt: new Date(), assignmentConfirmedBy: user.id } });
      await logAssignment({ jobId: job.id, action: "TEAM_CONFIRMED", actor, detail: `${n} cleaner(s)${job.assignedManagerId ? " + Field Manager" : ""}` });
      const staff = await prisma.jobAssignment.findMany({ where: { jobId: job.id, status: { in: ["ASSIGNED", "ACCEPTED"] } }, select: { employeeId: true } });
      const [m, s] = await Promise.all([notifyJobAssigned(job.id).catch(() => null), notifyStaffAssignment(job.id, staff.map((x) => x.employeeId), "assigned").catch(() => null)]);
      void recordAudit({ actor: user, action: "TEAM_CONFIRMED", entityType: "job", entityId: job.id, jobId: job.id, details: `${n} cleaner(s)`, request });
      return ok({ confirmed: true, notified: { manager: m?.queued ?? false, staff: s?.queued ?? false, provider: s?.provider ?? m?.provider ?? "none" } });
    }

    // The remaining actions are about one person.
    const emp = await prisma.employee.findUnique({ where: { id: a.employeeId } });
    if (!emp) return fail("Staff member not found.", 404);
    const row = await prisma.jobAssignment.findUnique({ where: { jobId_employeeId: { jobId: job.id, employeeId: emp.id } } });
    const isActive = !!row && ACTIVE_ASSIGNMENT.includes(row.status);

    if (a.action === "add") {
      if (CLOSED.includes(job.status)) return fail("This job is closed — the team can't be changed.", 409);
      if (isActive) return fail(`${emp.fullName} is already on this job.`, 409);
      const cs = (await conflictsForMany([emp.id], job)).get(emp.id) ?? [];
      const freelance = emp.employmentType === "FREELANCE";
      if (freelance && emp.verificationStatus !== "VERIFIED") cs.push({ kind: "status", blocking: true, message: "This freelancer hasn't been verified yet." });
      const missing = job.requiredSkills.filter((k) => !emp.skills.map((x) => x.toLowerCase()).includes(k.toLowerCase()));
      if (missing.length) cs.push({ kind: "status", blocking: false, message: `Missing skills: ${missing.join(", ")}.` });
      const hard = cs.filter((c) => c.blocking);
      if (hard.length) return Response.json({ success: false, error: hard.map((c) => c.message).join(" "), conflicts: cs }, { status: 409 });
      if (cs.length && !a.acknowledgeConflict) return Response.json({ success: false, error: cs.map((c) => c.message).join(" "), conflicts: cs, needsConfirmation: true }, { status: 409 });

      let rateType = a.rateType ?? null;
      let rate = a.rate ?? null;
      if (freelance) {
        if (!rateType || rate === null) {
          if (emp.payType === "HOURLY" || emp.payType === "PER_JOB") { rateType = rateType ?? (emp.payType === "HOURLY" ? "HOURLY" : "FIXED"); rate = rate ?? emp.payRate ?? null; }
        }
        if (!rateType || rate === null || rate <= 0) return fail("Enter the agreed rate for this freelancer (per hour or fixed for the job).", 400);
      } else { rateType = null; rate = null; }

      try {
        await prisma.$transaction(async (tx) => {
          if (a.role === "LEAD") await tx.jobAssignment.updateMany({ where: { jobId: job.id, role: "LEAD", status: { in: ACTIVE_ASSIGNMENT } }, data: { role: "MEMBER" } });
          const data = { role: a.role, status: "ASSIGNED", rateType, rate, expectedHours: a.expectedHours ?? null, actualHours: null, assignedBy: user.id, assignedAt: new Date(), respondedAt: null, completedAt: null, removedAt: null, removedReason: null };
          if (row) await tx.jobAssignment.update({ where: { id: row.id }, data });
          else await tx.jobAssignment.create({ data: { jobId: job.id, employeeId: emp.id, ...data } });
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(`${emp.fullName} was just added by someone else.`, 409);
        throw e;
      }
      await logAssignment({ jobId: job.id, employeeId: emp.id, action: "ASSIGNED", actor, detail: `${a.role}${rate !== null ? ` · ${rateType} ₹${rate}` : ""}${cs.length ? " · conflict acknowledged" : ""}` });
      void recordAudit({ actor: user, action: "STAFF_ASSIGNED", entityType: "job", entityId: job.id, jobId: job.id, details: `${emp.fullName} (${emp.employeeCode})${cs.length ? " — " + cs.map((c) => c.message).join(" ") : ""}`, request });
      if (confirmed) void notifyStaffAssignment(job.id, [emp.id], "assigned").catch(() => {});
      return ok({ added: emp.id }, 201);
    }

    if (!row || !isActive) return fail(`${emp.fullName} isn't on this job.`, 404);

    if (a.action === "remove") {
      if (CLOSED.includes(job.status) && !DONE.includes(job.status)) return fail("This job is closed.", 409);
      const pay = await prisma.freelancePayment.findUnique({ where: { assignmentId: row.id }, select: { status: true } });
      if (pay && pay.status !== "REJECTED") return fail("A freelance payment already exists for this work, so they can't be removed.", 409);
      const u = await prisma.jobAssignment.updateMany({ where: { id: row.id, status: { in: ACTIVE_ASSIGNMENT } }, data: { status: "REMOVED", removedAt: new Date(), removedReason: a.reason, role: "MEMBER" } });
      if (u.count === 0) return fail("They were already removed.", 409);
      await logAssignment({ jobId: job.id, employeeId: emp.id, action: "REMOVED", actor, detail: a.reason });
      void recordAudit({ actor: user, action: "STAFF_REMOVED", entityType: "job", entityId: job.id, jobId: job.id, reason: a.reason, details: `${emp.fullName} (${emp.employeeCode})`, request });
      if (confirmed) void notifyStaffAssignment(job.id, [emp.id], "removed").catch(() => {});
      return ok({ removed: emp.id });
    }

    if (a.action === "set-lead") {
      await prisma.$transaction(async (tx) => {
        await tx.jobAssignment.updateMany({ where: { jobId: job.id, role: "LEAD", status: { in: ACTIVE_ASSIGNMENT } }, data: { role: "MEMBER" } });
        await tx.jobAssignment.update({ where: { id: row.id }, data: { role: "LEAD" } });
      });
      await logAssignment({ jobId: job.id, employeeId: emp.id, action: "ROLE_CHANGED", actor, detail: "Team leader" });
      return ok({ lead: emp.id });
    }

    if (a.action === "respond") {
      const u = await prisma.jobAssignment.updateMany({ where: { id: row.id, status: { in: ["ASSIGNED", "ACCEPTED"] } }, data: { status: a.response, respondedAt: new Date(), ...(a.response === "DECLINED" ? { role: "MEMBER" } : {}) } });
      if (u.count === 0) return fail("That assignment can't be changed now.", 409);
      await logAssignment({ jobId: job.id, employeeId: emp.id, action: a.response, actor, detail: "Recorded by Admin" });
      return ok({ status: a.response });
    }

    // complete
    if (!job.startedAt && !DONE.includes(job.status)) return fail("The job hasn't started yet.", 409);
    if (row.rateType === "HOURLY" && !(a.actualHours && a.actualHours > 0) && !row.actualHours) return fail("Enter the hours worked for this hourly freelancer.", 400);
    await prisma.jobAssignment.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt: new Date(), actualHours: a.actualHours !== undefined ? round2(a.actualHours) : row.actualHours } });
    await logAssignment({ jobId: job.id, employeeId: emp.id, action: "COMPLETED", actor, detail: a.actualHours ? `${a.actualHours} h` : null });
    if (DONE.includes(job.status)) await syncFreelancePayments(user);
    return ok({ status: "COMPLETED" });
  } catch (err) {
    return errorResponse(err, "jobs.team.post_error");
  }
}
