import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { authorizeJob } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";

/**
 * GET /api/feedback?jobId=... — sign-off + feedback snapshot for dashboards.
 * Reads the Job's own approval + feedback columns (single source of truth).
 * Feedback submission moved to the customer's ONE secure link.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ success: false, error: "jobId is required." }, { status: 400 });
    }
    // Only someone who may see this job may see its approval and rating.
    await authorizeJob(jobId, "jobs.view");

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
