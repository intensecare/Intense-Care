import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

/**
 * PATCH /api/amc/[id] — contract & visit lifecycle actions:
 *   { action: "reschedule_visit", visitId, scheduledDate, scheduledSlot? }
 *   { action: "remind_visit", visitId }                  → marks reminder sent
 *   { action: "complete_visit", visitId, ...NRI report } → visit completed
 *   { action: "nri_approval", visitId, nriApproved, nriNotes? }
 *   { action: "update_contract", paymentStatus?, status?, notes? }
 *
 * AMC visits are lightweight records outside the strict job state machine;
 * completing a visit records the §2 NRI report fields verbatim.
 */
const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reschedule_visit"),
    visitId: z.string().min(1),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduledSlot: z.string().max(64).optional().nullable(),
  }),
  z.object({
    action: z.literal("remind_visit"),
    visitId: z.string().min(1),
  }),
  z.object({
    action: z.literal("complete_visit"),
    visitId: z.string().min(1),
    arrivedAt: z.string().datetime().optional().nullable(),
    completedAt: z.string().datetime().optional().nullable(),
    otpVerified: z.boolean().optional(),
    staffIds: z.array(z.string()).max(20).optional(),
    qcScore: z.number().int().min(0).max(100).optional().nullable(),
    issuesFound: z.string().max(2000).optional().nullable(),
    recommendations: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("nri_approval"),
    visitId: z.string().min(1),
    nriApproved: z.boolean(),
    nriNotes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("update_contract"),
    paymentStatus: z.enum(["PENDING", "PARTIAL", "PAID"]).optional(),
    status: z.enum(["ACTIVE", "EXPIRING_SOON", "EXPIRED", "CANCELLED"]).optional(),
    notes: z.string().max(2000).optional().nullable(),
  }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { user } = await requireRole(["super_admin", "ops_manager"]);
    const { id } = params;

    const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid AMC action payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const contract = await prisma.amcContract.findUnique({ where: { id } });
    if (!contract) {
      return NextResponse.json({ success: false, error: "AMC contract not found." }, { status: 404 });
    }

    switch (body.action) {
      case "reschedule_visit": {
        const visit = await prisma.amcVisit.findFirst({
          where: { id: body.visitId, contractId: id },
        });
        if (!visit) {
          return NextResponse.json({ success: false, error: "Visit not found." }, { status: 404 });
        }
        await prisma.amcVisit.update({
          where: { id: visit.id },
          data: {
            scheduledDate: body.scheduledDate,
            scheduledSlot: body.scheduledSlot ?? visit.scheduledSlot,
            status: "RESCHEDULED",
          },
        });
        logger.info("amc.visit_rescheduled", { contractId: id, visitId: visit.id, by: user.id });
        return NextResponse.json({ success: true });
      }

      case "remind_visit": {
        const visit = await prisma.amcVisit.findFirst({
          where: { id: body.visitId, contractId: id },
        });
        if (!visit) {
          return NextResponse.json({ success: false, error: "Visit not found." }, { status: 404 });
        }
        await prisma.amcVisit.update({
          where: { id: visit.id },
          data: { reminderSentAt: new Date(), status: visit.status === "SCHEDULED" ? "REMINDED" : visit.status },
        });
        logger.info("amc.visit_reminder_marked", { contractId: id, visitId: visit.id, by: user.id });
        return NextResponse.json({ success: true });
      }

      case "complete_visit": {
        const visit = await prisma.amcVisit.findFirst({
          where: { id: body.visitId, contractId: id },
        });
        if (!visit) {
          return NextResponse.json({ success: false, error: "Visit not found." }, { status: 404 });
        }
        await prisma.amcVisit.update({
          where: { id: visit.id },
          data: {
            status: "COMPLETED",
            arrivedAt: body.arrivedAt ? new Date(body.arrivedAt) : visit.arrivedAt ?? new Date(),
            completedAt: body.completedAt ? new Date(body.completedAt) : new Date(),
            otpVerified: body.otpVerified ?? visit.otpVerified,
            staffIds: body.staffIds ?? visit.staffIds,
            qcScore: body.qcScore ?? visit.qcScore,
            issuesFound: body.issuesFound ?? visit.issuesFound,
            recommendations: body.recommendations ?? visit.recommendations,
          },
        });
        logger.info("amc.visit_completed", { contractId: id, visitId: visit.id, by: user.id });
        return NextResponse.json({ success: true });
      }

      case "nri_approval": {
        const visit = await prisma.amcVisit.findFirst({
          where: { id: body.visitId, contractId: id },
        });
        if (!visit) {
          return NextResponse.json({ success: false, error: "Visit not found." }, { status: 404 });
        }
        await prisma.amcVisit.update({
          where: { id: visit.id },
          data: { nriApproved: body.nriApproved, nriNotes: body.nriNotes ?? null },
        });
        return NextResponse.json({ success: true });
      }

      case "update_contract": {
        await prisma.amcContract.update({
          where: { id },
          data: {
            ...(body.paymentStatus ? { paymentStatus: body.paymentStatus } : {}),
            ...(body.status ? { status: body.status } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
          },
        });
        return NextResponse.json({ success: true });
      }
    }
  } catch (err) {
    return errorResponse(err, "amc.patch.route_error");
  }
}
