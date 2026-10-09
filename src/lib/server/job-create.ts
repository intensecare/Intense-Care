import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./authz";
import type { SessionUser } from "./session";
import { nextJobSerial } from "./job-serial";
import { nextInvoiceNumber } from "./invoices";
import { computeInvoiceFigures, type InvoiceType } from "@/lib/tax";
import { ASSIGNABLE_ROLES, can } from "@/lib/rbac";
import type { QuoteLine, SystemSettings, CustomerVisibility } from "@/lib/types";
import { CUSTOMER_VISIBILITY_KEYS } from "@/lib/types";
import { formatAddress, normalizeCoords } from "@/lib/location";
import { syncOpenJobsToProperty } from "./locations";

/**
 * Creating a job — ONE implementation used by "New job" and by converting a
 * quotation. The job, its checklist (from every catalogue service on it) and
 * its invoice are written in one transaction.
 */

const TERMINAL = ["COMPLETED", "CANCELLED", "CLOSED"];

/** Validates the Field Manager / crew and refuses double-booking in the same slot. */
export async function validateCrew(
  user: SessionUser,
  p: { assignedManagerId?: string | null; assignedStaffIds?: string[]; scheduledDate: string; scheduledTimeSlot: string }
): Promise<{ assignedManagerId: string | null; assignedStaffIds: string[] }> {
  const staff = p.assignedStaffIds ?? [];
  const crewIds = Array.from(new Set([...(p.assignedManagerId ? [p.assignedManagerId] : []), ...staff]));
  let assignedManagerId = p.assignedManagerId ?? null;
  if (crewIds.length === 0) return { assignedManagerId: null, assignedStaffIds: [] };
  if (!can(user, "jobs.assign")) throw new HttpError(403, "Your role may create bookings but not assign Field Managers.");
  const rows = await prisma.user.findMany({ where: { id: { in: crewIds }, role: { in: ASSIGNABLE_ROLES }, active: true }, select: { id: true, role: true } });
  const valid = new Map(rows.map((r) => [r.id, r.role]));
  if (crewIds.some((id) => !valid.has(id))) throw new HttpError(400, "One or more selected people are not active Field Managers.");
  if (!assignedManagerId) assignedManagerId = staff.find((id) => valid.get(id) === "field_manager") ?? null;
  const clash = await prisma.job.count({
    where: {
      scheduledDate: p.scheduledDate,
      scheduledTimeSlot: p.scheduledTimeSlot,
      status: { notIn: TERMINAL },
      OR: [{ assignedStaffIds: { hasSome: crewIds } }, { assignedManagerId: { in: crewIds } }],
    },
  });
  if (clash > 0) throw new HttpError(409, "That Field Manager already has a job in this date & time slot.");
  return { assignedManagerId, assignedStaffIds: staff };
}

/** Only known keys, only true/false; null when nothing is overridden. */
export function cleanVisibility(v: unknown): Partial<CustomerVisibility> | null {
  if (!v || typeof v !== "object") return null;
  const out: Partial<CustomerVisibility> = {};
  for (const k of CUSTOMER_VISIBILITY_KEYS) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === "boolean") out[k] = x;
  }
  return Object.keys(out).length ? out : null;
}

export interface NewJob {
  customerId: string;
  propertyId: string;
  /** The job's primary service (checklists come from every catalogue line). */
  serviceId: string;
  scheduledDate: string;
  scheduledTimeSlot: string;
  assignedManagerId: string | null;
  assignedStaffIds: string[];
  notes?: string | null;
  customerNotes?: string | null;
  referralPartnerId?: string | null;
  location?: { lat: number | null; lng: number | null; address: string | null } | null;
  /** Also save the job's pin on its property when the property has none yet. */
  saveLocationToProperty?: boolean;
  customerVisibility?: Partial<CustomerVisibility> | null;
  status?: string;
  quoteId?: string | null;
  invoice: {
    type: InvoiceType;
    interState: boolean;
    /** Billing lines; default = one line for the primary service at its price. */
    items?: QuoteLine[];
    discount?: number;
    customerGstin?: string | null;
    paymentTerms?: string | null;
    notes?: string | null;
  };
}

export async function createJobWithInvoice(input: NewJob, settings: SystemSettings) {
  const [customer, property, primary] = await Promise.all([
    prisma.customer.findUnique({ where: { id: input.customerId } }),
    prisma.property.findUnique({ where: { id: input.propertyId } }),
    prisma.service.findUnique({ where: { id: input.serviceId }, include: { checklistTemplate: { orderBy: { position: "asc" } } } }),
  ]);
  if (!customer) throw new HttpError(404, "Customer not found.");
  if (!property || property.customerId !== customer.id) throw new HttpError(400, "Property does not belong to this customer.");
  if (!primary) throw new HttpError(404, "Service not found. Create it on the Services page first.");

  const items: QuoteLine[] = input.invoice.items?.length
    ? input.invoice.items
    : [{ serviceId: primary.id, description: primary.name, quantity: 1, rate: primary.basePrice, amount: primary.basePrice, custom: false }];
  const extraServiceIds = Array.from(new Set(items.map((l) => l.serviceId).filter((x): x is string => !!x && x !== primary.id)));
  const extra = extraServiceIds.length
    ? await prisma.service.findMany({ where: { id: { in: extraServiceIds } }, include: { checklistTemplate: { orderBy: { position: "asc" } } } })
    : [];
  const subtotal = Math.round(items.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const f = computeInvoiceFigures({ invoiceType: input.invoice.type, subtotal, discount: input.invoice.discount ?? 0, gstRatePercent: settings.taxRatePercent, interState: input.invoice.interState });
  const gst = f.invoiceType === "GST";
  const propertyAddress = formatAddress(property);
  const propertyPin = normalizeCoords(property.lat, property.lng);
  // The job's pin: a valid pin sent for this job, else the property's saved pin.
  const sent = input.location ?? null;
  const sentPin = sent ? normalizeCoords(sent.lat, sent.lng) : null;
  if (sent && !sentPin && (sent.lat !== null || sent.lng !== null)) {
    throw new HttpError(400, "The job's map location needs both latitude and longitude (and can't be 0, 0).");
  }
  const ownPin = sentPin && !(propertyPin && Math.abs(propertyPin.lat - sentPin.lat) < 1e-6 && Math.abs(propertyPin.lng - sentPin.lng) < 1e-6) ? sentPin : null;
  const pinOnProperty = !!ownPin && !propertyPin && input.saveLocationToProperty === true;
  const pin = ownPin ?? propertyPin;
  const loc = { lat: pin?.lat ?? null, lng: pin?.lng ?? null, address: sent?.address?.trim() || propertyAddress };
  const locationSource = ownPin && !pinOnProperty ? "JOB" : "PROPERTY";

  const result = await prisma.$transaction(async (tx) => {
    if (pinOnProperty && ownPin) {
      await tx.property.update({ where: { id: property.id }, data: { lat: ownPin.lat, lng: ownPin.lng, locationSource: "MAP_PIN", locationUpdatedAt: new Date() } });
    }
    const job = await tx.job.create({
      data: {
        jobSerial: await nextJobSerial(tx, customer.name, input.scheduledDate),
        customerId: customer.id,
        propertyId: property.id,
        serviceId: primary.id,
        scheduledDate: input.scheduledDate,
        scheduledTimeSlot: input.scheduledTimeSlot,
        assignedStaffIds: input.assignedStaffIds,
        assignedManagerId: input.assignedManagerId,
        amount: f.taxable,
        status: input.status ?? (input.assignedManagerId || input.assignedStaffIds.length ? "ASSIGNED" : "SCHEDULED"),
        notes: input.notes || null,
        customerNotes: input.customerNotes || null,
        referralPartnerId: input.referralPartnerId || null,
        locationLat: loc.lat,
        locationLng: loc.lng,
        locationAddress: loc.address || propertyAddress || null,
        locationSource,
        customerVisibility: (input.customerVisibility ?? undefined) as Prisma.InputJsonValue | undefined,
        quoteId: input.quoteId ?? null,
      },
    });
    const rubric = [primary, ...extra].flatMap((s) => s.checklistTemplate.map((c) => ({ jobId: job.id, area: c.area, task: c.task, critical: c.critical })));
    if (rubric.length) await tx.jobChecklistItem.createMany({ data: rubric });
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: await nextInvoiceNumber(tx, f.invoiceType),
        invoiceType: f.invoiceType,
        jobId: job.id,
        customerId: customer.id,
        subtotal: f.subtotal,
        discount: f.discount,
        tax: f.tax,
        gstRate: f.gstRate,
        cgst: f.cgst,
        sgst: f.sgst,
        igst: f.igst,
        interState: gst && input.invoice.interState,
        customerGstin: gst ? input.invoice.customerGstin || customer.gstin || null : null,
        supplierGstin: gst ? settings.gstin?.trim() || null : null,
        total: f.total,
        balanceDue: f.total,
        dueDate: input.scheduledDate,
        items: items as unknown as Prisma.InputJsonValue,
        billingAddress: customer.address || propertyAddress || null,
        serviceAddress: loc.address || propertyAddress || null,
        paymentTerms: input.invoice.paymentTerms ?? settings.invoicePaymentTerms ?? null,
        notes: input.invoice.notes ?? settings.invoiceNotes ?? null,
        quoteId: input.quoteId ?? null,
      },
    });
    await tx.customer.update({ where: { id: customer.id }, data: { totalBookings: { increment: 1 } } });
    return { job, invoice };
  });
  // The property just got its first pin: its other open jobs get it too.
  if (pinOnProperty) await syncOpenJobsToProperty(property.id);
  return result;
}

/** Best-effort follow-ups after a job is created: calendar sync + its one customer QR link. */
export function afterJobCreated(jobId: string, user: { id: string; name: string }) {
  void (async () => {
    try {
      const { syncJobEvent } = await import("./google-calendar");
      await syncJobEvent(jobId);
    } catch {}
    try {
      const { ensureCustomerLink } = await import("./qr-service");
      await ensureCustomerLink(jobId, { id: user.id, name: user.name });
    } catch {}
  })();
}
