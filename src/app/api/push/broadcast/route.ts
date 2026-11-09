import { z } from "zod";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { rateLimit } from "@/lib/server/qr-service";
import { messages, pushToUsers, userIdsWithRole } from "@/lib/server/push";

const Body = z.object({
  title: z.string().trim().min(3).max(60),
  body: z.string().trim().min(3).max(200),
  roles: z.array(z.enum(["admin", "field_operations_manager"])).min(1).default(["field_operations_manager"]),
  /** Sending the same key twice sends once. */
  idempotencyKey: z.string().min(8).max(80),
});

/** POST /api/push/broadcast — an important ERP update to a group of staff phones (Admin). Don't put customer or money details in it. */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("notifications.send");
    if (!rateLimit(`push-broadcast:${user.id}`, 10, 60 * 60 * 1000).ok) return fail("Too many announcements this hour.", 429);
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid announcement.", 400);
    const { title, body, roles, idempotencyKey } = parsed.data;
    const ids = await userIdsWithRole(roles);
    const r = await pushToUsers(ids, messages.update(title, body), () => `broadcast:${idempotencyKey}`);
    void recordAudit({ actor: user, action: "PUSH_BROADCAST", entityType: "push", entityId: idempotencyKey, details: `${roles.join(",")} → sent ${r.SENT}, no phone ${r.SKIPPED}, failed ${r.FAILED}, duplicate ${r.DUPLICATE}`, request });
    return ok({ recipients: ids.length, ...r });
  } catch (err) {
    return errorResponse(err, "push.broadcast.route_error");
  }
}
