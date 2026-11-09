import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/server/logger";
import { validSignature } from "@/lib/server/webhook-signature";
import { appSecret, safeEqual, verifyToken, resolvedIds } from "@/lib/server/whatsapp/config";
import { processPending, storeEvents } from "@/lib/server/whatsapp/ingest";
import { parseWebhook } from "@/lib/whatsapp";

/**
 * WhatsApp Business Platform (Cloud API) webhook — the official, verified integration only.
 * Personal WhatsApp / WhatsApp Web is never automated.
 *
 * Configure in Meta for Developers → your app → WhatsApp → Configuration:
 *   Callback URL  = APP_BASE_URL/api/webhooks/whatsapp      (public HTTPS)
 *   Verify token  = WHATSAPP_WEBHOOK_VERIFY_TOKEN
 *   Subscribe to the "messages" field (incoming messages AND delivery statuses).
 *
 * POST: the raw body must carry Meta's X-Hub-Signature-256 (HMAC-SHA256 with WHATSAPP_APP_SECRET) or it is
 * rejected before anything is parsed. Valid events are written to the WhatsAppEvent table (unique per
 * message/status, so Meta's retries are no-ops), then processed — we wait briefly so the common case is done
 * before we answer, and answer 200 regardless once the events are safely stored. Failed processing is retried by
 * /api/cron/maintenance. Without the env variables the endpoint answers 503 and stores nothing.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expected = verifyToken();
  if (!expected) return new NextResponse("Not configured", { status: 503 });
  const url = new URL(request.url);
  const given = url.searchParams.get("hub.verify_token") ?? "";
  if (url.searchParams.get("hub.mode") === "subscribe" && safeEqual(given, expected)) {
    await prisma.whatsAppIntegration.upsert({ where: { id: "singleton" }, create: { id: "singleton", lastVerifiedAt: new Date() }, update: { lastVerifiedAt: new Date() } }).catch(() => {});
    const challenge = (url.searchParams.get("hub.challenge") ?? "").slice(0, 200);
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

let lastSigNote = 0;

export async function POST(request: Request) {
  const secret = appSecret();
  if (!secret || !verifyToken()) return new NextResponse("Not configured", { status: 503 });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 1_000_000) return new NextResponse("Too large", { status: 413 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return new NextResponse("Too large", { status: 413 });
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    logger.warn("whatsapp.webhook.bad_signature");
    if (Date.now() - lastSigNote > 10_000) {
      lastSigNote = Date.now();
      await prisma.whatsAppIntegration.upsert({ where: { id: "singleton" }, create: { id: "singleton", lastSignatureFailAt: new Date() }, update: { lastSignatureFailAt: new Date() } }).catch(() => {});
    }
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  await prisma.whatsAppIntegration.upsert({ where: { id: "singleton" }, create: { id: "singleton", lastWebhookAt: new Date() }, update: { lastWebhookAt: new Date() } }).catch(() => {});

  const { phoneNumberId } = await resolvedIds().catch(() => ({ phoneNumberId: null }));
  const parsed = parseWebhook(body, { ownNumberId: phoneNumberId });
  let stored = { stored: 0, duplicates: 0 };
  try {
    stored = await storeEvents(parsed.events);
  } catch (e) {
    // Could not even store: ask Meta to retry later rather than lose the event.
    logger.error("whatsapp.webhook.store_failed", { error: e instanceof Error ? e.message : String(e) });
    return new NextResponse("Try again", { status: 503 });
  }
  if (stored.stored) {
    const work = processPending().catch((e) => logger.warn("whatsapp.webhook.process_error", { error: e instanceof Error ? e.message : String(e) }));
    await Promise.race([work, new Promise((r) => setTimeout(r, 4000))]);
  }
  return NextResponse.json({ ok: true, received: parsed.events.length, stored: stored.stored, duplicates: stored.duplicates, ignored: parsed.ignored });
}
