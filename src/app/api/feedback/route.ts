import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/server/prisma";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { recordActivity } from "@/lib/server/activity";
import { resolveQrToken } from "@/lib/server/qr-service";

/** Invite tokens are stored only as SHA-256 hashes (see completion-service). */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

const BodySchema = z.object({
  token: z.string().min(16).max(200),
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(60)).max(10).default([]),
  comment: z.string().max(2000).optional(),
  googleReviewClicked: z.boolean().default(false),
});

/**
 * POST /api/feedback — records post-service customer feedback on the
 * completion invite (token-gated, public to the customer holding the link).
 *
 * Two token flavors are accepted so both handover surfaces agree:
 *  1. legacy completion-invite token (SHA-256 hash stored on the invite);
 *  2. unified QR CUSTOMER_APPROVAL token — the /approval/[token] page uses
 *     this one, so ratings submitted from the secure approval link land on
 *     the same invite record (§24: feedback is part of the single journey).
 * Raw tokens are never stored.
 */
export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "A valid link token and rating (1-5) are required." },
        { status: 400 }
      );
    }

    let invite = await prisma.completionInvite.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });

    // Fallback: unified QR approval token. Only a live, unexpired,
    // unrevoked CUSTOMER_APPROVAL token may attach feedback.
    if (!invite) {
      const resolved = await resolveQrToken(parsed.data.token, "CUSTOMER_APPROVAL");
      if (!resolved.ok) {
        return NextResponse.json(
          { success: false, error: "This link is invalid or has expired." },
          { status: 404 }
        );
      }
      const { tokenRow, job } = resolved.data;
      invite = await prisma.completionInvite.findFirst({
        where: { jobId: job.id },
        orderBy: { createdAt: "desc" },
      });
      if (!invite) {
        // Jobs approved purely through the QR journey may have no invite yet —
        // create a carrier record so the rating still lands on the job.
        invite = await prisma.completionInvite.create({
          data: {
            // Unique, non-secret carrier hash (the QR service never exposes
            // token hash material outside its module).
            tokenHash: `qr:${tokenRow.id}`,
            tokenLast4: tokenRow.id.slice(-4),
            jobId: job.id,
            customerId: job.customerId,
          },
        });
      }
    }

    const updated = await prisma.completionInvite.update({
      where: { id: invite.id },
      data: {
        feedbackRating: parsed.data.rating,
        feedbackTags: parsed.data.tags,
        feedbackComment: parsed.data.comment ?? null,
        googleReviewClicked: parsed.data.googleReviewClicked,
        feedbackAt: new Date(),
      },
    });

    logger.info("feedback.recorded", {
      inviteId: invite.id,
      jobId: invite.jobId,
      rating: parsed.data.rating,
    });

    // Live feed: ops/QC see customer feedback land the moment it happens.
    await recordActivity({
      jobId: invite.jobId,
      type: "FEEDBACK_RECORDED",
      message: `Customer rated the service ${parsed.data.rating}/5${parsed.data.comment ? ` — “${parsed.data.comment}”` : ""}`,
      actor: { name: "Customer", role: "customer" },
    });
    if (parsed.data.googleReviewClicked) {
      await recordActivity({
        jobId: invite.jobId,
        type: "GOOGLE_REVIEW_CLICKED",
        message: "Customer clicked through to Google Business review",
        actor: { name: "Customer", role: "customer" },
      });
    }

    return NextResponse.json({
      success: true,
      data: { feedbackAt: updated.feedbackAt?.toISOString() ?? null },
    });
  } catch (err) {
    return errorResponse(err, "feedback.post.route_error");
  }
}

/**
 * GET /api/feedback?jobId=... — reads feedback for a job (any authenticated
 * user; the payload is non-sensitive ratings data used by dashboards).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "jobId is required." },
        { status: 400 }
      );
    }

    const invite = await prisma.completionInvite.findFirst({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });

    // Full sign-off + feedback snapshot. The job record's Sign-off & Feedback
    // tab consumes EXACTLY this shape (signStatus/signatoryName/feedback*) —
    // the previous {rating, tags, comment} shape never matched the page's
    // field names, so submitted reviews silently never rendered.
    return NextResponse.json({
      success: true,
      data: invite
        ? {
            signStatus: invite.signStatus,
            signedAt: invite.signedAt?.toISOString() ?? null,
            signatoryName: invite.signatoryName ?? null,
            feedbackRating: invite.feedbackRating,
            feedbackTags: invite.feedbackTags ?? [],
            feedbackComment: invite.feedbackComment,
            googleReviewClicked: invite.googleReviewClicked,
            feedbackAt: invite.feedbackAt?.toISOString() ?? null,
          }
        : null,
    });
  } catch (err) {
    return errorResponse(err, "feedback.get.route_error");
  }
}
