/**
 * Server-side serializers: Prisma rows → client ERP types (src/lib/types.ts).
 *
 * The database is the source of truth; these mappers define the wire format
 * the hydrated client store consumes. Dates serialize as ISO strings.
 */
import { Prisma } from "@prisma/client";
import { parseStoredLines } from "@/lib/documents";
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
  JobServiceLine,
  Expense,
  Refund,
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
    gstin: c.gstin ?? undefined,
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
    lat: p.lat ?? undefined,
    lng: p.lng ?? undefined,
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
    taxTreatment: s.taxTreatment === "EXEMPT" ? "EXEMPT" : "GST",
    internalNotes: s.internalNotes ?? undefined,
    isCustom: s.isCustom,
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

/** §3 One priced service on a job. */
export function serializeJobServiceLine(
  l: Prisma.JobServiceLineGetPayload<object>
): JobServiceLine {
  return {
    id: l.id,
    jobId: l.jobId,
    serviceId: l.serviceId ?? undefined,
    name: l.name,
    description: l.description ?? "",
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount,
    taxable: l.taxable,
    durationHours: l.durationHours,
    position: l.position,
  };
}

/**
 * Financial fields of a job are the Admin's domain. ops_manager gets a
 * stripped projection (no amounts, no payment data) enforced at the API
 * boundary; staff receive the same shape so the field app stays money-free.
 */
export type OpsSafeJob = Omit<SerializedJob, "amount" | "paymentStatus">;

export function redactJobForOps(job: SerializedJob): OpsSafeJob {
  const { amount: _amount, paymentStatus: _paymentStatus, ...rest } = job;
  // §3 Service lines carry prices. Field Manager and QC see WHAT to do
  // (service, scope, how long) but never what the job is worth.
  return {
    ...rest,
    serviceLines: rest.serviceLines?.map((l) => ({ ...l, unitPrice: 0, discount: 0 })),
  };
}

/** Job shape from the DB joined with customer/property/service display names. */
export type SerializedJob = Job & {
  customerName?: string;
  customerPhone?: string;
  propertyTitle?: string;
  service?: Pick<Service, "id" | "name" | "basePrice" | "estimatedDurationHours">;
};

/** A job row with its display joins, and optionally its priced service lines. */
export type JobRowWithJoins = Prisma.JobGetPayload<{
  include: {
    customer: { select: { name: true; phone: true } };
    property: { select: { title: true; address: true } };
    service: { select: { id: true; name: true; basePrice: true; estimatedDurationHours: true } };
  };
}> & { serviceLines?: Prisma.JobServiceLineGetPayload<object>[] };

export function serializeJob(j: JobRowWithJoins): SerializedJob {
  return {
    id: j.id,
    jobNumber: j.jobSerial ?? undefined,
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
    customerNotes: j.customerNotes ?? undefined,
    customerConfirmedAt: j.customerConfirmedAt
      ? new Date(j.customerConfirmedAt).toISOString()
      : undefined,
    approvedAt: j.approvedAt ? new Date(j.approvedAt).toISOString() : undefined,
    approvedBy: j.approvedBy ?? undefined,
    approvalMethod: j.approvalMethod ?? undefined,
    customerFeedbackRating: j.customerFeedbackRating ?? undefined,
    customerFeedbackAt: j.customerFeedbackAt
      ? new Date(j.customerFeedbackAt).toISOString()
      : undefined,
    googleReviewClicked: j.googleReviewClicked,
    qualityCheckId: j.qualityCheckId ?? undefined,
    referralAttribution: undefined,
    arrivedAt: j.arrivedAt ? new Date(j.arrivedAt).toISOString() : undefined,
    startedAt: j.startedAt ? new Date(j.startedAt).toISOString() : undefined,
    completedAt: j.completedAt ? new Date(j.completedAt).toISOString() : undefined,
    // §1 The official service location chosen when the job was booked.
    serviceAddress: j.serviceAddress ?? undefined,
    serviceLat: j.serviceLat ?? undefined,
    serviceLng: j.serviceLng ?? undefined,
    serviceLocationAccuracy: j.serviceLocationAccuracy ?? undefined,
    locationNotes: j.locationNotes ?? undefined,
    // §2/§12 How arrival was verified — GPS, QR or an audited manual override.
    arrivalVerification: (j.arrivalVerification as Job["arrivalVerification"]) ?? undefined,
    arrivalDistanceM: j.arrivalDistanceM ?? undefined,
    arrivalBypassReason: j.arrivalBypassReason ?? undefined,
    // §6 undefined = the company default applies (lib/visibility.ts).
    customerVisibility:
      j.customerVisibility && typeof j.customerVisibility === "object" && !Array.isArray(j.customerVisibility)
        ? (j.customerVisibility as Record<string, boolean>)
        : undefined,
    serviceLines: j.serviceLines
      ?.slice()
      .sort((a, b) => a.position - b.position)
      .map(serializeJobServiceLine),
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

/**
 * Resolves assigned worker ids to display names server-side. Ops managers and
 * staff cannot read the full user directory (GET /api/users is Admin
 * only), so dispatch surfaces previously rendered assigned jobs as
 * "Unassigned" — the id→name map simply came back empty. Routes attach this
 * to every serialized job; pages fall back to their local store when absent.
 */
export function withStaffNames<T extends { assignedStaffIds: string[] }>(
  job: T,
  userNameById?: Map<string, string>
): T & { assignedStaffNames: string[] } {
  const names = userNameById
    ? job.assignedStaffIds.map((id) => userNameById.get(id)).filter((n): n is string => !!n)
    : [];
  return { ...job, assignedStaffNames: names };
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
    finalizedAt: i.finalizedAt ? new Date(i.finalizedAt).toISOString() : undefined,
    refundedAmount: i.refundedAmount,
    invoiceType: i.invoiceType === "NON_GST" ? "NON_GST" : "GST",
    gstRate: i.gstRate,
    cgst: i.cgst,
    sgst: i.sgst,
    igst: i.igst,
    interState: i.interState,
    customerGstin: i.customerGstin ?? undefined,
    supplierGstin: i.supplierGstin ?? undefined,
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
  // Line items persisted with the quotation. Legacy rows carried only
  // { description, quantity, unitPrice } and are upgraded in place.
  const items = parseStoredLines(q.items).map((it) => ({
    ...it,
    amount: Math.round((it.quantity * it.unitPrice - it.discount) * 100) / 100,
  }));

  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    customerId: q.customerId,
    propertyId: q.propertyId,
    serviceId: q.serviceId,
    items,
    subtotal: q.subtotal,
    tax: q.tax,
    discount: q.discount,
    total: q.total,
    validUntil: q.validUntil,
    status: q.status as Quote["status"],
    invoiceType: q.invoiceType === "NON_GST" ? "NON_GST" : "GST",
    gstRate: q.gstRate,
    cgst: q.cgst,
    sgst: q.sgst,
    igst: q.igst,
    interState: q.interState,
    serviceAddress: q.serviceAddress ?? undefined,
    paymentTerms: q.paymentTerms ?? undefined,
    serviceTerms: q.serviceTerms ?? undefined,
    notes: q.notes ?? undefined,
    acceptedAt: q.acceptedAt ? new Date(q.acceptedAt).toISOString() : undefined,
    acceptedBy: q.acceptedBy ?? undefined,
    jobId: q.jobId ?? undefined,
    createdAt: new Date(q.createdAt).toISOString(),
    updatedAt: q.updatedAt ? new Date(q.updatedAt).toISOString() : undefined,
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
      role: a.performedByRole ?? "",
    },
    jobId: a.jobId ?? undefined,
    oldState: a.oldState ?? undefined,
    newState: a.newState ?? undefined,
    reason: a.reason ?? undefined,
    details: a.details ?? undefined,
    ipAddress: a.ipAddress ?? undefined,
    userAgent: a.userAgent ?? undefined,
    timestamp: new Date(a.timestamp).toISOString(),
  };
}

export function serializeRefund(r: Prisma.RefundGetPayload<object>): Refund {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    jobId: r.jobId,
    customerId: r.customerId,
    amount: r.amount,
    reason: r.reason,
    method: r.method as Refund["method"],
    status: r.status as Refund["status"],
    requestedBy: r.requestedBy,
    approvedBy: r.approvedBy ?? undefined,
    approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : undefined,
    processedAt: r.processedAt ? new Date(r.processedAt).toISOString() : undefined,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

/**
 * Customer-safe projection of a job (§13/§22): no internal notes, no crew
 * ids, no money on the job row itself (invoices are served separately).
 */
export function redactJobForCustomer(job: SerializedJob) {
  const {
    notes: _notes,
    amount: _amount,
    assignedManagerId: _m,
    assignedStaffIds: _s,
    customerPhone: _p,
    // §8 Desk-only operational detail never reaches a customer projection:
    // the pin notes for the crew, the GPS-bypass reason, the measured
    // distance and the visibility configuration itself.
    locationNotes: _ln,
    arrivalBypassReason: _abr,
    arrivalDistanceM: _adm,
    customerVisibility: _cv,
    ...rest
  } = job;
  return { ...rest, assignedStaffIds: [] as string[] };
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
