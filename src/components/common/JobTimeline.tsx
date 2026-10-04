import React from "react";
import { Job, JobStatus } from "@/lib/types";
import {
  Check,
  AlertTriangle,
  FileText,
  CalendarCheck,
  UserPlus,
  MapPin,
  KeyRound,
  Sparkles,
  ClipboardCheck,
  ShieldCheck,
  PenLine,
  CheckCircle2,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface JobTimelineProps {
  job: Job;
  className?: string;
}

/* --------------------------------------------------------------------------
 * §3 Service Journey — the old rigid stepper is replaced by a smooth curved
 * journey: rounded nodes with large icons sit on an SVG wave connector.
 * Completed = filled check · Current = larger highlighted coral node ·
 * Upcoming = muted. Stacks into a vertical rail on mobile.
 * ------------------------------------------------------------------------ */

const ORDERED_STEPS: {
  status: JobStatus;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { status: "DRAFT", label: "Booking Created", shortLabel: "Booking", icon: FileText },
  { status: "SCHEDULED", label: "Confirmed Schedule", shortLabel: "Scheduled", icon: CalendarCheck },
  { status: "ASSIGNED", label: "Team Dispatched", shortLabel: "Assigned", icon: UserPlus },
  { status: "ARRIVED", label: "Arrived On Site", shortLabel: "Arrived", icon: MapPin },
  { status: "CUSTOMER_VERIFIED", label: "Customer OTP Verified", shortLabel: "OTP Verified", icon: KeyRound },
  { status: "IN_PROGRESS", label: "Cleaning In Progress", shortLabel: "Cleaning", icon: Sparkles },
  { status: "WORK_COMPLETED", label: "Work Completed", shortLabel: "Work Done", icon: ClipboardCheck },
  { status: "QUALITY_CHECK", label: "Quality Inspection", shortLabel: "Quality Check", icon: ShieldCheck },
  { status: "CUSTOMER_APPROVAL", label: "Customer Handover", shortLabel: "Handover", icon: PenLine },
  { status: "COMPLETED", label: "Job Completed", shortLabel: "Completed", icon: CheckCircle2 },
  { status: "FEEDBACK_REQUESTED", label: "Feedback & Review", shortLabel: "Review", icon: Star },
];

// States that have no dedicated step (rework loop, QC pass, closed) resolve
// onto the stage they logically occupy so the journey never shows an empty node.
const STATUS_STEP_MAP: Partial<Record<JobStatus, JobStatus>> = {
  PASS: "QUALITY_CHECK",
  REWORK_REQUIRED: "QUALITY_CHECK",
  REWORK_COMPLETED: "QUALITY_CHECK",
  REINSPECTION: "QUALITY_CHECK",
  CLOSED: "FEEDBACK_REQUESTED",
};

function buildWavePath(count: number): string {
  /* Smooth alternating wave through each node centre — viewBox is
   * 0 0 1000 140 with preserveAspectRatio="none", node centres at
   * x = (i + 0.5) * 1000/count, y alternating 52 / 88. */
  const pts = Array.from({ length: count }, (_, i) => ({
    x: ((i + 0.5) * 1000) / count,
    y: i % 2 === 0 ? 52 : 88,
  }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const midX = (prev.x + cur.x) / 2;
    d += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  return d;
}

export function JobTimeline({ job, className }: JobTimelineProps) {
  const isRework = job.status === "REWORK_REQUIRED" || job.status === "REWORK_COMPLETED" || job.status === "REINSPECTION";
  const isCancelled = job.status === "CANCELLED";

  const currentIndex = ORDERED_STEPS.findIndex((s) => s.status === STATUS_STEP_MAP[job.status] || s.status === job.status);
  const wavePath = React.useMemo(() => buildWavePath(ORDERED_STEPS.length), []);
  const reachedFeedback = job.status === "FEEDBACK_REQUESTED" || job.status === "CLOSED";

  const timeFor = (status: JobStatus): string | null => {
    switch (status) {
      case "ARRIVED":
        return job.arrivedAt ? new Date(job.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
      case "CUSTOMER_VERIFIED":
        return job.otpVerification?.verifiedAt ? new Date(job.otpVerification.verifiedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
      case "IN_PROGRESS":
        return job.startedAt ? new Date(job.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
      case "WORK_COMPLETED":
        return job.completedAt ? new Date(job.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
      default:
        return null;
    }
  };

  const nodeState = (idx: number): "completed" | "current" | "upcoming" => {
    if (idx < currentIndex || (idx === currentIndex && reachedFeedback)) return "completed";
    if (idx === currentIndex) return "current";
    return "upcoming";
  };

  return (
    <div className={cn("bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xs", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-5 border-b border-slate-100">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Service Journey</h4>
          <p className="text-xs text-slate-400 mt-0.5">
            {isCancelled
              ? "This booking was cancelled — no further stages will run."
              : isRework
              ? "Rework phase active — the job loops through Quality Check until it passes."
              : "Every stage of today's service, from booking to feedback."}
          </p>
        </div>
        {isRework && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
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

      {/* ---------------- Desktop: curved horizontal journey ---------------- */}
      <div className="hidden md:block overflow-x-auto pb-1">
        <div className="relative min-w-[860px]" style={{ height: 190 }}>
          {/* Curved connector */}
          <svg
            className="absolute inset-0 w-full h-[140px]"
            viewBox="0 0 1000 140"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path d={wavePath} fill="none" stroke="#efe9df" strokeWidth={10} strokeLinecap="round" />
            <path
              d={(() => {
                // overlay the travelled portion of the same wave in coral
                const pts = Array.from({ length: Math.max(currentIndex + 1, 2) }, (_, i) => ({
                  x: ((i + 0.5) * 1000) / ORDERED_STEPS.length,
                  y: i % 2 === 0 ? 52 : 88,
                }));
                if (pts.length < 2) return "";
                let d = `M ${pts[0].x} ${pts[0].y}`;
                for (let i = 1; i < pts.length; i++) {
                  const prev = pts[i - 1];
                  const cur = pts[i];
                  const midX = (prev.x + cur.x) / 2;
                  d += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`;
                }
                return d;
              })()}
              fill="none"
              stroke="#fbc7cf"
              strokeWidth={10}
              strokeLinecap="round"
              className="transition-all duration-300"
            />
          </svg>

          {/* Nodes */}
          {ORDERED_STEPS.map((step, idx) => {
            const state = nodeState(idx);
            const Icon = step.icon;
            const left = `${((idx + 0.5) * 100) / ORDERED_STEPS.length}%`;
            const top = idx % 2 === 0 ? 0 : 36; // aligns node to the wave crest/trough
            const time = timeFor(step.status);

            return (
              <div
                key={step.status}
                className="absolute flex flex-col items-center text-center"
                style={{ left, top: top + 4, transform: "translateX(-50%)", width: 96 }}
              >
                <div className="relative">
                  {state === "current" && (
                    <span className="absolute inset-0 rounded-2xl ring-4 ring-rose-200/70 motion-safe:animate-pulse" />
                  )}
                  <div
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200",
                      state === "completed" && "bg-emerald-50 text-emerald-600 border border-emerald-200",
                      state === "current" && !isRework && "bg-rose-500 text-white shadow-md shadow-rose-200 scale-110",
                      state === "current" && isRework && "bg-red-600 text-white shadow-md shadow-red-200 scale-110",
                      state === "upcoming" && "bg-slate-100 text-slate-400 border border-slate-200"
                    )}
                  >
                    {state === "completed" ? (
                      <Check className="h-5 w-5 stroke-[3]" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                </div>
                <span
                  className={cn(
                    "mt-2 text-[11px] leading-tight font-medium",
                    state === "current" ? "text-slate-900 font-semibold" : state === "completed" ? "text-slate-600" : "text-slate-400"
                  )}
                >
                  {step.shortLabel}
                </span>
                {time && (
                  <span className={cn("text-[10px] mt-0.5", state === "current" ? "text-rose-600 font-medium" : "text-slate-400")}>
                    {time}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------- Mobile: vertical rail journey ---------------- */}
      <ol className="md:hidden relative space-y-0">
        {ORDERED_STEPS.map((step, idx) => {
          const state = nodeState(idx);
          const Icon = step.icon;
          const time = timeFor(step.status);
          const isLast = idx === ORDERED_STEPS.length - 1;

          return (
            <li key={step.status} className="relative flex gap-3 pb-4 last:pb-0">
              {/* vertical rail segment */}
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[21px] top-11 bottom-0 w-[3px] rounded-full",
                    idx < currentIndex ? "bg-rose-200" : "bg-slate-100"
                  )}
                />
              )}
              <div
                className={cn(
                  "relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all",
                  state === "completed" && "bg-emerald-50 text-emerald-600 border border-emerald-200",
                  state === "current" && !isRework && "bg-rose-500 text-white shadow-md shadow-rose-200",
                  state === "current" && isRework && "bg-red-600 text-white shadow-md shadow-red-200",
                  state === "upcoming" && "bg-slate-100 text-slate-400 border border-slate-200"
                )}
              >
                {state === "completed" ? <Check className="h-5 w-5 stroke-[3]" /> : <Icon className="h-5 w-5" />}
              </div>
              <div className="pt-1">
                <p className={cn("text-sm font-medium", state === "current" ? "text-slate-900 font-semibold" : state === "completed" ? "text-slate-600" : "text-slate-400")}>
                  {step.label}
                </p>
                {time && <p className={cn("text-[11px] mt-0.5", state === "current" ? "text-rose-600 font-medium" : "text-slate-400")}>{time}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
