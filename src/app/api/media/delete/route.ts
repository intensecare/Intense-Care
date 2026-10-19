import { z } from "zod";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { rateLimit } from "@/lib/server/qr-service";
import { deleteMedia, loadManagedItems, scanUnreferenced } from "@/lib/server/media";
import { PROTECTED_DELETE_PHRASE, type MediaItem } from "@/lib/media";

const Body = z.object({
  ids: z.array(z.string().min(1).max(300)).min(1).max(100),
  /** true = show what would happen, change nothing. */
  preview: z.boolean().default(false),
  /** Must be true to actually delete. */
  confirm: z.boolean().default(false),
  /** Only for PROTECTED media: a written reason (10+ characters) and the typed phrase. */
  override: z.object({ reason: z.string().trim().min(10).max(500), phrase: z.string() }).nullable().optional(),
});

/**
 * POST /api/media/delete — remove files, or preview the removal.
 *  preview: returns each file's name, size, type, Job ID, whether a record uses it and its protection.
 *  confirm: removes the files the policy allows (re-checked now); the response says what happened to each.
 * LOCKED files are never removed; PROTECTED files only with `override` — kept in the permanent audit trail.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("media.manage");
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) return fail("Choose 1 to 100 files.", 400);
    const { ids, preview, confirm, override } = parsed.data;

    if (preview) {
      const wanted = new Set(ids);
      const managed = (await loadManagedItems()).filter((i) => wanted.has(i.id));
      const found = new Set(managed.map((i) => i.id));
      const items: MediaItem[] = [...managed];
      if (ids.some((i) => i.startsWith("cl:") && !found.has(i))) items.push(...(await scanUnreferenced()).items.filter((i) => wanted.has(i.id)));
      const count = (l: string) => items.filter((i) => i.protection.level === l).length;
      return ok({
        items,
        missing: ids.filter((i) => !items.some((x) => x.id === i)),
        totalBytes: items.reduce((a, i) => a + (i.bytes ?? 0), 0),
        counts: { free: count("FREE"), confirm: count("CONFIRM"), protected: count("PROTECTED"), locked: count("LOCKED") },
        phrase: PROTECTED_DELETE_PHRASE,
      });
    }

    if (!confirm) return fail("Confirm the deletion first.", 400);
    if (!rateLimit(`media-delete:${user.id}`, 20, 10 * 60 * 1000).ok) return fail("Too many deletions. Wait a few minutes.", 429);
    const results = await deleteMedia({ ids, override: override ?? null, actor: { id: user.id, name: user.name } });
    const deleted = results.filter((r) => r.outcome === "DELETED");
    const usedOverride = deleted.some((r) => r.level === "PROTECTED");
    void recordAudit({
      actor: user,
      action: usedOverride ? "MEDIA_PROTECTED_DELETED" : "MEDIA_DELETED",
      entityType: "media",
      entityId: "bulk",
      reason: usedOverride ? override?.reason : undefined,
      details: `deleted ${deleted.length}, refused ${results.filter((r) => r.outcome === "REFUSED").length}, failed ${results.filter((r) => r.outcome === "FAILED").length}`,
      request,
    });
    return ok({ results, deleted: deleted.length });
  } catch (err) {
    return errorResponse(err, "media.delete.route_error");
  }
}
