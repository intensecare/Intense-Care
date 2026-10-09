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
  logoDataUrl: "",
  signatureDataUrl: "",
  signatoryName: "Authorised Signatory",
  invoicePaymentTerms: "Payment due on completion of service.",
  invoiceNotes: "Thank you for choosing us.",
  quotationTerms: "Prices are valid until the date shown. Work is scheduled after acceptance. Any extra work is quoted separately.",
  quotationPaymentTerms: "Full payment on completion of service.",
  quotationValidityDays: 15,
  customerVisibility: {
    jobId: true, service: true, serviceDate: true, location: true, team: true, status: true,
    beforePhotos: true, afterPhotos: true, qcResult: true, quotation: true, invoice: true,
    paymentStatus: true, serviceNotes: true, feedback: true,
  },
  referralRules: { enabled: true, bonusType: "FIXED", bonusValue: 500, minJobValue: 2000, requirePaid: true, eligibilityDays: 90, maxBonus: 0 },
  notifications: { customerArrived: true, customerCompleted: true, fieldManagerAssigned: true, reworkAssigned: true, qcReady: true },
};
