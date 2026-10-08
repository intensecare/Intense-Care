import type { SystemSettings } from "./types";

/**
 * Structural defaults for system settings ONLY.
 *
 * There are no hardcoded business catalogs in this codebase: service packages,
 * checklist rubrics, and commission rules start EMPTY and are authored entirely
 * by the company through the app (Services page, Referrals page). Anything a
 * cleaning business might define is company data in the database.
 */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  nextDayDispatchTime: "20:00",
  googleBusinessReviewUrl: "",
  currency: "INR",
  companyName: "Intense Care",
  companyTagline: "Deep Cleaning Field Services",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  taxRatePercent: 18,
  taxLabel: "GST",
  gstin: "",
  sacCode: "",
  resendCooldownSeconds: 60,
  refundApprovalLimit: 5000,
  discountApprovalLimitPercent: 10,
};
