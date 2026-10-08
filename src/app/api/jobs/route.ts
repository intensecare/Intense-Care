import { NextResponse } from "next/server";
import { nextJobSerial } from "@/lib/server/job-serial";
import { nextInvoiceNumber } from "@/lib/server/invoices";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, jobWhereFor, dispatchWindowApplies } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { syncJobEvent } from "@/lib/server/google-calendar";
import {
  serializeJob,
  serializeInvoice,
  serializeChecklistItem,
  withStaffNames,
  fail,
  readJson,
  type JobRowWithJoins,
} from "@/lib/server/serialize";
import { projectJob } from "@/lib/server/projections";
import { recordAudit } from "@/lib/server/audit";
import { recordActivity } from "@/lib/server/activity";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import { dispatchCutoffTime } from "@/lib/server/policy";
import { getSystemSettings } from "@/lib/server/settings";
import { computeDocumentFigures } from "@/lib/documents";
import {
  ServiceSelectionSchema,
  ServiceLineError,
  resolveServiceLines,
  writeJobServiceLines,
} from "@/lib/server/service-lines";
import { LocationSchema, hasCoords } from "@/lib/server/location";
import { normalizeVisibility, DEFAULT_CUSTOMER_VISIBILITY } from "@/lib/visibility";
import { logger } from "@/lib/server/logger";
import { ASSIGNABLE_ROLES, can } from "@/lib/rbac";

/** Include shape shared by every job-list fetch (display joins only). */
const JOB_LIST_INCLUDE = {
  customer: { select: { name: true, phone: true } },
  property: { select: { title: true, address: true } },
  service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
  serviceLines: { orderBy: { position: "asc" as const } },
} as const;

type JobListRow = Prisma.JobGetPayload<{ include: typeof JOB_LIST_INCLUDE }>;

/** id → name; roles that cannot read the directory still need crew names. */
async function userNameMap(): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/**
 * GET /api/jobs — the job register, scoped by the caller's `jobs.view` scope:
 *   ALL (desk roles)      → every job (ops managers: inside the dispatch window)
 *   TEAM / ASSIGNED       → only jobs the caller (or their team) is on
 *   OWN (customer/partner) → only their own bookings, in a safe projection
 * Financial fields are present only for `finance.view` holders.
 */
export async function GET() {
  try {
    const { user } = await requirePermission("jobs.view");
    const where = await jobWhereFor(user, "jobs.view");
    if (where === null) return NextResponse.json({ success: true, data: [] });

    let jobs: JobListRow[] = await prisma.job.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: JOB_LIST_INCLUDE,
    });
    if (dispatchWindowApplies(user)) {
      const visibility = getOpsDateVisibility(new Date(), { nextDayDispatchTime: dispatchCutoffTime() });
      jobs = filterJobsForOpsManager(jobs, visibility);
    }

    const names = await userNameMap();
    return NextResponse.json({
      success: true,
      data: jobs.map((j) => projectJob(user, withStaffNames(serializeJob(j), names))),
    });
  } catch (err) {
    return errorResponse(err, "jobs.get.route_error");
  }
}

const CreateJobSchema = z.object({
  customerId: z.string().min(1).max(64).optional(),
  customerName: z.string().min(1).max(160).optional(),
  customerPhone: z.string().min(7).max(32).optional(),
  customerEmail: z.string().max(200).optional(),
  propertyId: z.string().max(64).optional(),
  propertyAddress: z.string().max(500).optional(),
  /** The primary service. Optional when `services` carries the selection. */
  serviceId: z.string().min(1).max(64).optional(),
  /** §3 One or many services — catalog entries and/or custom services. */
  services: z.array(ServiceSelectionSchema).min(1).max(20).optional(),
  /** §1 The official service location for this job. */
  location: LocationSchema.optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTimeSlot: z
    .string()
    .min(1)
    .max(80)
    .regex(
      /^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$|^\d{1,2}:\d{2}\s*[AP]M\s*[-–]\s*\d{1,2}:\d{2}\s*[AP]M$/i,
      "Time window must be a from → to range, e.g. 09:00 - 13:30"
    ),
  assignedStaffIds: z.array(z.string().max(64)).default([]),
  assignedManagerId: z.string().max(64).optional(),
  /** Internal work notes — never customer-facing. */
  notes: z.string().max(2000).optional(),
  /** A note written FOR the customer, subject to visibility. */
  customerNotes: z.string().max(2000).optional(),
  referralPartnerId: z.string().max(64).optional(),
  /** A whole-document discount, spread across the service lines. */
  discount: z.number().min(0).max(10000000).optional(),
  /** The Admin's choice for this job's invoice. GST unless told otherwise. */
  invoiceType: z.enum(["GST", "NON_GST"]).default("GST"),
  /** GST only: inter-state supply → IGST instead of CGST + SGST. */
  interState: z.boolean().optional().default(false),
  /** §6 What the customer may see for this job (over the company default). */
  customerVisibility: z.record(z.string(), z.boolean()).optional(),
});

/**
 * POST /api/jobs — creates a REAL booking: customer + property (inline or
 * existing), the job with its official service location, one or many priced
 * service lines, the checklist instantiated from the primary service rubric,
 * the customer-visibility configuration and a tax invoice — all in one
 * transaction. Requires `jobs.create`.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("jobs.create");
    const parsed = CreateJobSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid job payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;
    if (!d.serviceId && (!d.services || d.services.length === 0)) {
      return fail("Select at least one service for this job.", 400);
    }

    // Ops managers book only inside their dispatch window (policy, not scope).
    if (dispatchWindowApplies(user)) {
      const visibility = getOpsDateVisibility(new Date(), { nextDayDispatchTime: dispatchCutoffTime() });
      if (!visibility.isDateVisible(d.scheduledDate)) {
        return fail(`Scheduled date ${d.scheduledDate} is not yet open for dispatch.`, 409);
      }
    }

    // Crew validation + double-booking guard (mirrors PATCH /api/jobs/[id]).
    const crewIds = Array.from(new Set([...(d.assignedManagerId ? [d.assignedManagerId] : []), ...d.assignedStaffIds]));
    let assignedManagerId: string | null = d.assignedManagerId ?? null;
    if (crewIds.length > 0) {
      if (!can(user, "jobs.assign")) return fail("Your role may create bookings but not assign crews.", 403);
      const rows = await prisma.user.findMany({
        where: { id: { in: crewIds }, role: { in: ASSIGNABLE_ROLES }, active: true },
        select: { id: true, role: true },
      });
      const valid = new Map(rows.map((r) => [r.id, r.role]));
      if (crewIds.some((id) => !valid.has(id))) {
        return fail("One or more selected workers are not active field accounts.", 400);
      }
      if (!assignedManagerId) {
        assignedManagerId = d.assignedStaffIds.find((id) => valid.get(id) === "field_manager") ?? null;
      }
      const terminal = ["COMPLETED", "CANCELLED", "CLOSED"];
      const sameSlot = await prisma.job.findMany({
        where: {
          scheduledDate: d.scheduledDate,
          scheduledTimeSlot: d.scheduledTimeSlot,
          status: { notIn: terminal },
          OR: [{ assignedStaffIds: { hasSome: crewIds } }, { assignedManagerId: { in: crewIds } }],
        },
        select: { id: true },
      });
      if (sameSlot.length > 0) {
        return fail("Worker already booked on another job in this date & time slot (double-booking is not allowed).", 409);
      }
    }

    // Customer (inline creation supported).
    let customerId = d.customerId;
    let customerName = d.customerName ?? "Customer";
    let customerGstin: string | null = null;
    let customerAddress = "";
    if (!customerId) {
      if (!d.customerName || !d.customerPhone) {
        return fail("Customer name and phone are required for a new customer.", 400);
      }
      const partner = d.referralPartnerId
        ? await prisma.referralPartner.findUnique({ where: { id: d.referralPartnerId } })
        : null;
      const created = await prisma.customer.create({
        data: {
          name: d.customerName,
          phone: d.customerPhone,
          email: d.customerEmail || "",
          address: d.location?.address || d.propertyAddress || "",
          source: d.referralPartnerId ? "referral" : "direct",
          referralPartnerId: d.referralPartnerId,
          referralCode: partner?.code,
        },
      });
      customerId = created.id;
      customerAddress = created.address;
    } else {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) return fail("Customer not found.", 404);
      customerName = existing.name;
      customerGstin = existing.gstin;
      customerAddress = existing.address;
    }

    // §1 The service location: the map pin Admin confirmed, falling back to
    // the typed address and then to the customer's address on file.
    const serviceAddress =
      d.location?.address?.trim() || d.propertyAddress?.trim() || customerAddress || "";

    // Property (inline creation supported).
    let propertyId = d.propertyId;
    if (!propertyId) {
      if (!serviceAddress) return fail("A service address is required.", 400);
      const created = await prisma.property.create({
        data: {
          customerId,
          title: `${(d.customerName || customerName || "Customer").split(" ")[0]}'s Property`,
          address: serviceAddress,
          lat: d.location?.lat ?? null,
          lng: d.location?.lng ?? null,
        },
      });
      propertyId = created.id;
    } else {
      const existing = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!existing) return fail("Property not found.", 404);
      if (existing.customerId !== customerId) return fail("Property does not belong to this customer.", 400);
      // A property with no coordinates inherits the pin Admin just dropped, so
      // the next job at the same address can be GPS-verified from the start.
      if (d.location && hasCoords(d.location) && (existing.lat === null || existing.lng === null)) {
        await prisma.property.update({
          where: { id: propertyId },
          data: { lat: d.location.lat, lng: d.location.lng },
        });
      }
    }

    const settings = await getSystemSettings();
    // §6 The job's visibility: the Admin choice over the company default.
    const visibility = normalizeVisibility(
      d.customerVisibility,
      normalizeVisibility(settings.defaultCustomerVisibility, DEFAULT_CUSTOMER_VISIBILITY)
    );

    let result: { job: { id: string; status: string }; invoice: Prisma.InvoiceGetPayload<object>; serviceName: string };
    try {
      result = await prisma.$transaction(async (tx) => {
        // §3 One or many services → priced lines + the primary catalog service.
        const resolved = await resolveServiceLines(tx, {
          services: d.services,
          fallbackServiceId: d.serviceId,
        });
        const primary = await tx.service.findUnique({
          where: { id: resolved.primaryServiceId },
          include: { checklistTemplate: { orderBy: { position: "asc" } } },
        });
        if (!primary) throw new ServiceLineError("Service not found.", 404);

        const figures = computeDocumentFigures({
          invoiceType: d.invoiceType,
          lines: resolved.lines,
          gstRatePercent: settings.taxRatePercent,
          interState: d.interState,
          documentDiscount: d.discount,
        });
        const isGst = figures.invoiceType === "GST";

        const job = await tx.job.create({
          data: {
            jobSerial: await nextJobSerial(tx, customerName, d.scheduledDate),
            customerId: customerId!,
            propertyId: propertyId!,
            serviceId: primary.id,
            scheduledDate: d.scheduledDate,
            scheduledTimeSlot: d.scheduledTimeSlot,
            assignedStaffIds: d.assignedStaffIds,
            assignedManagerId,
            // The job value is the net service value; GST lives on the invoice.
            amount: Math.round((figures.taxable + figures.exempt) * 100) / 100,
            status: crewIds.length > 0 ? "ASSIGNED" : "SCHEDULED",
            notes: d.notes,
            customerNotes: d.customerNotes?.trim() || null,
            referralPartnerId: d.referralPartnerId,
            // §1 The official service location for this job.
            serviceAddress: serviceAddress || null,
            serviceLat: d.location?.lat ?? null,
            serviceLng: d.location?.lng ?? null,
            serviceLocationAccuracy: d.location?.accuracy ?? null,
            locationNotes: d.location?.notes?.trim() || null,
            // §6 Enforced on every customer-facing response, server-side.
            customerVisibility: visibility,
          },
        });

        await writeJobServiceLines(tx, job.id, resolved.lines);

        if (primary.checklistTemplate.length > 0) {
          await tx.jobChecklistItem.createMany({
            data: primary.checklistTemplate.map((item) => ({
              jobId: job.id,
              area: item.area,
              task: item.task,
              critical: item.critical,
            })),
          });
        }

        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await nextInvoiceNumber(tx, figures.invoiceType),
            invoiceType: figures.invoiceType,
            jobId: job.id,
            customerId: customerId!,
            subtotal: figures.subtotal,
            discount: figures.discount,
            tax: figures.tax,
            gstRate: figures.gstRate,
            cgst: figures.cgst,
            sgst: figures.sgst,
            igst: figures.igst,
            interState: isGst && d.interState,
            customerGstin: isGst ? customerGstin : null,
            supplierGstin: isGst ? settings.gstin?.trim() || null : null,
            total: figures.total,
            balanceDue: figures.total,
            dueDate: d.scheduledDate,
          },
        });

        await tx.customer.update({ where: { id: customerId! }, data: { totalBookings: { increment: 1 } } });
        if (d.referralPartnerId) {
          await tx.referralPartner.update({
            where: { id: d.referralPartnerId },
            data: { totalReferrals: { increment: 1 } },
          });
        }
        return { job, invoice, serviceName: resolved.primaryServiceName };
      });
    } catch (e) {
      if (e instanceof ServiceLineError) return fail(e.message, e.status);
      throw e;
    }

    logger.info("jobs.created", { jobId: result.job.id, by: user.id });
    void recordAudit({
      actor: user,
      action: "JOB_CREATED",
      entityType: "job",
      entityId: result.job.id,
      jobId: result.job.id,
      newState: result.job.status,
      details: `${result.serviceName} on ${d.scheduledDate} ${d.scheduledTimeSlot}`,
      request,
    });
    // §1/§12 The location decision is part of the job record from minute one.
    if (serviceAddress || d.location?.lat !== undefined) {
      void recordActivity({
        jobId: result.job.id,
        type: "STATUS_CHANGED",
        message: hasCoords(d.location ?? {})
          ? `Service location set — ${serviceAddress || "map pin"} (${d.location!.lat!.toFixed(5)}, ${d.location!.lng!.toFixed(5)})`
          : `Service location set — ${serviceAddress} (no map pin; arrival will need QR or a reason)`,
        actor: { id: user.id, name: user.name, role: user.role },
      }).catch(() => {});
    }

    void syncJobEvent(result.job.id).catch(() => {});
    void (async () => {
      try {
        const { ensureCustomerLink } = await import("@/lib/server/qr-service");
        await ensureCustomerLink(result.job.id, { id: user.id, name: user.name });
      } catch (e) {
        logger.warn("jobs.customer_link_ensure_failed", { jobId: result.job.id, error: e instanceof Error ? e.message : String(e) });
      }
    })();

    const full: JobRowWithJoins | null = await prisma.job.findUnique({
      where: { id: result.job.id },
      include: JOB_LIST_INCLUDE,
    });
    const names = await userNameMap();
    return NextResponse.json(
      {
        success: true,
        data: {
          job: full ? projectJob(user, withStaffNames(serializeJob(full), names)) : null,
          invoice: can(user, "finance.view") ? serializeInvoice(result.invoice) : undefined,
          checklist: await prisma.jobChecklistItem
            .findMany({ where: { jobId: result.job.id } })
            .then((rows) => rows.map(serializeChecklistItem)),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err, "jobs.post.route_error");
  }
}
