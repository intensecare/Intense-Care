import React from "react";
import { JobStatus } from "@/lib/types";
import { JOB_STATUS_CONFIG } from "@/lib/state-machine";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: JobStatus;
  size?: "sm" | "md";
  showDot?: boolean;
}

/**
 * Outline status chip with a colored dot — one shape, four semantics:
 * neutral (zinc), success (emerald), waiting (amber), alert (red).
 * No filled pastel backgrounds; the dot carries the hue, the label carries
 * the meaning. Keeps the whole app's status vocabulary calm and scannable.
 */
export function JobStatusBadge({
  status,
  size = "md",
  showDot = true,
}: JobStatusBadgeProps) {
  const config = JOB_STATUS_CONFIG[status] || JOB_STATUS_CONFIG.DRAFT;

  const tone =
    status === "COMPLETED" || status === "PASS"
      ? "success"
      : status === "REWORK_REQUIRED" || status === "CANCELLED"
      ? "alert"
      : status === "SCHEDULED" ||
        status === "QUALITY_CHECK" ||
        status === "CUSTOMER_APPROVAL" ||
        status === "FEEDBACK_REQUESTED" ||
        status === "REINSPECTION" ||
        status === "REWORK_COMPLETED"
      ? "waiting"
      : "neutral";

  const tones = {
    neutral: {
      chip: "border-zinc-200 text-zinc-600",
      dot: "bg-zinc-400",
    },
    success: {
      chip: "border-emerald-200 text-emerald-700",
      dot: "bg-emerald-500",
    },
    waiting: {
      chip: "border-amber-200 text-amber-700",
      dot: "bg-amber-500",
    },
    alert: {
      chip: "border-red-200 text-red-600",
      dot: "bg-red-500",
    },
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border bg-white font-medium whitespace-nowrap font-sans",
        tones.chip,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
      )}
    >
      {showDot && (
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", tones.dot)} />
      )}
      {config.label}
    </span>
  );
}

export function PaymentStatusBadge({
  status,
}: {
  status: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" | "CANCELLED" | "NOT_APPLICABLE";
}) {
  // Same outline-dot vocabulary: only PAID is green, only UNPAID is amber.
  const styles = {
    UNPAID: "border-amber-200 text-amber-700",
    PARTIAL: "border-amber-200 text-amber-700",
    PAID: "border-emerald-200 text-emerald-700",
    REFUNDED: "border-zinc-200 text-zinc-500",
    CANCELLED: "border-zinc-200 text-zinc-500",
    NOT_APPLICABLE: "border-slate-200 text-slate-500",
  };
  const dots = {
    UNPAID: "bg-amber-500",
    PARTIAL: "bg-amber-500",
    PAID: "bg-emerald-500",
    REFUNDED: "bg-zinc-300",
    CANCELLED: "bg-zinc-300",
    NOT_APPLICABLE: "bg-slate-300",
  };
  const labels: Record<string, string> = {
    NOT_APPLICABLE: "Billed on contract",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border bg-white text-[10px] font-medium font-sans whitespace-nowrap",
        styles[status] || styles.UNPAID
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dots[status] || dots.UNPAID)} />
      {labels[status] ?? status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
