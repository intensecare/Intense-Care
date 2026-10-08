import type { Role } from "./rbac/roles";

/** The nine RBAC roles (see src/lib/rbac/roles.ts). */
export type UserRole = Role;

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  avatar?: string;
  active: boolean;
  /** Scope attributes (TEAM / BRANCH) and external-role links (OWN). */
  teamId?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  referralPartnerId?: string | null;
  createdAt: string;
}

export type JobStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ASSIGNED"
  | "ARRIVED"
  | "CUSTOMER_VERIFIED"
  | "IN_PROGRESS"
  | "WORK_COMPLETED"
  | "QUALITY_CHECK"
  | "PASS"
  | "REWORK_REQUIRED"
  | "REWORK_ASSIGNED" // §19 rework dispatched to a specific staff member
  | "REWORK_IN_PROGRESS" // §19 staff opened the rework link / started work
  | "REWORK_COMPLETED"
  | "REINSPECTION"
  | "CUSTOMER_APPROVAL"
  | "COMPLETED"
  | "FEEDBACK_REQUESTED"
  | "CLOSED"
  | "CANCELLED";

export type PaymentStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "REFUNDED"
  | "CANCELLED"
  | "NOT_APPLICABLE"; // AMC visit jobs — billed under the parent contract, no invoice

export interface SystemSettings {
  nextDayDispatchTime: string; // e.g., "20:00" for 8:00 PM
  googleBusinessReviewUrl: string;
  currency: string;
  /** Company identity printed on tax invoices & customer statements. */
  companyName: string;
  /** Short line under the company name (e.g. "Deep Cleaning Field Services"). */
  companyTagline: string;
  /** Registered business address printed on statutory documents. */
  companyAddress: string;
  /** Support phone printed on documents. */
  companyPhone: string;
  /** Support/billing email printed on documents. */
  companyEmail: string;
  /** Tax rate as a percentage of the taxable value (e.g. 18 for GST 18%). 0 disables tax. */
  taxRatePercent: number;
  /** Tax name shown on invoices, e.g. "GST". */
  taxLabel: string;
  /** Business GSTIN printed on statutory invoice documents. */
  gstin: string;
  /** SAC/service accounting code printed on statutory invoice documents. */
  sacCode: string;
  /** Seconds a customer must wait between secure-link resend notifications. */
  resendCooldownSeconds: number;
  /** §17 approval authority: refunds above this amount need Ops Manager / Super Admin approval. */
  refundApprovalLimit: number;
  /** §17 approval authority: discounts above this percentage need elevated approval. */
  discountApprovalLimitPercent: number;
}

export interface Refund {
  id: string;
  invoiceId: string;
  jobId: string;
  customerId: string;
  amount: number;
  reason: string;
  method: "original" | "bank_transfer" | "upi" | "cash";
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PROCESSED";
  requestedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  processedAt?: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  date: string;
  category: "equipment" | "chemicals" | "fuel" | "salaries" | "marketing" | "utilities" | "other";
  amount: number;
  description: string;
  paymentMethod: "cash" | "card" | "bank_transfer" | "upi";
  reference?: string;
  attachmentUrl?: string;
  createdBy: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  whatsapp: string;
  address: string;
  notes?: string;
  source: string; // 'referral' | 'google' | 'direct' | 'repeat'
  referralPartnerId?: string;
  referralCode?: string;
  lifetimeRevenue: number;
  totalBookings: number;
  status: "active" | "inactive";
  createdAt: string;
}

/** Referral attribution summary attached to the customer detail snapshot. */
export interface CustomerPartnerSummary {
  id: string;
  name: string;
  code: string;
  status: string;
}

/** Serialized booking row on the customer detail snapshot: the hydrated Job
 *  shape plus display joins (service name, property title). */
export interface CustomerDetailJob extends Job {
  customerName?: string;
  customerPhone?: string;
  propertyTitle?: string;
  service?: {
    id: string;
    name: string;
    basePrice: number;
    estimatedDurationHours: number;
  };
}

/** Server-computed aggregates for the customer detail view. Financial fields
 *  are only present for Admin responses. */
export interface CustomerDetailStats {
  totalBookings: number;
  completedJobs: number;
  activeJobs: number;
  lifetimeRevenue?: number;
  billedTotal?: number;
  collected?: number;
  outstanding?: number;
}

/** GET /api/customers/[id] — the 360° customer file consumed by the detail
 *  page. Invoices/payments/quotes are Admin-only and omitted otherwise. */
export interface CustomerDetailSnapshot {
  customer: Customer;
  properties: Property[];
  jobs: CustomerDetailJob[];
  partner: CustomerPartnerSummary | null;
  stats: CustomerDetailStats;
  invoices?: Invoice[];
  payments?: Payment[];
  quotes?: Quote[];
  complaints?: Complaint[];
  /** §2 AMC contracts held by this customer (Admin only). */
  amcContracts?: CustomerAmcContractSummary[];
}

/** Role-safe AMC contract summary shown on the customer file's AMC tab. */
export interface CustomerAmcContractSummary {
  id: string;
  contractNumber: string;
  status: string;
  paymentStatus: string;
  startDate: string;
  endDate: string;
  /** Omitted for ops_manager (financial redaction). */
  contractValue?: number;
  visitCount: number;
  frequency: string;
  serviceId: string | null;
  visits: {
    id: string;
    visitNumber: number;
    scheduledDate: string;
    status: string;
    jobId: string | null;
  }[];
}

export type PropertyType =
  | "apartment"
  | "villa"
  | "office"
  | "penthouse"
  | "commercial"
  | "duplex";

export interface Property {
  id: string;
  customerId: string;
  propertyType: PropertyType;
  title: string; // e.g. "Prestige Lakeside 3BHK"
  address: string;
  city: string;
  postalCode: string;
  carpetAreaSqFt?: number;
  bedrooms?: number;
  bathrooms?: number;
  gpsCoordinates: {
    lat: number;
    lng: number;
  };
  accessNotes?: string;
  parkingInstructions?: string;
  preferredTime?: string;
  recurringService: boolean;
  recurringFrequency?: "weekly" | "biweekly" | "monthly" | "quarterly";
  createdAt: string;
}

export interface ServiceChecklistTemplateItem {
  id: string;
  area: string; // e.g. "Kitchen", "Bathrooms", "Living Room"
  task: string; // e.g. "Degrease chimney & exhaust fan"
  critical: boolean; // if critical, cannot be skipped without admin override
}

export interface Service {
  id: string;
  name: string;
  slug: string;
  category: "residential" | "commercial" | "specialized";
  description: string;
  basePrice: number;
  estimatedDurationHours: number;
  checklistTemplate: ServiceChecklistTemplateItem[];
  active: boolean;
}

export interface JobChecklistItem {
  id: string;
  jobId: string;
  area: string;
  task: string;
  critical: boolean;
  status: "pending" | "completed" | "skipped" | "issue";
  skippedReason?: string;
  issueNotes?: string;
  photoEvidence?: string;
  completedBy?: string;
  completedAt?: string;
}

export interface JobPhoto {
  id: string;
  jobId: string;
  area: string; // "Kitchen", "Master Bedroom", "Balcony", "Bathroom 1"
  photoType: "before" | "after" | "qc" | "rework";
  photoUrl: string;
  thumbnailUrl?: string;
  caption?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface QualityIssue {
  id: string;
  qualityCheckId?: string; // null for customer attention requests without a formal QC record
  jobId: string;
  area: string;
  itemDescription: string;
  severity: "minor" | "major" | "critical";
  notes: string;
  photoEvidence?: string;
  status: "open" | "rework_in_progress" | "resolved" | "reinspected_pass";
  reworkTaskId?: string;
  assignedStaffId?: string;
  reworkInstructions?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ReworkTask {
  id: string;
  qualityIssueId: string;
  jobId: string;
  assignedStaffId: string;
  instructions: string;
  status: "pending" | "in_progress" | "completed" | "reinspected";
  completedAt?: string;
  completedNotes?: string;
  createdAt: string;
}

export interface QualityCheck {
  id: string;
  jobId: string;
  inspectorId: string;
  inspectorName: string;
  score: number; // 0 - 100
  status: "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "PASS" | "REWORK_REQUIRED";
  itemsChecked: number;
  itemsPassed: number;
  issuesCount: number;
  notes?: string;
  evidencePhotos: string[];
  inspectedAt?: string;
  completedAt?: string;
}

export interface CustomerApproval {
  id: string;
  jobId: string;
  customerId: string;
  approvalToken: string;
  status: "PENDING" | "APPROVED" | "ATTENTION_REQUESTED";
  approvedAt?: string;
  signatureOrConfirmation?: string;
  attentionNotes?: string;
  attentionCategory?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface CustomerFeedback {
  id: string;
  jobId: string;
  customerId: string;
  rating: number; // 1 to 5
  sentiment: "positive" | "neutral" | "negative";
  tags: string[];
  comment?: string;
  googleReviewPromptShown: boolean;
  googleReviewClicked: boolean;
  createdAt: string;
}

export interface Complaint {
  id: string;
  jobId: string;
  customerId: string;
  category:
    | "quality"
    | "punctuality"
    | "staff_behavior"
    | "damage"
    | "missed_area"
    | "billing";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  assignedOwnerId: string;
  assignedOwnerName?: string;
  status: "open" | "investigating" | "resolution_proposed" | "resolved" | "closed";
  resolutionNotes?: string;
  resolvedAt?: string;
  createdAt: string;
}

export type CommissionRuleType =
  | "percentage"
  | "fixed"
  | "tiered"
  | "service_specific";

export interface CommissionTier {
  minAmount: number;
  maxAmount: number;
  rate: number; // percentage or fixed
}

export interface CommissionRule {
  id: string;
  name: string;
  partnerType:
    | "customer"
    | "employee"
    | "real_estate_agent"
    | "interior_designer"
    | "corporate_partner"
    | "influencer";
  calculationType: CommissionRuleType;
  value: number; // percentage (e.g. 10 for 10%) or fixed amount
  tierRules?: CommissionTier[];
  serviceOverrides?: Record<string, number>; // serviceId -> percentage or fixed
  isDefault: boolean;
  active: boolean;
}

export type CommissionStatus =
  | "REFERRAL"
  | "BOOKED"
  | "JOB_COMPLETED"
  | "COMMISSION_PENDING"
  | "APPROVED"
  | "PAYMENT_PROCESSING"
  | "PAID"
  | "REVERSED";

export interface CommissionEntry {
  id: string;
  partnerId: string;
  referralId: string;
  jobId: string;
  bookingAmount: number;
  commissionAmount: number;
  ruleApplied: string;
  status: CommissionStatus;
  approvedAt?: string;
  payoutId?: string;
  reversedReason?: string;
  createdAt: string;
}

export interface ReferralPartner {
  id: string;
  name: string;
  code: string; // e.g. "INTERIOR-LUXE"
  partnerType:
    | "customer"
    | "employee"
    | "real_estate_agent"
    | "interior_designer"
    | "corporate_partner"
    | "influencer";
  email: string;
  phone: string;
  commissionRuleId: string;
  status: "active" | "inactive";
  totalReferrals: number;
  totalConversions: number;
  totalRevenueGenerated: number;
  totalCommissionEarned: number;
  totalCommissionPaid: number;
  totalCommissionPending: number;
  bankDetails?: {
    accountName: string;
    accountNumber: string;
    ifscOrRouting: string;
    upiId?: string;
  };
  createdAt: string;
}

export interface Referral {
  id: string;
  partnerId: string;
  customerId: string;
  jobId?: string;
  referralCode: string;
  attributionDate: string;
  attributionExpiresAt: string;
  status: "lead" | "booked" | "completed" | "expired" | "disqualified";
}

export interface Payout {
  id: string;
  partnerId: string;
  partnerName: string;
  amount: number;
  payoutMethod: "bank_transfer" | "upi" | "cheque" | "wallet";
  referenceNumber: string;
  status: "draft" | "processing" | "paid" | "failed";
  paidAt?: string;
  notes?: string;
  createdAt: string;
}

/** One job assignment inside the staff directory (read-only operational
 *  view — amounts/payment are financial and intentionally omitted). */
export interface StaffDirectoryJob {
  id: string;
  status: JobStatus;
  scheduledDate: string;
  scheduledTimeSlot: string;
  customerName: string | null;
  propertyTitle: string | null;
  serviceName: string | null;
  isLead: boolean;
  crewSize: number;
}

/**
 * One field worker in GET /api/users/staff-directory. Every figure is
 * server-computed from the database (assignments, rework tasks, photo
 * uploads) — nothing is hardcoded in the client.
 */
export interface StaffDirectoryEntry {
  id: string;
  name: string;
  email: string;
  phone: string;
  active: boolean;
  role: string;
  createdAt: string;
  stats: {
    totalJobs: number;
    activeJobs: number;
    completedJobs: number;
    upcomingJobs: number;
    leadJobs: number;
    openReworkTasks: number;
    photosUploaded: number;
  };
  jobs: StaffDirectoryJob[];
  openRework: {
    id: string;
    jobId: string;
    instructions: string;
    createdAt: string;
  }[];
}

/**
 * Live pipeline activity event (GET /api/activity). Written server-side on
 * every field-worker/QC/customer action so supervisors get a real-time feed
 * and the job record's Audit tab shows genuine database history.
 */
export interface JobActivityEvent {
  id: string;
  jobId: string;
  type:
    | "STATUS_CHANGED"
    | "STAFF_ASSIGNED"
    | "OTP_SENT"
    | "OTP_VERIFIED"
    | "CHECKLIST_UPDATED"
    | "PHOTO_UPLOADED"
    | "QC_SUBMITTED"
    | "REWORK_ASSIGNED"
    | "REWORK_COMPLETED"
    | "CUSTOMER_SIGNED"
    | "ATTENTION_REQUESTED"
    | "FEEDBACK_RECORDED"
    | "GOOGLE_REVIEW_CLICKED";
  message: string;
  actorId?: string | null;
  actorName: string;
  actorRole: string;
  createdAt: string;
}

export interface Job {
  id: string; // internal database id (used in URLs)
  /** The ONE readable Job ID shown to people, e.g. "JOB-10245". */
  jobNumber?: string;
  customerId: string;
  propertyId: string;
  serviceId: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTimeSlot: string; // "09:00 AM - 01:00 PM"
  assignedManagerId?: string;
  /** Directly-assigned field workers. The FIRST entry is the lead worker:
   *  they gate the start-work flow once the customer confirms via the secure
   *  link; other assigned workers execute the job without extra control. */
  assignedStaffIds: string[];
  /** Server-resolved display names for assignedStaffIds (attached by the jobs
   *  API; ops_manager/staff cannot read the full user directory). */
  assignedStaffNames?: string[];
  /** Job value — Admin only. The server redacts this field (and
   *  paymentStatus) for ops_manager and staff; treat as optional at runtime. */
  amount?: number;
  paymentStatus?: PaymentStatus;
  status: JobStatus;
  notes?: string;
  accessCode?: string;
  /** Set when the customer confirms team arrival via the secure link
   *  (POST /api/customer/job/[token] action=confirm). Gates IN_PROGRESS. */
  customerConfirmedAt?: string;
  /** Customer digital sign-off written by the secure approval link. */
  approvedAt?: string;
  approvedBy?: string;
  approvalMethod?: string;
  /** Unified-journey feedback captured on the customer's secure link. */
  customerFeedbackRating?: number;
  customerFeedbackAt?: string;
  googleReviewClicked?: boolean;
  qualityCheckId?: string;
  customerApprovalId?: string;
  feedbackId?: string;
  referralAttribution?: {
    partnerId: string;
    referralCode: string;
    commissionEntryId?: string;
  };
  arrivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  customerId: string;
  propertyId: string;
  serviceId: string;
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  validUntil: string;
  status: "draft" | "sent" | "accepted" | "declined" | "converted_to_job";
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  jobId: string;
  customerId: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  dueDate: string;
  status: PaymentStatus;
  issuedAt: string;
  finalizedAt?: string;
  refundedAmount?: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  jobId: string;
  customerId: string;
  amount: number;
  paymentMethod: "card" | "bank_transfer" | "cash" | "upi" | "online_link";
  transactionReference: string;
  status: "completed" | "pending" | "refunded" | "failed";
  paidAt: string;
}

export interface NotificationRecord {
  id: string;
  channel: "whatsapp" | "sms" | "email";
  recipient: string;
  templateType:
    | "booking_confirmation"
    | "otp_verification"
    | "work_started"
    | "work_completed"
    | "qc_pass"
    | "approval_request"
    | "feedback_request"
    | "commission_credited";
  title: string;
  body: string;
  status: "sent" | "delivered" | "failed" | "queued";
  sentAt: string;
}

/**
 * Server SMS gateway dispatch record (from /api/notifications/sms).
 * Recipients are masked server-side; no message bodies are exposed.
 */
export interface SmsGatewayLog {
  id: string;
  jobId: string | null;
  purpose: string; // e.g. CUSTOMER_ARRIVED, QC_READY, REWORK_ASSIGNED, CUSTOMER_COMPLETED
  provider: string;
  status: "QUEUED" | "SENT" | "FAILED";
  error?: string | null;
  recipientMasked: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  performedBy: {
    id: string;
    name: string;
    role: string;
  };
  jobId?: string;
  oldState?: string;
  newState?: string;
  reason?: string;
  details?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

/* ------------------------------------------------------------------------
 * §2 AMC — recurring home-maintenance contracts (NRI-with-elderly-parents
 * use case). Contracts auto-generate visits; a completed visit carries the
 * NRI report (work done, photos, QC, issues, recommendations, next visit).
 * ---------------------------------------------------------------------- */

export type AmcVisitStatus =
  | "SCHEDULED"
  | "REMINDED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "RESCHEDULED";

export interface AmcVisit {
  id: string;
  contractId: string;
  visitNumber: number;
  scheduledDate: string;
  scheduledSlot?: string | null;
  status: AmcVisitStatus;
  jobId?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
  staffIds: string[];
  staffNames?: string[];
  qcScore?: number | null;
  issuesFound?: string | null;
  recommendations?: string | null;
  nriApproved?: boolean | null;
  nriNotes?: string | null;
  reminderSentAt?: string | null;
  createdAt: string;
}

export interface AmcContract {
  id: string;
  contractNumber: string;
  customerId: string;
  propertyId: string;
  serviceId?: string | null;
  customerName?: string | null;
  propertyTitle?: string | null;
  serviceName?: string | null;
  nriContactName?: string | null;
  nriContactPhone?: string | null;
  nriContactEmail?: string | null;
  localContactName?: string | null;
  localContactPhone?: string | null;
  startDate: string;
  endDate: string;
  contractValue: number;
  includedServices: string[];
  visitCount: number;
  frequency: string; // WEEKLY | BIMONTHLY | MONTHLY | QUARTERLY | CUSTOM
  assignedStaffIds: string[];
  assignedStaffNames?: string[];
  emergencyContact?: string | null;
  paymentStatus: "PENDING" | "PARTIAL" | "PAID";
  status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "CANCELLED";
  notes?: string | null;
  createdAt: string;
  visits: AmcVisit[];
}



