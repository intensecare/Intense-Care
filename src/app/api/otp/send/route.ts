import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeadWorker } from "@/lib/server/authz";
import { sendArrivalOtp } from "@/lib/server/otp-service";
import { errorResponse } from "@/lib/server/http";

const BodySchema = z.object({
  jobId: z.string().min(1).max(64),
});

/**
 * POST /api/otp/send — sends the arrival OTP to the registered customer phone
 * via 2Factor. Session-authenticated; job-state validated server-side.
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

    // Lead-only gate: only the first-assigned field worker (or ops/admin) may
    // request the customer arrival OTP for this job.
    const { user } = await authorizeLeadWorker(parsed.data.jobId);

    const result = await sendArrivalOtp(parsed.data.jobId, {
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
    return errorResponse(err, "otp.send.route_error");
  }
}
