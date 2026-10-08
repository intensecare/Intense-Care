import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, HttpError } from "@/lib/server/authz";
import { resolveQrToken, rateLimit, clientIp } from "@/lib/server/qr-service";
import { aiConfigured, AiUnavailableError } from "@/lib/server/ai/provider";
import { runChat, type ChatEvent } from "@/lib/server/ai/chat";
import type { AiPrincipal } from "@/lib/server/ai/tools";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

/**
 * INTENSE AI chat.
 *   Signed-in users (permission ai.use): the assistant sees exactly what the
 *   user may see — every data tool re-checks RBAC on the server.
 *   Customers: pass the job's QR `token`; the assistant sees only that job.
 * The AI key stays on the server; the browser only talks to this route.
 */

const BodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
  token: z.string().min(10).max(200).optional(),
});

async function principalFrom(request: Request, token?: string): Promise<AiPrincipal> {
  if (token) {
    const rl = rateLimit(`ai-customer:${clientIp(request)}`, 20, 10 * 60 * 1000);
    if (!rl.ok) throw new HttpError(429, "Too many questions. Please wait a few minutes.");
    const resolved = await resolveQrToken(token);
    if (!resolved.ok) throw new HttpError(resolved.failure.kind === "not_found" ? 404 : 410, "This service link is no longer active.");
    return { kind: "customer", jobId: resolved.data.job.id, customerName: resolved.data.job.customerName || "Customer" };
  }
  const { user } = await requirePermission("ai.use");
  const rl = rateLimit(`ai-user:${user.id}`, 40, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, "You've asked a lot in a short time. Please wait a few minutes.");
  return { kind: "user", user };
}

/** GET — is Intense AI available? (?token=… for the customer page) */
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") || undefined;
    if (token) {
      const resolved = await resolveQrToken(token);
      if (!resolved.ok) return NextResponse.json({ success: false, error: "This service link is no longer active." }, { status: 410 });
    } else {
      await requirePermission("ai.use");
    }
    return NextResponse.json({ success: true, data: { enabled: aiConfigured() } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "ai.chat.get_error");
  }
}

/** POST { messages, token? } → a stream of JSON lines (status / delta / done / error). */
export async function POST(request: Request) {
  let principal: AiPrincipal;
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Please type a question (up to 4,000 characters)." }, { status: 400 });
    body = parsed.data;
    if (body.messages[body.messages.length - 1].role !== "user") return NextResponse.json({ success: false, error: "The last message must be a question." }, { status: 400 });
    principal = await principalFrom(request, body.token);
    if (!aiConfigured()) {
      return NextResponse.json({ success: false, error: "Intense AI isn't set up yet. Ask your administrator to add the AI key." }, { status: 503 });
    }
  } catch (err) {
    return errorResponse(err, "ai.chat.post_error");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        await runChat(principal, body.messages.slice(-20), send, request.signal);
      } catch (err) {
        if (request.signal.aborted) {
          // The user pressed Stop or left — nothing to report.
        } else if (err instanceof AiUnavailableError) {
          send({ type: "error", message: err.message });
        } else {
          logger.error("ai.chat.stream_error", { error: err instanceof Error ? err.message : String(err) });
          send({ type: "error", message: "Something went wrong while answering. Please try again." });
        }
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
