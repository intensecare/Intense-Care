import type { Job } from "./types";

/**
 * Staff availability — ONE definition used everywhere a worker's duty state is
 * shown or gated (job-file crew picker, new-booking form, dispatcher tower,
 * users directory). The server-side double-booking guard in
 * PATCH /api/jobs/[id] stays the authority; this module only mirrors it in UI.
 *
 * States:
 *  - "assigned_here" — already on THIS job (not a conflict; selectable).
 *  - "booked_slot"   — on ANOTHER non-terminal job with the same date+slot
 *                      (the server will 409; UI shows "Already assigned").
 *  - "on_duty"       — on another non-terminal job right now (different slot).
 *  - "available"     — no active assignment; free for this slot.
 */
export type AvailabilityState = "assigned_here" | "booked_slot" | "on_duty" | "available";

export const TERMINAL_JOB_STATUSES = ["COMPLETED", "CANCELLED", "CLOSED"];

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** Worker ids on ANOTHER non-terminal job with the same date + slot as `job`. */
export function bookedSlotWorkerIds(job: Pick<Job, "id" | "scheduledDate" | "scheduledTimeSlot">, jobs: Job[]): Set<string> {
  const busy = new Set<string>();
  for (const other of jobs) {
    if (other.id === job.id) continue;
    if (other.scheduledDate !== job.scheduledDate) continue;
    if (other.scheduledTimeSlot !== job.scheduledTimeSlot) continue;
    if (isTerminalStatus(other.status)) continue;
    for (const id of other.assignedStaffIds || []) busy.add(id);
  }
  return busy;
}

/** Worker ids on ANY non-terminal job (duty view, date-agnostic). */
export function onDutyWorkerIds(jobs: Job[]): Set<string> {
  const onDuty = new Set<string>();
  for (const j of jobs) {
    if (isTerminalStatus(j.status)) continue;
    for (const id of j.assignedStaffIds || []) onDuty.add(id);
  }
  return onDuty;
}

/** The four-state availability of one worker against one job's slot. */
export function availabilityFor(
  workerId: string,
  job: Pick<Job, "id" | "assignedStaffIds" | "scheduledDate" | "scheduledTimeSlot">,
  jobs: Job[]
): AvailabilityState {
  if ((job.assignedStaffIds || []).includes(workerId)) return "assigned_here";
  if (bookedSlotWorkerIds(job, jobs).has(workerId)) return "booked_slot";
  if (onDutyWorkerIds(jobs).has(workerId)) return "on_duty";
  return "available";
}
