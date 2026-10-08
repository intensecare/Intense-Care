/**
 * RBAC — contextual next action (§19 / §29).
 *
 * For a (role, job state) pair there is ONE primary action. The same table
 * drives the UI (what button to show) and the server (which transition the
 * role may request from this state), so a hidden button is never the only
 * guard. Customer-facing wording lives here too so no internal terminology
 * leaks into the customer portal.
 */

import type { Role } from "./roles";
import { normalizeRole } from "./roles";
import type { Permission } from "./permissions";

export type JobStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ASSIGNED"
  | "ARRIVED"
  | "CUSTOMER_VERIFIED"
  | "IN_PROGRESS"
  | "WORK_COMPLETED"
  | "QUALITY_CHECK"
  | "PASS"
  | "REWORK_REQUIRED"
  | "REWORK_ASSIGNED"
  | "REWORK_IN_PROGRESS"
  | "REWORK_COMPLETED"
  | "REINSPECTION"
  | "CUSTOMER_APPROVAL"
  | "COMPLETED"
  | "FEEDBACK_REQUESTED"
  | "CLOSED"
  | "CANCELLED";

/**
 * Which permission a status transition requires. Shared by the state machine
 * (client) and PATCH /api/jobs/[id] (server). A transition not listed here is
 * not reachable through the API at all.
 */
export const TRANSITION_PERMISSION: Record<JobStatus, Permission> = {
  DRAFT: "jobs.update",
  SCHEDULED: "jobs.reschedule",
  ASSIGNED: "jobs.assign",
  ARRIVED: "jobs.arrive",
  CUSTOMER_VERIFIED: "customer_approval.approve", // only the customer's secure link reaches this
  IN_PROGRESS: "jobs.start",
  WORK_COMPLETED: "jobs.complete",
  QUALITY_CHECK: "qc.inspect",
  PASS: "qc.pass",
  REWORK_REQUIRED: "qc.rework",
  REWORK_ASSIGNED: "rework.create",
  REWORK_IN_PROGRESS: "rework.complete",
  REWORK_COMPLETED: "rework.complete",
  REINSPECTION: "qc.reinspect",
  CUSTOMER_APPROVAL: "customer_approval.request",
  COMPLETED: "customer_approval.approve",
  FEEDBACK_REQUESTED: "feedback.manage",
  CLOSED: "jobs.close",
  CANCELLED: "jobs.cancel",
};

export type NextActionKind =
  | "transition" // PATCH status → target
  | "assign" // open crew picker
  | "schedule" // open scheduling
  | "checklist" // continue checklist
  | "photos" // capture before/after photos
  | "inspect" // open QC inspection screen
  | "rework" // open rework tasks
  | "handover" // open the customer handover link
  | "approve" // customer approval (portal)
  | "confirm" // customer confirms arrival (portal)
  | "feedback" // customer rates the service (portal)
  | "view" // read-only: open report / view handover
  | "wait"; // nothing for this role to do right now

export interface NextAction {
  kind: NextActionKind;
  label: string;
  /** Status target for `transition`; tab/screen id for the others. */
  target?: JobStatus | string;
  /** One line explaining what is happening now. */
  hint: string;
  /** True when the role is waiting on somebody else. */
  waiting?: boolean;
  tone?: "primary" | "success" | "warning" | "neutral";
}

export interface JobContext {
  status: JobStatus | string;
  assignedStaffIds?: string[];
  assignedManagerId?: string | null;
  customerConfirmedAt?: string | null;
  /** Checklist progress on the job (mandatory items). */
  checklistTotal?: number;
  checklistDone?: number;
  /** Before/after evidence counts. */
  photosBefore?: number;
  photosAfter?: number;
  /** Open (not completed) rework tasks. */
  openRework?: number;
  /** Invoice state for Accounts. */
  balanceDue?: number;
  invoiceFinalized?: boolean;
  approvedAt?: string | null;
  feedbackAt?: string | null;
}

const WAIT = (label: string, hint: string): NextAction => ({ kind: "wait", label, hint, waiting: true, tone: "neutral" });

/** ONE next action for the role on the job, or null when nothing applies. */
export function getNextAction(roleRaw: Role | string, job: JobContext): NextAction | null {
  const role = normalizeRole(roleRaw);
  const s = job.status as JobStatus;
  const checklistComplete = (job.checklistTotal ?? 0) === 0 || (job.checklistDone ?? 0) >= (job.checklistTotal ?? 0);
  const photosComplete = (job.photosBefore ?? 0) > 0 && (job.photosAfter ?? 0) > 0;
  const unassigned = !job.assignedManagerId && (job.assignedStaffIds?.length ?? 0) === 0;

  /* ---------------------------------------------------------------- customer */
  if (role === "customer") {
    switch (s) {
      case "DRAFT":
      case "SCHEDULED":
      case "ASSIGNED":
        return { kind: "view", label: "View Service", hint: "Your team is scheduled.", tone: "neutral" };
      case "ARRIVED":
        return job.customerConfirmedAt
          ? WAIT("Team Confirmed", "Your service is about to start.")
          : { kind: "confirm", label: "Confirm & Start", hint: "Your cleaning team has arrived.", tone: "primary" };
      case "CUSTOMER_VERIFIED":
      case "IN_PROGRESS":
        return { kind: "view", label: "View Progress", hint: "Service in progress.", tone: "neutral" };
      case "WORK_COMPLETED":
      case "QUALITY_CHECK":
      case "REWORK_REQUIRED":
      case "REWORK_ASSIGNED":
      case "REWORK_IN_PROGRESS":
      case "REWORK_COMPLETED":
      case "REINSPECTION":
        return { kind: "view", label: "Review Before / After", hint: "Quality check in progress.", tone: "neutral" };
      case "PASS":
      case "CUSTOMER_APPROVAL":
        return { kind: "approve", label: "Approve Service", hint: "Quality checked. Ready for your approval.", tone: "primary" };
      case "COMPLETED":
      case "FEEDBACK_REQUESTED":
        return job.feedbackAt
          ? { kind: "view", label: "View Report", hint: "Thank you for your feedback.", tone: "success" }
          : { kind: "feedback", label: "Rate Your Service", hint: "Service completed.", tone: "success" };
      case "CLOSED":
        return { kind: "view", label: "View Report", hint: "Service completed.", tone: "success" };
      default:
        return null;
    }
  }

  /* ----------------------------------------------------------- field manager */
  if (role === "field_manager") {
    switch (s) {
      case "SCHEDULED":
      case "ASSIGNED":
        return { kind: "transition", target: "ARRIVED", label: "I'm Here", hint: "Navigate to the property, then tap I'm Here.", tone: "primary" };
      case "ARRIVED":
        return job.customerConfirmedAt
          ? { kind: "transition", target: "IN_PROGRESS", label: "Start Service", hint: "Customer verified ✓", tone: "primary" }
          : WAIT("Waiting for Customer Confirmation", "Arrival verified ✓ The customer has the link to confirm.");
      case "CUSTOMER_VERIFIED":
        return { kind: "transition", target: "IN_PROGRESS", label: "Start Service", hint: "Customer verified ✓", tone: "primary" };
      case "IN_PROGRESS":
        if (!checklistComplete) return { kind: "checklist", label: "Continue Checklist", hint: "Service in progress.", tone: "primary" };
        if (!photosComplete) return { kind: "photos", label: "Add Photos", hint: "Checklist done. Before / after photos next.", tone: "primary" };
        return { kind: "transition", target: "WORK_COMPLETED", label: "Complete Work", hint: "Checklist and photos done.", tone: "success" };
      case "WORK_COMPLETED":
      case "QUALITY_CHECK":
        return WAIT("Waiting for QC", "Work completed ✓");
      case "REWORK_REQUIRED":
      case "REWORK_ASSIGNED":
      case "REWORK_IN_PROGRESS":
        return (job.openRework ?? 0) > 0
          ? { kind: "rework", label: "Fix Rework", hint: "QC found something to fix.", tone: "warning" }
          : WAIT("Waiting for QC", "Rework submitted ✓");
      case "REWORK_COMPLETED":
      case "REINSPECTION":
        return WAIT("Waiting for QC", "Rework submitted ✓");
      case "PASS":
      case "CUSTOMER_APPROVAL":
        return WAIT("Waiting for Customer Approval", "QC passed ✓");
      case "COMPLETED":
      case "FEEDBACK_REQUESTED":
      case "CLOSED":
        return { kind: "view", label: "View Report", hint: "Completed.", tone: "success" };
      default:
        return null;
    }
  }

  /* ---------------------------------------------------------------- QC role */
  if (role === "qc_inspector") {
    switch (s) {
      case "WORK_COMPLETED":
        return { kind: "inspect", label: "Inspect", hint: "Ready for quality inspection.", tone: "primary" };
      case "QUALITY_CHECK":
        return { kind: "inspect", label: "Inspect", hint: "Inspection in progress.", tone: "primary" };
      case "REWORK_COMPLETED":
      case "REINSPECTION":
        return { kind: "inspect", label: "Reinspect", hint: "Rework submitted by the Field Manager.", tone: "primary" };
      case "REWORK_REQUIRED":
      case "REWORK_ASSIGNED":
      case "REWORK_IN_PROGRESS":
        return WAIT("Rework in Progress", "The Field Manager is fixing the reported issues.");
      case "PASS":
      case "CUSTOMER_APPROVAL":
        return WAIT("Passed", "Waiting for customer approval.");
      default:
        return null;
    }
  }

  /* ------------------------------------------------------------------ admin */
  switch (s) {
    case "DRAFT":
      return { kind: "schedule", label: "Schedule Job", hint: "New booking.", tone: "primary" };
    case "SCHEDULED":
      return { kind: "assign", label: "Assign Field Manager", hint: unassigned ? "No Field Manager yet." : "Confirm the Field Manager.", tone: "primary" };
    case "ASSIGNED":
      return WAIT("Waiting for Arrival", "Field Manager assigned.");
    case "ARRIVED":
      return job.customerConfirmedAt
        ? WAIT("Customer Verified", "Service about to start.")
        : { kind: "handover", label: "Share Customer Link", hint: "Team arrived. Waiting for customer confirmation.", tone: "warning" };
    case "CUSTOMER_VERIFIED":
    case "IN_PROGRESS":
      return WAIT("Service in Progress", "The Field Manager is working.");
    case "WORK_COMPLETED":
    case "QUALITY_CHECK":
      return WAIT("QC Pending", "Work completed. Waiting for the quality check.");
    case "REWORK_REQUIRED":
    case "REWORK_ASSIGNED":
    case "REWORK_IN_PROGRESS":
      return WAIT("Rework in Progress", "The Field Manager is fixing what QC found.");
    case "REWORK_COMPLETED":
    case "REINSPECTION":
      return WAIT("Reinspection Pending", "Rework submitted. Waiting for QC.");
    case "PASS":
      return { kind: "transition", target: "CUSTOMER_APPROVAL", label: "Send for Approval", hint: "QC passed.", tone: "primary" };
    case "CUSTOMER_APPROVAL":
      return { kind: "handover", label: "Share Customer Link", hint: "QC passed. Waiting for customer approval.", tone: "neutral" };
    case "COMPLETED":
    case "FEEDBACK_REQUESTED":
      return job.feedbackAt
        ? { kind: "transition", target: job.status === "COMPLETED" ? "FEEDBACK_REQUESTED" : "CLOSED", label: "Close Job", hint: "Customer approved and rated the service.", tone: "success" }
        : WAIT("Completed", "Customer approved. Feedback requested on their link.");
    case "CLOSED":
    case "CANCELLED":
      return { kind: "view", label: "View Report", hint: s === "CLOSED" ? "Closed." : "Cancelled.", tone: "neutral" };
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Customer-facing vocabulary (§22) — never show internal statuses.           */
/* -------------------------------------------------------------------------- */

export function customerStageLabel(status: JobStatus | string): string {
  switch (status) {
    case "DRAFT":
    case "SCHEDULED":
      return "Booked";
    case "ASSIGNED":
      return "Team Scheduled";
    case "ARRIVED":
      return "Team Arrived";
    case "CUSTOMER_VERIFIED":
      return "Starting Service";
    case "IN_PROGRESS":
      return "Service In Progress";
    case "WORK_COMPLETED":
    case "QUALITY_CHECK":
    case "REWORK_REQUIRED":
    case "REWORK_ASSIGNED":
    case "REWORK_IN_PROGRESS":
    case "REWORK_COMPLETED":
    case "REINSPECTION":
      return "Quality Check";
    case "PASS":
    case "CUSTOMER_APPROVAL":
      return "Ready for Approval";
    case "COMPLETED":
    case "FEEDBACK_REQUESTED":
    case "CLOSED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Your Service";
  }
}

/** The five customer journey steps and which is current for a status. */
export const CUSTOMER_JOURNEY = ["Booked", "Team Arrived", "Service", "Quality Checked", "Approved"] as const;

export function customerJourneyIndex(status: JobStatus | string, approved: boolean): number {
  if (approved) return 4;
  switch (status) {
    case "DRAFT":
    case "SCHEDULED":
    case "ASSIGNED":
      return 0;
    case "ARRIVED":
    case "CUSTOMER_VERIFIED":
      return 1;
    case "IN_PROGRESS":
    case "WORK_COMPLETED":
    case "QUALITY_CHECK":
    case "REWORK_REQUIRED":
    case "REWORK_ASSIGNED":
    case "REWORK_IN_PROGRESS":
    case "REWORK_COMPLETED":
    case "REINSPECTION":
      return 2;
    case "PASS":
    case "CUSTOMER_APPROVAL":
      return 3;
    default:
      return 4;
  }
}

/** @deprecated kept for older imports — status only, never operations detail. */
export function partnerStageLabel(status: JobStatus | string): string {
  switch (status) {
    case "DRAFT":
    case "SCHEDULED":
    case "ASSIGNED":
      return "Booked";
    case "COMPLETED":
    case "FEEDBACK_REQUESTED":
    case "CLOSED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "In Progress";
  }
}
