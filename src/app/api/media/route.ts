import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok } from "@/lib/server/serialize";
import { parsePaging } from "@/lib/server/biz";
import { filterItems, loadManagedItems, sortItems } from "@/lib/server/media";

/**
 * GET /api/media — the files the ERP manages (job photos, expense receipts), never raw storage paths.
 * Filters: category, type=image|video|document, q (file / Job ID / customer / uploader), minMb, from, to,
 * referenced=yes|no, protection=FREE|CONFIRM|PROTECTED|LOCKED; sort=newest|oldest|largest|smallest|name; page, pageSize.
 */
export async function GET(request: Request) {
  try {
    await requirePermission("media.view");
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k);
    const { page, pageSize, skip } = parsePaging(url, 50, 200);
    const minMb = Number(g("minMb"));
    const filtered = sortItems(
      filterItems(await loadManagedItems(), {
        category: g("category"),
        type: g("type"),
        q: g("q"),
        minBytes: minMb > 0 ? Math.round(minMb * 1024 * 1024) : null,
        from: g("from"),
        to: g("to"),
        referenced: g("referenced") === "yes" ? "yes" : g("referenced") === "no" ? "no" : null,
        protection: g("protection"),
        page,
        pageSize,
      }),
      g("sort")
    );
    return ok({
      rows: filtered.slice(skip, skip + pageSize),
      total: filtered.length,
      totalBytes: filtered.reduce((a, i) => a + (i.bytes ?? 0), 0),
      page,
      pageSize,
    });
  } catch (err) {
    return errorResponse(err, "media.get.route_error");
  }
}
