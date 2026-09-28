import React from "react";
import { JobStatus } from "@/lib/types";
import { JOB_STATUS_CONFIG } from "@/lib/state-machine";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: JobStatus;
  size?: "sm" | "md";
  showDot?: boolean;
}

export function JobStatusBadge({
  status,
  size = "md",
  showDot = true,
}: JobStatusBadgeProps) {
  const config = JOB_STATUS_CONFIG[status] || JOB_STATUS_CONFIG.DRAFT;

  // Custom refined status styling
  const isCompletedOrPassed = status === "COMPLETED" || status === "PASS";
  const isAlertOrRework = status === "REWORK_REQUIRED" || status === "CANCELLED";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium border rounded-md transition-colors font-sans",
        isCompletedOrPassed
          ? "bg-emerald-50 text-emerald-800 border-emerald-200 font-semibold"
          : isAlertOrRework
          ? "bg-rose-50 text-rose-800 border-rose-200 font-bold"
          : "bg-zinc-100/80 text-zinc-800 border-zinc-200",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs"
      )}
    >
      {showDot && (
        <span
          className={cn(
            "rounded-full shrink-0",
            isCompletedOrPassed
              ? "bg-emerald-500"
              : isAlertOrRework
              ? "bg-rose-500"
              : "bg-zinc-500",
            size === "sm" ? "h-1.5 w-1.5" : "h-1.5 w-1.5"
          )}
        />
      )}
      {config.label}
    </span>
  );
}

export function PaymentStatusBadge({
  status,
}: {
  status: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" | "CANCELLED";
}) {
  const styles = {
    UNPAID: "bg-amber-50 text-amber-900 border-amber-200 font-semibold",
    PARTIAL: "bg-zinc-100 text-zinc-800 border-zinc-200",
    PAID: "bg-emerald-50 text-emerald-900 border-emerald-200 font-semibold",
    REFUNDED: "bg-zinc-100 text-zinc-600 border-zinc-200",
    CANCELLED: "bg-zinc-100 text-zinc-500 border-zinc-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-sans font-semibold border",
        styles[status] || styles.UNPAID
      )}
    >
      {status}
    </span>
  );
}

