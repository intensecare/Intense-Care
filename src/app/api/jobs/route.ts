import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { syncJobEvent } from "@/lib/server/google-calendar";
import {
  serializeJob,
  redactJobForOps,
  serializeInvoice,
  serializeChecklistItem,
  withStaffNames,
  ok,
  fail,
  readJson,
  nextDocNumber,
} from "@/lib/server/serialize";
import { getOpsDateVisibility, filterJobsForOpsManager } from "@/lib/ops-visibility";
import { dispatchCutoffTime } from "@/lib/server/policy";
import { getSystemSettings } from "@/lib/server/settings";
import { getTaxRate } from "@/lib/tax";
import { logger } from "@/lib/server/logger";

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

interface JobDisplayContext {
  /** id → name; ops_manager/staff cannot read the user directory, so names
   *  are resolved here rather than in the client. */
  userNameById: Map<string, string>;
}

/**
 * Batch-resolves worker display names for every dispatch surface.
 */
async function buildJobDisplayContext(): Promise<JobDisplayContext> {
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  return {
    userNameById: new Map(users.map((u) => [u.id, u.name])),
  };
}

/**
 * GET /api/jobs — the operational job register hydrated from the database.
 * Staff receive only jobs they are DIRECTLY assigned to (worker or manager);
 * ops_managers receive only jobs within the dispatch visibility window
 * (past + today, plus tomorrow after the configured cutoff) — enforced
 * server-side, not just in the UI; super_admins receive all.
 */
export async function GET() {
  try {
    const { user } = await requireRole(["super_admin", "ops_manager", "staff"]);

    let jobs;
    if (user.role === "super_admin") {
      jobs = await prisma.job.findMany({
        orderBy: { updatedAt: "desc" },
        include: JOB_LIST_INCLUDE,
      });
      const ctx = await buildJobDisplayContext();
      return NextResponse.json({
        success: true,
        data: jobs.map((j) =>
          withStaffNames(serializeJob(j), ctx.userNameById)
        ),
      });
    }

    // ops_manager + staff: dispatch data only — amounts and payment status
    // are redacted at the API boundary (server-enforced, not UI-hidden).
    if (user.role === "ops_manager") {
      const all = await prisma.job.findMany({
        orderBy: { updatedAt: "desc" },
        include: JOB_LIST_INCLUDE,
      });
      const visibility = getOpsDateVisibility(new Date(), {
        nextDayDispatchTime: dispatchCutoffTime(),
      });
      jobs = filterJobsForOpsManager(all, visibility);
    } else {
      jobs = await prisma.job.findMany({
        where: {
          OR: [
            { assignedManagerId: user.id },
            { assignedStaffIds: { has: user.id } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        include: JOB_LIST_INCLUDE,
      });
    }

    const ctx = await buildJobDisplayContext();
    return NextResponse.json({
      success: true,
      data: (jobs as JobListRow[]).map((j) =>
        withStaffNames(
          redactJobForOps(serializeJob(j)),
          ctx.userNameById
        )
      ),
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
    // Free from/to window ("HH:MM - HH:MM", 24h) — any times the ops desk sets.
    // Legacy "09:00 AM - 01:30 PM" style strings remain valid for compatibility.
    .regex(
      /^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$|^\d{1,2}:\d{2}\s*[AP]M\s*[-–]\s*\d{1,2}:\d{2}\s*[AP]M$/i,
      "Time window must be a from → to range, e.g. 09:00 - 13:30"
    ),
  assignedStaffIds: z.array(z.string().max(64)).default([]),
  notes: z.string().max(2000).optional(),
  referralPartnerId: z.string().max(64).optional(),
});

/**
 * POST /api/jobs — creates a REAL booking in the database:
 * customer + property (inline or existing), job, checklist instantiated from
 * the service rubric, and a GST invoice computed from company settings —
 * all in one transaction. This is the source of truth; nothing is stored
 * only in the client.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin", "ops_manager"]);
    const parsed = CreateJobSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid job payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    // Ops Managers book only inside their dispatch window (past/today, plus
    // tomorrow after the cutoff) — same rule the GET enforces, so a crafted
    // POST cannot schedule beyond it. Super admins are unrestricted.
    if (user.role === "ops_manager") {
      const visibility = getOpsDateVisibility(new Date(), {
        nextDayDispatchTime: dispatchCutoffTime(),
      });
      if (!visibility.isDateVisible(d.scheduledDate)) {
        return NextResponse.json(
          {
            success: false,
            error: `Scheduled date ${d.scheduledDate} is not yet open for dispatch.`,
          },
          { status: 409 }
        );
      }
    }

    // --- Service + rubric ---------------------------------------------------
    const service = await prisma.service.findUnique({
      where: { id: d.serviceId },
      include: SERVICE_WITH_RUBRIC_INCLUDE,
    });
    if (!service) return fail("Service package not found. Create it on the Services page first.", 404);
    if (!service.active) return fail("This service package is inactive.", 409);

    // --- Customer (inline creation supported) --------------------------------
    let customerId = d.customerId;
    if (!customerId) {
      if (!d.customerName || !d.customerPhone) {
        return fail("Customer name and phone are required for a new customer.", 400);
      }
      const created = await prisma.customer.create({
        data: {
          name: d.customerName,
          phone: d.customerPhone,
          email: d.customerEmail || "",
          address: d.propertyAddress || "",
          source: d.referralPartnerId ? "referral" : "direct",
          referralPartnerId: d.referralPartnerId,
          referralCode: d.referralPartnerId
            ? (await prisma.referralPartner.findUnique({ where: { id: d.referralPartnerId } }))?.code
            : undefined,
        },
      });
      customerId = created.id;
    } else {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) return fail("Customer not found.", 404);
    }

    // --- Property (inline creation supported) --------------------------------
    let propertyId = d.propertyId;
    if (!propertyId) {
      if (!d.propertyAddress) {
        return fail("Property address is required.", 400);
      }
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
    }

    // --- Job + checklist + invoice in one transaction ------------------------
    const settings = await getSystemSettings();
    const taxRate = getTaxRate(settings);
    const subtotal = service.basePrice;
    const tax = Math.round(subtotal * taxRate * 100) / 100;

    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          customerId,
          propertyId,
          serviceId: service.id,
          scheduledDate: d.scheduledDate,
          scheduledTimeSlot: d.scheduledTimeSlot,
          assignedStaffIds: d.assignedStaffIds,
          amount: subtotal,
          status: d.assignedStaffIds.length > 0 ? "ASSIGNED" : "SCHEDULED",
          notes: d.notes,
          referralPartnerId: d.referralPartnerId,
        },
      });

      // Instantiate the working checklist from the company-authored rubric.
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

      // The booking counts toward the customer's lifetime booking total.
      await tx.customer.update({
        where: { id: customerId },
        data: { totalBookings: { increment: 1 } },
      });

      // Referred booking: count the referral on the partner immediately.
      if (d.referralPartnerId) {
        await tx.referralPartner.update({
          where: { id: d.referralPartnerId },
          data: { totalReferrals: { increment: 1 } },
        });
      }

      return { job, invoice };
    });

    logger.info("jobs.created", {
      jobId: result.job.id,
      serviceId: service.id,
      checklistItems: service.checklistTemplate.length,
      by: "api",
    });

    // §1 Google Calendar: one event per booking (customer, service, time,
    // address, team, contact, job id). Env-gated and fire-and-forget — a
    // calendar outage can never fail a booking.
    void syncJobEvent(result.job.id).catch(() => {});

    // Re-fetch with relations for the hydrated client shape. The invoice is
    // financial data: only returned to super_admins (ops/staff never see it).
    const full = await prisma.job.findUnique({
      where: { id: result.job.id },
      include: {
        customer: { select: { name: true, phone: true } },
        property: { select: { title: true, address: true } },
        service: { select: { id: true, name: true, basePrice: true, estimatedDurationHours: true } },
      },
    });

    const isSuperAdmin = user.role === "super_admin";
    // Fresh job: resolve names for the store.
    const createdCtx = await buildJobDisplayContext();
    return NextResponse.json(
      {
        success: true,
        data: {
          job: full
            ? withStaffNames(
                isSuperAdmin
                  ? serializeJob(full)
                  : redactJobForOps(serializeJob(full)),
                createdCtx.userNameById
              )
            : null,
          invoice: isSuperAdmin ? serializeInvoice(result.invoice) : undefined,
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
