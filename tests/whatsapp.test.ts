import test from "node:test";
import assert from "node:assert/strict";
import { canSendTemplate, canSendText, checkMedia, classifyApiError, eventKey, nextStatus, optIntent, parseWebhook, windowOpen, WINDOW_MS } from "../src/lib/whatsapp";

const wrap = (value: object) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "111", display_phone_number: "919999900000" }, ...value } }] }] });
const msg = (m: object) => wrap({ contacts: [{ wa_id: "919812345678", profile: { name: " Asha " } }], messages: [{ id: "wamid.1", from: "919812345678", timestamp: "1760000000", type: "text", text: { body: "hello" }, ...m }] });

test("parses a text message with profile name, id and time", () => {
  const { events } = parseWebhook(msg({}));
  assert.equal(events.length, 1);
  const e = events[0];
  assert.ok(e.kind === "MESSAGE");
  assert.equal(e.from, "919812345678");
  assert.equal(e.profileName, "Asha");
  assert.equal(e.text, "hello");
  assert.equal(e.timestamp.getTime(), 1760000000_000);
  assert.equal(eventKey(e), "message:wamid.1");
});

test("parses media with caption, mime and filename", () => {
  const { events } = parseWebhook(msg({ type: "document", text: undefined, document: { id: "M9", mime_type: "application/pdf", filename: "a.pdf", caption: "plan" } }));
  const e = events[0];
  assert.ok(e.kind === "MESSAGE");
  assert.deepEqual([e.type, e.mediaId, e.mediaMime, e.filename, e.text], ["document", "M9", "application/pdf", "a.pdf", "plan"]);
});

test("ignores groups, own-number echoes, reactions, other numbers, other fields and junk", () => {
  assert.equal(parseWebhook(msg({ group_id: "g@g.us" })).events.length, 0);
  assert.equal(parseWebhook(msg({ from: "919999900000" })).events.length, 0);
  assert.equal(parseWebhook(msg({ type: "reaction" })).events.length, 0);
  assert.equal(parseWebhook(msg({}), { ownNumberId: "222" }).events.length, 0);
  assert.equal(parseWebhook(msg({}), { ownNumberId: "111" }).events.length, 1);
  assert.equal(parseWebhook({ object: "page" }).events.length, 0);
  assert.equal(parseWebhook(null).events.length, 0);
  assert.equal(parseWebhook("x").events.length, 0);
  assert.equal(parseWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: {} }] }] }).events.length, 0);
  assert.equal(parseWebhook(msg({ from: "12" })).events.length, 0);
  assert.equal(parseWebhook(msg({ id: undefined })).events.length, 0);
});

test("parses delivery statuses and failures", () => {
  const r = parseWebhook(wrap({ statuses: [{ id: "wamid.9", status: "failed", recipient_id: "919812345678", timestamp: "1760000100", errors: [{ code: 131026, message: "undeliverable" }] }, { id: "wamid.9", status: "weird", recipient_id: "919812345678" }, { id: "wamid.8", status: "read", recipient_id: "919812345678", recipient_type: "group" }] }));
  assert.equal(r.events.length, 1);
  const s = r.events[0];
  assert.ok(s.kind === "STATUS");
  assert.deepEqual([s.status, s.errorCode, s.errorMessage], ["FAILED", "131026", "undeliverable"]);
  assert.equal(eventKey(s), "status:wamid.9:FAILED");
});

test("statuses only move forward", () => {
  assert.equal(nextStatus("ACCEPTED", "SENT"), "SENT");
  assert.equal(nextStatus("READ", "DELIVERED"), "READ");
  assert.equal(nextStatus("DELIVERED", "SENT"), "DELIVERED");
  assert.equal(nextStatus("DELIVERED", "FAILED"), "DELIVERED");
  assert.equal(nextStatus("ACCEPTED", "FAILED"), "FAILED");
  assert.equal(nextStatus("PENDING", "READ"), "READ");
});

test("24-hour window", () => {
  const now = Date.now();
  assert.equal(windowOpen(new Date(now - WINDOW_MS + 1000), now), true);
  assert.equal(windowOpen(new Date(now - WINDOW_MS - 1000), now), false);
  assert.equal(windowOpen(null, now), false);
});

test("send rules: window, opt-out, consent, approval", () => {
  const base = { configured: true, optedOut: false, lastInboundAt: new Date(), marketingConsent: false };
  assert.equal(canSendText(base), null);
  assert.equal(canSendText({ ...base, lastInboundAt: new Date(Date.now() - 2 * WINDOW_MS) })?.code, "WINDOW_CLOSED");
  assert.equal(canSendText({ ...base, optedOut: true })?.code, "OPTED_OUT");
  assert.equal(canSendText({ ...base, configured: false })?.code, "NOT_CONFIGURED");
  const util = { status: "APPROVED", active: true, category: "UTILITY" };
  assert.equal(canSendTemplate({ ...base, lastInboundAt: null }, util), null);
  assert.equal(canSendTemplate({ ...base, optedOut: true }, util)?.code, "OPTED_OUT");
  assert.equal(canSendTemplate(base, { ...util, status: "PENDING" })?.code, "TEMPLATE_NOT_APPROVED");
  assert.equal(canSendTemplate(base, { ...util, category: "MARKETING" })?.code, "NO_CONSENT");
  assert.equal(canSendTemplate({ ...base, marketingConsent: true }, { ...util, category: "MARKETING" }), null);
});

test("opt-out words", () => {
  for (const w of ["STOP", " stop. ", "Unsubscribe", "opt out"]) assert.equal(optIntent(w), "OUT", w);
  for (const w of ["START", "subscribe"]) assert.equal(optIntent(w), "IN", w);
  for (const w of ["please stop calling at night", "I want the stop valve fixed", "", null]) assert.equal(optIntent(w as string), null, String(w));
});

test("media validation checks type, size and real content", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.deepEqual(checkMedia("image/png", png), { ok: true, mime: "image/png" });
  assert.equal(checkMedia("image/png", new TextEncoder().encode("hello world")).ok, false);
  assert.equal(checkMedia("application/x-msdownload", png).ok, false);
  assert.equal(checkMedia(null, png).ok, false);
  assert.equal(checkMedia("image/png", new Uint8Array(0)).ok, false);
  assert.equal(checkMedia("application/pdf", new TextEncoder().encode("%PDF-1.7 ...")).ok, true);
  assert.equal(checkMedia("audio/ogg", new Uint8Array(10)).ok, true);
});

test("provider errors are classified into actions", () => {
  assert.equal(classifyApiError(401, { code: 190 }).kind, "TOKEN");
  assert.equal(classifyApiError(400, { code: 190 }).retryable, false);
  assert.equal(classifyApiError(429, {}).kind, "RATE_LIMIT");
  assert.equal(classifyApiError(400, { code: 130429 }).kind, "RATE_LIMIT");
  assert.equal(classifyApiError(400, { code: 131047 }).kind, "WINDOW");
  assert.equal(classifyApiError(400, { code: 131026 }).kind, "RECIPIENT");
  assert.equal(classifyApiError(500, {}).kind, "TRANSIENT");
  assert.equal(classifyApiError(400, { code: 132001 }).kind, "TEMPLATE");
  assert.equal(classifyApiError(400, { code: 133010 }).kind, "NUMBER");
  assert.equal(classifyApiError(400, { code: 999, message: "odd" }).message, "odd");
});
