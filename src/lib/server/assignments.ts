import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { recordAudit } from "./audit";
import { nextFreelancePaymentNumber } from "./biz";
import { round2, type AssignmentRow } from "@/lib/business";

const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
const CLOSED_JOB = [...DONE, "CANCELLED"];
/** Assignment statuses that occupy the person's time. */
export const ACTIVE_ASSIGNMENT = ["ASSIGNED", "ACCEPTED", "COMPLETED"];

/** "09:00 - 13:00" → minutes since midnight, or null when it can't be read. */
export function slotRange(slot: string): [number, number] | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$/.exec(slot);
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = Number(m[3]) * 60 + Number(m[4]);
  return b > a ? [a, b] : null;
}
export const overlaps = (a: string, b: string) => {
  const x = slotRange(a);
  const y = slotRange(b);
  // An unreadable slot is treated as the whole day so a clash is never missed.
  return !x || !y ? true : x[0] < y[1] && y[0] < x[1];
};

export interface Conflict {
  kind: "job" | "leave" | "status" | "absent";
  blocking: boolean;
  message: string;
  jobId?: string;
  jobNumber?: string;
}

/**
 * Why people may not be free for a job: other jobs at the same time, approved
 * leave, status. Computed for many people in a handful of queries.
 */
export async function conflictsForMany(employeeIds: string[], job: { id: string; scheduledDate: string; scheduledTimeSlot: string }): Promise<Map<string, Conflict[]>> {
  const out = new Map<string, Conflict[]>(employeeIds.map((id) => [id, []]));
  if (!employeeIds.length) return out;
  const [emps, leaves, absent, others] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, status: true, fullName: true } }),
    prisma.leaveRequest.findMany({ where: { employeeId: { in: employeeIds }, status: "APPROVED", startDate: { lte: job.scheduledDate }, endDate: { gte: job.scheduledDate } }, select: { employeeId: true, startDate: true, endDate: true } }),
    prisma.attendanceRecord.findMany({ where: { employeeId: { in: employeeIds }, date: job.scheduledDate, status: { in: ["ABSENT", "LEAVE"] } }, select: { employeeId: true } }),
    prisma.jobAssignment.findMany({
      where: { employeeId: { in: employeeIds }, status: { in: ACTIVE_ASSIGNMENT }, jobId: { not: job.id }, job: { scheduledDate: job.scheduledDate, status: { notIn: CLOSED_JOB } } },
      select: { employeeId: true, jobId: true, job: { select: { jobSerial: true, scheduledTimeSlot: true } } },
    }),
  ]);
  for (const e of emps) if (e.status === "EXITED" || e.status === "INACTIVE") out.get(e.id)!.push({ kind: "status", blocking: true, message: `${e.fullName} is ${e.status === "EXITED" ? "no longer with the company" : "marked inactive"}.` });
  for (const l of leaves) out.get(l.employeeId)!.push({ kind: "leave", blocking: true, message: `On approved leave ${l.startDate} to ${l.endDate}.` });
  for (const x of absent) out.get(x.employeeId)!.push({ kind: "absent", blocking: false, message: "Marked absent or on leave that day." });
  for (const o of others) if (overlaps(o.job.scheduledTimeSlot, job.scheduledTimeSlot)) out.get(o.employeeId)!.push({ kind: "job", blocking: false, jobId: o.jobId, jobNumber: o.job.jobSerial, message: `Already on ${o.job.jobSerial} (${o.job.scheduledTimeSlot}).` });
  return out;
}

export async function logAssignment(e: { jobId: string; employeeId?: string | null; action: string; actor: { id?: string | null; name: string }; detail?: string | null }) {
  await prisma.jobAssignmentEvent.create({ data: { jobId: e.jobId, employeeId: e.employeeId ?? null, action: e.action, actorId: e.actor.id ?? null, actorName: e.actor.name, detail: e.detail?.slice(0, 300) ?? null } });
}

type AssignmentWithEmployee = Prisma.JobAssignmentGetPayload<{ include: { employee: { select: { fullName: true; employeeCode: true; employmentType: true; phone: true } } } }>;

/** `withMoney` adds agreed rates (Admin); `withPhone` is for the Field Manager who runs the job. */
export function toAssignmentRow(a: AssignmentWithEmployee, opts: { withMoney: boolean }): AssignmentRow {
  return {
    id: a.id, jobId: a.jobId, employeeId: a.employeeId, employeeName: a.employee.fullName, employeeCode: a.employee.employeeCode, employmentType: a.employee.employmentType, phone: a.employee.phone,
    role: a.role as AssignmentRow["role"], status: a.status,
    rateType: opts.withMoney ? a.rateType : null, rate: opts.withMoney ? a.rate : null,
    expectedHours: a.expectedHours, actualHours: a.actualHours, assignedAt: a.assignedAt.toISOString(),
  };
}

/**
 * Freelance pay for finished work. When a job is completed, every freelancer who
 * worked it (assigned or accepted, not declined or removed) gets ONE payment record
 * (unique per assignment) waiting for verification. Employees are never turned into
 * payments — only people whose employment type is FREELANCE.
 */
export async function syncFreelancePayments(actor: { id: string; name: string; role: string } = { id: "system", name: "System", role: "system" }): Promise<number> {
  const due = await prisma.jobAssignment.findMany({
    where: { status: { in: ["ASSIGNED", "ACCEPTED", "COMPLETED"] }, employee: { employmentType: "FREELANCE" }, job: { status: { in: DONE } }, freelancePayment: null },
    include: { job: { select: { id: true, jobSerial: true } } },
    take: 200,
  });
  let made = 0;
  for (const a of due) {
    if (!a.rateType || a.rate === null) continue; // an agreed rate is required (checked when assigning)
    const hours = a.rateType === "HOURLY" ? a.actualHours ?? a.expectedHours ?? null : null;
    const amount = a.rateType === "HOURLY" ? round2((a.rate ?? 0) * (hours ?? 0)) : round2(a.rate ?? 0);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.jobAssignment.updateMany({ where: { id: a.id, status: { in: ["ASSIGNED", "ACCEPTED"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
        await tx.freelancePayment.create({ data: { paymentNumber: await nextFreelancePaymentNumber(tx), assignmentId: a.id, employeeId: a.employeeId, jobId: a.jobId, rateType: a.rateType!, rate: a.rate!, hours, amount } });
      });
      made++;
      void recordAudit({ actor, action: "FREELANCE_PAYMENT_CREATED", entityType: "freelance_payment", entityId: a.id, jobId: a.jobId, newState: "PENDING_VERIFICATION", details: `${a.job.jobSerial} ₹${amount}` });
    } catch {
      /* unique violation: another request created it first — nothing to do */
    }
  }
  return made;
}

/** Another open job at an OVERLAPPING time that already has one of these Field Managers / workers. */
export async function crewClash(crew: string[], job: { id: string; scheduledDate: string; scheduledTimeSlot: string }) {
  if (!crew.length) return null;
  const same = await prisma.job.findMany({
    where: { id: { not: job.id }, scheduledDate: job.scheduledDate, status: { notIn: ["COMPLETED", "CANCELLED", "CLOSED", "FEEDBACK_REQUESTED"] }, OR: [{ assignedStaffIds: { hasSome: crew } }, { assignedManagerId: { in: crew } }] },
    select: { id: true, jobSerial: true, scheduledTimeSlot: true },
  });
  return same.find((j) => overlaps(j.scheduledTimeSlot, job.scheduledTimeSlot)) ?? null;
}
