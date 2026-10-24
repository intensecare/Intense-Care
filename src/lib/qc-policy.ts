/**
 * Separation of duties for quality control — pure, so the pages and the server apply the same rule.
 *
 * With one combined Field Operations Manager role, the person who did the work can also hold the inspector's pen.
 * The company decides (Settings → Quality control) whether that is allowed:
 *   separationOfDuties = true  (default)  nobody on a job's crew may inspect, pass or reinspect that job
 *   separationOfDuties = false            they may; every inspection still records WHO inspected and that they were on the crew
 * The rule is enforced on the server in /api/quality — hiding the button is never the guard.
 */
export interface QcPolicy {
  separationOfDuties: boolean;
}

export const DEFAULT_QC_POLICY: QcPolicy = { separationOfDuties: true };

export interface CrewRef {
  assignedManagerId?: string | null;
  assignedStaffIds?: string[] | null;
}

export function isOnCrew(userId: string, job: CrewRef): boolean {
  return job.assignedManagerId === userId || (job.assignedStaffIds ?? []).includes(userId);
}

/** A reason when this person may not inspect this job under the policy, else null. */
export function inspectionBarredReason(policy: QcPolicy, userId: string, job: CrewRef): string | null {
  if (!policy.separationOfDuties) return null;
  return isOnCrew(userId, job) ? "Company rule: you can't inspect a job you worked on. Another Field Operations Manager or an Admin must do the inspection." : null;
}
