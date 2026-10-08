import React from "react";
import { Check, RotateCcw, XCircle } from "lucide-react";
import { JOURNEY_STEPS, REWORK_STATUSES, journeyIndex } from "@/lib/status";
import { cn } from "@/lib/utils";

type StepState = "done" | "current" | "upcoming" | "rework";

/**
 * Job Journey — one connected timeline for every job.
 * Phones: vertical list. Tablet/desktop: horizontal connected track.
 * Done = green check, current = coral ring, upcoming = hollow, rework = amber.
 */
export function JobJourney({ status, className, compactOnMobile }: { status: string; className?: string; compactOnMobile?: boolean }) {
  if (status === "CANCELLED") {
    return (
      <div className={cn("rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 flex items-center gap-2", className)}>
        <XCircle className="h-5 w-5" aria-hidden /> This job was cancelled
      </div>
    );
  }
  const at = journeyIndex(status);
  const rework = REWORK_STATUSES.includes(status);
  const finished = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"].includes(status);
  const steps = JOURNEY_STEPS.map((s, i) => {
    const state: StepState = finished || i < at ? "done" : i === at ? (rework ? "rework" : "current") : "upcoming";
    return { ...s, state, label: i === at && rework ? "Rework" : s.label };
  });
  const srText = (s: StepState) => (s === "done" ? "done" : s === "current" ? "current step" : s === "rework" ? "rework in progress" : "upcoming");

  return (
    <div className={className}>
      {/* Vertical (phones) */}
      <ol className={cn("md:hidden", compactOnMobile && "hidden")}>
        {steps.map((s, i) => (
          <li key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <Dot state={s.state} />
              {i < steps.length - 1 && <span className={cn("w-0.5 flex-1 min-h-[14px]", s.state === "done" ? "bg-emerald-400" : "bg-zinc-200")} aria-hidden />}
            </div>
            <div className={cn("pb-3 -mt-0.5 text-sm", s.state === "current" || s.state === "rework" ? "font-semibold text-zinc-950" : s.state === "done" ? "text-zinc-700" : "text-zinc-400")}>
              {s.label}
              <span className="sr-only"> — {srText(s.state)}</span>
            </div>
          </li>
        ))}
      </ol>
      {/* Horizontal (tablet / desktop) */}
      <ol className={cn(compactOnMobile ? "flex" : "hidden md:flex", "items-start overflow-x-auto")}>
        {steps.map((s, i) => (
          <li key={s.key} className="flex-1 min-w-[76px] flex flex-col items-center text-center relative">
            {i > 0 && <span aria-hidden className={cn("absolute top-[13px] right-1/2 w-full h-0.5", s.state === "upcoming" ? "bg-zinc-200" : "bg-emerald-400")} />}
            <span className="relative z-10"><Dot state={s.state} /></span>
            <span className={cn("mt-2 px-1 text-xs leading-tight", s.state === "current" || s.state === "rework" ? "font-semibold text-zinc-950" : s.state === "done" ? "text-zinc-600" : "text-zinc-400")}>
              {s.label}
              <span className="sr-only"> — {srText(s.state)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Dot({ state }: { state: StepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors",
        state === "done" && "bg-emerald-500 border-emerald-500 text-white",
        state === "current" && "bg-white border-rose-500 ring-4 ring-rose-100",
        state === "rework" && "bg-amber-500 border-amber-500 text-white ring-4 ring-amber-100",
        state === "upcoming" && "bg-white border-zinc-300"
      )}
    >
      {state === "done" && <Check className="h-4 w-4" />}
      {state === "current" && <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />}
      {state === "rework" && <RotateCcw className="h-3.5 w-3.5" />}
    </span>
  );
}
