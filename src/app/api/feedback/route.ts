import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { recordActivity } from "@/lib/server/activity";
import { resolveQrToken } from "@/lib/server/qr-service";

const BodySchema = z.object({
  token: z.string().min(16).max(200),
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(60)).max(10).default([]),
  comment: z.string().max(2000).optional(),
  googleReviewClicked: z.boolean().default(false),
});

/**
 * POST /api/feedback — records post-service customer feedback (§24).
 *
 * Token-gated, public to the customer holding the link: only a live,
 * unexpired, unrevoked unified QR CUSTOMER_APPROVAL token may attach
 * feedback. The rating is stored on the Job itself — one Job ID owns the
 * whole journey (approval, feedback, Google review click). Raw tokens are
 * never stored.
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

    const resolved = await resolveQrToken(parsed.data.token, "CUSTOMER_APPROVAL");
    if (!resolved.ok) {
      return NextResponse.json(
        { success: false, error: "This link is invalid or has expired." },
        { status: 404 }
      );
    }
    const { job } = resolved.data;

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        customerFeedbackRating: parsed.data.rating,
        googleReviewClicked: parsed.data.googleReviewClicked,
        // comment/tags are accepted for API compatibility but the unified
        // journey stores the rating + Google-review signal only.
        customerFeedbackAt: new Date(),
      },
    });

    logger.info("feedback.recorded", { jobId: job.id, rating: parsed.data.rating });

    // Live feed: ops/QC see customer feedback land the moment it happens.
    await recordActivity({
      jobId: job.id,
      type: "FEEDBACK_RECORDED",
      message: `Customer rated the service ${parsed.data.rating}/5${parsed.data.comment ? ` — “${parsed.data.comment}”` : ""}`,
      actor: { name: "Customer", role: "customer" },
    });
    if (parsed.data.googleReviewClicked) {
      await recordActivity({
        jobId: job.id,
        type: "GOOGLE_REVIEW_CLICKED",
        message: "Customer clicked through to Google Business review",
        actor: { name: "Customer", role: "customer" },
      });
    }

    return NextResponse.json({
      success: true,
      data: { feedbackAt: updated.customerFeedbackAt?.toISOString() ?? null },
    });
  } catch (err) {
    return errorResponse(err, "feedback.post.route_error");
  }
}

/**
 * GET /api/feedback?jobId=... — feedback snapshot for a job (any authenticated
 * user; non-sensitive ratings data used by dashboards). Reads the Job's own
 * approval + feedback columns — the single source of truth since the legacy
 * portal handover was removed.
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

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        status: true,
        approvedAt: true,
        approvedBy: true,
        customerFeedbackRating: true,
        googleReviewClicked: true,
        customerFeedbackAt: true,
      },
    });
    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
    }

    // Same field names the Sign-off & Feedback tab has always consumed.
    const signatory = job.approvedBy?.includes(":")
      ? job.approvedBy.slice(job.approvedBy.indexOf(":") + 1)
      : job.approvedBy;

    return NextResponse.json({
      success: true,
      data: {
        signStatus: job.approvedAt ? "APPROVED" : "PENDING",
        signedAt: job.approvedAt?.toISOString() ?? null,
        signatoryName: signatory ?? null,
        feedbackRating: job.customerFeedbackRating,
        feedbackTags: [] as string[],
        feedbackComment: null,
        googleReviewClicked: job.googleReviewClicked,
        feedbackAt: job.customerFeedbackAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    return errorResponse(err, "feedback.get.route_error");
  }
}
