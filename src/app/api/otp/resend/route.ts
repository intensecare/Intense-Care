import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeadWorker } from "@/lib/server/authz";
import { resendArrivalOtp } from "@/lib/server/otp-service";
import { errorResponse } from "@/lib/server/http";

const BodySchema = z.object({
  jobId: z.string().min(1).max(64),
});

/**
 * POST /api/otp/resend — re-sends a fresh arrival OTP. The server enforces the
 * resend cooldown and hourly caps; a new code supersedes all previous ones.
 */
export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "jobId is required." },
        { status: 400 }
      );
    }

    // Lead-only gate: same rule as first-send — the non-lead assigned workers
    // can never trigger SMS re-delivery of the customer OTP.
    const { user } = await authorizeLeadWorker(parsed.data.jobId);

    const result = await resendArrivalOtp(parsed.data.jobId, {
      id: user.id,
      role: user.role,
    });

    if (!result.success) {
      const status =
        result.failure.kind === "not_found"
          ? 404
          : result.failure.kind === "wrong_status" || result.failure.kind === "already_verified"
          ? 409
          : result.failure.kind === "cooldown" || result.failure.kind === "rate_limited"
          ? 429
          : 502;
      return NextResponse.json(
        { success: false, error: result.failure.message, code: result.failure.kind },
        { status }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (err) {
    return errorResponse(err, "otp.resend.route_error");
  }
}
