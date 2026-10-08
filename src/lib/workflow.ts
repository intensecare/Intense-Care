/**
 * The order workflow — ONE table of allowed status transitions.
 *
 * Used by the server (src/lib/server/orders.ts) to reject invalid moves and
 * by the UI to show only the buttons that are valid right now. Pure module:
 * safe to import from client and server code.
 */

export const ORDER_STATUSES = [
  "CREATED",
  "PICKUP_ASSIGNED",
  "PICKED_UP",
  "PROCESSING",
  "QC_PENDING",
  "QC_FAILED",
  "REWORK",
  "QC_PASSED",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type StaffRole = "ADMIN" | "FIELD_MANAGER" | "QC";
/** SYSTEM = automation (pickup completed → processing, QC passed → ready). */
export type Actor = StaffRole | "SYSTEM";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  CREATED: "Order Created",
  PICKUP_ASSIGNED: "Pickup Assigned",
  PICKED_UP: "Picked Up",
  PROCESSING: "Processing",
  QC_PENDING: "QC Pending",
  QC_FAILED: "QC Failed",
  REWORK: "Rework",
  QC_PASSED: "QC Passed",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export type Tone = "neutral" | "info" | "warning" | "danger" | "success";

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  CREATED: "neutral",
  PICKUP_ASSIGNED: "info",
  PICKED_UP: "info",
  PROCESSING: "info",
  QC_PENDING: "warning",
  QC_FAILED: "danger",
  REWORK: "danger",
  QC_PASSED: "success",
  READY: "success",
  OUT_FOR_DELIVERY: "info",
  DELIVERED: "success",
  CANCELLED: "neutral",
};

export interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  actors: Actor[];
  label: string;
  /** A written reason is mandatory (QC fail, rework, cancel). */
  requiresReason?: boolean;
  tone?: "primary" | "danger" | "secondary";
}

export const TRANSITIONS: Transition[] = [
  { from: "CREATED", to: "PICKUP_ASSIGNED", actors: ["ADMIN", "SYSTEM"], label: "Assign Pickup" },
  { from: "PICKUP_ASSIGNED", to: "PICKED_UP", actors: ["ADMIN", "FIELD_MANAGER"], label: "Mark Picked Up" },
  { from: "PICKED_UP", to: "PROCESSING", actors: ["ADMIN", "SYSTEM"], label: "Start Processing" },
  { from: "PROCESSING", to: "QC_PENDING", actors: ["ADMIN"], label: "Processing Done — Send to QC" },
  { from: "QC_PENDING", to: "QC_PASSED", actors: ["ADMIN", "QC"], label: "Pass" },
  { from: "QC_PENDING", to: "QC_FAILED", actors: ["ADMIN", "QC"], label: "Fail", requiresReason: true, tone: "danger" },
  { from: "QC_PENDING", to: "REWORK", actors: ["ADMIN", "QC"], label: "Needs Rework", requiresReason: true, tone: "secondary" },
  { from: "QC_FAILED", to: "REWORK", actors: ["ADMIN"], label: "Start Rework" },
  { from: "REWORK", to: "QC_PENDING", actors: ["ADMIN"], label: "Rework Done — Send to QC" },
  { from: "QC_PASSED", to: "READY", actors: ["ADMIN", "SYSTEM"], label: "Mark Ready" },
  { from: "READY", to: "OUT_FOR_DELIVERY", actors: ["ADMIN", "FIELD_MANAGER"], label: "Start Delivery" },
  { from: "OUT_FOR_DELIVERY", to: "DELIVERED", actors: ["ADMIN", "FIELD_MANAGER"], label: "Delivered" },
  ...(["CREATED", "PICKUP_ASSIGNED", "PICKED_UP", "PROCESSING"] as const).map(
    (from): Transition => ({ from, to: "CANCELLED", actors: ["ADMIN"], label: "Cancel Order", requiresReason: true, tone: "danger" })
  ),
];

/** Statuses the system advances automatically right after they are reached. */
export const AUTO_ADVANCE: Partial<Record<OrderStatus, OrderStatus>> = {
  PICKED_UP: "PROCESSING",
  QC_PASSED: "READY",
};

export function findTransition(from: OrderStatus, to: OrderStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransition(actor: Actor, from: OrderStatus, to: OrderStatus): boolean {
  const t = findTransition(from, to);
  return Boolean(t && t.actors.includes(actor));
}

/** Buttons a human actor may press for an order in `status` (automation steps excluded). */
export function availableActions(actor: StaffRole, status: OrderStatus): Transition[] {
  return TRANSITIONS.filter((t) => t.from === status && t.actors.includes(actor));
}

/** Items, prices and discount may be edited until the order reaches QC. */
export const EDITABLE_STATUSES: OrderStatus[] = ["CREATED", "PICKUP_ASSIGNED", "PICKED_UP", "PROCESSING", "REWORK"];

export const OPEN_STATUSES: OrderStatus[] = ORDER_STATUSES.filter((s) => s !== "DELIVERED" && s !== "CANCELLED");

/** Status groups used by dashboard tiles and list filters. */
export const STATUS_GROUPS = {
  pickup: ["CREATED", "PICKUP_ASSIGNED"],
  processing: ["PICKED_UP", "PROCESSING", "REWORK"],
  qc: ["QC_PENDING"],
  qcFailed: ["QC_FAILED"],
  ready: ["QC_PASSED", "READY"],
  delivery: ["OUT_FOR_DELIVERY"],
  delivered: ["DELIVERED"],
  cancelled: ["CANCELLED"],
} as const satisfies Record<string, readonly OrderStatus[]>;

export type StatusGroup = keyof typeof STATUS_GROUPS;

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  pickup: "Pending Pickup",
  processing: "Processing",
  qc: "QC Pending",
  qcFailed: "QC Failed",
  ready: "Ready",
  delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/* -------------------------------------------------------------------------- */
/* Customer-facing timeline                                                   */
/* -------------------------------------------------------------------------- */

export const CUSTOMER_STEPS = [
  "Order Created",
  "Picked Up",
  "Processing",
  "Quality Check",
  "Ready",
  "Out for Delivery",
  "Delivered",
] as const;

/** Index of the current step on the customer timeline (−1 when cancelled). */
export function customerStepIndex(status: OrderStatus): number {
  switch (status) {
    case "CREATED":
    case "PICKUP_ASSIGNED":
      return 0;
    case "PICKED_UP":
      return 1;
    case "PROCESSING":
      return 2;
    case "QC_PENDING":
    case "QC_FAILED":
    case "REWORK":
    case "QC_PASSED":
      return 3;
    case "READY":
      return 4;
    case "OUT_FOR_DELIVERY":
      return 5;
    case "DELIVERED":
      return 6;
    case "CANCELLED":
      return -1;
  }
}

/** Plain-language status lines for the customer page (no internal terms). */
export function customerStatusLines(status: OrderStatus) {
  const i = customerStepIndex(status);
  const reworking = status === "QC_FAILED" || status === "REWORK";
  return {
    pickup: i >= 1 ? "Picked up" : status === "PICKUP_ASSIGNED" ? "Pickup scheduled" : status === "CANCELLED" ? "Cancelled" : "Awaiting pickup",
    processing: i >= 3 ? "Done" : i === 2 ? "In progress" : "Not started",
    qc: i >= 4 ? "Passed" : reworking ? "Being re-done for quality" : i === 3 ? "Checking" : "Not started",
    ready: i >= 4 ? "Ready" : "Not yet",
    delivery: i >= 6 ? "Delivered" : i === 5 ? "Out for delivery" : "Not yet",
  };
}
