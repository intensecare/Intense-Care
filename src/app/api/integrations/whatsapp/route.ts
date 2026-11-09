import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { fail, ok, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { resolveBaseUrl } from "@/lib/server/policy";
import { getIntegration, healthSnapshot, testConnection } from "@/lib/server/whatsapp/config";
import { syncTemplates } from "@/lib/server/whatsapp/send";

export const dynamic = "force-dynamic";

/**
 * Admin-only WhatsApp integration page API (`integrations.manage`).
 * GET   → status and health. Secrets are reported only as set / not set — their values never leave the server.
 * PATCH → the two non-secret IDs.
 * POST  → { action: "test" } connection test, or { action: "sync-templates" }.
 */
async function status(request: Request) {
  return healthSnapshot(resolveBaseUrl(new URL(request.url).origin));
}

export async function GET(request: Request) {
  try {
    await requirePermission("integrations.manage");
    return ok(await status(request));
  } catch (err) {
    return errorResponse(err, "integrations.whatsapp.get_error");
  }
}

const id = z.string().trim().regex(/^\d{5,25}$/, "IDs are numbers (copy them from WhatsApp Manager → API setup)").nullable().optional().or(z.literal(""));
const Patch = z.object({ wabaId: id, phoneNumberId: id });

export async function PATCH(request: Request) {
  try {
    const { user } = await requirePermission("integrations.manage");
    const p = Patch.safeParse(await readJson(request));
    if (!p.success) return fail(p.error.issues[0]?.message || "Invalid IDs.", 400);
    const data: Record<string, string | null> = {};
    if (p.data.wabaId !== undefined) data.wabaId = p.data.wabaId || null;
    if (p.data.phoneNumberId !== undefined) data.phoneNumberId = p.data.phoneNumberId || null;
    const before = await getIntegration();
    await prisma.whatsAppIntegration.update({ where: { id: "singleton" }, data: { ...data, updatedBy: user.id, ...(data.phoneNumberId !== undefined && data.phoneNumberId !== before.phoneNumberId ? { connectionStatus: "UNKNOWN", lastCheckError: null } : {}) } });
    void recordAudit({ actor: user, action: "WHATSAPP_SETTINGS_CHANGED", entityType: "integration", entityId: "whatsapp", details: `Changed: ${Object.keys(data).join(", ") || "nothing"}`, request });
    return ok(await status(request));
  } catch (err) {
    return errorResponse(err, "integrations.whatsapp.patch_error");
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("integrations.manage");
    const body = await readJson(request);
    if (body?.action === "test") {
      const r = await testConnection();
      void recordAudit({ actor: user, action: "WHATSAPP_CONNECTION_TESTED", entityType: "integration", entityId: "whatsapp", details: r.ok ? "connected" : "failed", request });
      return ok({ test: { ok: r.ok, message: r.message }, status: await status(request) });
    }
    if (body?.action === "sync-templates") {
      const r = await syncTemplates();
      void recordAudit({ actor: user, action: "WHATSAPP_TEMPLATES_SYNCED", entityType: "integration", entityId: "whatsapp", details: `${r.synced} synced, ${r.deactivated} switched off`, request });
      return ok({ ...r, status: await status(request) });
    }
    return fail("Unknown action.", 400);
  } catch (err) {
    return errorResponse(err, "integrations.whatsapp.post_error");
  }
}
