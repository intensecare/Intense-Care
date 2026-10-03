import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/server/prisma";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { recordActivity } from "@/lib/server/activity";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * POST /api/portal/[token]/google-click — public, token-gated. Records the
 * instant the customer clicks through to the Google Business review page.
 *
 * This is intentionally separate from POST /api/feedback (which requires a
 * full rating): the whole point of the handover link is driving Google
 * reviews, and many customers tap "Review us on Google" without ever
 * submitting the in-app star form — that click was previously lost.
 */
export async function POST(
  _request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;
    const invite = await prisma.completionInvite.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!invite) {
      return NextResponse.json(
        { success: false, error: "This link is invalid or has expired." },
        { status: 404 }
      );
    }

    if (!invite.googleReviewClicked) {
      await prisma.completionInvite.update({
        where: { id: invite.id },
        data: { googleReviewClicked: true },
      });
    }

    await recordActivity({
      jobId: invite.jobId,
      type: "GOOGLE_REVIEW_CLICKED",
      message: "Customer clicked through to Google Business review",
      actor: { name: "Customer", role: "customer" },
    });

    logger.info("portal.google_review_clicked", { inviteId: invite.id, jobId: invite.jobId });
    return NextResponse.json({ success: true, data: { googleReviewClicked: true } });
  } catch (err) {
    return errorResponse(err, "portal.google_click.route_error");
  }
}
