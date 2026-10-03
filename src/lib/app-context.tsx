"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  User,
  UserRole,
  Customer,
  Property,
  Service,
  Job,
  JobStatus,
  JobChecklistItem,
  JobPhoto,
  QualityCheck,
  QualityIssue,
  ReworkTask,
  Complaint,
  ReferralPartner,
  CommissionRule,
  CommissionEntry,
  Payout,
  Quote,
  Invoice,
  Payment,
  Expense,
  SystemSettings,
  SmsGatewayLog,
} from "./types";
import { DEFAULT_SYSTEM_SETTINGS } from "./initial-config";
import { useAuth } from "./auth-context";

/**
 * Application data layer — the DATABASE is the source of truth.
 *
 * On sign-in, the store hydrates every collection from the server APIs. Every
 * mutating action is a write-through call to the API; local state is updated
 * from the server response so the UI always mirrors persisted data. If a
 * hydration or write fails, the UI shows the error instead of pretending the
 * data was saved.
 */

interface AppContextType {
  currentUser: User;
  currentRole: UserRole;

  systemSettings: SystemSettings;
  updateSystemSettings: (settings: Partial<SystemSettings>) => Promise<{ success: boolean; message: string }>;

  fontSize: "sm" | "md" | "lg" | "xl";
  setFontSize: (size: "sm" | "md" | "lg" | "xl") => void;

  /** True while initial hydration from the database is in flight. */
  loading: boolean;

  // Collections
  users: User[];
  jobs: Job[];
  customers: Customer[];
  properties: Property[];
  services: Service[];
  checklistItems: JobChecklistItem[];
  photos: JobPhoto[];
  qualityChecks: QualityCheck[];
  qualityIssues: QualityIssue[];
  reworkTasks: ReworkTask[];
  complaints: Complaint[];
  partners: ReferralPartner[];
  commissionRules: CommissionRule[];
  commissionEntries: CommissionEntry[];
  payouts: Payout[];
  quotes: Quote[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  smsGatewayLogs: SmsGatewayLog[];

  // Actions
  transitionJobStatus: (
    jobId: string,
    nextStatus: JobStatus,
    overrideNotes?: string
  ) => { success: boolean; message: string };

  /** Re-fetches jobs + checklist from the server (post-write re-sync). */
  refreshJobs: () => Promise<void>;
  /** Re-fetches the customer directory from the server (post-write re-sync). */
  refreshCustomers: () => Promise<void>;
  /** Re-fetches the referral ledger from the server (post-write re-sync; super_admin only). */
  refreshReferrals: () => Promise<void>;
  /** Last server-rejected status transition, for UI error display. */
  transitionError: { jobId: string; message: string } | null;

  sendJobArrivalOTP: (
    jobId: string
  ) => Promise<{ success: boolean; message: string; maskedPhone?: string; cooldownSeconds?: number; devCode?: string }>;

  verifyJobOTP: (
    jobId: string,
    enteredCode: string
  ) => Promise<{ success: boolean; message: string }>;

  resendJobOTP: (
    jobId: string
  ) => Promise<{ success: boolean; message: string; maskedPhone?: string; cooldownSeconds?: number; devCode?: string }>;

  fetchSmsGatewayLog: () => Promise<SmsGatewayLog[]>;

  addJobPhoto: (photo: {
    jobId: string;
    area: string;
    photoType: "before" | "after";
    imageDataUrl: string;
    caption?: string;
  }) => Promise<{ success: boolean; message: string; photo?: JobPhoto }>;

  deleteJobPhoto: (photoId: string) => Promise<{ success: boolean; message: string }>;

  submitQualityCheck: (
    jobId: string,
    score: number,
    decision: "PASS" | "REWORK_REQUIRED",
    notes: string,
    issues: {
      area: string;
      itemDescription: string;
      severity: "minor" | "major" | "critical";
      notes: string;
      assignedStaffId?: string;
    }[]
  ) => Promise<{ success: boolean; message: string }>;

  completeReworkTask: (taskId: string, notes: string) => Promise<{ success: boolean; message: string }>;

  reinspectAndPassQC: (
    jobId: string,
    notes: string
  ) => Promise<{ success: boolean; message: string }>;

  customerApproveJob: (
    jobId: string,
    signature: string
  ) => { success: boolean; message: string };

  customerRequestAttention: (
    jobId: string,
    description: string,
    category: Complaint["category"]
  ) => Promise<{ success: boolean; message: string }>;

  submitCustomerFeedback: (
    jobId: string,
    rating: number,
    tags: string[],
    comment?: string,
    clickedGoogleReview?: boolean,
    portalToken?: string
  ) => Promise<{ success: boolean; message: string }>;

  updateChecklistItem: (
    itemId: string,
    status: "pending" | "completed" | "skipped" | "issue",
    skippedReason?: string,
    issueNotes?: string,
    photoEvidence?: string
  ) => Promise<{ success: boolean; message: string }>;

  createJob: (jobData: {
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    propertyId?: string;
    propertyAddress?: string;
    serviceId: string;
    scheduledDate: string;
    scheduledTimeSlot: string;
    /** Directly-assigned field worker ids; first entry becomes the lead
     *  worker who controls the customer OTP verification flow. */
    assignedStaffIds?: string[];
    notes?: string;
    referralPartnerId?: string;
  }) => Promise<{ success: boolean; message: string; job?: Job }>;

  createCustomer: (customerData: Partial<Customer>) => Promise<{ success: boolean; message: string; customer?: Customer }>;
  updateCustomer: (
    id: string,
    updates: Omit<Partial<Customer>, "referralPartnerId"> & { referralPartnerId?: string | null }
  ) => Promise<{ success: boolean; message: string; customer?: Customer }>;
  deleteCustomer: (id: string) => Promise<{ success: boolean; message: string }>;
  createProperty: (propertyData: Partial<Property>) => Promise<{ success: boolean; message: string; property?: Property }>;
  updateProperty: (id: string, updates: Partial<Property>) => Promise<{ success: boolean; message: string; property?: Property }>;
  deleteProperty: (id: string) => Promise<{ success: boolean; message: string }>;
  createPartner: (partnerData: Partial<ReferralPartner>) => Promise<{ success: boolean; message: string; partner?: ReferralPartner }>;
  updatePartner: (
    id: string,
    updates: Omit<Partial<ReferralPartner>, "commissionRuleId"> & { commissionRuleId?: string | null }
  ) => Promise<{ success: boolean; message: string; partner?: ReferralPartner }>;
  deletePartner: (id: string) => Promise<{ success: boolean; message: string }>;
  createCommissionRule: (rule: Partial<CommissionRule>) => Promise<{ success: boolean; message: string; rule?: CommissionRule }>;
  updateCommissionRule: (id: string, updates: Partial<CommissionRule>) => Promise<{ success: boolean; message: string }>;
  deleteCommissionRule: (id: string) => Promise<{ success: boolean; message: string }>;
  approveCommissionEntry: (id: string) => Promise<{ success: boolean; message: string }>;
  createPayout: (
    partnerId: string,
    amount: number,
    method: Payout["payoutMethod"],
    referenceNumber: string,
    notes?: string
  ) => Promise<{ success: boolean; message: string; payout?: Payout }>;
  recordPayment: (
    invoiceId: string,
    amount: number,
    method: Payment["paymentMethod"],
    reference: string
  ) => Promise<{ success: boolean; message: string }>;

  createExpense: (expense: Omit<Expense, "id" | "createdAt" | "createdBy">) => Promise<{ success: boolean; message: string }>;
  deleteExpense: (id: string) => Promise<{ success: boolean; message: string }>;
  createQuote: (quote: {
    customerId: string;
    propertyId: string;
    serviceId: string;
    items: { description: string; quantity: number; unitPrice: number }[];
    validUntil: string;
  }) => Promise<{ success: boolean; message: string }>;
  convertQuoteToInvoice: (
    quoteId: string,
    schedule?: { scheduledDate: string; scheduledTimeSlot: string }
  ) => Promise<{ success: boolean; message: string; jobId?: string }>;
  convertQuoteToJob: (quoteId: string) => Promise<{ success: boolean; message: string }>;
  deleteQuote: (id: string) => Promise<{ success: boolean; message: string }>;
  assignStaffToJob: (jobId: string, staffIds: string[]) => Promise<{ success: boolean; message: string }>;
  /** Assignment-scoped roster of active field workers (PUT /api/users), visible
   *  to both super_admin and ops_manager — backs the dispatcher tower and the
   *  job-console staff-assignment modal. */
  fetchStaffDirectory: () => Promise<void>;

  // Service Package Management (DB-backed; companies author everything)
  createService: (serviceData: Omit<Service, "id">) => Promise<{ success: boolean; message: string; service?: Service }>;
  updateService: (id: string, updates: Partial<Service>) => Promise<{ success: boolean; message: string }>;
  deleteService: (id: string) => Promise<{ success: boolean; message: string }>;
  addChecklistItemToService: (
    serviceId: string,
    item: { area: string; task: string; critical: boolean }
  ) => Promise<{ success: boolean; message: string }>;
  removeChecklistItemFromService: (serviceId: string, itemId: string) => Promise<{ success: boolean; message: string }>;

  // User & Staff Management (database-backed via /api/users)
  addUser: (userData: {
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    password: string;
  }) => Promise<{ success: boolean; message: string }>;
  updateUser: (
    id: string,
    updates: { name?: string; phone?: string; role?: UserRole; active?: boolean; password?: string }
  ) => Promise<{ success: boolean; message: string }>;
  toggleUserStatus: (id: string) => Promise<void>;
  deleteUser: (id: string) => Promise<{ success: boolean; message: string }>;

  /** Secure handover link minting (server-side). linkUrl is the fully-qualified
   *  shareable URL resolved server-side; linkPath is the relative fallback. */
  sendCompletionLink: (
    jobId: string
  ) => Promise<{ success: boolean; message: string; linkPath?: string; linkUrl?: string }>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

/** Standard API response envelope. */
type ApiEnvelope<T> = { success: boolean; data?: T; error?: string };

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!res.ok || !json?.success) {
      return { ok: false, error: json?.error || `Request failed (${res.status})`, status: res.status };
    }
    return { ok: true, data: json.data, status: res.status };
  } catch {
    return { ok: false, error: "Network error. Check your connection and retry.", status: 0 };
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  // Signed-in identity is owned by AuthProvider (server session via cookie).
  const { currentUser: authUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS);
  const [fontSize, setFontSizeState] = useState<"sm" | "md" | "lg" | "xl">("md");

  // Collections — all hydrated from the database, never seeded client-side.
  const [users, setUsers] = useState<User[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [checklistItems, setChecklistItems] = useState<JobChecklistItem[]>([]);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [qualityChecks, setQualityChecks] = useState<QualityCheck[]>([]);
  const [qualityIssues, setQualityIssues] = useState<QualityIssue[]>([]);
  const [reworkTasks, setReworkTasks] = useState<ReworkTask[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [partners, setPartners] = useState<ReferralPartner[]>([]);
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([]);
  const [commissionEntries, setCommissionEntries] = useState<CommissionEntry[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [smsGatewayLogs, setSmsGatewayLogs] = useState<SmsGatewayLog[]>([]);
  /** Last rejected transition (jobId + server message) surfaced to the UI. */
  const [transitionError, setTransitionError] = useState<{ jobId: string; message: string } | null>(null);

  const setFontSize = (size: "sm" | "md" | "lg" | "xl") => {
    setFontSizeState(size);
    try {
      localStorage.setItem("intense_font_size", size);
    } catch (e) {}
  };

  const currentUser: User = authUser || {
    id: "system",
    name: "System",
    email: "system@local",
    phone: "",
    role: "super_admin",
    active: true,
    createdAt: new Date().toISOString(),
  };
  const currentRole = currentUser.role;

  // --- Hydration: the database is the single source of truth ----------------
  const hydrate = useCallback(async () => {
    if (!authUser) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const isManager = authUser.role === "super_admin" || authUser.role === "ops_manager";
    const parallel: Promise<void>[] = [];

    // Settings: any signed-in user may read.
    parallel.push(
      api<SystemSettings>("/api/settings").then((r) => {
        if (r.ok && r.data) setSystemSettings({ ...DEFAULT_SYSTEM_SETTINGS, ...r.data });
      })
    );

    // Services: staff see active only; managers/admins all.
    parallel.push(
      api<Service[]>("/api/services").then((r) => {
        if (r.ok && r.data) setServices(r.data);
      })
    );

    // Jobs: role-scoped server-side (staff → assigned only).
    parallel.push(
      api<Job[]>("/api/jobs").then((r) => {
        if (r.ok && r.data) setJobs(r.data);
      })
    );

    if (isManager) {
      parallel.push(
        api<Customer[]>("/api/customers").then((r) => {
          if (r.ok && r.data) setCustomers(r.data);
        })
      );
      parallel.push(
        api<Property[]>("/api/properties").then((r) => {
          if (r.ok && r.data) setProperties(r.data);
        })
      );
      parallel.push(
        api<User[]>("/api/users").then((r) => {
          if (r.ok && r.data) setUsers(r.data);
        })
      );
      parallel.push(
        api<{
          partners: ReferralPartner[];
          commissionRules: CommissionRule[];
          commissionEntries: CommissionEntry[];
          payouts: Payout[];
        }>("/api/referrals").then((r) => {
          if (r.ok && r.data) {
            setPartners(r.data.partners);
            setCommissionRules(r.data.commissionRules);
            setCommissionEntries(r.data.commissionEntries);
            setPayouts(r.data.payouts);
          }
        })
      );
      parallel.push(
        api<{ invoices: Invoice[]; payments: Payment[]; expenses: Expense[]; quotes: Quote[] }>("/api/finance").then((r) => {
          if (r.ok && r.data) {
            setInvoices(r.data.invoices);
            setPayments(r.data.payments);
            setExpenses(r.data.expenses);
            setQuotes(r.data.quotes);
          }
        })
      );
    }

    // Photos: hydrated from the DB (Cloudinary-backed).
    parallel.push(
      api<JobPhoto[]>("/api/photos").then((r) => {
        if (r.ok && r.data) setPhotos(r.data);
      })
    );

    // Quality records (staff-scoped server-side).
    parallel.push(
      api<{
        qualityChecks: QualityCheck[];
        qualityIssues: QualityIssue[];
        reworkTasks: ReworkTask[];
        complaints: Complaint[];
      }>("/api/quality").then((r) => {
        if (r.ok && r.data) {
          setQualityChecks(r.data.qualityChecks);
          setQualityIssues(r.data.qualityIssues);
          setReworkTasks(r.data.reworkTasks);
          setComplaints(r.data.complaints);
        }
      })
    );

    await Promise.allSettled(parallel);
    setLoading(false);
  }, [authUser]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Checklist items hydrate once per session from the DB (role-scoped).
  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    (async () => {
      const r = await api<JobChecklistItem[]>("/api/checklist");
      if (!cancelled && r.ok && r.data) setChecklistItems(r.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  // Font size restoration
  useEffect(() => {
    try {
      const saved = localStorage.getItem("intense_font_size") as "sm" | "md" | "lg" | "xl" | null;
      if (saved && ["sm", "md", "lg", "xl"].includes(saved)) {
        setFontSizeState(saved);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("font-scale-sm", "font-scale-md", "font-scale-lg", "font-scale-xl");
    root.classList.add(`font-scale-${fontSize}`);
  }, [fontSize]);

  // --- Audit (server-side, best-effort) -------------------------------------
  const logAudit = async (
    entityType: string,
    entityId: string,
    action: string,
    details?: string
  ) => {
    try {
      await api("/api/audit", {
        method: "POST",
        body: JSON.stringify({ action: "status-audit", entityType, entityId, auditAction: action, details }),
      });
    } catch (e) {
      // Audit is best-effort; never blocks the operation.
    }
  };

  // --- Job lifecycle ---------------------------------------------------------
  /** Re-fetches the role-scoped job list and checklist from the server. */
  const refreshJobs = useCallback(async () => {
    const r = await api<Job[]>("/api/jobs");
    if (r.ok && r.data) setJobs(r.data);
    const c = await api<JobChecklistItem[]>("/api/checklist");
    if (c.ok && c.data) setChecklistItems(c.data);
  }, []);

  /**
   * Re-fetches the customer directory (post-write re-sync). Managers only —
   * staff get a silent 403 no-op. Keeps lifetime revenue, booking totals and
   * attribution in step after finance/job writes that touch customer rows.
   */
  const refreshCustomers = useCallback(async () => {
    const r = await api<Customer[]>("/api/customers");
    if (r.ok && r.data) setCustomers(r.data);
  }, []);

  /**
   * Re-fetches the referral ledger (partners, rules, commission entries,
   * payouts). Super_admin only at the API boundary — other roles get a 403
   * that fails silently, making it safe to call after any server-side write
   * that may have settled a commission (e.g. job completion).
   */
  const refreshReferrals = useCallback(async () => {
    const r = await api<{
      partners: ReferralPartner[];
      commissionRules: CommissionRule[];
      commissionEntries: CommissionEntry[];
      payouts: Payout[];
    }>("/api/referrals");
    if (r.ok && r.data) {
      setPartners(r.data.partners);
      setCommissionRules(r.data.commissionRules);
      setCommissionEntries(r.data.commissionEntries);
      setPayouts(r.data.payouts);
    }
  }, []);

  const transitionJobStatus = (
    jobId: string,
    nextStatus: JobStatus,
    overrideNotes?: string
  ): { success: boolean; message: string } => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return { success: false, message: "Job not found" };

    // Optimistic local update; the server PATCH is the authority for staff
    // transitions (it re-validates the state machine and OTP gates).
    const now = new Date().toISOString();
    const updatedJob: Job = {
      ...job,
      status: nextStatus,
      updatedAt: now,
      arrivedAt: nextStatus === "ARRIVED" ? now : job.arrivedAt,
      startedAt: nextStatus === "IN_PROGRESS" ? now : job.startedAt,
      completedAt: nextStatus === "WORK_COMPLETED" ? now : job.completedAt,
    };
    setJobs((prev) => prev.map((j) => (j.id === jobId ? updatedJob : j)));

    void (async () => {
      const r = await api<Job>(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!r.ok) {
        // Roll back on server rejection (e.g. OTP gate, visibility window) and
        // surface the authoritative error instead of a fake success.
        setJobs((prev) => prev.map((j) => (j.id === jobId ? job : j)));
        setTransitionError({ jobId, message: r.error || "Transition rejected by the server." });
        return;
      }
      setTransitionError(null);
      await logAudit("job", jobId, "STATUS_TRANSITION", `→ ${nextStatus}${overrideNotes ? `: ${overrideNotes}` : ""}`);

      // Re-sync from the server so status, timestamps and OTP state stay
      // authoritative (also refreshes other viewers of the same job). Also
      // re-sync the referral ledger: completing an attributed job settles a
      // commission entry server-side, and the ledger/partner counters must
      // reflect that immediately (a no-op 403 for staff/managers-without-access).
      void refreshJobs();
      void refreshReferrals();
    })();

    return { success: true, message: `Job transitioned to ${nextStatus}` };
  };

  // --- Server-authoritative OTP flows (2Factor SMS) --------------------------
  const sendJobArrivalOTP = async (
    jobId: string
  ): Promise<{ success: boolean; message: string; maskedPhone?: string; cooldownSeconds?: number; devCode?: string }> => {
    const r = await api<{
      maskedPhone: string;
      cooldownSeconds?: number;
      sentVia?: string;
      devCode?: string;
    }>("/api/otp/send", {
      method: "POST",
      body: JSON.stringify({ jobId }),
    });
    if (!r.ok) return { success: false, message: r.error || "OTP dispatch failed. Please retry." };
    if (r.data?.devCode) {
      // Dev mode (OTP_DEV_MODE=1): no SMS was sent; the code comes back inline.
      return {
        success: true,
        message: `DEV MODE: OTP is ${r.data.devCode} — no SMS was sent.`,
        maskedPhone: r.data?.maskedPhone,
        cooldownSeconds: r.data?.cooldownSeconds,
        devCode: r.data.devCode,
      };
    }
    await logAudit("otp", jobId, "OTP_SENT", `Arrival OTP dispatched via 2Factor SMS to ${r.data?.maskedPhone}`);
    return {
      success: true,
      message: `OTP sent via SMS to ${r.data?.maskedPhone}.`,
      maskedPhone: r.data?.maskedPhone,
      cooldownSeconds: r.data?.cooldownSeconds,
    };
  };

  const verifyJobOTP = async (
    jobId: string,
    enteredCode: string
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api<{ verifiedAt?: string }>("/api/otp/verify", {
      method: "POST",
      body: JSON.stringify({ jobId, code: enteredCode.trim() }),
    });
    if (!r.ok) {
      await logAudit("otp", jobId, "OTP_VERIFICATION_FAILED", r.error);
      return { success: false, message: r.error || "Verification failed. Please retry." };
    }
    const now = new Date().toISOString();
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: "CUSTOMER_VERIFIED",
              otpVerification: {
                ...j.otpVerification,
                status: "verified",
                verifiedAt: r.data?.verifiedAt || now,
                verifiedBy: currentUser.id,
              },
              updatedAt: now,
            }
          : j
      )
    );
    await logAudit("otp", jobId, "OTP_VERIFIED", "Customer OTP verified (server-side)");
    // Re-sync in the background so other viewers see the verified state too.
    void refreshJobs();
    return { success: true, message: "Customer OTP verified successfully! You may now begin work." };
  };

  const resendJobOTP = async (
    jobId: string
  ): Promise<{ success: boolean; message: string; maskedPhone?: string; cooldownSeconds?: number; devCode?: string }> => {
    const r = await api<{
      maskedPhone: string;
      cooldownSeconds?: number;
      sentVia?: string;
      devCode?: string;
    }>("/api/otp/resend", {
      method: "POST",
      body: JSON.stringify({ jobId }),
    });
    if (!r.ok) return { success: false, message: r.error || "OTP resend failed. Please retry." };
    if (r.data?.devCode) {
      return {
        success: true,
        message: `DEV MODE: new OTP is ${r.data.devCode} — no SMS was sent.`,
        maskedPhone: r.data?.maskedPhone,
        cooldownSeconds: r.data?.cooldownSeconds,
        devCode: r.data.devCode,
      };
    }
    await logAudit("otp", jobId, "OTP_RESENT", `Fresh OTP dispatched via 2Factor SMS to ${r.data?.maskedPhone}`);
    return {
      success: true,
      message: `New OTP sent via SMS to ${r.data?.maskedPhone}.`,
      maskedPhone: r.data?.maskedPhone,
      cooldownSeconds: r.data?.cooldownSeconds,
    };
  };

  const fetchSmsGatewayLog = async (): Promise<SmsGatewayLog[]> => {
    const r = await api<SmsGatewayLog[]>("/api/notifications/sms");
    if (r.ok && r.data) {
      setSmsGatewayLogs(r.data);
      return r.data;
    }
    return [];
  };

  // --- Photos (Cloudinary + DB) ----------------------------------------------
  const addJobPhoto = async (photo: {
    jobId: string;
    area: string;
    photoType: "before" | "after";
    imageDataUrl: string;
    caption?: string;
  }): Promise<{ success: boolean; message: string; photo?: JobPhoto }> => {
    const r = await api<JobPhoto>("/api/photos", {
      method: "POST",
      body: JSON.stringify({
        jobId: photo.jobId,
        area: photo.area,
        photoType: photo.photoType,
        image: photo.imageDataUrl,
        caption: photo.caption,
      }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Photo upload failed." };
    setPhotos((prev) => [r.data as JobPhoto, ...prev]);
    await logAudit("job", photo.jobId, "PHOTO_UPLOADED", `${photo.photoType.toUpperCase()} photo for ${photo.area}`);
    return { success: true, message: "Photo uploaded.", photo: r.data };
  };

  const deleteJobPhoto = async (photoId: string): Promise<{ success: boolean; message: string }> => {
    const r = await api(`/api/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
    if (!r.ok) return { success: false, message: r.error || "Photo deletion failed." };
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    return { success: true, message: "Photo deleted." };
  };

  // --- Quality lifecycle ------------------------------------------------------
  const submitQualityCheck = async (
    jobId: string,
    score: number,
    decision: "PASS" | "REWORK_REQUIRED",
    notes: string,
    issues: {
      area: string;
      itemDescription: string;
      severity: "minor" | "major" | "critical";
      notes: string;
      assignedStaffId?: string;
    }[]
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api<QualityCheck>("/api/quality", {
      method: "POST",
      body: JSON.stringify({ action: "submit-check", jobId, score, decision, notes, issues }),
    });
    if (!r.ok) return { success: false, message: r.error || "QC submission failed." };

    // Refresh quality collections from the server.
    const qr = await api<{
      qualityChecks: QualityCheck[];
      qualityIssues: QualityIssue[];
      reworkTasks: ReworkTask[];
      complaints: Complaint[];
    }>("/api/quality");
    if (qr.ok && qr.data) {
      setQualityChecks(qr.data.qualityChecks);
      setQualityIssues(qr.data.qualityIssues);
      setReworkTasks(qr.data.reworkTasks);
      setComplaints(qr.data.complaints);
    }
    // Mirror the job status change the server made.
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? { ...j, status: decision === "PASS" ? "CUSTOMER_APPROVAL" : "REWORK_REQUIRED", qualityCheckId: r.data?.id }
          : j
      )
    );

    if (decision === "PASS") {
      const link = await sendCompletionLink(jobId);
      return {
        success: true,
        message: `QC Audit Passed (${score}%).${link.success ? " Secure handover link generated on the job file." : ""}`,
      };
    }
    return { success: true, message: `QC Audit completed. Rework required with ${issues.length} tasks.` };
  };

  const completeReworkTask = async (
    taskId: string,
    notes: string
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api("/api/quality", {
      method: "POST",
      body: JSON.stringify({ action: "complete-rework", taskId, notes }),
    });
    if (!r.ok) return { success: false, message: r.error || "Rework completion failed." };
    setReworkTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: "completed", completedAt: new Date().toISOString(), completedNotes: notes }
          : t
      )
    );
    setQualityIssues((prev) =>
      prev.map((i) => (i.reworkTaskId === taskId ? { ...i, status: "resolved", resolvedAt: new Date().toISOString() } : i))
    );
    await logAudit("rework", taskId, "REWORK_TASK_COMPLETED", notes);
    return { success: true, message: "Rework task completed." };
  };

  const reinspectAndPassQC = async (
    jobId: string,
    notes: string
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api("/api/quality", {
      method: "POST",
      body: JSON.stringify({ action: "reinspect-pass", jobId, notes }),
    });
    if (!r.ok) return { success: false, message: r.error || "Reinspection failed." };
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: "CUSTOMER_APPROVAL" } : j)));
    setQualityIssues((prev) =>
      prev.map((i) =>
        i.jobId === jobId && i.status !== "resolved" && i.status !== "reinspected_pass"
          ? { ...i, status: "reinspected_pass", resolvedAt: new Date().toISOString() }
          : i
      )
    );
    await logAudit("qc", jobId, "QC_REINSPECTION_PASSED", notes);
    const link = await sendCompletionLink(jobId);
    return {
      success: true,
      message: `Reinspection passed!${link.success ? " Secure handover link generated on the job file." : ""}`,
    };
  };

  const customerApproveJob = (
    jobId: string,
    signature: string
  ): { success: boolean; message: string } => {
    return transitionJobStatus(jobId, "COMPLETED", "Customer digitally signed and approved completion");
  };

  const customerRequestAttention = async (
    jobId: string,
    description: string,
    category: Complaint["category"]
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api<Complaint>("/api/quality", {
      method: "POST",
      body: JSON.stringify({ action: "request-attention", jobId, description, category }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not record the request." };
    setComplaints((prev) => [r.data as Complaint, ...prev]);
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: "REWORK_REQUIRED" } : j)));
    await logAudit("customer", jobId, "ATTENTION_REQUESTED", description);
    return { success: true, message: "Attention requested. Operations is notified." };
  };

  const submitCustomerFeedback = async (
    jobId: string,
    rating: number,
    tags: string[],
    comment?: string,
    clickedGoogleReview: boolean = false,
    portalToken?: string
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        token: portalToken,
        rating,
        tags,
        comment: comment || undefined,
        googleReviewClicked: clickedGoogleReview,
      }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not record feedback." };
    await logAudit("customer", jobId, "FEEDBACK_SUBMITTED", `Rating: ${rating}/5. ${comment || ""}`);
    return { success: true, message: "Feedback recorded." };
  };

  // --- Checklist ---------------------------------------------------------------
  const updateChecklistItem = async (
    itemId: string,
    status: "pending" | "completed" | "skipped" | "issue",
    skippedReason?: string,
    issueNotes?: string,
    photoEvidence?: string
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api<{ id: string; status: string }>("/api/quality", {
      method: "PATCH",
      body: JSON.stringify({ itemId, status, skippedReason, issueNotes, photoEvidence }),
    });
    if (!r.ok) return { success: false, message: r.error || "Checklist update failed." };
    setChecklistItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status,
              skippedReason: skippedReason || item.skippedReason,
              issueNotes: issueNotes || item.issueNotes,
              photoEvidence: photoEvidence || item.photoEvidence,
              completedBy: status === "completed" ? currentUser.name : item.completedBy,
              completedAt: status === "completed" ? new Date().toISOString() : item.completedAt,
            }
          : item
      )
    );
    return { success: true, message: "Checklist updated." };
  };

  // --- Completion link ----------------------------------------------------------
  const sendCompletionLink = async (
    jobId: string
  ): Promise<{ success: boolean; message: string; linkPath?: string; linkUrl?: string }> => {
    const r = await api<{ linkPath: string; linkUrl?: string }>(`/api/jobs/${encodeURIComponent(jobId)}/completion-link`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!r.ok) return { success: false, message: r.error || "Link generation failed." };
    await logAudit("customer", jobId, "COMPLETION_LINK_GENERATED", "Secure handover link generated.");
    return {
      success: true,
      message: "Secure link generated. Copy and share it with the customer.",
      linkPath: r.data?.linkPath,
      linkUrl: r.data?.linkUrl,
    };
  };

  // --- Jobs ----------------------------------------------------------------------
  const createJob = async (jobData: {
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    propertyId?: string;
    propertyAddress?: string;
    serviceId: string;
    scheduledDate: string;
    scheduledTimeSlot: string;
    assignedStaffIds?: string[];
    notes?: string;
    referralPartnerId?: string;
  }): Promise<{ success: boolean; message: string; job?: Job }> => {
    const r = await api<{
      job: Job & { customerName?: string; customerPhone?: string; propertyTitle?: string; service?: Job extends never ? never : { id: string; name: string; basePrice: number; estimatedDurationHours: number } };
      invoice: Invoice;
      checklist: JobChecklistItem[];
    }>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(jobData),
    });
    if (!r.ok || !r.data?.job) return { success: false, message: r.error || "Booking failed." };

    const createdJob = r.data.job as Job;
    setJobs((prev) => [createdJob, ...prev]);
    if (r.data.invoice) setInvoices((prev) => [r.data!.invoice as Invoice, ...prev]);
    if (r.data.checklist) setChecklistItems((prev) => [...r.data!.checklist, ...prev]);
    if (jobData.referralPartnerId) {
      const partner = partners.find((p) => p.id === jobData.referralPartnerId);
      if (partner) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === createdJob.id
              ? { ...j, referralAttribution: { partnerId: partner.id, referralCode: partner.code } }
              : j
          )
        );
      }
    }
    await logAudit("job", createdJob.id, "JOB_CREATED", `Booking created (${createdJob.status})`);
    // The server incremented the customer's booking total — re-sync the
    // directory so lifetime counters stay accurate without a manual refresh.
    void refreshCustomers();
    return { success: true, message: "Booking created.", job: createdJob };
  };

  const assignStaffToJob = async (
    jobId: string,
    staffIds: string[]
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api(`/api/jobs/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      body: JSON.stringify({ assignedStaffIds: staffIds }),
    });
    if (!r.ok) return { success: false, message: r.error || "Assignment failed." };
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              assignedStaffIds: staffIds,
              status:
                staffIds.length > 0 && (j.status === "SCHEDULED" || j.status === "DRAFT")
                  ? "ASSIGNED"
                  : j.status,
              updatedAt: new Date().toISOString(),
            }
          : j
      )
    );
    await logAudit("job", jobId, "STAFF_ASSIGNED", `${staffIds.length} worker(s) assigned`);
    return { success: true, message: "Assignment saved." };
  };

  /**
   * Hydrates the assignment-scoped field-worker roster (PUT /api/users —
   * semantic GET, allowed for super_admin AND ops_manager). Ops managers cannot
   * read the full /api/users directory, so the dispatcher tower and the
   * job-console assignment modal call this to resolve worker names/phones.
   * Merges into the users store without clobbering existing hydrated users.
   */
  const fetchStaffDirectory = useCallback(async () => {
    const r = await api<Array<Pick<User, "id" | "name" | "phone" | "active">>>("/api/users", {
      method: "PUT",
    });
    if (!r.ok || !r.data) return;
    const staff = r.data;
    setUsers((prev) => {
      const known = new Set(prev.map((u) => u.id));
      const additions = staff.filter((s) => !known.has(s.id));
      if (additions.length === 0) return prev;
      return [
        ...prev,
        ...additions.map((s) => ({
          id: s.id,
          name: s.name,
          email: "",
          phone: s.phone || "",
          role: "staff" as const,
          active: s.active !== false,
          createdAt: "",
        })),
      ];
    });
  }, []);

  // --- Customers & properties -----------------------------------------------------
  const createCustomer = async (customerData: Partial<Customer>) => {
    const r = await api<Customer>("/api/customers", {
      method: "POST",
      body: JSON.stringify({
        name: customerData.name,
        phone: customerData.phone,
        email: customerData.email || "",
        address: customerData.address || "",
        notes: customerData.notes,
        source: customerData.source || "direct",
        referralPartnerId: customerData.referralPartnerId,
      }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not create the customer." };
    setCustomers((prev) => [r.data as Customer, ...prev]);
    await logAudit("customer", r.data.id, "CUSTOMER_CREATED", `Customer ${r.data.name} registered`);
    return { success: true, message: "Customer created.", customer: r.data };
  };

  const updateCustomer = async (
    id: string,
    updates: Omit<Partial<Customer>, "referralPartnerId"> & { referralPartnerId?: string | null }
  ) => {
    const r = await api<Customer>("/api/customers", {
      method: "PATCH",
      body: JSON.stringify({ id, ...updates }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not update the customer." };
    setCustomers((prev) => prev.map((c) => (c.id === id ? (r.data as Customer) : c)));
    await logAudit("customer", id, "CUSTOMER_UPDATED", `Customer ${r.data.name} updated`);
    // Re-attribution moves a lead between partners server-side (counters +
    // code) — re-sync the referral ledger so the directory stays honest.
    if (Object.prototype.hasOwnProperty.call(updates, "referralPartnerId")) {
      void refreshReferrals();
    }
    return { success: true, message: "Customer updated.", customer: r.data };
  };

  const deleteCustomer = async (id: string) => {
    const target = customers.find((c) => c.id === id);
    const r = await api<{ deleted?: boolean }>("/api/customers", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not delete the customer." };
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    // The DB cascades the customer's property records — mirror that locally so
    // the Properties page doesn't show ghost properties until a refresh.
    setProperties((prev) => prev.filter((p) => p.customerId !== id));
    // The server decremented the partner's lead counter — re-sync the ledger.
    if (target?.referralPartnerId) void refreshReferrals();
    await logAudit("customer", id, "CUSTOMER_DELETED", "Customer record deleted");
    return { success: true, message: "Customer deleted." };
  };

  const createProperty = async (propertyData: Partial<Property>) => {
    const r = await api<Property>("/api/properties", {
      method: "POST",
      body: JSON.stringify({
        customerId: propertyData.customerId,
        title: propertyData.title,
        address: propertyData.address,
        propertyType: propertyData.propertyType,
        city: propertyData.city,
        postalCode: propertyData.postalCode,
        bedrooms: propertyData.bedrooms,
        bathrooms: propertyData.bathrooms,
        carpetAreaSqFt: propertyData.carpetAreaSqFt,
        accessNotes: propertyData.accessNotes,
        parkingInstructions: propertyData.parkingInstructions,
        preferredTime: propertyData.preferredTime,
        recurringService: propertyData.recurringService,
        recurringFrequency: propertyData.recurringFrequency,
      }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not create the property." };
    setProperties((prev) => [r.data as Property, ...prev]);
    return { success: true, message: "Property created.", property: r.data };
  };

  const updateProperty = async (id: string, updates: Partial<Property>) => {
    const r = await api<Property>("/api/properties", {
      method: "PATCH",
      body: JSON.stringify({ id, ...updates }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not update the property." };
    setProperties((prev) => prev.map((p) => (p.id === id ? (r.data as Property) : p)));
    return { success: true, message: "Property updated.", property: r.data };
  };

  const deleteProperty = async (id: string) => {
    const r = await api("/api/properties", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not delete the property." };
    setProperties((prev) => prev.filter((p) => p.id !== id));
    return { success: true, message: "Property deleted." };
  };

  // --- Referrals --------------------------------------------------------------------
  const createPartner = async (partnerData: Partial<ReferralPartner>) => {
    const r = await api<ReferralPartner>("/api/referrals", {
      method: "POST",
      body: JSON.stringify({
        action: "create-partner",
        name: partnerData.name,
        partnerType: partnerData.partnerType,
        email: partnerData.email,
        phone: partnerData.phone,
        code: partnerData.code,
        commissionRuleId: partnerData.commissionRuleId || undefined,
      }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not register the partner." };
    setPartners((prev) => [r.data as ReferralPartner, ...prev]);
    await logAudit("customer", r.data.id, "PARTNER_REGISTERED", `Partner ${r.data.name} (Code: ${r.data.code})`);
    return { success: true, message: "Partner registered.", partner: r.data };
  };

  const updatePartner = async (
    id: string,
    updates: Omit<Partial<ReferralPartner>, "commissionRuleId"> & { commissionRuleId?: string | null }
  ) => {
    const r = await api<ReferralPartner>("/api/referrals", {
      method: "POST",
      body: JSON.stringify({ action: "update-partner", id, ...updates }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Partner update failed." };
    setPartners((prev) => prev.map((p) => (p.id === id ? (r.data as ReferralPartner) : p)));
    await logAudit("customer", id, "PARTNER_UPDATED", "Referral partner details updated");
    return { success: true, message: "Partner updated.", partner: r.data };
  };

  const deletePartner = async (id: string) => {
    const r = await api("/api/referrals", {
      method: "POST",
      body: JSON.stringify({ action: "delete-partner", id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not delete the partner." };
    setPartners((prev) => prev.filter((p) => p.id !== id));
    // The server detaches customer attribution in the DB; mirror it locally.
    setCustomers((prev) =>
      prev.map((c) =>
        c.referralPartnerId === id ? { ...c, referralPartnerId: undefined, referralCode: undefined } : c
      )
    );
    await logAudit("customer", id, "PARTNER_DELETED", "Referral partner deleted");
    return { success: true, message: "Partner deleted." };
  };

  const createCommissionRule = async (rule: Partial<CommissionRule>) => {
    const r = await api<CommissionRule>("/api/referrals", {
      method: "POST",
      body: JSON.stringify({
        action: "create-rule",
        name: rule.name,
        partnerType: rule.partnerType,
        calculationType: rule.calculationType,
        value: rule.value,
        isDefault: false,
        active: true,
      }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not create the rule." };
    setCommissionRules((prev) => [...prev, r.data as CommissionRule]);
    await logAudit("commission", r.data.id, "RULE_CREATED", `Rule ${r.data.name} created`);
    return { success: true, message: "Rule created.", rule: r.data };
  };

  const updateCommissionRule = async (id: string, updates: Partial<CommissionRule>) => {
    const r = await api("/api/referrals", {
      method: "POST",
      body: JSON.stringify({ action: "update-rule", id, ...updates }),
    });
    if (!r.ok) return { success: false, message: r.error || "Rule update failed." };
    setCommissionRules((prev) => prev.map((x) => (x.id === id ? { ...x, ...updates } : x)));
    await logAudit("commission", id, "RULE_UPDATED", "Commission rule updated");
    return { success: true, message: "Rule updated." };
  };

  const deleteCommissionRule = async (id: string) => {
    const r = await api("/api/referrals", {
      method: "POST",
      body: JSON.stringify({ action: "delete-rule", id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not delete the rule." };
    setCommissionRules((prev) => prev.filter((rule) => rule.id !== id));
    await logAudit("commission", id, "RULE_DELETED", "Commission rule deleted");
    return { success: true, message: "Rule deleted." };
  };

  const approveCommissionEntry = async (id: string) => {
    const r = await api("/api/referrals", {
      method: "POST",
      body: JSON.stringify({ action: "approve-entry", id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Approval failed." };
    setCommissionEntries((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "APPROVED", approvedAt: new Date().toISOString() } : c))
    );
    await logAudit("commission", id, "COMMISSION_APPROVED", "Approved for next payout batch");
    return { success: true, message: "Commission approved." };
  };

  const createPayout = async (
    partnerId: string,
    amount: number,
    method: Payout["payoutMethod"],
    referenceNumber: string,
    notes?: string
  ) => {
    const r = await api<Payout>("/api/referrals", {
      method: "POST",
      body: JSON.stringify({ action: "create-payout", partnerId, amount, payoutMethod: method, referenceNumber, notes }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Payout failed." };
    setPayouts((prev) => [r.data as Payout, ...prev]);
    setPartners((prev) =>
      prev.map((p) =>
        p.id === partnerId
          ? {
              ...p,
              totalCommissionPaid: p.totalCommissionPaid + amount,
              totalCommissionPending: Math.max(0, p.totalCommissionPending - amount),
            }
          : p
      )
    );
    setCommissionEntries((prev) =>
      prev.map((c) => (c.partnerId === partnerId && c.status === "APPROVED" ? { ...c, status: "PAID" } : c))
    );
    await logAudit("commission", r.data.id, "PAYOUT_COMPLETED", `Payout of ₹${amount} issued`);
    return { success: true, message: "Payout recorded.", payout: r.data };
  };

  // --- Finance -------------------------------------------------------------------
  const recordPayment = async (
    invoiceId: string,
    amount: number,
    method: Payment["paymentMethod"],
    reference: string
  ) => {
    const r = await api<Payment>("/api/finance", {
      method: "POST",
      body: JSON.stringify({ action: "record-payment", invoiceId, amount, paymentMethod: method, reference }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Payment failed." };
    setPayments((prev) => [r.data as Payment, ...prev]);
    await logAudit("payment", r.data.id, "PAYMENT_RECORDED", `Received ₹${amount} via ${method}`);
    // Refresh invoices + job payment status from the server.
    const fr = await api<{ invoices: Invoice[]; payments: Payment[]; expenses: Expense[] }>("/api/finance");
    if (fr.ok && fr.data) {
      setInvoices(fr.data.invoices);
      setPayments(fr.data.payments);
      setExpenses(fr.data.expenses);
    }
    const jr = await api<Job[]>("/api/jobs");
    if (jr.ok && jr.data) setJobs(jr.data);
    // The settlement recomputed the customer's lifetime revenue server-side —
    // re-sync the directory so the Customers section reflects it immediately.
    await refreshCustomers();
    return { success: true, message: "Payment recorded." };
  };

  const createExpense = async (expenseData: Omit<Expense, "id" | "createdAt" | "createdBy">) => {
    const r = await api<Expense>("/api/finance", {
      method: "POST",
      body: JSON.stringify({ action: "create-expense", ...expenseData }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not record the expense." };
    setExpenses((prev) => [r.data as Expense, ...prev]);
    await logAudit("payment", r.data.id, "EXPENSE_RECORDED", `Expense ₹${expenseData.amount} — ${expenseData.category}`);
    return { success: true, message: "Expense recorded." };
  };

  const deleteExpense = async (id: string) => {
    const r = await api("/api/finance", {
      method: "POST",
      body: JSON.stringify({ action: "delete-expense", id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not delete the expense." };
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    await logAudit("payment", id, "EXPENSE_DELETED", "Expense entry deleted");
    return { success: true, message: "Expense deleted." };
  };

  const createQuote = async (quote: {
    customerId: string;
    propertyId: string;
    serviceId: string;
    items: { description: string; quantity: number; unitPrice: number }[];
    validUntil: string;
  }) => {
    const r = await api<Quote>("/api/finance", {
      method: "POST",
      body: JSON.stringify({ action: "create-quote", ...quote }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not create the quotation." };
    // Insert the persisted quotation into the local store so it shows up
    // without a manual refresh.
    setQuotes((prev) => [r.data as Quote, ...prev]);
    await logAudit("job", "quote", "QUOTE_CREATED", `Quotation created (₹ total per line items)`);
    return { success: true, message: "Quotation created." };
  };

  const convertQuoteToInvoice = async (
    quoteId: string,
    schedule?: { scheduledDate: string; scheduledTimeSlot: string }
  ) => {
    const r = await api<{ invoice: Invoice; jobId: string }>("/api/finance", {
      method: "POST",
      body: JSON.stringify({ action: "convert-quote", quoteId, ...schedule }),
    });
    if (!r.ok) return { success: false, message: r.error || "Conversion failed." };
    // The server created a booking + tax invoice and closed the quotation.
    // Re-sync every affected collection so Jobs, Finance and Customers all
    // reflect the conversion without a manual refresh.
    await Promise.all([
      (async () => {
        const fr = await api<{
          invoices: Invoice[];
          payments: Payment[];
          expenses: Expense[];
          quotes: Quote[];
        }>("/api/finance");
        if (fr.ok && fr.data) {
          setInvoices(fr.data.invoices);
          setPayments(fr.data.payments);
          setExpenses(fr.data.expenses);
          setQuotes(fr.data.quotes);
        }
      })(),
      refreshJobs(),
      refreshCustomers(),
    ]);
    await logAudit("payment", quoteId, "QUOTE_CONVERTED", "Quotation converted to job + invoice");
    return { success: true, message: "Quotation converted to job + invoice.", jobId: r.data?.jobId };
  };

  const convertQuoteToJob = async (quoteId: string) => {
    return convertQuoteToInvoice(quoteId);
  };

  const deleteQuote = async (id: string) => {
    const r = await api("/api/finance", {
      method: "POST",
      body: JSON.stringify({ action: "delete-quote", id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not delete the quotation." };
    setQuotes((prev) => prev.filter((q) => q.id !== id));
    await logAudit("payment", id, "QUOTE_DELETED", "Open quotation deleted");
    return { success: true, message: "Quotation deleted." };
  };

  // --- Services & rubrics (company-authored, DB-backed) ----------------------------
  const createService = async (serviceData: Omit<Service, "id">) => {
    const r = await api<Service>("/api/services", {
      method: "POST",
      body: JSON.stringify({
        name: serviceData.name,
        category: serviceData.category,
        description: serviceData.description,
        basePrice: serviceData.basePrice,
        estimatedDurationHours: serviceData.estimatedDurationHours,
        checklistTemplate: serviceData.checklistTemplate.map(({ area, task, critical }) => ({ area, task, critical })),
      }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not create the service." };
    setServices((prev) => [...prev, r.data as Service]);
    await logAudit("job", r.data.id, "SERVICE_CREATED", `Service package ${r.data.name} created`);
    return { success: true, message: "Service package created.", service: r.data };
  };

  const updateService = async (id: string, updates: Partial<Service>) => {
    const r = await api<Service>("/api/services", {
      method: "PATCH",
      body: JSON.stringify({ id, ...updates }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Service update failed." };
    setServices((prev) => prev.map((s) => (s.id === id ? (r.data as Service) : s)));
    await logAudit("job", id, "SERVICE_UPDATED", `Service package updated`);
    return { success: true, message: "Service updated." };
  };

  const deleteService = async (id: string) => {
    const r = await api<{ retired?: boolean }>("/api/services", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Deletion failed." };
    if (r.data?.retired) {
      // In use by jobs: retired (inactive) instead of deleted to preserve history.
      const gr = await api<Service[]>("/api/services");
      if (gr.ok && gr.data) setServices(gr.data);
      return { success: true, message: "Service is used by existing jobs and was retired (deactivated) instead." };
    }
    setServices((prev) => prev.filter((s) => s.id !== id));
    await logAudit("job", id, "SERVICE_DELETED", `Service package deleted`);
    return { success: true, message: "Service deleted." };
  };

  const addChecklistItemToService = async (
    serviceId: string,
    item: { area: string; task: string; critical: boolean }
  ) => {
    const r = await api<Service>("/api/services", {
      method: "PUT",
      body: JSON.stringify({ serviceId, ...item }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not add the rubric item." };
    setServices((prev) => prev.map((s) => (s.id === serviceId ? (r.data as Service) : s)));
    return { success: true, message: "Rubric item added." };
  };

  const removeChecklistItemFromService = async (serviceId: string, itemId: string) => {
    const r = await api<Service>("/api/services", {
      method: "PUT",
      body: JSON.stringify({ serviceId, itemId }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not remove the rubric item." };
    setServices((prev) => prev.map((s) => (s.id === serviceId ? (r.data as Service) : s)));
    return { success: true, message: "Rubric item removed." };
  };

  // --- Users (DB-backed via /api/users) ----------------------------------------------
  const addUser = async (userData: {
    name: string;
    email: string;
    phone: string;
    role: UserRole;
    password: string;
  }): Promise<{ success: boolean; message: string }> => {
    const r = await api<User>("/api/users", {
      method: "POST",
      body: JSON.stringify(userData),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not create the user." };
    setUsers((prev) => [...prev, r.data as User]);
    await logAudit("customer", r.data.id, "USER_CREATED", `Created user ${r.data.name} (${r.data.email})`);
    return { success: true, message: `User ${r.data.name} created.` };
  };

  const updateUser = async (
    id: string,
    updates: { name?: string; phone?: string; role?: UserRole; active?: boolean; password?: string }
  ): Promise<{ success: boolean; message: string }> => {
    const r = await api<User>("/api/users", {
      method: "PATCH",
      body: JSON.stringify({ id, ...updates }),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Could not update the user." };
    setUsers((prev) => prev.map((u) => (u.id === id ? (r.data as User) : u)));
    await logAudit("customer", id, "USER_UPDATED", `Updated user account`);
    return { success: true, message: "User updated." };
  };

  const toggleUserStatus = async (id: string) => {
    const target = users.find((u) => u.id === id);
    if (!target) return;
    await updateUser(id, { active: !target.active });
  };

  const deleteUser = async (id: string) => {
    const r = await api<{ retired?: boolean; deleted?: boolean }>("/api/users", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    });
    if (!r.ok) return { success: false, message: r.error || "Could not delete the user." };
    if (r.data?.retired) {
      // Referenced by jobs/inspections/photos: deactivated instead of deleted to
      // preserve operational history. Re-sync the directory from the server.
      const ur = await api<User[]>("/api/users");
      if (ur.ok && ur.data) setUsers(ur.data);
      return {
        success: true,
        message: "User has operational history and was deactivated instead of deleted.",
      };
    }
    setUsers((prev) => prev.filter((u) => u.id !== id));
    await logAudit("customer", id, "USER_DELETED", "User account deleted");
    return { success: true, message: "User deleted." };
  };

  // --- Settings -------------------------------------------------------------------------
  const updateSystemSettings = async (updates: Partial<SystemSettings>) => {
    const r = await api<SystemSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    if (!r.ok || !r.data) return { success: false, message: r.error || "Settings update failed." };
    setSystemSettings(r.data);
    await logAudit("job", "SYS-CONFIG", "SETTINGS_UPDATED", "System settings updated");
    return { success: true, message: "Settings saved." };
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        currentRole,
        systemSettings,
        updateSystemSettings,
        fontSize,
        setFontSize,
        loading,
        users,
        jobs,
        customers,
        properties,
        services,
        checklistItems,
        photos,
        qualityChecks,
        qualityIssues,
        reworkTasks,
        complaints,
        partners,
        commissionRules,
        commissionEntries,
        payouts,
        quotes,
        invoices,
        payments,
        expenses,
        smsGatewayLogs,
        transitionJobStatus,
        refreshJobs,
        refreshCustomers,
        refreshReferrals,
        transitionError,
        sendJobArrivalOTP,
        verifyJobOTP,
        resendJobOTP,
        fetchSmsGatewayLog,
        sendCompletionLink,
        updateChecklistItem,
        addJobPhoto,
        deleteJobPhoto,
        submitQualityCheck,
        completeReworkTask,
        reinspectAndPassQC,
        customerApproveJob,
        customerRequestAttention,
        submitCustomerFeedback,
        createJob,
        createCustomer,
        updateCustomer,
        deleteCustomer,
        createProperty,
        updateProperty,
        deleteProperty,
        createPartner,
        updatePartner,
        deletePartner,
        createCommissionRule,
        updateCommissionRule,
        deleteCommissionRule,
        approveCommissionEntry,
        createPayout,
        recordPayment,
        createExpense,
        deleteExpense,
        createQuote,
        deleteQuote,
        convertQuoteToInvoice,
        convertQuoteToJob,
        assignStaffToJob,
        fetchStaffDirectory,
        createService,
        updateService,
        deleteService,
        addChecklistItemToService,
        removeChecklistItemFromService,
        addUser,
        updateUser,
        toggleUserStatus,
        deleteUser,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
