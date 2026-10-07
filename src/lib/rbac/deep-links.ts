/**
 * RBAC — notification deep links (§24).
 *
 * A notification always lands on the role-specific action page, never on a
 * generic dashboard. The same resolver is used by SMS/WhatsApp composition
 * on the server and by in-app notification cards.
 */

import type { Role } from "./roles";
import { normalizeRole } from "./roles";

export type NotificationEvent =
  | "job_assigned"
  | "team_arrived"
  | "qc_ready"
  | "rework_assigned"
  | "qc_passed"
  | "customer_approved"
  | "payment_received"
  | "invoice_due"
  | "commission_earned";

export interface DeepLink {
  path: string;
  cta: string;
  message: string;
}

export function deepLinkFor(roleRaw: Role | string, event: NotificationEvent, ctx: { jobId?: string; invoiceId?: string; customerLink?: string }): DeepLink {
  const role = normalizeRole(roleRaw);
  const jobId = ctx.jobId ?? "";

  switch (event) {
    case "job_assigned":
      return role === "field_staff"
        ? { path: `/my-tasks/${jobId}`, cta: "OPEN TASK", message: "New task assigned." }
        : { path: `/my-jobs/${jobId}`, cta: "OPEN JOB", message: "New job assigned." };
    case "team_arrived":
      return { path: ctx.customerLink ?? `/my-services/${jobId}`, cta: "CONFIRM SERVICE", message: "Your cleaning team has arrived." };
    case "qc_ready":
      return { path: `/quality-queue/${jobId}`, cta: "INSPECT", message: "Job ready for quality inspection." };
    case "rework_assigned":
      return role === "field_staff"
        ? { path: `/my-tasks/${jobId}`, cta: "OPEN REWORK", message: "Rework assigned to you." }
        : { path: `/my-jobs/${jobId}`, cta: "OPEN REWORK", message: "Rework assigned to your team." };
    case "qc_passed":
      return { path: ctx.customerLink ?? `/my-services/${jobId}`, cta: "APPROVE SERVICE", message: "Your service is quality checked and ready for approval." };
    case "customer_approved":
      return role === "accounts"
        ? { path: `/finance?invoice=${ctx.invoiceId ?? ""}`, cta: "GENERATE INVOICE", message: "Customer approved the service." }
        : { path: `/jobs/${jobId}`, cta: "VIEW JOB", message: "Customer approved the service." };
    case "payment_received":
      return { path: `/finance?invoice=${ctx.invoiceId ?? ""}`, cta: "VIEW PAYMENT", message: "Payment received." };
    case "invoice_due":
      return { path: `/my-services/${jobId}`, cta: "PAY NOW", message: "Your invoice is ready." };
    case "commission_earned":
      return { path: "/my-referrals", cta: "VIEW COMMISSION", message: "Commission credited." };
    default:
      return { path: "/", cta: "OPEN", message: "" };
  }
}
