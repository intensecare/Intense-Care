import { NextResponse } from "next/server";
import { normalizeCoords } from "@/lib/location";
import { validateCrew, createJobWithInvoice, cleanVisibility, afterJobCreated } from "@/lib/server/job-create";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, jobWhereFor, dispatchWindowApplies } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import {
  serializeJob,
  serializeInvoice,
  serializeChecklistItem,
  withStaffNames,
  fail,
  readJson,
  JOB_PROPERTY_SELECT,
} from "@/lib/server/serialize";
import { projectJob } from "@/lib/server/projections";
import { recordAudit } from "@/lib/server/audit";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import { dispatchCutoffTime } from "@/lib/server/policy";
import { getSystemSettings } from "@/lib/server/settings";
import { logger } from "@/lib/server/logger";
import { can } from "@/lib/rbac";

/** Include shape shared by every job-list fetch (display joins only). */
const JOB_LIST_INCLUDE = {
  customer: { select: { name: true, phone: true } },
  property: { select: JOB_PROPERTY_SELECT },
  service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
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
  serviceId: z.string().min(1).max(64),
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
  notes: z.string().max(2000).optional(),
  /** Notes the customer may see (internal notes stay in `notes`). */
  customerNotes: z.string().max(2000).optional(),
  referralPartnerId: z.string().max(64).optional(),
  propertyTitle: z.string().max(160).optional(),
  /** Service location (map pin). Defaults to the property's location. */
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  locationAddress: z.string().max(500).optional(),
  /** Save the pin on the property too, when the property has none yet. */
  saveLocationToProperty: z.boolean().optional(),
  /** Per-job customer visibility (unset keys follow the company default). */
  customerVisibility: z.record(z.string(), z.boolean()).optional(),
  /** The Admin's choice for this job's invoice; default follows the service's GST setting. */
  invoiceType: z.enum(["GST", "NON_GST"]).optional(),
  /** GST only: inter-state supply → IGST instead of CGST + SGST. */
  interState: z.boolean().optional().default(false),
});

/**
 * POST /api/jobs — creates a REAL booking: customer + property (inline or
 * existing), job, checklist instantiated from the service rubric, and a tax
 * invoice — all in one transaction. Requires `jobs.create`.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("jobs.create");
    const parsed = CreateJobSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid job payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    // Ops managers book only inside their dispatch window (policy, not scope).
    if (dispatchWindowApplies(user)) {
      const visibility = getOpsDateVisibility(new Date(), { nextDayDispatchTime: dispatchCutoffTime() });
      if (!visibility.isDateVisible(d.scheduledDate)) {
        return fail(`Scheduled date ${d.scheduledDate} is not yet open for dispatch.`, 409);
      }
    }

    const service = await prisma.service.findUnique({ where: { id: d.serviceId }, select: { id: true, name: true, active: true, gstTreatment: true } });
    if (!service) return fail("Service package not found. Create it on the Services page first.", 404);
    if (!service.active) return fail("This service package is inactive.", 409);

    const crew = await validateCrew(user, d);

    // Customer (inline creation supported).
    let customerId = d.customerId;
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
          address: d.propertyAddress || "",
          source: d.referralPartnerId ? "referral" : "direct",
          referralPartnerId: d.referralPartnerId,
          referralCode: partner?.code,
        },
      });
      customerId = created.id;
    } else {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) return fail("Customer not found.", 404);
    }

    // Property (inline creation supported). A map pin on a new property is kept.
    let propertyId = d.propertyId;
    if (!propertyId) {
      const address = d.propertyAddress || d.locationAddress;
      if (!address) return fail("Property address is required.", 400);
      const pin = normalizeCoords(d.locationLat, d.locationLng);
      if (!pin && (d.locationLat != null || d.locationLng != null)) return fail("The map location needs both latitude and longitude (and can't be 0, 0).", 400);
      const created = await prisma.property.create({
        data: {
          customerId,
          title: d.propertyTitle || `${(d.customerName || "Customer").split(" ")[0]}'s Property`,
          address,
          lat: pin?.lat ?? null,
          lng: pin?.lng ?? null,
          locationSource: pin ? "MAP_PIN" : null,
          locationUpdatedAt: pin ? new Date() : null,
        },
      });
      propertyId = created.id;
    }

    const settings = await getSystemSettings();
    const invoiceType = d.invoiceType ?? (service.gstTreatment === "NON_GST" ? "NON_GST" : "GST");
    const result = await createJobWithInvoice(
      {
        customerId,
        propertyId,
        serviceId: service.id,
        scheduledDate: d.scheduledDate,
        scheduledTimeSlot: d.scheduledTimeSlot,
        assignedManagerId: crew.assignedManagerId,
        assignedStaffIds: crew.assignedStaffIds,
        notes: d.notes,
        customerNotes: d.customerNotes,
        referralPartnerId: d.referralPartnerId,
        location:
          d.locationLat != null || d.locationLng != null || d.locationAddress
            ? { lat: d.locationLat ?? null, lng: d.locationLng ?? null, address: d.locationAddress ?? null }
            : null,
        saveLocationToProperty: d.saveLocationToProperty,
        customerVisibility: cleanVisibility(d.customerVisibility),
        invoice: { type: invoiceType, interState: d.interState },
      },
      settings
    );
    if (d.referralPartnerId) {
      await prisma.referralPartner.update({ where: { id: d.referralPartnerId }, data: { totalReferrals: { increment: 1 } } }).catch(() => {});
    }

    logger.info("jobs.created", { jobId: result.job.id, serviceId: service.id, by: user.id });
    void recordAudit({
      actor: user,
      action: "JOB_CREATED",
      entityType: "job",
      entityId: result.job.id,
      jobId: result.job.id,
      newState: result.job.status,
      details: `${service.name} on ${d.scheduledDate} ${d.scheduledTimeSlot}`,
      request,
    });
    afterJobCreated(result.job.id, user);

    const full = await prisma.job.findUnique({ where: { id: result.job.id }, include: JOB_LIST_INCLUDE });
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
