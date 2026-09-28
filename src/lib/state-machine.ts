import { Job, JobStatus, UserRole } from "./types";

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
    label: "Draft",
    shortDescription: "Job created but not yet scheduled",
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
    shortDescription: "Date confirmed, pending staff assignment",
    color: {
      bg: "bg-blue-50",
      text: "text-blue-700",
      border: "border-blue-200",
      dot: "bg-blue-500",
      badgeVariant: "secondary",
    },
  },
  ASSIGNED: {
    label: "Staff Assigned",
    shortDescription: "Field staff assigned and scheduled",
    color: {
      bg: "bg-indigo-50",
      text: "text-indigo-700",
      border: "border-indigo-200",
      dot: "bg-indigo-500",
      badgeVariant: "secondary",
    },
  },
  ARRIVED: {
    label: "Staff Arrived",
    shortDescription: "Field worker on site, awaiting Customer OTP",
    color: {
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-300",
      dot: "bg-amber-500",
      badgeVariant: "secondary",
    },
  },
  CUSTOMER_VERIFIED: {
    label: "Customer Verified",
    shortDescription: "Customer OTP verified, ready to start",
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
    shortDescription: "Deep cleaning active, checklist & photos in progress",
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
    shortDescription: "Staff finished, ready for Operations Manager QC",
    color: {
      bg: "bg-purple-50",
      text: "text-purple-700",
      border: "border-purple-200",
      dot: "bg-purple-500",
      badgeVariant: "secondary",
    },
  },
  QUALITY_CHECK: {
    label: "Quality Inspection",
    shortDescription: "Operations Manager conducting QC audit",
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
    shortDescription: "Quality check passed, ready for customer sign-off",
    color: {
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-300",
      dot: "bg-emerald-500",
      badgeVariant: "secondary",
    },
  },
  REWORK_REQUIRED: {
    label: "Rework Required",
    shortDescription: "Defects found during QC, assigned to field staff",
    color: {
      bg: "bg-rose-50",
      text: "text-rose-700",
      border: "border-rose-300",
      dot: "bg-rose-500",
      badgeVariant: "destructive",
    },
  },
  REWORK_COMPLETED: {
    label: "Rework Completed",
    shortDescription: "Staff finished rework tasks, ready for reinspection",
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
    shortDescription: "Operations Manager reinspecting corrective work",
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
    shortDescription: "QC passed, awaiting customer review and digital sign-off",
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
    shortDescription: "Service accepted & approved by customer",
    color: {
      bg: "bg-emerald-100",
      text: "text-emerald-900",
      border: "border-emerald-400",
      dot: "bg-emerald-600",
      badgeVariant: "default",
    },
  },
  FEEDBACK_REQUESTED: {
    label: "Feedback Requested",
    shortDescription: "Secure feedback & Google Review link sent to customer",
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
    shortDescription: "Job closed & archived",
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
    shortDescription: "Job cancelled or booking voided",
    color: {
      bg: "bg-red-50",
      text: "text-red-700",
      border: "border-red-300",
      dot: "bg-red-500",
      badgeVariant: "destructive",
    },
  },
};

export interface TransitionAction {
  status: JobStatus;
  label: string;
  description: string;
  buttonVariant?: "default" | "outline" | "destructive" | "secondary";
  allowedRoles: UserRole[];
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
          allowedRoles: ["super_admin", "ops_manager"],
        },
        {
          status: "CANCELLED",
          label: "Cancel Job",
          description: "Void draft booking",
          buttonVariant: "destructive",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "SCHEDULED":
      return [
        {
          status: "ASSIGNED",
          label: "Assign Field Staff",
          description: "Assign field workers to job",
          allowedRoles: ["super_admin", "ops_manager"],
        },
        {
          status: "CANCELLED",
          label: "Cancel Job",
          description: "Cancel scheduled appointment",
          buttonVariant: "destructive",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "ASSIGNED":
      return [
        {
          status: "ARRIVED",
          label: "Mark Arrived",
          description: "Field worker arrived at property",
          allowedRoles: ["super_admin", "ops_manager", "staff"],
        },
        {
          status: "CANCELLED",
          label: "Cancel Job",
          description: "Cancel assignment before arrival",
          buttonVariant: "destructive",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "ARRIVED":
      return [
        {
          status: "CUSTOMER_VERIFIED",
          label: "Verify Customer OTP",
          description: "Customer provides 4-digit OTP to authorize property entry",
          allowedRoles: ["super_admin", "ops_manager", "staff"],
          requirementNotes: "Customer OTP verification required",
        },
        {
          status: "CANCELLED",
          label: "Customer No-Show / Cancel",
          description: "Customer unavailable or entry denied",
          buttonVariant: "destructive",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "CUSTOMER_VERIFIED":
      return [
        {
          status: "IN_PROGRESS",
          label: "Start Job",
          description: "Commence deep cleaning procedures and begin checklist",
          allowedRoles: ["super_admin", "ops_manager", "staff"],
        },
      ];

    case "IN_PROGRESS":
      return [
        {
          status: "WORK_COMPLETED",
          label: "Mark Work Completed",
          description: "Checklist done, after photos captured, submit for QC",
          allowedRoles: ["super_admin", "ops_manager", "staff"],
        },
      ];

    case "WORK_COMPLETED":
      return [
        {
          status: "QUALITY_CHECK",
          label: "Start QC Inspection",
          description: "Operations Manager conducts room-by-room quality inspection",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "QUALITY_CHECK":
      return [
        {
          status: "PASS",
          label: "Pass Quality Check",
          description: "Work meets quality standard",
          buttonVariant: "default",
          allowedRoles: ["super_admin", "ops_manager"],
        },
        {
          status: "REWORK_REQUIRED",
          label: "Mark Rework Required",
          description: "Flag defects and assign rework tasks to field staff",
          buttonVariant: "destructive",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "PASS":
      return [
        {
          status: "CUSTOMER_APPROVAL",
          label: "Send Customer Approval Link",
          description: "Send secure approval link to customer",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "REWORK_REQUIRED":
      return [
        {
          status: "REWORK_COMPLETED",
          label: "Mark Rework Completed",
          description: "Staff completed corrective rework tasks",
          allowedRoles: ["super_admin", "ops_manager", "staff"],
        },
      ];

    case "REWORK_COMPLETED":
      return [
        {
          status: "REINSPECTION",
          label: "Start Reinspection",
          description: "Operations Manager reinspects corrected areas",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "REINSPECTION":
      return [
        {
          status: "PASS",
          label: "Pass Reinspection",
          description: "Corrective work verified and passed",
          buttonVariant: "default",
          allowedRoles: ["super_admin", "ops_manager"],
        },
        {
          status: "REWORK_REQUIRED",
          label: "Require Additional Rework",
          description: "Defects remain uncorrected",
          buttonVariant: "destructive",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "CUSTOMER_APPROVAL":
      return [
        {
          status: "COMPLETED",
          label: "Approve Service",
          description: "Customer digitally approves completion",
          buttonVariant: "default",
          allowedRoles: ["super_admin", "ops_manager"],
        },
        {
          status: "REWORK_REQUIRED",
          label: "Customer Raised Issue",
          description: "Customer requested rectification of missed areas",
          buttonVariant: "destructive",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "COMPLETED":
      return [
        {
          status: "FEEDBACK_REQUESTED",
          label: "Send Feedback & Google Review Link",
          description: "Trigger customer review link & Google Business Review notification",
          allowedRoles: ["super_admin", "ops_manager"],
        },
      ];

    case "FEEDBACK_REQUESTED":
      return [
        {
          status: "CLOSED",
          label: "Close & Archive Job",
          description: "Job fully closed",
          allowedRoles: ["super_admin", "ops_manager"],
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
  role: UserRole
): { allowed: boolean; reason?: string } {
  const allowed = getAllowedTransitions(job);
  const match = allowed.find((t) => t.status === nextStatus);

  if (!match) {
    return {
      allowed: false,
      reason: `Cannot transition job from ${job.status} to ${nextStatus}. Invalid sequence.`,
    };
  }

  if (role !== "super_admin" && !match.allowedRoles.includes(role)) {
    return {
      allowed: false,
      reason: `Role '${role}' is not authorized to transition job to ${nextStatus}. Authorized: ${match.allowedRoles.join(
        ", "
      )}`,
    };
  }

  if (nextStatus === "IN_PROGRESS" && job.otpVerification.status !== "verified") {
    return {
      allowed: false,
      reason: "Customer OTP must be verified before starting job.",
    };
  }

  return { allowed: true };
}
