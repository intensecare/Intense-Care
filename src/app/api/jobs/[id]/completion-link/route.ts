import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/authz";
import { sendCompletionInvite } from "@/lib/server/completion-service";
import { errorResponse } from "@/lib/server/http";

/**
 * POST /api/jobs/[id]/completion-link — mints (or refreshes) the tokenized
 * customer handover invite. The link is shown once to the operations desk to
 * share with the customer over any channel; no server-side messaging is
 * involved. Allowed only after QC pass. Managers/admins only.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(["super_admin", "ops_manager"]);

    const origin = request.headers.get("origin");
    const result = await sendCompletionInvite(params.id, { baseUrl: origin ?? undefined });

    if (!result.success) {
      const status =
        result.failure.kind === "not_found"
          ? 404
          : result.failure.kind === "wrong_status"
          ? 409
          : 429; // cooldown | rate_limited
      return NextResponse.json(
        { success: false, error: result.failure.message, code: result.failure.kind },
        { status }
      );
    }

    // The raw token is returned exactly once so the ERP UI can display/copy
    // the link for the ops desk to hand to the customer.
    return NextResponse.json({ success: true, data: result.data });
  } catch (err) {
    return errorResponse(err, "completion_link.route_error");
  }
}
