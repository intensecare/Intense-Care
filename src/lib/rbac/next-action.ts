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
import { scopeOf } from "./engine";

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
  | "record-payment" // accounts
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
  const has = (p: Permission) => scopeOf(role, p) !== "NONE";
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

  /* --------------------------------------------------------- referral partner */
  if (role === "referral_partner") {
    return { kind: "view", label: "View Referral", hint: partnerStageLabel(s), tone: "neutral" };
  }

  /* ------------------------------------------------------------- field roles */
  if (role === "field_manager" || role === "field_staff") {
    switch (s) {
      case "SCHEDULED":
      case "ASSIGNED":
        return has("jobs.arrive")
          ? { kind: "transition", target: "ARRIVED", label: "Arrived", hint: "Next: arrive at the property.", tone: "primary" }
          : WAIT("Waiting for Team Leader", "Your team leader marks arrival.");
      case "ARRIVED":
        return job.customerConfirmedAt
          ? has("jobs.start")
            ? { kind: "transition", target: "IN_PROGRESS", label: "Start Service", hint: "Customer verified.", tone: "primary" }
            : WAIT("Waiting to Start", "Your team leader starts the service.")
          : WAIT("Waiting for Customer", "GPS verified. Customer notified to confirm.");
      case "CUSTOMER_VERIFIED":
        return has("jobs.start")
          ? { kind: "transition", target: "IN_PROGRESS", label: "Start Service", hint: "Customer verified.", tone: "primary" }
          : WAIT("Waiting to Start", "Your team leader starts the service.");
      case "IN_PROGRESS":
        if (!checklistComplete) return { kind: "checklist", label: "Continue Checklist", hint: "Service in progress.", tone: "primary" };
        if (!photosComplete) return { kind: "photos", label: "Capture Photos", hint: "Checklist complete. Before / after photos next.", tone: "primary" };
        return has("jobs.complete")
          ? { kind: "transition", target: "WORK_COMPLETED", label: "Complete Work", hint: "Photos complete.", tone: "success" }
          : { kind: "checklist", label: "Submit Task", hint: "Your tasks are done. Team leader completes the work.", tone: "success" };
      case "WORK_COMPLETED":
      case "QUALITY_CHECK":
        return WAIT("Waiting for QC", "Work completed.");
      case "REWORK_REQUIRED":
      case "REWORK_ASSIGNED":
      case "REWORK_IN_PROGRESS":
        return (job.openRework ?? 0) > 0
          ? { kind: "rework", label: "Fix Rework Items", hint: "QC found issues to correct.", tone: "warning" }
          : WAIT("Waiting for Reinspection", "Rework submitted.");
      case "REWORK_COMPLETED":
      case "REINSPECTION":
        return WAIT("Waiting for Reinspection", "Rework completed.");
      case "PASS":
      case "CUSTOMER_APPROVAL":
        return { kind: "view", label: "View Handover", hint: "QC passed. Waiting for customer approval.", tone: "success" };
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
        return { kind: "inspect", label: "Pass / Rework", hint: "Inspection in progress.", tone: "primary" };
      case "REWORK_COMPLETED":
      case "REINSPECTION":
        return { kind: "inspect", label: "Reinspect", hint: "Rework completed by the team.", tone: "primary" };
      case "REWORK_REQUIRED":
      case "REWORK_ASSIGNED":
      case "REWORK_IN_PROGRESS":
        return WAIT("Waiting for Rework", "Team is fixing the reported issues.");
      case "PASS":
      case "CUSTOMER_APPROVAL":
        return WAIT("Passed", "Waiting for customer approval.");
      default:
        return null;
    }
  }

  /* ----------------------------------------------------------- accounts role */
  if (role === "accounts") {
    if (["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED", "CUSTOMER_APPROVAL", "PASS"].includes(s)) {
      if ((job.balanceDue ?? 0) > 0) {
        return job.invoiceFinalized
          ? { kind: "record-payment", label: "Record Payment", hint: "Payment pending.", tone: "primary" }
          : { kind: "record-payment", label: "Finalize Invoice", target: "finalize", hint: "Billable job. Finalize and send the invoice.", tone: "primary" };
      }
      return { kind: "view", label: "View Invoice", hint: "Paid.", tone: "success" };
    }
    if (s === "CANCELLED") return { kind: "view", label: "View Invoice", hint: "Cancelled booking.", tone: "neutral" };
    return WAIT("Not Billable Yet", "Invoice opens after the service completes.");
  }

  /* ------------------------------------------- desk roles (admin/ops/scheduler) */
  switch (s) {
    case "DRAFT":
      return has("jobs.reschedule")
        ? { kind: "schedule", label: "Schedule Job", hint: "New booking.", tone: "primary" }
        : null;
    case "SCHEDULED":
      return has("jobs.assign")
        ? { kind: "assign", label: "Assign Team", hint: unassigned ? "No team assigned yet." : "Confirm the crew.", tone: "primary" }
        : WAIT("Scheduled", "Waiting for team assignment.");
    case "ASSIGNED":
      return WAIT("Monitor Arrival", "Team assigned. Waiting for arrival.");
    case "ARRIVED":
      return job.customerConfirmedAt
        ? WAIT("Customer Verified", "Service about to start.")
        : has("links.manage")
        ? { kind: "handover", label: "Share Customer Link", hint: "Waiting for customer confirmation.", tone: "warning" }
        : WAIT("Waiting for Customer", "Customer confirmation pending.");
    case "CUSTOMER_VERIFIED":
    case "IN_PROGRESS":
      return WAIT("Monitor Job", "Service in progress.");
    case "WORK_COMPLETED":
      return has("qc.inspect")
        ? { kind: "inspect", label: "Inspect", hint: "Ready for QC.", tone: "primary" }
        : WAIT("QC Pending", "Waiting for the quality inspector.");
    case "QUALITY_CHECK":
      return has("qc.pass")
        ? { kind: "inspect", label: "Pass / Rework", hint: "Inspection in progress.", tone: "primary" }
        : WAIT("QC In Progress", "Inspector is reviewing.");
    case "REWORK_REQUIRED":
      return has("rework.create")
        ? { kind: "rework", label: "Dispatch Rework", hint: "QC found issues.", tone: "warning" }
        : WAIT("Rework Required", "Waiting for dispatch.");
    case "REWORK_ASSIGNED":
    case "REWORK_IN_PROGRESS":
      return WAIT("Monitor Rework", "Team is fixing the issues.");
    case "REWORK_COMPLETED":
    case "REINSPECTION":
      return has("qc.reinspect")
        ? { kind: "inspect", label: "Reinspect", hint: "Rework completed.", tone: "primary" }
        : WAIT("Reinspection Pending", "Waiting for the quality inspector.");
    case "PASS":
      return has("customer_approval.request")
        ? { kind: "transition", target: "CUSTOMER_APPROVAL", label: "Send for Approval", hint: "QC passed.", tone: "primary" }
        : WAIT("QC Passed", "Waiting for handover.");
    case "CUSTOMER_APPROVAL":
      return has("links.manage")
        ? { kind: "handover", label: "Open Handover", hint: "Waiting for customer approval.", tone: "neutral" }
        : WAIT("Approval Pending", "Waiting for customer.");
    case "COMPLETED":
      return has("feedback.manage")
        ? { kind: "transition", target: "FEEDBACK_REQUESTED", label: "Request Feedback", hint: "Customer approved.", tone: "success" }
        : WAIT("Completed", "Customer approved.");
    case "FEEDBACK_REQUESTED":
      return has("jobs.close")
        ? { kind: "transition", target: "CLOSED", label: "Close Job", hint: "Feedback requested.", tone: "success" }
        : WAIT("Feedback Requested", "Waiting for close.");
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

/** Referral partner summary wording — status only, never operations detail. */
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
