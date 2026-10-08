import { NextResponse } from "next/server";
import { nextJobSerial } from "@/lib/server/job-serial";
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
  nextDocNumber,
} from "@/lib/server/serialize";
import { projectJob } from "@/lib/server/projections";
import { recordAudit } from "@/lib/server/audit";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import { dispatchCutoffTime } from "@/lib/server/policy";
import { getSystemSettings } from "@/lib/server/settings";
import { getTaxRate } from "@/lib/tax";
import { logger } from "@/lib/server/logger";
import { ASSIGNABLE_ROLES, can } from "@/lib/rbac";

/** Service row including its rubric, used to instantiate the job checklist. */
const SERVICE_WITH_RUBRIC_INCLUDE = {
  checklistTemplate: { orderBy: { position: "asc" as const } },
} as const;

/** Include shape shared by every job-list fetch (display joins only). */
const JOB_LIST_INCLUDE = {
  customer: { select: { name: true, phone: true } },
  property: { select: { title: true, address: true } },
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
  referralPartnerId: z.string().max(64).optional(),
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
        { success: false, error: "Invalid job payload.", details: parsed.error.flatten() },
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

    const service = await prisma.service.findUnique({
      where: { id: d.serviceId },
      include: SERVICE_WITH_RUBRIC_INCLUDE,
    });
    if (!service) return fail("Service package not found. Create it on the Services page first.", 404);
    if (!service.active) return fail("This service package is inactive.", 409);

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

    // Property (inline creation supported).
    let propertyId = d.propertyId;
    if (!propertyId) {
      if (!d.propertyAddress) return fail("Property address is required.", 400);
      const created = await prisma.property.create({
        data: {
          customerId,
          title: `${(d.customerName || "Customer").split(" ")[0]}'s Property`,
          address: d.propertyAddress,
        },
      });
      propertyId = created.id;
    } else {
      const existing = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!existing) return fail("Property not found.", 404);
      if (existing.customerId !== customerId) return fail("Property does not belong to this customer.", 400);
    }

    const settings = await getSystemSettings();
    const taxRate = getTaxRate(settings);
    const subtotal = service.basePrice;
    const tax = Math.round(subtotal * taxRate * 100) / 100;

    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          jobSerial: await nextJobSerial(tx),
          customerId,
          propertyId,
          serviceId: service.id,
          scheduledDate: d.scheduledDate,
          scheduledTimeSlot: d.scheduledTimeSlot,
          assignedStaffIds: d.assignedStaffIds,
          assignedManagerId,
          amount: subtotal,
          status: crewIds.length > 0 ? "ASSIGNED" : "SCHEDULED",
          notes: d.notes,
          referralPartnerId: d.referralPartnerId,
        },
      });

      if (service.checklistTemplate.length > 0) {
        await tx.jobChecklistItem.createMany({
          data: service.checklistTemplate.map((item) => ({
            jobId: job.id,
            area: item.area,
            task: item.task,
            critical: item.critical,
          })),
        });
      }

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: nextDocNumber("INV"),
          jobId: job.id,
          customerId,
          subtotal,
          tax,
          total: subtotal + tax,
          balanceDue: subtotal + tax,
          dueDate: d.scheduledDate,
        },
      });

      await tx.customer.update({ where: { id: customerId }, data: { totalBookings: { increment: 1 } } });
      if (d.referralPartnerId) {
        await tx.referralPartner.update({
          where: { id: d.referralPartnerId },
          data: { totalReferrals: { increment: 1 } },
        });
      }
      return { job, invoice };
    });

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

    void syncJobEvent(result.job.id).catch(() => {});
    void (async () => {
      try {
        const { ensureCustomerLink } = await import("@/lib/server/qr-service");
        await ensureCustomerLink(result.job.id, { id: user.id, name: user.name });
      } catch (e) {
        logger.warn("jobs.customer_link_ensure_failed", { jobId: result.job.id, error: e instanceof Error ? e.message : String(e) });
      }
    })();

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
