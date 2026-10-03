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
/**
 * Best-effort public origin of the incoming request. `Origin` is preferred,
 * but proxies/load balancers (Vercel included) may omit it — the forwarded
 * host/proto headers are the reliable fallback. This is what keeps generated
 * links pointing at whichever domain the desk is actually using.
 */
function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin && /^https?:\/\//.test(origin)) return origin;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return null;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(["super_admin", "ops_manager"]);

    const result = await sendCompletionInvite(params.id, { baseUrl: requestOrigin(request) ?? undefined });

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
