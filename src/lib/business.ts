/**
 * Constants and shapes shared by the Expenses, Referrals, HR and Staff
 * Assignment modules — one definition for the API, the database checks and
 * the pages.
 */

export const EXPENSE_CATEGORIES = [
  { key: "CLEANING_SUPPLIES", label: "Cleaning supplies" },
  { key: "EQUIPMENT", label: "Equipment" },
  { key: "TRANSPORTATION", label: "Transportation" },
  { key: "FUEL", label: "Fuel" },
  { key: "STAFF_WAGES", label: "Staff wages" },
  { key: "FREELANCE_PAYMENTS", label: "Freelance staff payments" },
  { key: "MARKETING", label: "Marketing" },
  { key: "OFFICE_EXPENSES", label: "Office expenses" },
  { key: "REPAIRS_MAINTENANCE", label: "Repairs and maintenance" },
  { key: "REFERRAL_BONUSES", label: "Referral bonuses" },
  { key: "OTHER_EXPENSES", label: "Other expenses" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];
export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key) as [ExpenseCategory, ...ExpenseCategory[]];
export const categoryLabel = (k: string) => EXPENSE_CATEGORIES.find((c) => c.key === k)?.label ?? k;

/** Categories that are created by their own workflow (payroll, freelance, referral), never typed in by hand. */
export const SYSTEM_CATEGORIES: ExpenseCategory[] = ["STAFF_WAGES", "FREELANCE_PAYMENTS", "REFERRAL_BONUSES"];

export const PAYMENT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "upi", label: "UPI" },
  { key: "card", label: "Card" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "cheque", label: "Cheque" },
] as const;
export const PAYMENT_METHOD_KEYS = PAYMENT_METHODS.map((m) => m.key) as [string, ...string[]];
export const methodLabel = (k?: string | null) => PAYMENT_METHODS.find((m) => m.key === k)?.label ?? k ?? "—";

export const EMPLOYMENT_TYPES = [
  { key: "PERMANENT", label: "Permanent" },
  { key: "CONTRACT", label: "Contract" },
  { key: "FREELANCE", label: "Freelance" },
] as const;
export const employmentLabel = (k: string) => EMPLOYMENT_TYPES.find((t) => t.key === k)?.label ?? k;

export const PAY_TYPES = [
  { key: "MONTHLY", label: "Monthly salary" },
  { key: "DAILY", label: "Per day" },
  { key: "HOURLY", label: "Per hour" },
  { key: "PER_JOB", label: "Per job" },
] as const;

export const LEAVE_TYPES = [
  { key: "CASUAL", label: "Casual" },
  { key: "SICK", label: "Sick" },
  { key: "PAID", label: "Paid" },
  { key: "UNPAID", label: "Unpaid" },
  { key: "OTHER", label: "Other" },
] as const;

export const ATTENDANCE_STATUSES = [
  { key: "PRESENT", label: "Present" },
  { key: "HALF_DAY", label: "Half day" },
  { key: "ABSENT", label: "Absent" },
  { key: "LEAVE", label: "On leave" },
  { key: "HOLIDAY", label: "Holiday" },
  { key: "WEEKLY_OFF", label: "Weekly off" },
] as const;

export const REFERRAL_STATUSES = [
  { key: "CREATED", label: "Referral created" },
  { key: "CUSTOMER_REGISTERED", label: "Customer registered" },
  { key: "QUALIFYING_JOB_COMPLETED", label: "Qualifying job completed" },
  { key: "BONUS_REVIEW", label: "Bonus review" },
  { key: "APPROVED", label: "Approved" },
  { key: "PAID", label: "Paid" },
  { key: "REJECTED", label: "Rejected" },
  { key: "EXPIRED", label: "Expired" },
] as const;
export const referralStatusLabel = (k: string) => REFERRAL_STATUSES.find((s) => s.key === k)?.label ?? k;

export const FREELANCE_STATUSES = [
  { key: "PENDING_VERIFICATION", label: "Awaiting verification" },
  { key: "VERIFIED", label: "Work verified" },
  { key: "APPROVED", label: "Payment approved" },
  { key: "PAID", label: "Paid" },
  { key: "REJECTED", label: "Rejected" },
] as const;
export const freelanceStatusLabel = (k: string) => FREELANCE_STATUSES.find((s) => s.key === k)?.label ?? k;

/** Upload rules for receipts, bills and HR documents. */
export const UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** Last 10 digits of a phone number — used to recognise the same person twice. */
export const phoneKey = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
};

/* ------------------------------------------------------------------ shapes */

export interface ExpenseRow {
  id: string;
  expenseNumber: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  taxAmount: number;
  paymentMethod: string;
  paidBy: string | null;
  vendor: string | null;
  reference: string | null;
  jobId: string | null;
  jobNumber: string | null;
  employeeId: string | null;
  employeeName: string | null;
  receipt: { id: string; fileName: string; mimeType: string } | null;
  paymentStatus: "PAID" | "PENDING";
  approvalStatus: "APPROVED" | "PENDING_APPROVAL" | "REJECTED";
  notes: string | null;
  source: { type: string; id: string } | null;
  voided: boolean;
  voidReason: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

export interface ReferralRules {
  enabled: boolean;
  bonusType: "FIXED" | "PERCENT";
  bonusValue: number;
  /** Minimum value (before GST) of the qualifying job. */
  minJobValue: number;
  /** The qualifying job's invoice must be fully paid. */
  requirePaid: boolean;
  /** The qualifying job must be completed within this many days of the referral. */
  eligibilityDays: number;
  /** Highest bonus for one referral (0 = no cap). */
  maxBonus: number;
}

export interface ReferralRow {
  id: string;
  referralNumber: string;
  referrerName: string;
  referrerContact: string;
  referrerCustomerId: string | null;
  referredCustomerId: string | null;
  referredName: string;
  referredContact: string;
  referralDate: string;
  source: string;
  qualifyingJobId: string | null;
  qualifyingJobNumber: string | null;
  status: string;
  bonusType: string | null;
  bonusValue: number | null;
  bonusAmount: number | null;
  approvalStatus: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  paymentStatus: string;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  expenseNumber: string | null;
  revenueGenerated: number;
  notes: string | null;
  createdAt: string;
}

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string;
  email: string | null;
  employmentType: string;
  department: string | null;
  designation: string | null;
  joiningDate: string | null;
  status: string;
  managerUserId: string | null;
  managerName: string | null;
  userId: string | null;
  skills: string[];
  serviceCategories: string[];
  availabilityNotes: string | null;
  preferredLocations: string | null;
  verificationStatus: string;
  agreementOnFile: boolean;
  notes: string | null;
  /** Only for hr.sensitive: */
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  payType?: string | null;
  payRate?: number | null;
}

export interface AssignmentRow {
  id: string;
  jobId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employmentType: string;
  phone?: string;
  role: "LEAD" | "MEMBER";
  status: string;
  rateType: string | null;
  rate: number | null;
  expectedHours: number | null;
  actualHours: number | null;
  assignedAt: string;
}
