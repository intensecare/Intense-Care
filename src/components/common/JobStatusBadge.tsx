import React from "react";
import { CheckCircle2, Circle, Clock, AlertTriangle, PlayCircle, XCircle } from "lucide-react";
import { statusView, TONE_CLASSES, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

const TONE_ICON: Record<StatusTone, React.ElementType> = {
  neutral: Circle,
  info: PlayCircle,
  warning: Clock,
  success: CheckCircle2,
  error: AlertTriangle,
};

/**
 * StatusBadge — the ONE status chip of the product. Colour AND an icon carry
 * the meaning (never colour alone), labels come from src/lib/status.ts.
 */
export function StatusBadge({ status, size = "md", className }: { status: string; size?: "sm" | "md"; className?: string }) {
  const view = statusView(status);
  const Icon = status === "CANCELLED" ? XCircle : TONE_ICON[view.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap",
        TONE_CLASSES[view.tone].chip,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs sm:text-sm",
        className
      )}
    >
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
      {view.label}
    </span>
  );
}

/** Backwards-compatible name used across the app. */
export function JobStatusBadge({ status, size = "md" }: { status: string; size?: "sm" | "md"; showDot?: boolean }) {
  return <StatusBadge status={status} size={size} />;
}

const PAYMENT: Record<string, { label: string; tone: StatusTone }> = {
  UNPAID: { label: "Unpaid", tone: "warning" },
  PARTIAL: { label: "Part paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  NOT_APPLICABLE: { label: "Billed on contract", tone: "neutral" },
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const p = PAYMENT[status] ?? PAYMENT.UNPAID;
  const Icon = TONE_ICON[p.tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap", TONE_CLASSES[p.tone].chip)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {p.label}
    </span>
  );
}
