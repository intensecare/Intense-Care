import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { fail, readJson } from "@/lib/server/serialize";
import { sendTemplate, sendText, SendError } from "@/lib/server/whatsapp/send";
import { serializeMessages } from "@/lib/server/whatsapp/serialize";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), contactId: z.string().min(1).max(64), clientRequestId: z.string().min(8).max(80), text: z.string().max(4096) }),
  z.object({ kind: z.literal("template"), contactId: z.string().min(1).max(64), clientRequestId: z.string().min(8).max(80), templateId: z.string().min(1).max(64), params: z.array(z.string().max(300)).max(20).default([]) }),
]);

/**
 * POST /api/whatsapp/send — reply from the ERP through the official Cloud API. Needs `leads.manage`.
 * The response status of the returned message is ACCEPTED at best: it means WhatsApp took the request,
 * not that the customer has it. SENT / DELIVERED / READ arrive later from Meta's status webhooks.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("leads.manage");
    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid message.", 400);
    const d = parsed.data;
    const common = { contactId: d.contactId, clientRequestId: d.clientRequestId, actor: user, request };
    const r = d.kind === "text" ? await sendText({ ...common, text: d.text }) : await sendTemplate({ ...common, templateId: d.templateId, params: d.params });
    const [message] = await serializeMessages([r.message]);
    return NextResponse.json({ success: true, data: { message, duplicate: r.duplicate } }, { status: r.duplicate ? 200 : 201 });
  } catch (err) {
    if (err instanceof SendError) {
      return NextResponse.json({ success: false, error: err.message, code: err.code, retryAfterSec: err.retryAfterSec }, { status: err.status, headers: err.retryAfterSec ? { "Retry-After": String(err.retryAfterSec) } : undefined });
    }
    return errorResponse(err, "whatsapp.send.route_error");
  }
}
