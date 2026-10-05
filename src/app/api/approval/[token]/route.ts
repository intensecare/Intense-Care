import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/server/prisma";
import { resolveQrToken, clientIp, rateLimit } from "@/lib/server/qr-service";
import { recordActivity } from "@/lib/server/activity";
import { logger } from "@/lib/server/logger";
import { notifyReworkAssigned } from "@/lib/server/notify";

/**
 * /approval/{token} API — §21, §22, §23, §27, §30.
 *
 * Purpose scope: CUSTOMER_APPROVAL only (a verification/customer link can
 * never approve). APPROVE is idempotent and records approved_by / approved_at
 * / approval_method + UA/IP hash on the JOB, the token usage, and the audit
 * feed. REPORT creates a Complaint + rework dispatch and never double-approves.
 */

function fail(error: string, status: number, kind?: string) {
  return NextResponse.json({ success: false, error, ...(kind ? { kind } : {}) }, { status });
}

function hashIp(ip: string | null): string | undefined {
  if (!ip) return undefined;
  const salt = process.env.ERP_SESSION_SECRET || "portal-sign-ip";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`appr:${clientIp(request)}`, 60, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const resolved = await resolveQrToken(params.token, "CUSTOMER_APPROVAL");
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { job } = resolved.data;

    const [checklist, photos, qc, jobRow, team, complaintCount] = await Promise.all([
      prisma.jobChecklistItem.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } }),
      prisma.jobPhoto.findMany({ where: { jobId: job.id }, orderBy: { uploadedAt: "asc" } }),
      prisma.qualityCheck.findFirst({ where: { jobId: job.id }, orderBy: { createdAt: "desc" } }),
      prisma.job.findUnique({
        where: { id: job.id },
        select: {
          approvedAt: true,
          approvedBy: true,
          approvalMethod: true,
          completedAt: true,
          arrivedAt: true,
          status: true,
        },
      }),
      prisma.job
        .findUnique({ where: { id: job.id }, select: { assignedStaffIds: true } })
        .then(async (j) =>
          j && j.assignedStaffIds.length
            ? (await prisma.user.findMany({ where: { id: { in: j.assignedStaffIds } }, select: { name: true } })).map((u) => u.name)
            : []
        ),
      prisma.complaint.count({ where: { jobId: job.id } }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        job: {
          id: job.id,
          status: job.status,
          serviceName: (await prisma.service.findUnique({ where: { id: job.serviceId }, select: { name: true } }))?.name ?? "Service",
          scheduledDate: job.scheduledDate,
          arrivedAt: jobRow?.arrivedAt?.toISOString() ?? null,
          completedAt: jobRow?.completedAt?.toISOString() ?? null,
        },
        property: { title: job.propertyName, address: job.propertyAddress },
        customer: { name: job.customerName },
        team,
        checklist: checklist.map((c) => ({ id: c.id, area: c.area, task: c.task, completed: c.status === "completed" })),
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
        complaintCount,
        company: {
          name: process.env.APP_COMPANY_NAME || "Intense Care",
          googleReviewUrl: process.env.GOOGLE_BUSINESS_REVIEW_URL || "",
        },
      },
    });
  } catch (err) {
    logger.error("approval.get.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Failed to load the handover page.", 500);
  }
}

const ApproveSchema = z.object({
  action: z.literal("approve"),
  signatoryName: z.string().min(2).max(120),
  confirmChecked: z.boolean(),
});

const ComplaintSchema = z.object({
  action: z.literal("complaint"),
  category: z.enum(["missed_area", "quality", "damage", "staff_behavior", "other"]),
  description: z.string().min(5).max(2000),
  signatoryName: z.string().max(120).optional(),
});

export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = rateLimit(`appr-post:${clientIp(request)}`, 15, 60 * 1000);
    if (!rl.ok) return fail("Too many requests. Please slow down.", 429);

    const body = await request.json().catch(() => null);
    const resolved = await resolveQrToken(params.token, "CUSTOMER_APPROVAL");
    if (!resolved.ok) {
      const status = resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "forbidden" ? 403 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return fail(resolved.failure.message, status, resolved.failure.kind);
    }
    const { tokenRow, job } = resolved.data;

    /* ---------------- §22 APPROVE (idempotent) ---------------- */
    if (body?.action === "approve") {
      const parsed = ApproveSchema.safeParse(body);
      if (!parsed.success) return fail("Please enter your name and tick the confirmation checkbox.", 400);
      if (!parsed.data.confirmChecked) return fail("Please tick the confirmation checkbox to approve.", 400);

      const jobRow = await prisma.job.findUnique({
        where: { id: job.id },
        select: { status: true, approvedAt: true, customerId: true },
      });
      if (!jobRow) return fail("Job not found.", 404);

      // §30 — already approved: same success, no duplicate record.
      if (jobRow.approvedAt) {
        return NextResponse.json({
          success: true,
          data: { alreadyApproved: true, approvedAt: jobRow.approvedAt.toISOString(), status: jobRow.status },
        });
      }
      if (!["PASS", "CUSTOMER_APPROVAL"].includes(jobRow.status)) {
        return fail(`Approval is open only after QC passes (current: ${jobRow.status}).`, 409);
      }

      const now = new Date();
      const ua = request.headers.get("user-agent") || undefined;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          approvedAt: now,
          approvedBy: `${tokenRow.id}:${parsed.data.signatoryName}`,
          approvalMethod: "secure_link",
          completedAt: jobRow.status === "PASS" ? now : undefined,
          updatedAt: now,
        },
      });

      // Mirror the sign-off onto the newest completion invite (idempotent —
      // invite stays PENDING when the approval came through the QR approval
      // route, so both surfaces agree).
      const invite = await prisma.completionInvite.findFirst({
        where: { jobId: job.id, signStatus: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (invite) {
        await prisma.completionInvite.update({
          where: { id: invite.id },
          data: {
            signStatus: "APPROVED",
            signedAt: now,
            signatoryName: parsed.data.signatoryName,
            signUserAgent: ua?.slice(0, 500),
            signIpHash: hashIp(request.headers.get("x-forwarded-for")),
          },
        });
      }

      await recordActivity({
        jobId: job.id,
        type: "CUSTOMER_SIGNED",
        message: `Customer approved completion via secure approval link — ${parsed.data.signatoryName}`,
        actor: { name: parsed.data.signatoryName, role: "customer" },
      });
      logger.info("approval.granted", { jobId: job.id, tokenId: tokenRow.id });

      return NextResponse.json({
        success: true,
        data: { alreadyApproved: false, approvedAt: now.toISOString(), status: "COMPLETED" },
      });
    }

    /* ---------------- §23 REPORT AN ISSUE ---------------- */
    if (body?.action === "complaint") {
      const parsed = ComplaintSchema.safeParse(body);
      if (!parsed.success) return fail("Please describe the issue (at least 5 characters).", 400);

      const jobRow = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true, customerId: true } });
      if (!jobRow) return fail("Job not found.", 404);

      const opsManager = await prisma.user.findFirst({
        where: { role: "ops_manager", active: true },
        orderBy: { createdAt: "asc" },
      });

      const complaint = await prisma.complaint.create({
        data: {
          jobId: job.id,
          customerId: jobRow.customerId,
          category: parsed.data.category,
          severity: "high",
          description: parsed.data.description,
          assignedOwnerId: opsManager?.id ?? null,
          assignedOwnerName: opsManager?.name ?? "Operations",
        },
      });

      await recordActivity({
        jobId: job.id,
        type: "ATTENTION_REQUESTED",
        message: `Customer reported an issue via secure link (${parsed.data.category.replace("_", " ")}): ${parsed.data.description}`,
        actor: { name: parsed.data.signatoryName || job.customerName || "Customer", role: "customer" },
      });
      void notifyReworkAssigned(job.id).catch(() => {});
      logger.info("approval.complaint_created", { jobId: job.id, complaintId: complaint.id });

      return NextResponse.json({ success: true, data: { complaintId: complaint.id, status: "open" } }, { status: 201 });
    }

    return fail("Unknown action.", 400);
  } catch (err) {
    logger.error("approval.post.route_error", { error: err instanceof Error ? err.message : String(err) });
    return fail("Action failed due to a server error.", 500);
  }
}
