// WhatsApp Business Cloud API end-to-end check: the REAL server and database, with a stand-in for Meta's Graph API
// (scripts/fake-providers.mjs) and webhook posts signed exactly the way Meta signs them (X-Hub-Signature-256).
// NO real WhatsApp message is involved: see docs/WHATSAPP.md for the live acceptance test to run with a real number.
//
//   node scripts/fake-providers.mjs &
//   run AFTER scripts/e2e-verify.mjs (reuses its users); server env:
//     WHATSAPP_WEBHOOK_VERIFY_TOKEN=verify-me WHATSAPP_APP_SECRET=wa-secret WHATSAPP_ACCESS_TOKEN=wa-test-token
//     WHATSAPP_GRAPH_BASE=http://localhost:3998/graph WHATSAPP_PHONE_NUMBER_ID=100200300 WHATSAPP_BUSINESS_ACCOUNT_ID=900800700
//   DATABASE_URL=… BASE_URL=http://localhost:3100 SERVER_LOG=/path/to/server.log node scripts/whatsapp-verify.mjs
import { execSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const FAKE = process.env.FAKE_URL || "http://localhost:3998";
const SECRET = "wa-secret", PNID = "100200300";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q).replace(/\$/g, "\\$")}`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 6000) => { const t = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(150); } };

function client() {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, headers: res.headers, json: ct.includes("json") ? await res.json().catch(() => null) : null, data: null, buf: ct.includes("json") ? null : Buffer.from(await res.arrayBuffer()) };
  };
}
const login = async (e, p) => { const c = client(); await c("/api/auth/login", { method: "POST", body: { email: e, password: p } }); return c; };
const fake = async (path, body) => (await fetch(FAKE + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined })).json();

const sign = (raw, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
async function post(payload, { sig, secret } = {}) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };
  if (sig !== null) headers["X-Hub-Signature-256"] = sig ?? sign(raw, secret);
  const res = await fetch(BASE + "/api/webhooks/whatsapp", { method: "POST", headers, body: raw });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const wrap = (value) => ({ object: "whatsapp_business_account", entry: [{ id: "900800700", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919999900000", phone_number_id: PNID }, ...value } }] }] });
const ts = () => String(Math.floor(Date.now() / 1000));
const inbound = (from, id, text, name = "Test Customer", extra = {}) => wrap({ contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id, timestamp: ts(), type: "text", text: { body: text }, ...extra }] });
const status = (id, st, to, extra = {}) => wrap({ statuses: [{ id, status: st, timestamp: ts(), recipient_id: to, ...extra }] });
const leadsFor = (key) => Number(sql(`select count(*) from "Lead" where "phoneKey"='${key}'`));
const msgCount = (wamid) => Number(sql(`select count(*) from "WhatsAppMessage" where "providerMessageId"='${wamid}'`));

const admin = await login("admin@test.local", "adminpass123");
const fm = await login("fm1@test.local", "password123");
const tax = await login("tax@test.local", "password123");
const anon = client();
await fake("/__reset");
await fake("/__control", {});

/* ------------------------------------------------------------ A. Meta's verification challenge */
console.log("--- Callback verification");
let r = await fetch(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=CHALLENGE_123`);
ok(r.status === 200 && (await r.text()) === "CHALLENGE_123", "correct verify token → the challenge is echoed back");
r = await fetch(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=X`);
ok(r.status === 403, "wrong verify token → 403");
r = await fetch(`${BASE}/api/webhooks/whatsapp?hub.verify_token=verify-me&hub.challenge=X`);
ok(r.status === 403, "missing hub.mode → 403");
ok(sql(`select "lastVerifiedAt" is not null from "WhatsAppIntegration" where id='singleton'`) === "t", "successful verification is recorded for the health page");

/* ------------------------------------------------------------ B. signatures */
console.log("--- Signature validation");
const A = "919812345601";
const bad = inbound(A, "wamid.BADSIG1", "should never be stored");
ok((await post(bad, { sig: null })).status === 401, "no signature header → 401");
ok((await post(bad, { sig: "sha256=" + "0".repeat(64) })).status === 401, "wrong signature → 401");
ok((await post(bad, { secret: "other-secret" })).status === 401, "signed with another secret → 401");
ok((await post(bad, { sig: "sha1=abcd" })).status === 401, "wrong algorithm prefix → 401");
ok((await post(JSON.stringify(bad) + " ", { sig: sign(JSON.stringify(bad)) })).status === 401, "body changed after signing → 401");
ok(leadsFor("9812345601") === 0 && msgCount("wamid.BADSIG1") === 0, "nothing from unsigned posts was stored");
ok((await post("not json")).status === 400, "signed but malformed JSON → 400");
ok(sql(`select "lastSignatureFailAt" is not null from "WhatsAppIntegration" where id='singleton'`) === "t", "signature failures are recorded for the health page");

/* ------------------------------------------------------------ C. new customer → new lead */
console.log("--- Incoming message creates a lead");
let w = await post(inbound(A, "wamid.IN1", "Hi, I need sofa cleaning", "Anita Rao"));
ok(w.status === 200 && w.json?.stored === 1, "valid signed message accepted and stored");
const lead1 = sql(`select id from "Lead" where "phoneKey"='9812345601'`);
ok(!!lead1 && sql(`select source||'|'||status||'|'||"customerName" from "Lead" where id='${lead1}'`) === "WHATSAPP|NEW|Anita Rao", "lead created: source WHATSAPP, status NEW, name from the WhatsApp profile");
ok(sql(`select count(*) from "LeadActivity" where "leadId"='${lead1}' and "externalId"='wa:wamid.IN1'`) === "1", "provider message id recorded on the lead's history");
const conv = (await admin(`/api/whatsapp/conversations`)).json?.data;
const row1 = conv?.rows?.find((x) => x.leadId === lead1);
ok(!!row1 && row1.unreadCount === 1 && row1.phone === "+" + A && row1.windowOpen === true, "message appears in the ERP inbox: unread 1, 24-hour window open");
const thread1 = (await admin(`/api/whatsapp/conversations/${row1.id}`)).json?.data;
ok(thread1?.messages?.length === 1 && thread1.messages[0].direction === "IN" && thread1.messages[0].body === "Hi, I need sofa cleaning", "the message is in the right conversation, incoming, with its text");
ok(Number(sql(`select count(*) from "AuditLog" where action='LEAD_CREATED_FROM_WHATSAPP' and "entityId"='${lead1}'`)) === 1, "lead creation is audited");
ok(Number(sql(`select count(*) from "PushNotification" where type='NEW_ENQUIRY'`)) >= 1, "staff notified of the new enquiry (own push ledger row)");

/* ------------------------------------------------------------ D/E. duplicates, append */
console.log("--- Repeats and follow-up messages");
w = await post(inbound(A, "wamid.IN1", "Hi, I need sofa cleaning", "Anita Rao"));
ok(w.status === 200 && w.json?.stored === 0 && w.json?.duplicates === 1, "Meta retry of the same message → acknowledged, stored once");
ok(msgCount("wamid.IN1") === 1 && leadsFor("9812345601") === 1, "still one message and one lead after the retry");
await post(inbound(A, "wamid.IN2", "Also the curtains please", "Anita Rao"));
ok(leadsFor("9812345601") === 1, "second message from the same number → no second lead");
const t2 = (await admin(`/api/whatsapp/conversations/${row1.id}`)).json?.data;
ok(t2?.messages?.length === 2 && t2.conversation.unreadCount === 2, "second message appended to the same conversation; unread 2");
ok(Number(sql(`select count(*) from "PushNotification" where type='WHATSAPP_MESSAGE'`)) >= 0, "message on an existing lead uses its own notification type");
const acts = sql(`select count(*) from "LeadActivity" where "leadId"='${lead1}' and type='WHATSAPP_MESSAGE'`);
ok(acts === "2", "the lead's activity timeline has both messages");

/* ------------------------------------------------------------ F. matching an existing lead / not overwriting */
console.log("--- Matching existing leads");
const existing = (await admin("/api/leads", { method: "POST", body: { customerName: "Existing Lead Person", phone: "+91 98123 45602", source: "PHONE_CALL", notes: "Called yesterday" } })).json?.data;
const existingId = existing?.lead?.id ?? existing?.id;
await admin(`/api/leads/${existingId}`, { method: "PATCH", body: { status: "QUALIFIED" } });
await post(inbound("919812345602", "wamid.IN3", "Following up on your call", "Different Profile Name"));
ok(leadsFor("9812345602") === 1, "number in a different format matches the existing lead — no duplicate");
ok(sql(`select "customerName"||'|'||status||'|'||source||'|'||notes from "Lead" where id='${existingId}'`) === "Existing Lead Person|QUALIFIED|PHONE_CALL|Called yesterday", "existing lead's name, status, source and notes are not overwritten");
ok(sql(`select count(*) from "LeadActivity" where "leadId"='${existingId}' and "externalId"='wa:wamid.IN3'`) === "1", "message added to that lead's conversation");

/* ------------------------------------------------------------ G. concurrency */
console.log("--- Concurrent first messages");
const B = "919812345603";
await Promise.all([1, 2, 3, 4, 5].map((i) => post(inbound(B, `wamid.CC${i}`, `parallel ${i}`, "Parallel Person"))));
ok(leadsFor("9812345603") === 1, "five simultaneous first messages → exactly one lead");
ok(Number(sql(`select count(*) from "WhatsAppMessage" where "contactId" in (select id from "WhatsAppContact" where "waId"='${B}')`)) === 5, "…and all five messages are stored");

/* ------------------------------------------------------------ H. events that must be ignored */
console.log("--- Events that are not customer messages");
const before = Number(sql(`select count(*) from "Lead"`));
await post(inbound("919812345604", "wamid.GRP1", "group hello", "G", { group_id: "120363000000@g.us" }));
await post(inbound("919999900000", "wamid.ECHO1", "our own number", "Us"));
await post(wrap({ contacts: [{ profile: { name: "R" }, wa_id: "919812345605" }], messages: [{ from: "919812345605", id: "wamid.REACT1", timestamp: ts(), type: "reaction", reaction: { emoji: "👍", message_id: "x" } }] }));
await post(status("wamid.NOPE", "delivered", "919812345606"));
await post({ object: "page", entry: [] });
await post({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: {} }] }] });
const other = wrap({ messages: [{ from: "919812345607", id: "wamid.OTHERNUM", timestamp: ts(), type: "text", text: { body: "to another number" } }] });
other.entry[0].changes[0].value.metadata.phone_number_id = "555000111";
await post(other);
ok(Number(sql(`select count(*) from "Lead"`)) === before, "group messages, our own echoes, reactions, status-only posts, other objects/fields and other numbers create no lead");
ok(sql(`select count(*) from "WhatsAppMessage" where "providerMessageId" in ('wamid.GRP1','wamid.ECHO1','wamid.REACT1','wamid.OTHERNUM')`) === "0", "…and store no message");

/* ------------------------------------------------------------ I. media */
console.log("--- Media");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TXT = Buffer.from("this is not an image").toString("base64");
const EXE = Buffer.from("MZ....binary").toString("base64");
await fake("/__control", { media: { M1: { base64: PNG, mime: "image/png" }, M2: { base64: TXT, mime: "image/png" }, M3: { base64: EXE, mime: "application/x-msdownload" }, M4: { base64: PNG, mime: "image/png", sha256: "f".repeat(64) }, M5: { base64: Buffer.from("%PDF-1.4 fake").toString("base64"), mime: "application/pdf" } } });
const C = "919812345608";
const media = (id, mid, type, mime, extra = {}) => wrap({ contacts: [{ profile: { name: "Media Person" }, wa_id: C }], messages: [{ from: C, id, timestamp: ts(), type, [type]: { id: mid, mime_type: mime, ...extra } }] });
await post(media("wamid.MED1", "M1", "image", "image/png", { caption: "stain on sofa" }));
const m1 = await until(() => sql(`select id from "WhatsAppMessage" where "providerMessageId"='wamid.MED1' and "mediaStatus"='STORED'`));
ok(!!m1, "an image is downloaded from WhatsApp and stored");
const served = await admin(`/api/whatsapp/media/${m1}`);
ok(served.status === 200 && served.headers.get("content-type") === "image/png" && served.buf.subarray(1, 4).toString() === "PNG", "staff can open the image through the ERP");
ok(served.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(served.headers.get("content-security-policy") || ""), "served with nosniff and a sandboxing CSP");
ok((await anon(`/api/whatsapp/media/${m1}`)).status === 401, "signed-out visitor cannot fetch the image");
ok((await fm(`/api/whatsapp/media/${m1}`)).status === 403, "Field Operations Manager cannot fetch it");
const mt = (await admin(`/api/whatsapp/conversations/${(await admin("/api/whatsapp/conversations")).json.data.rows.find((x) => x.waId === C).id}`)).json.data.messages[0];
ok(mt.type === "image" && mt.body === "stain on sofa" && mt.media?.previewable === true && mt.media.url === `/api/whatsapp/media/${m1}`, "inbox row carries the caption and a previewable media link");
await post(media("wamid.MED2", "M2", "image", "image/png"));
await post(media("wamid.MED3", "M3", "document", "application/x-msdownload", { filename: "virus.exe" }));
await post(media("wamid.MED4", "M4", "image", "image/png"));
await post(media("wamid.MED5", "M5", "document", "application/pdf", { filename: "quote request.pdf" }));
await until(() => sql(`select count(*) from "WhatsAppMessage" where "providerMessageId" in ('wamid.MED2','wamid.MED3','wamid.MED4','wamid.MED5') and "mediaStatus"='PENDING'`) === "0");
const ms = (id) => sql(`select "mediaStatus" from "WhatsAppMessage" where "providerMessageId"='${id}'`);
ok(ms("wamid.MED2") === "SKIPPED", "a file whose bytes are not the declared image type is NOT stored");
ok(ms("wamid.MED3") === "SKIPPED" && sql(`select count(*) from "WhatsAppMedia" m join "WhatsAppMessage" x on x.id=m."messageId" where x."providerMessageId"='wamid.MED3'`) === "0", "an executable / unlisted file type is NOT stored");
ok(ms("wamid.MED4") === "FAILED", "a download whose checksum does not match WhatsApp's is discarded");
ok(ms("wamid.MED5") === "STORED", "a PDF is stored");
const pdfId = sql(`select id from "WhatsAppMessage" where "providerMessageId"='wamid.MED5'`);
ok((await admin(`/api/whatsapp/media/${pdfId}`)).headers.get("content-disposition")?.startsWith("inline"), "PDFs open inline");
ok(Number(sql(`select count(*) from "Lead" where "phoneKey"='9812345608'`)) === 1 && Number(sql(`select count(*) from "WhatsAppMessage" where "contactId" in (select id from "WhatsAppContact" where "waId"='${C}')`)) === 5, "media messages all belong to the one lead/conversation, even when the file was rejected");

/* ------------------------------------------------------------ J. sending + status tracking */
console.log("--- Sending from the ERP");
const contactId = row1.id;
const send1 = await admin("/api/whatsapp/send", { method: "POST", body: { kind: "text", contactId, clientRequestId: "req-" + randomUUID(), text: "Hello Anita, we can visit tomorrow." } });
const m = send1.json?.data?.message;
ok(send1.status === 201 && m?.direction === "OUT" && m.status === "ACCEPTED", "reply inside the 24-hour window is sent; status is ACCEPTED (not 'delivered')");
ok(m?.deliveredAt === null && m?.readAt === null, "no delivered/read time is claimed for a merely accepted message");
const sent = await fake("/__wasent");
ok(sent.length === 1 && sent[0].to === A && sent[0].type === "text" && sent[0].text.body === "Hello Anita, we can visit tomorrow.", "the Cloud API received the right recipient and text");
const wamid = sql(`select "providerMessageId" from "WhatsAppMessage" where id='${m.id}'`);
ok(/^wamid\.FAKE/.test(wamid), "provider message id stored");
await post(status(wamid, "sent", A));
await post(status(wamid, "delivered", A));
const st = () => sql(`select status from "WhatsAppMessage" where id='${m.id}'`);
ok(await until(() => st() === "DELIVERED"), "status webhook → DELIVERED");
await post(status(wamid, "read", A));
ok(await until(() => st() === "READ"), "status webhook → READ");
await post(status(wamid, "delivered", A, { timestamp: String(Number(ts()) - 5) }));
await post(status(wamid, "sent", A));
ok(st() === "READ", "late/out-of-order 'delivered' and 'sent' do not move a READ message backwards");
ok(sql(`select ("sentAt" is not null)::text||("deliveredAt" is not null)::text||("readAt" is not null)::text from "WhatsAppMessage" where id='${m.id}'`) === "truetruetrue", "sent / delivered / read times recorded");
const thr = (await admin(`/api/whatsapp/conversations/${contactId}`)).json.data;
ok(thr.conversation.unreadCount === 0 && thr.messages.at(-1).status === "READ", "replying clears the unread counter; the inbox shows the READ tick");
ok(sql(`select count(*) from "LeadActivity" where "leadId"='${lead1}' and "externalId"='wa:${wamid}'`) === "1", "reply recorded in the lead's history");
ok(Number(sql(`select count(*) from "AuditLog" where action='WHATSAPP_MESSAGE_SENT'`)) >= 1, "sending is audited");
const rid = "req-" + randomUUID();
const body2 = { kind: "text", contactId, clientRequestId: rid, text: "Double click test" };
const [d1, d2] = await Promise.all([admin("/api/whatsapp/send", { method: "POST", body: body2 }), admin("/api/whatsapp/send", { method: "POST", body: body2 })]);
const d3 = await admin("/api/whatsapp/send", { method: "POST", body: body2 });
ok((await fake("/__wasent")).filter((x) => x.text?.body === "Double click test").length === 1, "the same request sent 3 times (double-click) reaches WhatsApp once");
ok([d1, d2, d3].every((x) => [200, 201].includes(x.status)) && d3.json?.data?.duplicate === true, "…and repeats are answered with the original message");

console.log("--- Failed delivery");
const f1 = (await admin("/api/whatsapp/send", { method: "POST", body: { kind: "text", contactId, clientRequestId: "req-" + randomUUID(), text: "will fail later" } })).json.data.message;
const fw = sql(`select "providerMessageId" from "WhatsAppMessage" where id='${f1.id}'`);
await post(status(fw, "failed", A, { errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable", error_data: { details: "Recipient is not a valid WhatsApp user" } }] }));
ok(await until(() => sql(`select status from "WhatsAppMessage" where id='${f1.id}'`) === "FAILED"), "failed status webhook → FAILED");
ok(sql(`select "errorCode" from "WhatsAppMessage" where id='${f1.id}'`) === "131026", "provider error code kept");
ok((await admin(`/api/whatsapp/conversations/${contactId}`)).json.data.messages.find((x) => x.id === f1.id)?.error?.includes("not a valid WhatsApp user"), "the inbox shows why it failed");

/* ------------------------------------------------------------ K. window, templates, consent */
console.log("--- 24-hour window and templates");
sql(`update "WhatsAppContact" set "lastInboundAt" = now() - interval '25 hours' where id='${contactId}'`);
const closed = await admin("/api/whatsapp/send", { method: "POST", body: { kind: "text", contactId, clientRequestId: "req-" + randomUUID(), text: "late reply" } });
ok(closed.status === 422 && closed.json?.code === "WINDOW_CLOSED", "free text after 24 h is refused (422 WINDOW_CLOSED)");
ok(!(await fake("/__wasent")).some((x) => x.text?.body === "late reply"), "…and never reaches WhatsApp");
await fake("/__control", { templates: [
  { name: "visit_reminder", language: "en", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Hello {{1}}, our team visits on {{2}}." }] },
  { name: "summer_offer", language: "en", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Summer offer for you, {{1}}!" }] },
  { name: "pending_one", language: "en", category: "UTILITY", status: "PENDING", components: [{ type: "BODY", text: "Hi" }] },
] });
const sync = await admin("/api/integrations/whatsapp", { method: "POST", body: { action: "sync-templates" } });
ok(sync.status === 200 && sync.json?.data?.synced === 3, "templates synced from Meta");
const tpls = (await admin("/api/whatsapp/templates")).json.data;
ok(tpls.length === 2 && !tpls.some((t) => t.name === "pending_one"), "only APPROVED templates are offered");
const visit = tpls.find((t) => t.name === "visit_reminder"), offer = tpls.find((t) => t.name === "summer_offer");
const tr = await admin("/api/whatsapp/send", { method: "POST", body: { kind: "template", contactId, clientRequestId: "req-" + randomUUID(), templateId: visit.id, params: ["Anita", "Monday 10 am"] } });
ok(tr.status === 201 && tr.json.data.message.status === "ACCEPTED", "an approved utility template can be sent outside the window");
const tp = (await fake("/__wasent")).find((x) => x.type === "template");
ok(tp?.template?.name === "visit_reminder" && tp.template.language.code === "en" && tp.template.components[0].parameters.map((p) => p.text).join("|") === "Anita|Monday 10 am", "template name, language and parameters sent correctly");
ok((await admin("/api/whatsapp/send", { method: "POST", body: { kind: "template", contactId, clientRequestId: "req-" + randomUUID(), templateId: visit.id, params: ["only one"] } })).status === 400, "wrong number of template values → 400");
const mk = await admin("/api/whatsapp/send", { method: "POST", body: { kind: "template", contactId, clientRequestId: "req-" + randomUUID(), templateId: offer.id, params: ["Anita"] } });
ok(mk.status === 422 && mk.json?.code === "NO_CONSENT", "a MARKETING template without recorded consent is refused");
await admin(`/api/whatsapp/conversations/${contactId}`, { method: "PATCH", body: { marketingConsent: true } });
ok((await admin("/api/whatsapp/send", { method: "POST", body: { kind: "template", contactId, clientRequestId: "req-" + randomUUID(), templateId: offer.id, params: ["Anita"] } })).status === 201, "…and allowed once consent is recorded");

console.log("--- Opt-out");
await post(inbound(A, "wamid.STOP1", "STOP", "Anita Rao"));
ok(await until(() => sql(`select "optedOut" from "WhatsAppContact" where id='${contactId}'`) === "t"), "customer replying STOP is opted out");
ok(sql(`select "marketingConsent" from "WhatsAppContact" where id='${contactId}'`) === "f", "…and marketing consent is withdrawn");
const nSent = (await fake("/__wasent")).length;
const o1 = await admin("/api/whatsapp/send", { method: "POST", body: { kind: "text", contactId, clientRequestId: "req-" + randomUUID(), text: "hello?" } });
const o2 = await admin("/api/whatsapp/send", { method: "POST", body: { kind: "template", contactId, clientRequestId: "req-" + randomUUID(), templateId: visit.id, params: ["A", "B"] } });
ok(o1.json?.code === "OPTED_OUT" && o2.json?.code === "OPTED_OUT" && (await fake("/__wasent")).length === nSent, "nothing (text or template) is sent to an opted-out customer");
await post(inbound(A, "wamid.START1", "START", "Anita Rao"));
ok(await until(() => sql(`select "optedOut" from "WhatsAppContact" where id='${contactId}'`) === "f"), "START opts them back in");

/* ------------------------------------------------------------ L. provider errors */
console.log("--- Provider errors");
const fresh = () => ({ kind: "text", contactId, clientRequestId: "req-" + randomUUID(), text: "error test " + Math.random() });
const nowIn = () => sql(`update "WhatsAppContact" set "lastInboundAt" = now() where id='${contactId}'`);
nowIn();
await fake("/__control", { waError: { http: 429, code: 130429, message: "Rate limit hit" } });
const rl = await admin("/api/whatsapp/send", { method: "POST", body: fresh() });
ok(rl.status === 429 && rl.json?.code === "RATE_LIMIT" && /rate-limiting/i.test(rl.json?.error), "rate limit → 429 with a clear message");
ok(sql(`select status from "WhatsAppMessage" where direction='OUT' order by "createdAt" desc limit 1`) === "FAILED", "…and the message is recorded as FAILED, not sent");
await fake("/__control", { waError: { http: 400, code: 131047, message: "Re-engagement message" } });
ok((await admin("/api/whatsapp/send", { method: "POST", body: fresh() })).json?.code === "WINDOW_CLOSED", "Meta's own 'window closed' error is understood");
await fake("/__control", { waError: { http: 500, code: 131000, message: "Something went wrong" } });
ok((await admin("/api/whatsapp/send", { method: "POST", body: fresh() })).status === 502, "provider outage → 502 (message FAILED, safe to retry)");
await fake("/__control", { waError: { http: 400, code: 190, message: "token expired" } });
const ex = await admin("/api/whatsapp/send", { method: "POST", body: fresh() });
ok(ex.status === 503 && /access token/i.test(ex.json?.error || ""), "expired/revoked token → 503 with instructions to replace it");
const h1 = (await admin("/api/integrations/whatsapp")).json.data;
ok(h1.connection.credentialProblem && h1.problems.some((p) => /access token/i.test(p)) && h1.ready === false, "the integration page shows the token problem and 'not ready'");
await fake("/__control", { waExpired: true });
const tc = (await admin("/api/integrations/whatsapp", { method: "POST", body: { action: "test" } })).json.data;
ok(tc.test.ok === false && /access token/i.test(tc.test.message) && tc.status.connection.status === "ERROR", "Test connection with an expired token reports ERROR with an actionable message");
await fake("/__control", { waExpired: false });
const tc2 = (await admin("/api/integrations/whatsapp", { method: "POST", body: { action: "test" } })).json.data;
ok(tc2.test.ok === true && tc2.status.connection.status === "CONNECTED" && tc2.status.connection.verifiedName === "Intense Care", "Test connection succeeds again once the token works, showing the verified name");
ok(tc2.status.connection.credentialProblem === null, "…and clears the token problem");

/* ------------------------------------------------------------ M. late status (event retry) */
console.log("--- Status arriving before the sent message is stored");
await post(status("wamid.LATE1", "delivered", A));
ok(sql(`select state from "WhatsAppEvent" where "dedupeKey"='status:wamid.LATE1:DELIVERED'`) === "PENDING", "status for an unknown message waits (PENDING) instead of being lost");
const cid = sql(`select id from "WhatsAppContact" where "waId"='${A}'`);
sql(`insert into "WhatsAppMessage"(id,"contactId",direction,type,body,status,"providerMessageId") values ('late_msg','${cid}','OUT','text','late','ACCEPTED','wamid.LATE1')`);
const cron = await fetch(BASE + "/api/cron/maintenance", { method: "POST", headers: { authorization: "Bearer " + (process.env.CRON_SECRET || "cron-secret") } });
ok(cron.status === 200 && (await until(() => sql(`select status from "WhatsAppMessage" where id='late_msg'`) === "DELIVERED")), "the maintenance job retries it and the status is applied");

/* ------------------------------------------------------------ N. access control, secrets */
console.log("--- Access control and secrets");
for (const [who, c] of [["anonymous", anon], ["Field Operations Manager", fm], ["Tax Officer", tax]]) {
  const codes = [(await c("/api/whatsapp/conversations")).status, (await c(`/api/whatsapp/conversations/${contactId}`)).status, (await c("/api/whatsapp/send", { method: "POST", body: { kind: "text", contactId, clientRequestId: "req-" + randomUUID(), text: "x" } })).status, (await c("/api/whatsapp/templates")).status, (await c("/api/integrations/whatsapp")).status, (await c("/api/integrations/whatsapp", { method: "PATCH", body: { phoneNumberId: "12345678" } })).status, (await c("/api/integrations/whatsapp", { method: "POST", body: { action: "test" } })).status];
  ok(codes.every((s) => s === (who === "anonymous" ? 401 : 403)), `${who}: inbox, conversation, send, templates and integration endpoints refused (${codes.join(",")})`);
}
ok(sql(`select count(*) from "WhatsAppMessage" where body='x'`) === "0", "refused sends stored nothing");
const raw = JSON.stringify((await admin("/api/integrations/whatsapp")).json);
ok(!raw.includes("wa-test-token") && !raw.includes(SECRET) && !raw.includes("verify-me"), "the integration API never returns the access token, app secret or verify token");
const sec = (await admin("/api/integrations/whatsapp")).json.data.secrets;
ok(sec.accessToken === true && sec.appSecret === true && sec.verifyToken === true, "secrets are reported only as configured / not configured");
ok((await admin("/api/integrations/whatsapp", { method: "PATCH", body: { phoneNumberId: "not-a-number" } })).status === 400, "IDs must be numeric");
const pt = await admin("/api/integrations/whatsapp", { method: "PATCH", body: { wabaId: "900800700", phoneNumberId: PNID } });
ok(pt.status === 200 && pt.json.data.ids.phoneNumberId === PNID, "Admin can save the Phone Number ID and Business Account ID");
ok(Number(sql(`select count(*) from "AuditLog" where action='WHATSAPP_SETTINGS_CHANGED'`)) >= 1, "settings changes are audited");
ok(sql(`select count(*) from information_schema.columns where table_name='WhatsAppIntegration' and column_name ~* 'token|secret|password'`) === "0", "no database column can hold a token or secret");
// Conversations are isolated per customer
const other1 = (await admin(`/api/whatsapp/conversations/${(await admin("/api/whatsapp/conversations")).json.data.rows.find((x) => x.waId === C).id}`)).json.data.messages;
ok(!JSON.stringify(other1).includes("sofa cleaning") && !JSON.stringify(thr.messages).includes("stain on sofa"), "one customer's thread never contains another customer's messages");
// Inbox filters / search
const unread = (await admin("/api/whatsapp/conversations?filter=unread")).json.data;
ok(unread.rows.length > 0 && unread.rows.every((x) => x.unreadCount > 0), "unread filter");
const unassigned = (await admin("/api/whatsapp/conversations?filter=unassigned")).json.data;
ok(unassigned.rows.length > 0 && unassigned.rows.every((x) => !x.assignedUserId), "unassigned filter");
ok((await admin("/api/whatsapp/conversations?q=Anita")).json.data.rows.some((x) => x.id === contactId), "search by name");
ok((await admin("/api/whatsapp/conversations?q=9812345601")).json.data.rows.some((x) => x.id === contactId), "search by phone");
ok((await admin("/api/whatsapp/conversations?q=curtains")).json.data.rows.some((x) => x.id === contactId), "search by message text");
const adminId = sql(`select id from "User" where email='admin@test.local'`);
await admin(`/api/whatsapp/conversations/${contactId}`, { method: "PATCH", body: { assignedUserId: adminId } });
ok((await admin("/api/whatsapp/conversations?filter=mine")).json.data.rows.some((x) => x.id === contactId), "assign to me → 'mine' filter");
ok((await fm(`/api/whatsapp/conversations/${contactId}`, { method: "PATCH", body: { read: true } })).status === 403, "a Field Operations Manager cannot mark conversations read or assign them");
await admin(`/api/whatsapp/conversations/${contactId}`, { method: "PATCH", body: { read: true } });
ok((await admin(`/api/whatsapp/conversations/${contactId}`)).json.data.conversation.unreadCount === 0, "mark read");
await post(inbound(A, "wamid.IN9", "one more thing", "Anita Rao"));
await until(() => msgCount("wamid.IN9") === 1);
ok(Number(sql(`select count(*) from "PushNotification" where type='WHATSAPP_MESSAGE' or type='NEW_ENQUIRY'`)) >= 2, "staff are notified: new enquiry and new message on an existing lead are separate push events");

/* ------------------------------------------------------------ O. logs */
if (process.env.SERVER_LOG) {
  console.log("--- Logs");
  const log = readFileSync(process.env.SERVER_LOG, "utf8");
  ok(!log.includes("wa-test-token") && !log.includes(SECRET), "server log contains no access token or app secret");
  ok(!/9198123456\d\d/.test(log), "server log contains no full customer phone numbers");
  ok(!log.includes("Hi, I need sofa cleaning") && !log.includes("Hello Anita"), "server log contains no message text");
}
console.log(`\nwhatsapp-verify: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
