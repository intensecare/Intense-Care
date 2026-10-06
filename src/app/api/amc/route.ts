import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { nextDocNumber } from "@/lib/server/serialize";

/** Audit-trail event for AMC actions (entityType "amc", visible on /audit). */
async function auditAmc(
  actorId: string,
  actorName: string,
  action: string,
  entityId: string,
  details: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: "amc",
        entityId,
        action,
        performedBy: `${actorId}:${actorName}`,
        details,
      },
    });
  } catch {
    // Audit logging must never fail the business action.
  }
}

/**
 * GET /api/amc — §2 AMC dashboard payload: every contract with its visits,
 * server-resolved display names (customer, property, service, crew).
 */
export async function GET() {
  try {
    await requireRole(["super_admin", "ops_manager"]);

    const contracts = await prisma.amcContract.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { name: true } },
        property: { select: { title: true } },
        visits: { orderBy: { visitNumber: "asc" } },
      },
    });

    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const services = await prisma.service.findMany({ select: { id: true, name: true } });
    const serviceNameById = new Map(services.map((s) => [s.id, s.name]));

    return NextResponse.json({
      success: true,
      data: contracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        customerId: c.customerId,
        propertyId: c.propertyId,
        serviceId: c.serviceId,
        customerName: c.customer?.name ?? null,
        propertyTitle: c.property?.title ?? null,
        serviceName: c.serviceId ? serviceNameById.get(c.serviceId) ?? null : null,
        nriContactName: c.nriContactName,
        nriContactPhone: c.nriContactPhone,
        nriContactEmail: c.nriContactEmail,
        localContactName: c.localContactName,
        localContactPhone: c.localContactPhone,
        startDate: c.startDate,
        endDate: c.endDate,
        contractValue: c.contractValue,
        includedServices: c.includedServices,
        visitCount: c.visitCount,
        frequency: c.frequency,
        assignedStaffIds: c.assignedStaffIds,
        assignedStaffNames: c.assignedStaffIds.map((id) => nameById.get(id)).filter(Boolean),
        emergencyContact: c.emergencyContact,
        paymentStatus: c.paymentStatus,
        status: c.status,
        notes: c.notes,
        createdAt: c.createdAt.toISOString(),
        visits: c.visits.map((v) => ({
          id: v.id,
          contractId: v.contractId,
          visitNumber: v.visitNumber,
          scheduledDate: v.scheduledDate,
          scheduledSlot: v.scheduledSlot,
          status: v.status,
          jobId: v.jobId,
          arrivedAt: v.arrivedAt?.toISOString() ?? null,
          completedAt: v.completedAt?.toISOString() ?? null,
          staffIds: v.staffIds,
          staffNames: v.staffIds.map((id) => nameById.get(id)).filter(Boolean),
          qcScore: v.qcScore,
          issuesFound: v.issuesFound,
          recommendations: v.recommendations,
          nriApproved: v.nriApproved,
          nriNotes: v.nriNotes,
          reminderSentAt: v.reminderSentAt?.toISOString() ?? null,
          createdAt: v.createdAt.toISOString(),
        })),
      })),
    });
  } catch (err) {
    return errorResponse(err, "amc.get.route_error");
  }
}

const CreateSchema = z.object({
  customerId: z.string().min(1),
  propertyId: z.string().min(1),
  serviceId: z.string().min(1).optional().nullable(),
  nriContactName: z.string().max(120).optional().nullable(),
  nriContactPhone: z.string().max(32).optional().nullable(),
  nriContactEmail: z.string().max(160).optional().nullable(),
  localContactName: z.string().max(120).optional().nullable(),
  localContactPhone: z.string().max(32).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contractValue: z.number().nonnegative(),
  includedServices: z.array(z.string().max(120)).max(50).default([]),
  visitCount: z.number().int().min(1).max(200),
  frequency: z.enum(["WEEKLY", "BIMONTHLY", "MONTHLY", "QUARTERLY", "CUSTOM"]),
  assignedStaffIds: z.array(z.string()).max(20).default([]),
  emergencyContact: z.string().max(160).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/** POST /api/amc — create a contract and auto-generate its visit schedule. */
export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin", "ops_manager"]);
    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid AMC contract payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const [customer, property] = await Promise.all([
      prisma.customer.findUnique({ where: { id: d.customerId } }),
      prisma.property.findUnique({ where: { id: d.propertyId } }),
    ]);
    if (!customer) return NextResponse.json({ success: false, error: "Customer not found." }, { status: 404 });
    if (!property || property.customerId !== d.customerId) {
      return NextResponse.json(
        { success: false, error: "Property not found for this customer." },
        { status: 404 }
      );
    }

    // Spread the requested visit count evenly between start and end date —
    // the last visit always lands within the contract window.
    const startMs = new Date(`${d.startDate}T00:00:00`).getTime();
    const endMs = new Date(`${d.endDate}T00:00:00`).getTime();
    if (!(endMs > startMs)) {
      return NextResponse.json(
        { success: false, error: "End date must be after the start date." },
        { status: 400 }
      );
    }
    const step = (endMs - startMs) / d.visitCount;
    const visitDates = Array.from({ length: d.visitCount }, (_, i) =>
      new Date(startMs + step * i).toISOString().slice(0, 10)
    );

    const contract = await prisma.amcContract.create({
      data: {
        contractNumber: nextDocNumber("AMC"),
        customerId: d.customerId,
        propertyId: d.propertyId,
        serviceId: d.serviceId ?? null,
        nriContactName: d.nriContactName ?? null,
        nriContactPhone: d.nriContactPhone ?? null,
        nriContactEmail: d.nriContactEmail ?? null,
        localContactName: d.localContactName ?? null,
        localContactPhone: d.localContactPhone ?? null,
        startDate: d.startDate,
        endDate: d.endDate,
        contractValue: d.contractValue,
        includedServices: d.includedServices,
        visitCount: d.visitCount,
        frequency: d.frequency,
        assignedStaffIds: d.assignedStaffIds,
        emergencyContact: d.emergencyContact ?? null,
        notes: d.notes ?? null,
        visits: {
          create: visitDates.map((date, i) => ({
            visitNumber: i + 1,
            scheduledDate: date,
            staffIds: d.assignedStaffIds,
          })),
        },
      },
    });

    logger.info("amc.contract_created", {
      contractId: contract.id,
      visits: visitDates.length,
      by: user.id,
    });
    void auditAmc(
      user.id,
      user.name,
      "CONTRACT_CREATED",
      contract.id,
      `${contract.contractNumber} — ${d.visitCount} visits, ${d.frequency}, ₹${d.contractValue}`
    );
    return NextResponse.json({ success: true, data: { id: contract.id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "amc.post.route_error");
  }
}
