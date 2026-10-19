import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { mediaSummary } from "@/lib/server/media";

/** GET /api/media/summary[?refresh=1] — usage, quota / warning, file counts by category and type, largest files, safe-cleanup suggestions. */
export async function GET(request: Request) {
  try {
    await requirePermission("media.view");
    return ok(await mediaSummary({ refreshProvider: new URL(request.url).searchParams.get("refresh") === "1" }));
  } catch (err) {
    return errorResponse(err, "media.summary.route_error");
  }
}
