import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server/authz";
import { prisma } from "@/lib/server/prisma";
import { maskPhone } from "@/lib/server/logger";
import { errorResponse } from "@/lib/server/http";

/**
 * GET /api/notifications/sms — masked audit trail of every outbound gateway
 * dispatch (arrival/rework/completion notices). Managers/admins only; recipients are
 * masked, no message bodies or provider session ids are exposed.
 */
export async function GET() {
  try {
    await requirePermission("notifications.view");

    const logs = await prisma.smsLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      success: true,
      data: logs.map((l) => ({
        id: l.id,
        jobId: l.jobId,
        purpose: l.purpose,
        provider: l.provider,
        status: l.status,
        error: l.errorMessage,
        recipientMasked: maskPhone(l.phone),
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    return errorResponse(err, "notifications.sms.route_error");
  }
}
