import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, HttpError } from "@/lib/server/authz";
import { rateLimit } from "@/lib/server/qr-service";
import { aiConfigured, AiUnavailableError } from "@/lib/server/ai/provider";
import { runChat, type ChatEvent } from "@/lib/server/ai/chat";
import type { AiPrincipal } from "@/lib/server/ai/tools";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";

/**
 * INTENSE AI chat — internal ERP users only (permission `ai.use`). The
 * assistant sees exactly what the signed-in user may see — every data tool
 * re-checks RBAC on the server. Intense AI is not available to customers:
 * there is no token-based or unauthenticated path into this route, by
 * design — a direct request without a valid session is refused here, not
 * just hidden from the customer portal's UI.
 * The AI key stays on the server; the browser only talks to this route.
 */

const BodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

async function principalFrom(): Promise<AiPrincipal> {
  const { user } = await requirePermission("ai.use");
  const rl = rateLimit(`ai-user:${user.id}`, 40, 10 * 60 * 1000);
  if (!rl.ok) throw new HttpError(429, "You've asked a lot in a short time. Please wait a few minutes.");
  return { kind: "user", user };
}

/** GET — is Intense AI available? Internal users only. */
export async function GET() {
  try {
    await requirePermission("ai.use");
    return NextResponse.json({ success: true, data: { enabled: aiConfigured() } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "ai.chat.get_error");
  }
}

/** POST { messages } → a stream of JSON lines (status / delta / done / error). Internal users only. */
export async function POST(request: Request) {
  let principal: AiPrincipal;
  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Please type a question (up to 4,000 characters)." }, { status: 400 });
    body = parsed.data;
    if (body.messages[body.messages.length - 1].role !== "user") return NextResponse.json({ success: false, error: "The last message must be a question." }, { status: 400 });
    principal = await principalFrom();
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
