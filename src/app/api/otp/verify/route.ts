import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, authorizeLeadWorker } from "@/lib/server/authz";
import { verifyArrivalOtp } from "@/lib/server/otp-service";
import { prisma } from "@/lib/server/prisma";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

const BodySchema = z.object({
  jobId: z.string().min(1).max(64),
  code: z.string().min(4).max(10),
});

/**
 * POST /api/otp/verify — verifies the customer OTP server-side (constant-time
 * hash comparison, expiry, attempt budget) and advances the job to
 * CUSTOMER_VERIFIED on success. The OTP itself is never returned.
 */
export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "jobId and 6-digit code are required." },
        { status: 400 }
      );
    }

    const { jobId, code } = parsed.data;

    // Lead-only gate: only the first-assigned field worker (or ops/admin) may
    // verify the customer OTP and unlock the job.
    const { user } = await authorizeLeadWorker(jobId);

    // Job must exist and be in ARRIVED state for verification to apply.
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found." },
        { status: 404 }
      );
    }
    if (job.status !== "ARRIVED") {
      return NextResponse.json(
        {
          success: false,
          error: `OTP verification applies only while the job is ARRIVED (current: ${job.status}).`,
        },
        { status: 409 }
      );
    }

    const result = await verifyArrivalOtp(jobId, code);
    if (!result.success) {
      const status =
        result.failure.kind === "not_found"
          ? 404
          : result.failure.kind === "expired" || result.failure.kind === "locked" || result.failure.kind === "wrong_status"
          ? 409
          : 401;
      return NextResponse.json(
        { success: false, error: result.failure.message, code: result.failure.kind },
        { status }
      );
    }

    // Authoritative state transition: ARRIVED -> CUSTOMER_VERIFIED.
    const now = new Date();
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "CUSTOMER_VERIFIED", updatedAt: now },
    });

    logger.info("otp.verify.job_transitioned", {
      jobId,
      from: "ARRIVED",
      to: "CUSTOMER_VERIFIED",
      verifiedBy: user.id,
    });

    return NextResponse.json({
      success: true,
      data: { ...result.data, jobStatus: "CUSTOMER_VERIFIED" },
    });
  } catch (err) {
    return errorResponse(err, "otp.verify.route_error");
  }
}
