/**
 * RBAC — approval authority (§17).
 *
 * Some actions need a second, explicit authority on top of the base
 * permission. The thresholds are company configuration (SystemSettings);
 * the authority itself is fixed here so it cannot be lowered through the UI.
 */

import type { Role } from "./roles";

export type ApprovalKind =
  | "refund.high_value" // refund above the configured limit
  | "discount.high_value" // discount above the configured percentage
  | "users.delete" // deleting a user account
  | "settings.critical" // critical configuration (session, integrations, RBAC)
  | "audit.delete"; // never allowed through normal UI

export interface ApprovalPolicy {
  kind: ApprovalKind;
  label: string;
  /** Roles whose approval satisfies the policy. Empty = never allowed. */
  approvers: Role[];
}

export const APPROVAL_POLICIES: Record<ApprovalKind, ApprovalPolicy> = {
  "refund.high_value": {
    kind: "refund.high_value",
    label: "Refund above the configured limit",
    approvers: ["super_admin", "ops_manager"],
  },
  "discount.high_value": {
    kind: "discount.high_value",
    label: "Discount above the configured limit",
    approvers: ["super_admin", "ops_manager"],
  },
  "users.delete": {
    kind: "users.delete",
    label: "Delete a user account",
    approvers: ["super_admin"],
  },
  "settings.critical": {
    kind: "settings.critical",
    label: "Critical configuration",
    approvers: ["super_admin"],
  },
  "audit.delete": {
    kind: "audit.delete",
    label: "Delete audit history",
    approvers: [], // never through the normal UI
  },
};

export interface ApprovalLimits {
  /** Refunds up to and including this amount can be processed by Accounts alone. */
  refundApprovalLimit: number;
  /** Discounts up to and including this percentage need no extra approval. */
  discountApprovalLimitPercent: number;
}

export const DEFAULT_APPROVAL_LIMITS: ApprovalLimits = {
  refundApprovalLimit: 5000,
  discountApprovalLimitPercent: 10,
};

export function canApprove(role: Role, kind: ApprovalKind): boolean {
  return APPROVAL_POLICIES[kind].approvers.includes(role);
}

/** True when a refund of `amount` needs elevated approval. */
export function refundNeedsApproval(amount: number, limits: ApprovalLimits): boolean {
  return amount > limits.refundApprovalLimit;
}

/** True when a discount of `percent` needs elevated approval. */
export function discountNeedsApproval(percent: number, limits: ApprovalLimits): boolean {
  return percent > limits.discountApprovalLimitPercent;
}
