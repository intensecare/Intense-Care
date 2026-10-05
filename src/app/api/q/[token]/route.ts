import { NextResponse } from "next/server";
import { resolveQrToken, clientIp, rateLimit, PURPOSE_SCOPE, type QrPurpose } from "@/lib/server/qr-service";
import { logger } from "@/lib/server/logger";

/**
 * GET /api/q/[token] — §29 QR verification handshake.
 *
 * The physical QR carries only this random token. On scan:
 *   1. rate-limit per IP (§36)
 *   2. full server validation chain (hash → revoke → expire → purpose → job
 *      status) — §27
 *   3. return the route scope ONLY (never job data — the scope page re-validates)
 */
export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const ip = clientIp(request);
    const rl = rateLimit(`q:${ip}`, 30, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: "Too many scans from this device. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSecs) } }
      );
    }

    const { token } = params;
    const resolved = await resolveQrToken(token);

    if (!resolved.ok) {
      const status =
        resolved.failure.kind === "not_found" ? 404 : resolved.failure.kind === "wrong_status" ? 409 : 410;
      return NextResponse.json({ success: false, error: resolved.failure.message, kind: resolved.failure.kind }, { status });
    }

    const purpose = resolved.data.tokenRow.purpose as QrPurpose;
    const scope = PURPOSE_SCOPE[purpose] ?? "customer";
    logger.info("qr.resolved", { jobId: resolved.data.job.id, purpose, scope });

    return NextResponse.json({
      success: true,
      data: { token, purpose, scope },
    });
  } catch (err) {
    logger.error("q.resolve.route_error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ success: false, error: "QR verification failed." }, { status: 500 });
  }
}
