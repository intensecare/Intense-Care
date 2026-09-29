import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/authz";
import { getTwoFactorBalance } from "@/lib/server/twofactor";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

/**
 * GET /api/sms/balance — live 2Factor account credit check (super_admin).
 *
 * Read-only provider probe; no SMS is sent. Surfaces account balance so a
 * silent delivery failure (provider accepts AUTOGEN sends while credits are
 * exhausted at the route level) becomes visible from the ERP instead of only
 * from a customer's empty inbox. Errors are reported but never thrown — the
 * endpoint degrades to { configured: false } or an error detail payload.
 */
export async function GET() {
  try {
    await requireRole(["super_admin"]);

    const balance = await getTwoFactorBalance();
    if (!balance.configured) {
      return NextResponse.json({ success: true, data: { configured: false, mode: balance.mode } });
    }
    if (!balance.ok) {
      return NextResponse.json(
        { success: true, data: { configured: true, mode: balance.mode, error: balance.error } },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        configured: true,
        mode: balance.mode,
        otpSmsCredits: balance.otpSmsCredits ?? null,
        transactionalSmsCredits: balance.transactionalSmsCredits ?? null,
      },
    });
  } catch (err) {
    logger.error("sms.balance.route_error", { error: String(err) });
    return errorResponse(err, "sms.balance.route_error");
  }
}
