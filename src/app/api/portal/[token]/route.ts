import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { resolveInviteByToken } from "@/lib/server/completion-service";
import { logger, maskPhone } from "@/lib/server/logger";

/**
 * GET /api/portal/[token] — public, tokenized customer handover payload.
 * Resolved entirely server-side so the SMS link works on any device. The raw
 * token is only ever consumed by hash lookup; responses expose masked data.
 */
export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;
    const resolved = await resolveInviteByToken(token);

    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "This link is invalid or has expired." },
        { status: 404 }
      );
    }

    const { invite, job } = resolved;
    const customer = await prisma.customer.findUnique({ where: { id: job.customerId } });
    const property = await prisma.property.findFirst({
      where: { id: job.propertyId },
    });
    const qc = await prisma.qualityCheck.findFirst({
      where: { jobId: job.id },
      orderBy: { createdAt: "desc" },
    });
    const photos = await prisma.jobPhoto.findMany({
      where: { jobId: job.id },
      orderBy: { uploadedAt: "asc" },
    });
    // The handover page renders the completed cleaning checklist — without
    // this the client crashed reading `.length` of undefined.
    const checklist = await prisma.jobChecklistItem.findMany({
      where: { jobId: job.id },
      orderBy: [{ area: "asc" }, { id: "asc" }],
    });

    // The Google review URL must be resolved SERVER-side: the portal is a
    // public page whose visitor has no ERP session, so client-side settings
    // used to fall back to defaults and the review CTA silently vanished.
    const settingsRow = await prisma.systemSettings.findUnique({ where: { id: "singleton" } });
    const settingsData = (settingsRow?.data ?? {}) as { googleBusinessReviewUrl?: string; companyName?: string };

    return NextResponse.json({
      success: true,
      data: {
        job: {
          id: job.id,
          status: job.status,
          serviceName: job.service?.name ?? null,
          scheduledDate: job.scheduledDate,
          scheduledTimeSlot: job.scheduledTimeSlot,
        },
        customer: customer
          ? { name: customer.name, phoneMasked: maskPhone(customer.phone) }
          : null,
        company: {
          name: settingsData.companyName || "Intense Care",
          googleReviewUrl: settingsData.googleBusinessReviewUrl || "",
        },
        property: property
          ? { title: property.title, address: property.address }
          : null,
        qualityCheck: qc
          ? { score: qc.score, decision: qc.decision, inspectorId: qc.inspectorId, createdAt: qc.createdAt }
          : null,
        photos: photos.map((p) => ({
          id: p.id,
          area: p.area,
          photoType: p.photoType as "before" | "after",
          photoUrl: p.photoUrl,
          thumbnailUrl: p.thumbnailUrl,
          caption: p.caption,
          uploadedAt: p.uploadedAt.toISOString(),
        })),
        checklist: checklist.map((c) => ({
          id: c.id,
          area: c.area,
          task: c.task,
          completed: c.status === "completed",
        })),
        invite: {
          signStatus: invite.signStatus,
          signedAt: invite.signedAt,
          signatoryName: invite.signatoryName,
          createdAt: invite.createdAt,
        },
      },
    });
  } catch (err) {
    logger.error("portal.get.route_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: "Failed to load the service handover." },
      { status: 500 }
    );
  }
}
