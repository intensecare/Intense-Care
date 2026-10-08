/**
 * The ONE status vocabulary of the product. Every badge, journey and list
 * reads from here, so a status looks the same on every screen.
 *
 *   success = green · warning = amber · error = red · info = blue · neutral = gray
 */

export type StatusTone = "neutral" | "info" | "warning" | "success" | "error";

export interface StatusView {
  label: string;
  tone: StatusTone;
}

const VIEW: Record<string, StatusView> = {
  DRAFT: { label: "Booked", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  ASSIGNED: { label: "Assigned", tone: "neutral" },
  ARRIVED: { label: "Arrived", tone: "info" },
  CUSTOMER_VERIFIED: { label: "Customer Confirmed", tone: "info" },
  IN_PROGRESS: { label: "In Progress", tone: "info" },
  WORK_COMPLETED: { label: "Work Completed", tone: "warning" },
  QUALITY_CHECK: { label: "QC Pending", tone: "warning" },
  REWORK_REQUIRED: { label: "Rework", tone: "error" },
  REWORK_ASSIGNED: { label: "Rework", tone: "error" },
  REWORK_IN_PROGRESS: { label: "Rework", tone: "error" },
  REWORK_COMPLETED: { label: "QC Pending", tone: "warning" },
  REINSPECTION: { label: "QC Pending", tone: "warning" },
  PASS: { label: "QC Passed", tone: "success" },
  CUSTOMER_APPROVAL: { label: "Customer Approval", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  FEEDBACK_REQUESTED: { label: "Completed", tone: "success" },
  CLOSED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "error" },
};

export function statusView(status: string): StatusView {
  return VIEW[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "neutral" };
}

/** Tailwind classes per tone — chips, dots, soft panels. */
export const TONE_CLASSES: Record<StatusTone, { chip: string; dot: string; soft: string; text: string }> = {
  neutral: { chip: "bg-zinc-100 text-zinc-700 border-zinc-200", dot: "bg-zinc-400", soft: "bg-zinc-50 border-zinc-200", text: "text-zinc-700" },
  info: { chip: "bg-info-50 text-info-700 border-info-200", dot: "bg-info-500", soft: "bg-info-50 border-info-200", text: "text-info-700" },
  warning: { chip: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-500", soft: "bg-amber-50 border-amber-200", text: "text-amber-800" },
  success: { chip: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", soft: "bg-emerald-50 border-emerald-200", text: "text-emerald-800" },
  error: { chip: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500", soft: "bg-red-50 border-red-200", text: "text-red-700" },
};

/** The journey every job follows (customer-facing steps are a subset). */
export const JOURNEY_STEPS: { key: string; label: string; statuses: string[] }[] = [
  { key: "scheduled", label: "Scheduled", statuses: ["DRAFT", "SCHEDULED"] },
  { key: "assigned", label: "Assigned", statuses: ["ASSIGNED"] },
  { key: "arrived", label: "Arrived", statuses: ["ARRIVED"] },
  { key: "confirmed", label: "Customer Confirmed", statuses: ["CUSTOMER_VERIFIED"] },
  { key: "progress", label: "In Progress", statuses: ["IN_PROGRESS"] },
  { key: "completed_work", label: "Work Completed", statuses: ["WORK_COMPLETED"] },
  { key: "qc", label: "QC", statuses: ["QUALITY_CHECK", "REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_COMPLETED", "REINSPECTION"] },
  { key: "approval", label: "Approval", statuses: ["PASS", "CUSTOMER_APPROVAL"] },
  { key: "done", label: "Completed", statuses: ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"] },
];

export const REWORK_STATUSES = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];

export function journeyIndex(status: string): number {
  return JOURNEY_STEPS.findIndex((s) => s.statuses.includes(status));
}
