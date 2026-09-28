import React from "react";
import { Job, JobStatus } from "@/lib/types";
import { Check, Clock, AlertTriangle, ShieldCheck, ThumbsUp } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";

interface JobTimelineProps {
  job: Job;
  className?: string;
}

const ORDERED_STEPS: { status: JobStatus; label: string; shortLabel: string }[] = [
  { status: "DRAFT", label: "Draft Booking", shortLabel: "Draft" },
  { status: "SCHEDULED", label: "Confirmed Schedule", shortLabel: "Scheduled" },
  { status: "ASSIGNED", label: "Workers Dispatched", shortLabel: "Assigned" },
  { status: "ARRIVED", label: "Field Worker Arrived", shortLabel: "Arrived" },
  { status: "CUSTOMER_VERIFIED", label: "Customer OTP Verified", shortLabel: "OTP" },
  { status: "IN_PROGRESS", label: "Cleaning In Progress", shortLabel: "In Progress" },
  { status: "WORK_COMPLETED", label: "Work Completed", shortLabel: "Executed" },
  { status: "QUALITY_CHECK", label: "QC Inspection", shortLabel: "QC Audit" },
  { status: "CUSTOMER_APPROVAL", label: "Customer Sign-Off", shortLabel: "Approval" },
  { status: "COMPLETED", label: "Job Completed", shortLabel: "Completed" },
  { status: "FEEDBACK_REQUESTED", label: "Feedback & Review", shortLabel: "Review" },
];

export function JobTimeline({ job, className }: JobTimelineProps) {
  const isRework = job.status === "REWORK_REQUIRED" || job.status === "REWORK_COMPLETED" || job.status === "REINSPECTION";
  const isCancelled = job.status === "CANCELLED";

  // Map every JobStatus onto a position in the visual stepper. States that have
  // no dedicated step (rework loop, QC pass, closed) resolve to the equivalent
  // stage they logically occupy so the stepper never shows an empty index.
  const STATUS_STEP_MAP: Partial<Record<JobStatus, JobStatus>> = {
    PASS: "QUALITY_CHECK",
    REWORK_REQUIRED: "QUALITY_CHECK",
    REWORK_COMPLETED: "QUALITY_CHECK",
    REINSPECTION: "QUALITY_CHECK",
    CLOSED: "FEEDBACK_REQUESTED",
  };

  const getStepIndex = (status: JobStatus) => {
    const mapped = STATUS_STEP_MAP[status] || status;
    return ORDERED_STEPS.findIndex((s) => s.status === mapped);
  };

  const currentIndex = getStepIndex(job.status);

  return (
    <div className={cn("bg-white border border-slate-200/90 rounded-lg p-5 shadow-xs", className)}>
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            End-to-End Service Progression
          </h4>
          <p className="text-xs text-slate-400 mt-0.5">
            Strict State-Machine Service Record Audit Trail
          </p>
        </div>
        {isRework && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
            <AlertTriangle className="h-3.5 w-3.5" />
            Rework Phase Active
          </span>
        )}
        {isCancelled && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
            Cancelled
          </span>
        )}
      </div>

      {/* Responsive Horizontal Stepper */}
      <div className="relative overflow-x-auto pb-2">
        <div className="min-w-[760px] flex items-center justify-between relative">
          {/* Background Connecting Line */}
          <div className="absolute left-6 right-6 top-3.5 h-[2px] bg-slate-100 -z-0" />

          {ORDERED_STEPS.map((step, idx) => {
            const isCompleted = currentIndex > idx || (idx === currentIndex && job.status === "FEEDBACK_REQUESTED");
            const isCurrent = currentIndex === idx;
            const isPending = currentIndex < idx;

            return (
              <div
                key={step.status}
                className="flex flex-col items-center relative z-10 text-center px-1"
                style={{ width: `${100 / ORDERED_STEPS.length}%` }}
              >
                {/* Step Circle */}
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-all",
                    isCompleted && "bg-slate-900 text-white shadow-xs",
                    isCurrent && !isRework && "bg-blue-600 text-white ring-4 ring-blue-100 shadow-sm",
                    isCurrent && isRework && "bg-rose-600 text-white ring-4 ring-rose-100 shadow-sm",
                    isPending && "bg-white border-2 border-slate-200 text-slate-400"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                  ) : isCurrent && isRework ? (
                    <AlertTriangle className="h-3.5 w-3.5 stroke-[2.5]" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>

                {/* Step Label */}
                <span
                  className={cn(
                    "mt-2 text-[11px] font-medium leading-tight max-w-[70px]",
                    isCurrent && "text-slate-900 font-bold",
                    isCompleted && "text-slate-700",
                    isPending && "text-slate-400"
                  )}
                >
                  {step.shortLabel}
                </span>

                {/* Timestamps if available */}
                {step.status === "ARRIVED" && job.arrivedAt && (
                  <span className="text-[9px] text-slate-400 mt-0.5">
                    {new Date(job.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {step.status === "CUSTOMER_VERIFIED" && job.otpVerification?.verifiedAt && (
                  <span className="text-[9px] text-emerald-600 font-medium mt-0.5">
                    Verified
                  </span>
                )}
                {step.status === "IN_PROGRESS" && job.startedAt && (
                  <span className="text-[9px] text-slate-400 mt-0.5">
                    {new Date(job.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {step.status === "WORK_COMPLETED" && job.completedAt && (
                  <span className="text-[9px] text-slate-400 mt-0.5">
                    {new Date(job.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
