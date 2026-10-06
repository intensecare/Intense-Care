import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { resolveQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { recordActivity } from "@/lib/server/activity";
import { logger } from "@/lib/server/logger";

/**
 * /customer/job/{token} API — §7, §8, §9, §22, §23, §27, §30.
 *
 * Purpose scopes: CUSTOMER_JOB (view), CUSTOMER_VERIFICATION (view + confirm),
 * CUSTOMER_APPROVAL (view + approve). Every action:
 *   token validation chain → role/purpose check → idempotent write → audit.
 * The customer NEVER sees internal notes, finance internals, or other jobs.
 */

function fail(error: string, status: number, kind?: string) {
  return NextResponse.json({ success: false, error, ...(kind ? { kind } : {}) }, { status });
}

async function loadTeamNames(jobId: string): Promise<string[]> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { assignedStaffIds: true } });
  if (!job || job.assignedStaffIds.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: job.assignedStaffIds } }, select: { name: true } });
  return users.map((u) => u.name).filter(Boolean);
}

/** GET — minimum-info customer payload (§9). */
export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`cjob:${clientIp(request)}`, 60, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    // §28 RBAC: only the two customer purposes may open this workflow — the
    // resolver 403s foreign tokens BEFORE any job-status probing.
    const resolved = await resolveQrToken(params.token, ["CUSTOMER_JOB", "CUSTOMER_VERIFICATION"]);
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { tokenRow, job } = resolved.data;
    const purpose = tokenRow.purpose;

    const [checklist, photos, qc, team] = await Promise.all([
      prisma.jobChecklistItem.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } }),
      prisma.jobPhoto.findMany({ where: { jobId: job.id }, orderBy: { uploadedAt: "asc" } }),
      prisma.qualityCheck.findFirst({ where: { jobId: job.id }, orderBy: { createdAt: "desc" } }),
      loadTeamNames(job.id),
    ]);

    const jobRow = await prisma.job.findUnique({
      where: { id: job.id },
      select: {
        arrivedAt: true,
        completedAt: true,
        customerConfirmedAt: true,
        approvedAt: true,
        approvedBy: true,
        approvalMethod: true,
        arrivalVerification: true,
      },
    });

    // §9 minimum info only — no notes, no amounts, no other customers.
    return NextResponse.json({
      success: true,
      data: {
        purpose,
        canConfirm: ["CUSTOMER_VERIFICATION", "CUSTOMER_JOB"].includes(purpose),
        canApprove: purpose === "CUSTOMER_APPROVAL",
        job: {
          id: job.id,
          status: job.status,
          serviceName: (await prisma.service.findUnique({ where: { id: job.serviceId }, select: { name: true } }))?.name ?? "Service",
          scheduledDate: job.scheduledDate,
          scheduledTimeSlot: job.scheduledTimeSlot,
          arrivedAt: jobRow?.arrivedAt?.toISOString() ?? null,
          completedAt: jobRow?.completedAt?.toISOString() ?? null,
          customerConfirmedAt: jobRow?.customerConfirmedAt?.toISOString() ?? null,
          arrivalVerified: jobRow?.arrivalVerification === "gps" || jobRow?.arrivalVerification === "manual",
        },
        property: { title: job.propertyName, address: job.propertyAddress },
        customer: { name: job.customerName, phoneMasked: `******${job.customerPhone.replace(/[^0-9]/g, "").slice(-4)}` },
        team,
        checklist: checklist.map((c) => ({ id: c.id, area: c.area, task: c.task, completed: c.status === "completed", status: c.status })),
        photos: photos.map((p) => ({
          id: p.id,
          area: p.area,
          photoType: p.photoType,
          url: `/api/secure-photo/${p.id}?t=${encodeURIComponent(params.token)}`,
          thumbnailUrl: p.thumbnailUrl,
          caption: p.caption,
          uploadedAt: p.uploadedAt.toISOString(),
        })),
        qualityCheck: qc ? { score: qc.score, decision: qc.decision, passed: qc.decision === "PASS" } : null,
        approval: jobRow?.approvedAt
          ? { approvedAt: jobRow.approvedAt.toISOString(), approvedBy: jobRow.approvedBy, method: jobRow.approvalMethod }
          : null,
      },
    });
  } catch (err) {
    logger.error("customer.job.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Failed to load your service page.", 500);
  }
}

const ConfirmSchema = z.object({ action: z.literal("confirm") });

/** POST — idempotent customer actions. */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`cjob-post:${clientIp(request)}`, 20, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";

    const resolved = await resolveQrToken(params.token);
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { tokenRow, job } = resolved.data;
    const customerName = job.customerName || "Customer";

    /* ---------------- §7 CONFIRM & START (idempotent) ---------------- */
    if (action === "confirm") {
      const parsed = ConfirmSchema.safeParse(body);
      if (!parsed.success) return fail("Invalid payload.", 400);
      if (!["CUSTOMER_VERIFICATION", "CUSTOMER_JOB"].includes(tokenRow.purpose)) {
        return fail("This link cannot confirm a service start.", 403);
      }
      const jobRow = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, customerConfirmedAt: true } });
      if (!jobRow) return fail("Job not found.", 404);

      // §30 idempotency — already verified: return the same success state.
      if (["CUSTOMER_VERIFIED", "IN_PROGRESS", "WORK_COMPLETED"].includes(jobRow.status) || jobRow.customerConfirmedAt) {
        return NextResponse.json({ success: true, data: { alreadyConfirmed: true, status: jobRow.status } });
      }
      if (jobRow.status !== "ARRIVED" && jobRow.status !== "ASSIGNED") {
        return fail(`Confirmation is possible only while the team is on site (current: ${jobRow.status}).`, 409);
      }

      const now = new Date();
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "CUSTOMER_VERIFIED", customerConfirmedAt: now, updatedAt: now },
      });
      await recordActivity({
        jobId: job.id,
        type: "STATUS_CHANGED",
        message: `Customer confirmed team arrival via secure link${customerName ? ` — ${customerName}` : ""}`,
        actor: { name: customerName, role: "customer" },
      });
      logger.info("customer.confirmed", { jobId: job.id, purpose: tokenRow.purpose });
      return NextResponse.json({ success: true, data: { alreadyConfirmed: false, status: "CUSTOMER_VERIFIED" } });
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    logger.error("customer.job.post.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Action failed due to a server error.", 500);
  }
}
