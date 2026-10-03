/**
 * Server-side serializers: Prisma rows → client ERP types (src/lib/types.ts).
 *
 * The database is the source of truth; these mappers define the wire format
 * the hydrated client store consumes. Dates serialize as ISO strings.
 */
import { Prisma } from "@prisma/client";
import type {
  Customer,
  Property,
  Service,
  JobChecklistItem,
  Job,
  Invoice,
  Payment,
  QualityCheck,
  QualityIssue,
  ReworkTask,
  Complaint,
  ReferralPartner,
  CommissionRule,
  CommissionEntry,
  Payout,
  Quote,
  Expense,
  JobStatus,
  PaymentStatus,
} from "@/lib/types";

const iso = (d: Date | null | undefined): string => (d ? new Date(d).toISOString() : "");

export function serializeCustomer(c: Prisma.CustomerGetPayload<object>): Customer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email ?? "",
    whatsapp: c.email === c.phone ? c.phone : c.phone, // whatsapp defaults to phone server-side
    address: c.address ?? "",
    notes: c.notes ?? undefined,
    source: c.source,
    referralPartnerId: c.referralPartnerId ?? undefined,
    referralCode: c.referralCode ?? undefined,
    lifetimeRevenue: c.lifetimeRevenue,
    totalBookings: c.totalBookings,
    status: c.status === "inactive" ? "inactive" : "active",
    createdAt: new Date(c.createdAt).toISOString(),
  };
}

export function serializeProperty(p: Prisma.PropertyGetPayload<object>): Property {
  return {
    id: p.id,
    customerId: p.customerId,
    propertyType: p.propertyType as Property["propertyType"],
    title: p.title,
    address: p.address,
    city: p.city ?? "",
    postalCode: p.postalCode ?? "",
    carpetAreaSqFt: p.areaSqFt,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    gpsCoordinates: { lat: 0, lng: 0 },
    accessNotes: p.accessNotes ?? undefined,
    parkingInstructions: p.parkingInstructions ?? undefined,
    preferredTime: p.preferredTime ?? undefined,
    recurringService: p.recurringService,
    recurringFrequency: p.recurringFrequency as Property["recurringFrequency"],
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

export function serializeService(
  s: Prisma.ServiceGetPayload<{ include: { checklistTemplate: true } }>
): Service {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    category: s.category as Service["category"],
    description: s.description,
    basePrice: s.basePrice,
    estimatedDurationHours: s.estimatedDurationHours,
    checklistTemplate: s.checklistTemplate
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        area: item.area,
        task: item.task,
        critical: item.critical,
      })),
    active: s.active,
  };
}

export function serializeChecklistItem(i: Prisma.JobChecklistItemGetPayload<object>): JobChecklistItem {
  return {
    id: i.id,
    jobId: i.jobId,
    area: i.area,
    task: i.task,
    critical: i.critical,
    status: i.status as JobChecklistItem["status"],
    skippedReason: i.skippedReason ?? undefined,
    issueNotes: i.issueNotes ?? undefined,
    photoEvidence: i.photoEvidence ?? undefined,
    completedBy: i.completedBy ?? undefined,
    completedAt: i.completedAt ? new Date(i.completedAt).toISOString() : undefined,
  };
}

/**
 * Financial fields of a job are the super_admin's domain. ops_manager gets a
 * stripped projection (no amounts, no payment data) enforced at the API
 * boundary; staff receive the same shape so the field app stays money-free.
 */
export type OpsSafeJob = Omit<SerializedJob, "amount" | "paymentStatus">;

export function redactJobForOps(job: SerializedJob): OpsSafeJob {
  const { amount: _amount, paymentStatus: _paymentStatus, ...rest } = job;
  return rest;
}

/** Job shape from the DB joined with customer/property/service display names. */
export type SerializedJob = Omit<Job, "otpVerification"> & {
  otpVerification: Job["otpVerification"];
  customerName?: string;
  customerPhone?: string;
  propertyTitle?: string;
  service?: Pick<Service, "id" | "name" | "basePrice" | "estimatedDurationHours">;
};

export function serializeJob(
  j: Prisma.JobGetPayload<{
    include: {
      customer: { select: { name: true; phone: true } };
      property: { select: { title: true; address: true } };
      service: { select: { id: true; name: true; basePrice: true; estimatedDurationHours: true } };
    };
  }>
): SerializedJob {
  return {
    id: j.id,
    customerId: j.customerId,
    propertyId: j.propertyId,
    serviceId: j.serviceId,
    scheduledDate: j.scheduledDate,
    scheduledTimeSlot: j.scheduledTimeSlot,
    assignedManagerId: j.assignedManagerId ?? undefined,
    assignedStaffIds: j.assignedStaffIds ?? [],
    amount: j.amount,
    paymentStatus: j.paymentStatus as PaymentStatus,
    status: j.status as JobStatus,
    notes: j.notes ?? undefined,
    // OTP truth lives server-side; the hydrated store only carries display state.
    otpVerification: {
      phone: j.customer.phone,
      attempts: 0,
      maxAttempts: 5,
      status: "none",
    },
    qualityCheckId: j.qualityCheckId ?? undefined,
    referralAttribution: undefined,
    arrivedAt: j.arrivedAt ? new Date(j.arrivedAt).toISOString() : undefined,
    startedAt: j.startedAt ? new Date(j.startedAt).toISOString() : undefined,
    completedAt: j.completedAt ? new Date(j.completedAt).toISOString() : undefined,
    createdAt: new Date(j.createdAt).toISOString(),
    updatedAt: new Date(j.updatedAt).toISOString(),
    customerName: j.customer?.name,
    customerPhone: j.customer?.phone,
    propertyTitle: j.property ? `${j.property.title} - ${j.property.address}` : undefined,
    service: j.service
      ? {
          id: j.service.id,
          name: j.service.name,
          basePrice: j.service.basePrice,
          estimatedDurationHours: j.service.estimatedDurationHours,
        }
      : undefined,
  };
}

export function serializeInvoice(i: Prisma.InvoiceGetPayload<object>): Invoice {
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    jobId: i.jobId,
    customerId: i.customerId,
    subtotal: i.subtotal,
    tax: i.tax,
    discount: i.discount,
    total: i.total,
    amountPaid: i.amountPaid,
    balanceDue: i.balanceDue,
    dueDate: i.dueDate,
    status: i.status as Invoice["status"],
    issuedAt: new Date(i.issuedAt).toISOString(),
  };
}

export function serializePayment(p: Prisma.PaymentGetPayload<object>): Payment {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    jobId: p.jobId,
    customerId: p.customerId,
    amount: p.amount,
    paymentMethod: p.paymentMethod as Payment["paymentMethod"],
    transactionReference: p.transactionReference,
    status: "completed",
    paidAt: new Date(p.paidAt).toISOString(),
  };
}

export function serializeQualityCheck(q: Prisma.QualityCheckGetPayload<object>): QualityCheck {
  return {
    id: q.id,
    jobId: q.jobId,
    inspectorId: q.inspectorId,
    inspectorName: q.inspectorId,
    score: q.score,
    status: q.decision === "PASS" ? "PASS" : "REWORK_REQUIRED",
    itemsChecked: 0,
    itemsPassed: 0,
    issuesCount: 0,
    notes: q.notes ?? undefined,
    evidencePhotos: [],
    inspectedAt: new Date(q.createdAt).toISOString(),
    completedAt: new Date(q.createdAt).toISOString(),
  };
}

export function serializeQualityIssue(i: Prisma.QualityIssueGetPayload<object>): QualityIssue {
  return {
    id: i.id,
    qualityCheckId: i.qualityCheckId ?? undefined,
    jobId: i.jobId,
    area: i.area,
    itemDescription: i.itemDescription,
    severity: i.severity as QualityIssue["severity"],
    notes: i.notes ?? "",
    status: i.status as QualityIssue["status"],
    reworkTaskId: i.reworkTaskId ?? undefined,
    assignedStaffId: i.assignedStaffId ?? undefined,
    reworkInstructions: i.reworkInstructions ?? undefined,
    createdAt: new Date(i.createdAt).toISOString(),
    resolvedAt: i.resolvedAt ? new Date(i.resolvedAt).toISOString() : undefined,
  };
}

export function serializeReworkTask(t: Prisma.ReworkTaskGetPayload<object>): ReworkTask {
  return {
    id: t.id,
    qualityIssueId: t.qualityIssueId,
    jobId: t.jobId,
    assignedStaffId: t.assignedStaffId ?? "",
    instructions: t.instructions,
    status: t.status as ReworkTask["status"],
    completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : undefined,
    completedNotes: t.completedNotes ?? undefined,
    createdAt: new Date(t.createdAt).toISOString(),
  };
}

export function serializeComplaint(c: Prisma.ComplaintGetPayload<object>): Complaint {
  return {
    id: c.id,
    jobId: c.jobId,
    customerId: c.customerId,
    category: c.category as Complaint["category"],
    severity: c.severity as Complaint["severity"],
    description: c.description,
    assignedOwnerId: c.assignedOwnerId ?? "",
    assignedOwnerName: c.assignedOwnerName ?? undefined,
    status: c.status as Complaint["status"],
    resolutionNotes: c.resolutionNotes ?? undefined,
    resolvedAt: c.resolvedAt ? new Date(c.resolvedAt).toISOString() : undefined,
    createdAt: new Date(c.createdAt).toISOString(),
  };
}

export function serializePartner(p: Prisma.ReferralPartnerGetPayload<object>): ReferralPartner {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    partnerType: p.partnerType as ReferralPartner["partnerType"],
    email: p.email,
    phone: p.phone,
    commissionRuleId: p.commissionRuleId ?? "",
    status: p.status === "inactive" ? "inactive" : "active",
    totalReferrals: p.totalReferrals,
    totalConversions: p.totalConversions,
    totalRevenueGenerated: p.totalRevenueGenerated,
    totalCommissionEarned: p.totalCommissionEarned,
    totalCommissionPaid: p.totalCommissionPaid,
    totalCommissionPending: p.totalCommissionPending,
    bankDetails:
      p.bankAccountName || p.bankAccountNumber
        ? {
            accountName: p.bankAccountName ?? "",
            accountNumber: p.bankAccountNumber ?? "",
            ifscOrRouting: p.bankIfscOrRouting ?? "",
            upiId: p.bankUpiId ?? undefined,
          }
        : undefined,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

export function serializeCommissionRule(r: Prisma.CommissionRuleGetPayload<object>): CommissionRule {
  return {
    id: r.id,
    name: r.name,
    partnerType: r.partnerType as CommissionRule["partnerType"],
    calculationType: r.calculationType as CommissionRule["calculationType"],
    value: r.value,
    tierRules: (r.tierRules as unknown as CommissionRule["tierRules"]) ?? undefined,
    serviceOverrides: (r.serviceOverrides as unknown as CommissionRule["serviceOverrides"]) ?? undefined,
    isDefault: r.isDefault,
    active: r.active,
  };
}

export function serializeCommissionEntry(e: Prisma.CommissionEntryGetPayload<object>): CommissionEntry {
  return {
    id: e.id,
    partnerId: e.partnerId,
    referralId: e.referralId ?? "",
    jobId: e.jobId,
    bookingAmount: e.bookingAmount,
    commissionAmount: e.commissionAmount,
    ruleApplied: e.ruleApplied,
    status: e.status as CommissionEntry["status"],
    approvedAt: e.approvedAt ? new Date(e.approvedAt).toISOString() : undefined,
    payoutId: e.payoutId ?? undefined,
    reversedReason: e.reversedReason ?? undefined,
    createdAt: new Date(e.createdAt).toISOString(),
  };
}

export function serializePayout(p: Prisma.PayoutGetPayload<object>): Payout {
  return {
    id: p.id,
    partnerId: p.partnerId,
    partnerName: p.partnerName,
    amount: p.amount,
    payoutMethod: p.payoutMethod as Payout["payoutMethod"],
    referenceNumber: p.referenceNumber,
    status: p.status as Payout["status"],
    paidAt: new Date(p.paidAt).toISOString(),
    notes: p.notes ?? undefined,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

export function serializeQuote(q: Prisma.QuoteGetPayload<object>): Quote {
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    customerId: q.customerId,
    propertyId: q.propertyId,
    serviceId: q.serviceId,
    items: [],
    subtotal: q.subtotal,
    tax: q.tax,
    discount: q.discount,
    total: q.total,
    validUntil: q.validUntil,
    status: q.status as Quote["status"],
    createdAt: new Date(q.createdAt).toISOString(),
  };
}

export function serializeExpense(e: Prisma.ExpenseGetPayload<object>): Expense {
  return {
    id: e.id,
    date: e.date,
    category: e.category as Expense["category"],
    amount: e.amount,
    description: e.description,
    paymentMethod: e.paymentMethod as Expense["paymentMethod"],
    reference: e.reference ?? undefined,
    createdBy: e.createdBy,
    createdAt: new Date(e.createdAt).toISOString(),
  };
}

export function serializeAuditLog(a: Prisma.AuditLogGetPayload<object>) {
  // performedBy is stored as "userId:displayName" at write time.
  const [id, ...rest] = a.performedBy.split(":");
  return {
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    action: a.action,
    performedBy: {
      id: id || "system",
      name: rest.join(":") || "System",
      role: "",
    },
    oldState: a.oldState ?? undefined,
    newState: a.newState ?? undefined,
    details: a.details ?? undefined,
    timestamp: new Date(a.timestamp).toISOString(),
  };
}

/** Human-readable, collision-safe document number, e.g. INV-LX2K-8341. */
export function nextDocNumber(prefix: string): string {
  const t = Date.now().toString(36).toUpperCase().slice(-5);
  const r = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${t}${r}`;
}

/** Standard JSON success/error envelope used by all ERP API routes. */
export function ok<T>(data: T, status = 200) {
  return Response.json({ success: true, data }, { status });
}

export function fail(error: string, status = 400) {
  return Response.json({ success: false, error }, { status });
}

/** Parse a JSON body or return null; route handlers decide the error shape. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
