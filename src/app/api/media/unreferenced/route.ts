import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail } from "@/lib/server/serialize";
import { rateLimit } from "@/lib/server/qr-service";
import { scanUnreferenced } from "@/lib/server/media";

/**
 * GET /api/media/unreferenced — files nothing refers to: receipts attached to no expense, and files in cloud
 * storage that have no photo record (older than 24 h, so an upload in progress is never caught). It also lists
 * photo records whose cloud file is gone. Reviewing only — removal goes through POST /api/media/delete.
 */
export async function GET() {
  try {
    const { user } = await requirePermission("media.view");
    if (!rateLimit(`media-scan:${user.id}`, 10, 10 * 60 * 1000).ok) return fail("Wait a few minutes before scanning again.", 429);
    return ok(await scanUnreferenced());
  } catch (err) {
    return errorResponse(err, "media.unreferenced.route_error");
  }
}
