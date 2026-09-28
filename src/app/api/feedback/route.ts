import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/server/prisma";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

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
 * The invite's token is verified server-side; raw tokens are never stored.
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

    const invite = await prisma.completionInvite.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });
    if (!invite) {
      return NextResponse.json(
        { success: false, error: "This link is invalid or has expired." },
        { status: 404 }
      );
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

    return NextResponse.json({
      success: true,
      data: invite
        ? {
            rating: invite.feedbackRating,
            tags: invite.feedbackTags,
            comment: invite.feedbackComment,
            googleReviewClicked: invite.googleReviewClicked,
            feedbackAt: invite.feedbackAt?.toISOString() ?? null,
          }
        : null,
    });
  } catch (err) {
    return errorResponse(err, "feedback.get.route_error");
  }
}
