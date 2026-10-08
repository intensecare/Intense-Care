/**
 * RBAC — notification deep links.
 *
 * A notification always lands on the role-specific action page, never on a
 * generic dashboard. Customers always land on their ONE secure service link.
 */

import type { Role } from "./roles";

export type NotificationEvent =
  | "job_assigned"
  | "team_arrived"
  | "qc_ready"
  | "rework_assigned"
  | "qc_passed"
  | "customer_approved";

export interface DeepLink {
  path: string;
  cta: string;
  message: string;
}

export function deepLinkFor(_role: Role | string, event: NotificationEvent, ctx: { jobId?: string; customerLink?: string }): DeepLink {
  const jobId = ctx.jobId ?? "";

  switch (event) {
    case "job_assigned":
      return { path: `/my-jobs/${jobId}`, cta: "OPEN JOB", message: "New job assigned." };
    case "team_arrived":
      return { path: ctx.customerLink ?? "", cta: "CONFIRM & START", message: "Your team has arrived." };
    case "qc_ready":
      return { path: `/quality-queue/${jobId}`, cta: "INSPECT", message: "Job ready for quality check." };
    case "rework_assigned":
      return { path: `/my-jobs/${jobId}`, cta: "OPEN REWORK", message: "Rework required on your job." };
    case "qc_passed":
      return { path: ctx.customerLink ?? "", cta: "APPROVE SERVICE", message: "Your service passed the quality check and is ready for approval." };
    case "customer_approved":
      return { path: `/jobs/${jobId}`, cta: "VIEW JOB", message: "Customer approved the service." };
    default:
      return { path: "/", cta: "OPEN", message: "" };
  }
}
