import { Job, JobStatus, UserRole } from "./types";
import { statusView } from "./status";
import { TRANSITION_PERMISSION } from "./rbac/next-action";
import type { Permission } from "./rbac/permissions";
import { scopeOf } from "./rbac/engine";

export interface StatusConfig {
  label: string;
  shortDescription: string;
  color: {
    bg: string;
    text: string;
    border: string;
    dot: string;
    badgeVariant: "default" | "secondary" | "destructive" | "outline";
  };
}

export const JOB_STATUS_CONFIG: Record<JobStatus, StatusConfig> = {
  DRAFT: {
    label: "Booked",
    shortDescription: "Booked — date not confirmed yet",
    color: {
      bg: "bg-slate-100",
      text: "text-slate-700",
      border: "border-slate-300",
      dot: "bg-slate-400",
      badgeVariant: "outline",
    },
  },
  SCHEDULED: {
    label: "Scheduled",
    shortDescription: "Date confirmed — needs a Field Manager",
    color: {
      bg: "bg-blue-50",
      text: "text-blue-700",
      border: "border-blue-200",
      dot: "bg-blue-500",
      badgeVariant: "secondary",
    },
  },
  ASSIGNED: {
    label: "Assigned",
    shortDescription: "Field Manager assigned",
    color: {
      bg: "bg-indigo-50",
      text: "text-indigo-700",
      border: "border-indigo-200",
      dot: "bg-indigo-500",
      badgeVariant: "secondary",
    },
  },
  ARRIVED: {
    label: "Arrived",
    shortDescription: "Team on site — waiting for customer confirmation",
    color: {
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-300",
      dot: "bg-amber-500",
      badgeVariant: "secondary",
    },
  },
  CUSTOMER_VERIFIED: {
    label: "Customer Confirmed",
    shortDescription: "Customer confirmed — ready to start",
    color: {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      border: "border-emerald-300",
      dot: "bg-emerald-500",
      badgeVariant: "secondary",
    },
  },
  IN_PROGRESS: {
    label: "In Progress",
    shortDescription: "Work in progress",
    color: {
      bg: "bg-sky-50",
      text: "text-sky-800",
      border: "border-sky-300",
      dot: "bg-sky-500",
      badgeVariant: "secondary",
    },
  },
  WORK_COMPLETED: {
    label: "Work Completed",
    shortDescription: "Work done — waiting for QC",
    color: {
      bg: "bg-purple-50",
      text: "text-purple-700",
      border: "border-purple-200",
      dot: "bg-purple-500",
      badgeVariant: "secondary",
    },
  },
  QUALITY_CHECK: {
    label: "Quality Check",
    shortDescription: "QC is inspecting",
    color: {
      bg: "bg-violet-50",
      text: "text-violet-800",
      border: "border-violet-300",
      dot: "bg-violet-500",
      badgeVariant: "secondary",
    },
  },
  PASS: {
    label: "QC Passed",
    shortDescription: "QC passed — waiting for customer approval",
    color: {
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-300",
      dot: "bg-emerald-500",
      badgeVariant: "secondary",
    },
  },
  REWORK_REQUIRED: {
    label: "Rework",
    shortDescription: "QC found issues — Field Manager fixing",
    color: {
      bg: "bg-rose-50",
      text: "text-rose-700",
      border: "border-rose-300",
      dot: "bg-rose-500",
      badgeVariant: "destructive",
    },
  },
  REWORK_ASSIGNED: {
    label: "Rework",
    shortDescription: "QC found issues — Field Manager fixing",
    color: {
      bg: "bg-orange-50",
      text: "text-orange-700",
      border: "border-orange-300",
      dot: "bg-orange-500",
      badgeVariant: "destructive",
    },
  },
  REWORK_IN_PROGRESS: {
    label: "Rework",
    shortDescription: "Field Manager fixing",
    color: {
      bg: "bg-orange-50",
      text: "text-orange-800",
      border: "border-orange-300",
      dot: "bg-orange-500",
      badgeVariant: "destructive",
    },
  },
  REWORK_COMPLETED: {
    label: "Reinspection",
    shortDescription: "Rework submitted — waiting for QC",
    color: {
      bg: "bg-amber-50",
      text: "text-amber-700",
      border: "border-amber-300",
      dot: "bg-amber-500",
      badgeVariant: "secondary",
    },
  },
  REINSPECTION: {
    label: "Reinspection",
    shortDescription: "QC is reinspecting",
    color: {
      bg: "bg-indigo-50",
      text: "text-indigo-800",
      border: "border-indigo-300",
      dot: "bg-indigo-500",
      badgeVariant: "secondary",
    },
  },
  CUSTOMER_APPROVAL: {
    label: "Customer Approval",
    shortDescription: "QC passed — waiting for customer approval",
    color: {
      bg: "bg-teal-50",
      text: "text-teal-800",
      border: "border-teal-300",
      dot: "bg-teal-500",
      badgeVariant: "secondary",
    },
  },
  COMPLETED: {
    label: "Completed",
    shortDescription: "Customer approved the service",
    color: {
      bg: "bg-emerald-100",
      text: "text-emerald-900",
      border: "border-emerald-400",
      dot: "bg-emerald-600",
      badgeVariant: "default",
    },
  },
  FEEDBACK_REQUESTED: {
    label: "Completed",
    shortDescription: "Customer approved — feedback requested",
    color: {
      bg: "bg-slate-100",
      text: "text-slate-800",
      border: "border-slate-300",
      dot: "bg-slate-500",
      badgeVariant: "outline",
    },
  },
  CLOSED: {
    label: "Closed",
    shortDescription: "Job closed",
    color: {
      bg: "bg-slate-200",
      text: "text-slate-900",
      border: "border-slate-400",
      dot: "bg-slate-600",
      badgeVariant: "default",
    },
  },
  CANCELLED: {
    label: "Cancelled",
    shortDescription: "Job cancelled",
    color: {
      bg: "bg-red-50",
      text: "text-red-700",
      border: "border-red-300",
      dot: "bg-red-500",
      badgeVariant: "destructive",
    },
  },
};

// Labels always come from the one status vocabulary (src/lib/status.ts).
for (const key of Object.keys(JOB_STATUS_CONFIG) as JobStatus[]) {
  JOB_STATUS_CONFIG[key].label = statusView(key).label;
}

export interface TransitionAction {
  status: JobStatus;
  label: string;
  description: string;
  buttonVariant?: "default" | "outline" | "destructive" | "secondary";
  /** Permission required to request this transition (MODULE.ACTION). */
  permission: Permission;
  requirementNotes?: string;
}

export function getAllowedTransitions(job: Job): TransitionAction[] {
  switch (job.status) {
    case "DRAFT":
      return [
        {
          status: "SCHEDULED",
          label: "Schedule Job",
          description: "Confirm job date and initial time slot",
          permission: TRANSITION_PERMISSION.SCHEDULED,
        },
        {
          status: "CANCELLED",
          label: "Cancel Job",
          description: "Void draft booking",
          buttonVariant: "destructive",
          permission: TRANSITION_PERMISSION.CANCELLED,
        },
      ];

    case "SCHEDULED":
      return [
        {
          status: "ASSIGNED",
          label: "Assign Field Staff",
          description: "Assign field workers to job",
          permission: TRANSITION_PERMISSION.ASSIGNED,
        },
        {
          status: "CANCELLED",
          label: "Cancel Job",
          description: "Cancel scheduled appointment",
          buttonVariant: "destructive",
          permission: TRANSITION_PERMISSION.CANCELLED,
        },
      ];

    case "ASSIGNED":
      return [
        {
          status: "ARRIVED",
          label: "Mark Arrived",
          description: "Field worker arrived at property (performed in the Field App)",
          permission: TRANSITION_PERMISSION.ARRIVED,
        },
        {
          status: "CANCELLED",
          label: "Cancel Job",
          description: "Cancel assignment before arrival",
          buttonVariant: "destructive",
          permission: TRANSITION_PERMISSION.CANCELLED,
        },
      ];

    case "ARRIVED":
      return [
        {
          status: "CUSTOMER_VERIFIED",
          label: "Confirm via Customer Link",
          description: "Customer confirms arrival through the secure verification link",
          permission: TRANSITION_PERMISSION.CUSTOMER_VERIFIED,
          requirementNotes: "Customer confirmation via the secure link required",
        },
        {
          status: "CANCELLED",
          label: "Customer No-Show / Cancel",
          description: "Customer unavailable or entry denied",
          buttonVariant: "destructive",
          permission: TRANSITION_PERMISSION.CANCELLED,
        },
      ];

    case "CUSTOMER_VERIFIED":
      return [
        {
          status: "IN_PROGRESS",
          label: "Start Job",
          description: "Commence deep cleaning procedures and begin checklist (Field App)",
          permission: TRANSITION_PERMISSION.IN_PROGRESS,
        },
      ];

    case "IN_PROGRESS":
      return [
        {
          status: "WORK_COMPLETED",
          label: "Mark Work Completed",
          description: "Checklist done, after photos captured, submit for QC (Field App)",
          permission: TRANSITION_PERMISSION.WORK_COMPLETED,
        },
      ];

    case "WORK_COMPLETED":
      return [
        {
          status: "QUALITY_CHECK",
          label: "Start QC Inspection",
          description: "Operations Manager conducts room-by-room quality inspection",
          permission: TRANSITION_PERMISSION.QUALITY_CHECK,
        },
      ];

    case "QUALITY_CHECK":
      return [
        {
          status: "PASS",
          label: "Pass Quality Check",
          description: "Work meets quality standard",
          buttonVariant: "default",
          permission: TRANSITION_PERMISSION.PASS,
        },
        {
          status: "REWORK_REQUIRED",
          label: "Mark Rework Required",
          description: "Flag defects and assign rework tasks to field staff",
          buttonVariant: "destructive",
          permission: TRANSITION_PERMISSION.REWORK_REQUIRED,
        },
        {
          status: "REWORK_ASSIGNED",
          label: "Mark Rework Required & Dispatch",
          description: "Flag defects, notify staff and mint the rework secure link",
          buttonVariant: "destructive",
          permission: TRANSITION_PERMISSION.REWORK_ASSIGNED,
        },
      ];

    case "PASS":
      return [
        {
          status: "CUSTOMER_APPROVAL",
          label: "Send Customer Approval Link",
          description: "Send secure approval link to customer",
          permission: TRANSITION_PERMISSION.CUSTOMER_APPROVAL,
        },
      ];

    case "REWORK_REQUIRED":
      // §19: rework is DISPATCHED (notification + REWORK token mint) by the
      // ops desk; the REWORK_REQUIRED → REWORK_ASSIGNED edge below fires
      // server-side when the rework link is opened / notification sent.
      return [
        {
          status: "REWORK_ASSIGNED",
          label: "Dispatch Rework",
          description: "Send rework task + secure link to the assigned staff",
          permission: TRANSITION_PERMISSION.REWORK_ASSIGNED,
        },
        {
          status: "REWORK_COMPLETED",
          label: "Mark Rework Completed",
          description: "Field worker completed corrective rework tasks (Field App)",
          permission: TRANSITION_PERMISSION.REWORK_COMPLETED,
        },
      ];

    case "REWORK_ASSIGNED":
      return [
        {
          status: "REWORK_IN_PROGRESS",
          label: "Start Rework",
          description: "Staff opened the rework link and began corrective work",
          permission: TRANSITION_PERMISSION.REWORK_IN_PROGRESS,
        },
        {
          status: "REWORK_COMPLETED",
          label: "Mark Rework Completed",
          description: "Field worker completed corrective rework tasks (Field App)",
          permission: TRANSITION_PERMISSION.REWORK_COMPLETED,
        },
      ];

    case "REWORK_IN_PROGRESS":
      return [
        {
          status: "REWORK_COMPLETED",
          label: "Mark Rework Completed",
          description: "Field worker completed corrective rework tasks (Field App)",
          permission: TRANSITION_PERMISSION.REWORK_COMPLETED,
        },
      ];

    case "REWORK_COMPLETED":
      return [
        {
          status: "REINSPECTION",
          label: "Start Reinspection",
          description: "Operations Manager reinspects corrected areas",
          permission: TRANSITION_PERMISSION.REINSPECTION,
        },
      ];

    case "REINSPECTION":
      return [
        {
          status: "PASS",
          label: "Pass Reinspection",
          description: "Corrective work verified and passed",
          buttonVariant: "default",
          permission: TRANSITION_PERMISSION.PASS,
        },
        {
          status: "REWORK_REQUIRED",
          label: "Require Additional Rework",
          description: "Defects remain uncorrected",
          buttonVariant: "destructive",
          permission: TRANSITION_PERMISSION.REWORK_REQUIRED,
        },
      ];

    case "CUSTOMER_APPROVAL":
      return [
        {
          status: "COMPLETED",
          label: "Approve Service",
          description: "Customer digitally approves completion",
          buttonVariant: "default",
          permission: TRANSITION_PERMISSION.COMPLETED,
        },
        {
          status: "REWORK_REQUIRED",
          label: "Customer Raised Issue",
          description: "Customer requested rectification of missed areas",
          buttonVariant: "destructive",
          permission: TRANSITION_PERMISSION.REWORK_REQUIRED,
        },
      ];

    case "COMPLETED":
      return [
        {
          status: "FEEDBACK_REQUESTED",
          label: "Send Feedback & Google Review Link",
          description: "Trigger customer review link & Google Business Review notification",
          permission: TRANSITION_PERMISSION.FEEDBACK_REQUESTED,
        },
      ];

    case "FEEDBACK_REQUESTED":
      return [
        {
          status: "CLOSED",
          label: "Close & Archive Job",
          description: "Job fully closed",
          permission: TRANSITION_PERMISSION.CLOSED,
        },
      ];

    case "CLOSED":
    case "CANCELLED":
      return [];

    default:
      return [];
  }
}

export function validateTransition(
  job: Job,
  nextStatus: JobStatus,
  role: UserRole | string
): { allowed: boolean; reason?: string; permission?: Permission } {
  const allowed = getAllowedTransitions(job);
  const match = allowed.find((t) => t.status === nextStatus);

  if (!match) {
    return {
      allowed: false,
      reason: `Cannot transition job from ${job.status} to ${nextStatus}. Invalid sequence.`,
    };
  }

  if (scopeOf(role, match.permission) === "NONE") {
    return {
      allowed: false,
      permission: match.permission,
      reason: `Your role cannot perform this step (requires ${match.permission}).`,
    };
  }

  if (nextStatus === "IN_PROGRESS" && !job.customerConfirmedAt) {
    return {
      allowed: false,
      permission: match.permission,
      reason: "Customer confirmation via the secure link is required before starting the job.",
    };
  }

  return { allowed: true, permission: match.permission };
}

/** Transitions the role may request from the job's current state (UI + server share this). */
export function allowedTransitionsFor(job: Job, role: UserRole | string): TransitionAction[] {
  return getAllowedTransitions(job).filter((t) => scopeOf(role, t.permission) !== "NONE");
}
