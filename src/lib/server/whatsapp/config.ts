import { timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";
import { logger } from "../logger";
import { classifyApiError, type ApiFailure } from "@/lib/whatsapp";

/**
 * WhatsApp Business Cloud API configuration and the one place that talks to Graph.
 *
 * SECRETS are read from the server environment only and are never returned, logged or stored:
 *   WHATSAPP_ACCESS_TOKEN          production system-user token (long-lived)
 *   WHATSAPP_APP_SECRET            signs webhook posts (X-Hub-Signature-256)
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN  answers Meta's callback-URL challenge
 * Non-secret IDs may come from the Settings page (DB) or the env (WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID).
 */

export const accessToken = () => process.env.WHATSAPP_ACCESS_TOKEN?.trim() || null;
export const appSecret = () => process.env.WHATSAPP_APP_SECRET?.trim() || null;
export const verifyToken = () => process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || null;

export const graphBase = () => (process.env.WHATSAPP_GRAPH_BASE?.trim() || "https://graph.facebook.com").replace(/\/$/, "");
export const graphVersion = () => (process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0").replace(/[^v0-9.]/g, "");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function getIntegration() {
  return (await prisma.whatsAppIntegration.findUnique({ where: { id: "singleton" } })) ?? (await prisma.whatsAppIntegration.create({ data: { id: "singleton" } }).catch(() => prisma.whatsAppIntegration.findUniqueOrThrow({ where: { id: "singleton" } })));
}

export async function resolvedIds(): Promise<{ wabaId: string | null; phoneNumberId: string | null }> {
  const row = await getIntegration();
  return { wabaId: row.wabaId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || null, phoneNumberId: row.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null };
}

/** Everything needed to send: token + phone number id. */
export async function sendReady(): Promise<boolean> {
  return !!accessToken() && !!(await resolvedIds()).phoneNumberId;
}

export interface GraphResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  json: T | null;
  failure: ApiFailure | null;
  retryAfterSec: number | null;
}

/** One Graph API call. Never throws; never logs the token or the request/response body. */
export async function graph<T = Record<string, unknown>>(path: string, opts: { method?: "GET" | "POST"; body?: unknown; query?: Record<string, string>; timeoutMs?: number } = {}): Promise<GraphResult<T>> {
  const token = accessToken();
  if (!token) return { ok: false, status: 0, json: null, retryAfterSec: null, failure: { code: "NO_TOKEN", kind: "TOKEN", retryable: false, message: "WHATSAPP_ACCESS_TOKEN is not set on the server." } };
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  const url = `${graphBase()}/${graphVersion()}/${path.replace(/^\//, "")}${qs}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: number; error_subcode?: number; message?: string } }) | null;
    if (res.ok) {
      await clearTokenProblem();
      return { ok: true, status: res.status, json, failure: null, retryAfterSec: null };
    }
    const failure = classifyApiError(res.status, json?.error);
    if (failure.kind === "TOKEN") await markTokenProblem(failure.message);
    const ra = Number(res.headers.get("retry-after"));
    logger.warn("whatsapp.graph.error", { path: path.replace(/\d{6,}/g, "#"), status: res.status, code: failure.code, kind: failure.kind });
    return { ok: false, status: res.status, json, failure, retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : null };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    logger.warn("whatsapp.graph.network_error", { path: path.replace(/\d{6,}/g, "#"), aborted });
    return { ok: false, status: 0, json: null, retryAfterSec: null, failure: { code: aborted ? "TIMEOUT" : "NETWORK", kind: "TRANSIENT", retryable: false, message: "No answer from WhatsApp. Check the internet connection of the server and try again." } };
  } finally {
    clearTimeout(timer);
  }
}

async function markTokenProblem(message: string) {
  await prisma.whatsAppIntegration.upsert({ where: { id: "singleton" }, create: { id: "singleton", credentialProblem: message }, update: { credentialProblem: message } }).catch(() => {});
}
async function clearTokenProblem() {
  await prisma.whatsAppIntegration.updateMany({ where: { id: "singleton", credentialProblem: { not: null } }, data: { credentialProblem: null } }).catch(() => {});
}

/* ---------------------------------------------------------------------------------------------- health */

export interface WhatsAppHealth {
  secrets: { accessToken: boolean; appSecret: boolean; verifyToken: boolean };
  ids: { wabaId: string | null; phoneNumberId: string | null; wabaSource: "settings" | "env" | null; phoneSource: "settings" | "env" | null };
  webhook: { callbackUrl: string; lastVerifiedAt: string | null; lastReceivedAt: string | null; lastProcessedAt: string | null; lastSignatureFailureAt: string | null };
  connection: { status: string; checkedAt: string | null; error: string | null; displayPhone: string | null; verifiedName: string | null; qualityRating: string | null; credentialProblem: string | null };
  queue: { pendingEvents: number; failedEvents: number; pendingMedia: number; failedMedia: number; failedOutbound24h: number; stuckAccepted: number };
  problems: string[];
  ready: boolean;
}

export async function healthSnapshot(baseUrl: string): Promise<WhatsAppHealth> {
  const [row, ids] = await Promise.all([getIntegration(), resolvedIds()]);
  const day = new Date(Date.now() - 24 * 3600e3), quarter = new Date(Date.now() - 15 * 60e3);
  const [pendingEvents, failedEvents, pendingMedia, failedMedia, failedOutbound24h, stuckAccepted] = await Promise.all([
    prisma.whatsAppEvent.count({ where: { state: "PENDING" } }),
    prisma.whatsAppEvent.count({ where: { state: "FAILED" } }),
    prisma.whatsAppMessage.count({ where: { mediaStatus: "PENDING" } }),
    prisma.whatsAppMessage.count({ where: { mediaStatus: "FAILED" } }),
    prisma.whatsAppMessage.count({ where: { direction: "OUT", status: "FAILED", createdAt: { gt: day } } }),
    prisma.whatsAppMessage.count({ where: { direction: "OUT", status: "ACCEPTED", createdAt: { lt: quarter, gt: day } } }),
  ]);
  const secrets = { accessToken: !!accessToken(), appSecret: !!appSecret(), verifyToken: !!verifyToken() };
  const problems: string[] = [];
  if (!secrets.accessToken) problems.push("WHATSAPP_ACCESS_TOKEN is not set on the server — messages cannot be sent or media downloaded.");
  if (!secrets.appSecret) problems.push("WHATSAPP_APP_SECRET is not set — incoming webhooks are refused (503).");
  if (!secrets.verifyToken) problems.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set — Meta cannot verify the callback URL.");
  if (!ids.phoneNumberId) problems.push("Phone Number ID is missing — enter it below (WhatsApp Manager → API setup).");
  if (!ids.wabaId) problems.push("WhatsApp Business Account ID is missing — needed to sync templates.");
  if (row.credentialProblem) problems.push(row.credentialProblem);
  if (row.connectionStatus === "ERROR" && row.lastCheckError) problems.push(`Last connection test failed: ${row.lastCheckError}`);
  if (secrets.appSecret && secrets.verifyToken && !row.lastVerifiedAt && !row.lastWebhookAt) problems.push("Meta has not verified the callback URL yet — paste the Callback URL and verify token into the app's WhatsApp → Configuration page and subscribe to the “messages” field.");
  if (row.lastSignatureFailAt && (!row.lastWebhookAt || row.lastSignatureFailAt > row.lastWebhookAt)) problems.push("The latest webhook post failed signature validation — WHATSAPP_APP_SECRET probably does not match the Meta app.");
  if (stuckAccepted > 0) problems.push(`${stuckAccepted} sent message(s) have had no delivery update for 15+ minutes — the webhook may not be reaching the ERP (check the subscription and that the “messages” field is on).`);
  if (failedEvents > 0) problems.push(`${failedEvents} incoming event(s) failed to process; they are retried automatically.`);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    secrets,
    ids: { ...ids, wabaSource: row.wabaId ? "settings" : ids.wabaId ? "env" : null, phoneSource: row.phoneNumberId ? "settings" : ids.phoneNumberId ? "env" : null },
    webhook: { callbackUrl: `${baseUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`, lastVerifiedAt: iso(row.lastVerifiedAt), lastReceivedAt: iso(row.lastWebhookAt), lastProcessedAt: iso(row.lastProcessedAt), lastSignatureFailureAt: iso(row.lastSignatureFailAt) },
    connection: { status: row.connectionStatus, checkedAt: iso(row.lastCheckedAt), error: row.lastCheckError, displayPhone: row.displayPhone, verifiedName: row.verifiedName, qualityRating: row.qualityRating, credentialProblem: row.credentialProblem },
    queue: { pendingEvents, failedEvents, pendingMedia, failedMedia, failedOutbound24h, stuckAccepted },
    problems,
    ready: secrets.accessToken && secrets.appSecret && secrets.verifyToken && !!ids.phoneNumberId && !row.credentialProblem,
  };
}

/** "Test connection": asks Meta about the phone number (and the business account, when known). */
export async function testConnection(): Promise<{ ok: boolean; message: string; details?: Record<string, string | null> }> {
  const ids = await resolvedIds();
  if (!accessToken()) return finishTest(false, "WHATSAPP_ACCESS_TOKEN is not set on the server.");
  if (!ids.phoneNumberId) return finishTest(false, "Enter the Phone Number ID first.");
  const r = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string }>(ids.phoneNumberId, { query: { fields: "display_phone_number,verified_name,quality_rating,code_verification_status" } });
  if (!r.ok) return finishTest(false, r.failure?.message ?? "WhatsApp did not accept the request.");
  const d = { displayPhone: r.json?.display_phone_number ?? null, verifiedName: r.json?.verified_name ?? null, qualityRating: r.json?.quality_rating ?? null };
  let note = "";
  if (ids.wabaId) {
    const w = await graph(`${ids.wabaId}/subscribed_apps`);
    if (!w.ok) note = ` The business account check failed: ${w.failure?.message}`;
    else if (!Array.isArray((w.json as { data?: unknown[] } | null)?.data) || !(w.json as { data: unknown[] }).data.length) note = " This business account has no app subscribed to webhooks yet.";
  }
  return finishTest(true, `Connected to ${d.verifiedName ?? "your WhatsApp number"}${d.displayPhone ? ` (${d.displayPhone})` : ""}.${note}`, d);
}

async function finishTest(ok: boolean, message: string, d?: { displayPhone: string | null; verifiedName: string | null; qualityRating: string | null }) {
  await prisma.whatsAppIntegration.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", connectionStatus: ok ? "CONNECTED" : "ERROR", lastCheckedAt: new Date(), lastCheckError: ok ? null : message, ...(d ?? {}) },
    update: { connectionStatus: ok ? "CONNECTED" : "ERROR", lastCheckedAt: new Date(), lastCheckError: ok ? null : message, ...(d ?? {}) },
  });
  return { ok, message, details: d };
}
