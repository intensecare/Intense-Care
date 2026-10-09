// Lead Management end-to-end check. Run AFTER scripts/e2e-verify.mjs (reuses its
// users) against the same server and DB. The server must be started with:
//   LEAD_FORM_ALLOWED_ORIGINS=https://www.intensecare.example
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN=verify-me WHATSAPP_APP_SECRET=wa-secret
//   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/lead-verify.mjs
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
const BASE = process.env.BASE_URL || "http://localhost:3100";
const SITE = "https://www.intensecare.example";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();
function client() {
  let cookie = "";
  return async (path, { method = "GET", body, headers = {}, raw } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: typeof body === "string" ? body : body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    if (raw) return res;
    return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
  };
}
const login = async (e, p) => { const c = client(); await c("/api/auth/login", { method: "POST", body: { email: e, password: p } }); return c; };
const admin = await login("admin@test.local", "adminpass123");
const fmc = await login("fm1@test.local", "password123");
const qcc = await login("qc@test.local", "password123");
const taxc = await login("tax@test.local", "password123");
const anon = client();
const adminId = sql(`select id from "User" where email='admin@test.local'`);
const svc = (await admin("/api/services")).json?.data?.[0];
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() + 5.5 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const leadCount = () => Number(sql(`select count(*) from "Lead"`));
const getLead = async (id) => (await admin(`/api/leads/${id}`)).json?.data;

console.log("--- Access");
ok((await fmc("/api/leads")).status === 403 && (await fmc("/api/leads", { method: "POST", body: {} })).status === 403, "Field Manager has no access to leads");
ok((await qcc("/api/leads")).status === 403 && (await taxc("/api/leads")).status === 403, "QC and Tax Officer have no access to leads");
ok((await anon("/api/leads")).status === 401, "signed-out requests are refused");

console.log("--- Create / edit");
ok((await admin("/api/leads", { method: "POST", body: { customerName: "A", phone: "123", source: "WEBSITE" } })).status === 400, "invalid name / phone refused");
ok((await admin("/api/leads", { method: "POST", body: { customerName: "Anil Kumar", phone: "9845000001", source: "FAX" } })).status === 400, "unknown source refused");
const c1 = await admin("/api/leads", { method: "POST", body: { customerName: "Anil Kumar", phone: "+91 98450 00001", email: "Anil@Example.com", source: "REFERRAL", sourceDetails: "Referred by Mrs. Rao", serviceId: svc.id, propertyAddress: "22 Lake View", locality: "HSR Layout", city: "Bengaluru", postalCode: "560102", preferredDate: "2027-02-01", estimatedValue: 8500, assignedUserId: adminId, notes: "3BHK, move-in clean" } });
const L1 = c1.json?.data;
ok(c1.status === 201 && /^LD-\d{5}$/.test(L1?.leadNumber) && L1.status === "NEW" && L1.email === "anil@example.com" && L1.serviceName === svc.name && L1.assignedUserName, `lead created with every field (${L1?.leadNumber})`);
const dup = await admin("/api/leads", { method: "POST", body: { customerName: "Anil K", phone: "098450-00001", source: "PHONE_CALL" } });
ok(dup.status === 409 && dup.json?.code === "DUPLICATE" && dup.json.duplicates?.[0]?.id === L1.id, "duplicate detection: same phone in another format → warning with the open lead");
const dup2 = await admin("/api/leads", { method: "POST", body: { customerName: "Anil K", phone: "098450-00001", source: "PHONE_CALL", allowDuplicate: true } });
ok(dup2.status === 201 && dup2.json?.data?.duplicates?.some((d) => d.id === L1.id), "…saved anyway when the user confirms, and the two are cross-linked");
const ed = await admin(`/api/leads/${L1.id}`, { method: "PATCH", body: { estimatedValue: 9000, notes: "3BHK + balcony", expectedUpdatedAt: L1.updatedAt } });
ok(ed.status === 200 && ed.json?.data?.lead?.estimatedValue === 9000, "lead edited");
ok((await admin(`/api/leads/${L1.id}`, { method: "PATCH", body: { estimatedValue: 1, expectedUpdatedAt: L1.updatedAt } })).status === 409, "an edit based on an old copy is refused (no silent overwrite)");

console.log("--- Workflow");
let st = await admin(`/api/leads/${L1.id}`, { method: "PATCH", body: { status: "CONTACTED" } });
ok(st.status === 200 && st.json?.data?.lead?.status === "CONTACTED" && st.json.data.lead.lastContactedAt, "NEW → CONTACTED records last contacted");
for (const s of ["QUALIFIED", "QUOTATION_SENT", "FOLLOW_UP"]) await admin(`/api/leads/${L1.id}`, { method: "PATCH", body: { status: s } });
ok((await getLead(L1.id)).lead.status === "FOLLOW_UP", "→ QUALIFIED → QUOTATION SENT → FOLLOW-UP");
ok((await admin(`/api/leads/${dup2.json.data.id}`, { method: "PATCH", body: { status: "LOST" } })).status === 400, "LOST without a reason is refused");
const lost = (await admin(`/api/leads/${dup2.json.data.id}`, { method: "PATCH", body: { status: "LOST", lostReason: "Duplicate / spam" } }));
ok(lost.status === 200 && lost.json?.data?.lead?.lostReason === "Duplicate / spam", "LOST with a reason");
let constraint = false;
try { sql(`update "Lead" set "lostReason"=null where id='${dup2.json.data.id}'`); } catch { constraint = true; }
ok(constraint, "the database refuses a LOST lead without a reason");
const hist = (await getLead(L1.id)).activity;
ok(hist.filter((a) => a.type === "STATUS_CHANGED").length === 4 && hist.some((a) => a.type === "CREATED"), "every status change is in the lead's history");

console.log("--- Follow-ups");
await admin(`/api/leads/${L1.id}`, { method: "POST", body: { action: "follow-up", date: today, note: "Call after 5pm" } });
let list = (await admin("/api/leads?followUp=today")).json?.data;
ok(list.rows.some((r) => r.id === L1.id) && list.stats.followUpsToday >= 1, "follow-up due today appears in the dashboard and filter");
sql(`update "Lead" set "nextFollowUpDate"='${yesterday}' where id='${L1.id}'`);
list = (await admin("/api/leads?followUp=overdue")).json?.data;
ok(list.rows.some((r) => r.id === L1.id) && list.stats.overdueFollowUps >= 1, "overdue follow-up appears in the dashboard and filter");
const done = await admin(`/api/leads/${L1.id}`, { method: "POST", body: { action: "follow-up-done", note: "Spoke, sending quote" } });
ok(done.status === 200 && done.json?.data?.lead?.nextFollowUpDate === null && done.json.data.activity[0].type === "FOLLOW_UP_DONE", "follow-up completed: cleared and recorded");

console.log("--- Log Call");
const call1 = await admin("/api/leads/log-call", { method: "POST", body: { phone: "9845000002", callerName: "Bina Shah", direction: "INCOMING", outcome: "QUOTE_REQUESTED", notes: "Kitchen deep clean", serviceInterest: "Kitchen", nextFollowUpDate: today } });
ok(call1.status === 201 && call1.json?.data?.created === true && call1.json.data.lead.source === "PHONE_CALL" && call1.json.data.lead.status === "CONTACTED" && call1.json.data.lead.nextFollowUpDate === today, "a call from a new number creates a PHONE_CALL lead with outcome and follow-up");
const call2 = await admin("/api/leads/log-call", { method: "POST", body: { phone: "+91 98450 00002", direction: "OUTGOING", outcome: "NO_ANSWER" } });
ok(call2.status === 200 && call2.json?.data?.created === false && call2.json.data.lead.id === call1.json.data.lead.id, "a call from a known number is added to that lead (no duplicate)");
ok((await getLead(call1.json.data.lead.id)).activity.filter((a) => a.type === "CALL_LOGGED").length === 2, "both calls are in the history with their outcomes");
ok((await admin("/api/leads/log-call", { method: "POST", body: { phone: "9845000099", outcome: "WRONG_NUMBER" } })).status === 400, "a wrong number isn't saved as a lead");
ok((await fmc("/api/leads/log-call", { method: "POST", body: { phone: "9845000003", outcome: "INTERESTED" } })).status === 403, "Field Manager cannot log sales calls");

console.log("--- Website enquiry");
const form = (extra = {}) => ({ name: "Chitra Rao", phone: "9845000004", email: "chitra@example.com", service: "Sofa cleaning", location: "Indiranagar", postalCode: "560038", preferredDate: "2027-02-10", message: "2 sofas", startedAt: Date.now() - 20000, ...extra });
ok((await anon("/api/public/enquiry", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status === 403, "CORS preflight from an unknown site is refused");
const pre = await anon("/api/public/enquiry", { method: "OPTIONS", headers: { Origin: SITE } });
ok(pre.status === 204 && pre.headers.get("access-control-allow-origin") === SITE, "CORS preflight from the company website is allowed");
ok((await anon("/api/public/enquiry", { method: "POST", headers: { Origin: "https://evil.example" }, body: form() })).status === 403, "a post from an unknown site is refused");
let before = leadCount();
let e = await anon("/api/public/enquiry", { method: "POST", headers: { Origin: SITE }, body: form({ company_website: "http://spam.example" }) });
ok(e.status === 200 && e.json?.success && leadCount() === before, "honeypot filled → looks accepted, nothing stored");
e = await anon("/api/public/enquiry", { method: "POST", headers: { Origin: SITE }, body: form({ startedAt: Date.now() }) });
ok(e.status === 200 && leadCount() === before, "submitted instantly (bot) → nothing stored");
ok((await anon("/api/public/enquiry", { method: "POST", headers: { Origin: SITE }, body: form({ phone: "12" }) })).status === 400, "invalid phone → clear validation error");
e = await anon("/api/public/enquiry", { method: "POST", headers: { Origin: SITE }, body: form({ utm_source: "google", utm_medium: "cpc", utm_campaign: "Sofa Diwali", gclid: "Cj0KCQ-test-click", landingPage: `${SITE}/sofa?gclid=x`, referrer: "https://www.google.com/" }) });
ok(e.status === 201 && e.headers.get("access-control-allow-origin") === SITE, "a genuine enquiry is accepted");
const W = sql(`select id from "Lead" where "phoneKey"='9845000004'`);
let wl = (await getLead(W)).lead;
ok(wl.source === "GOOGLE_ADS" && wl.utmCampaign === "Sofa Diwali" && wl.gclid === "Cj0KCQ-test-click" && wl.postalCode === "560038" && wl.preferredDate === "2027-02-10" && /Google Ads/.test(wl.sourceDetails), "source attribution: UTM + Google Ads click id → GOOGLE_ADS, campaign kept");
before = leadCount();
e = await anon("/api/public/enquiry", { method: "POST", headers: { Origin: SITE }, body: form({ message: "Also the carpet" }) });
ok(e.status === 200 && leadCount() === before && (await getLead(W)).activity.filter((a) => a.type === "WEBSITE_ENQUIRY").length === 2, "a repeat enquiry from the same phone is added to the open lead");
ok((await anon("/api/public/enquiry", { method: "POST", headers: { Origin: SITE }, body: form({ phone: "9845000005" }) })).status === 429, "rate limit: too many enquiries from one connection → 429");

console.log("--- WhatsApp Business webhook");
ok((await anon("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123")).status === 403, "webhook verification with a wrong token is refused");
const vr = await anon("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=987654", { raw: true });
ok(vr.status === 200 && (await vr.text()) === "987654", "webhook verification handshake answers Meta's challenge");
const wa = (id, text, from = "919845000006") => JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", contacts: [{ wa_id: from, profile: { name: "Deepa N" } }], messages: [{ id, from, type: "text", text: { body: text } }] } }] }] });
const sign = (b) => "sha256=" + createHmac("sha256", "wa-secret").update(b).digest("hex");
let b = wa("wamid.1", "Hi, need full home cleaning");
ok((await anon("/api/webhooks/whatsapp", { method: "POST", body: b, headers: { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) } })).status === 401, "a webhook post with a bad signature is refused");
before = leadCount();
ok((await anon("/api/webhooks/whatsapp", { method: "POST", body: b, headers: { "X-Hub-Signature-256": sign(b) } })).status === 200 && leadCount() === before + 1, "a signed incoming message creates a WHATSAPP lead");
await anon("/api/webhooks/whatsapp", { method: "POST", body: b, headers: { "X-Hub-Signature-256": sign(b) } });
ok(leadCount() === before + 1 && sql(`select count(*) from "LeadActivity" where "externalId"='wa:wamid.1'`) === "1", "a webhook retry (same message id) is stored once");
b = wa("wamid.2", "Is Saturday possible?");
await anon("/api/webhooks/whatsapp", { method: "POST", body: b, headers: { "X-Hub-Signature-256": sign(b) } });
const WA = sql(`select id from "Lead" where "phoneKey"='9845000006'`);
const wad = await getLead(WA);
ok(leadCount() === before + 1 && wad.lead.source === "WHATSAPP" && wad.lead.customerName === "Deepa N" && wad.activity.filter((a) => a.type === "WHATSAPP_MESSAGE").length === 2, "a second message is added to the same lead");

console.log("--- Linked quotation + conversion");
const existing = (await admin("/api/customers", { method: "POST", body: { name: "Anil Kumar", phone: "9845000001", address: "Old address" } })).json?.data;
ok((await admin(`/api/leads/${L1.id}`, { method: "POST", body: { action: "convert", serviceId: svc.id, scheduledDate: "2027-02-01", scheduledTimeSlot: "09:00 - 11:00" } })).status === 409, "a lead must be WON before conversion");
const det = await getLead(L1.id);
ok(det.matchingCustomers.some((c) => c.id === existing.id), "an existing customer with the same phone is found");
const link = await admin(`/api/leads/${L1.id}`, { method: "POST", body: { action: "link-customer" } });
ok(link.status === 200 && link.json?.data?.lead?.convertedCustomerId === existing.id && link.json.data.lead.convertedPropertyId, "link customer: the existing customer is reused, a property is made from the lead's address");
const q = (await admin("/api/quotations", { method: "POST", body: { customerId: existing.id, propertyId: link.json.data.lead.convertedPropertyId, items: [{ serviceId: svc.id, quantity: 1, rate: 9000 }], quoteType: "NON_GST", validUntil: "2099-12-31", status: "sent" } })).json?.data;
const otherCust = (await admin("/api/customers", { method: "POST", body: { name: "Someone Else", phone: "9845000077", address: "x" } })).json?.data;
const otherQ = (await admin("/api/quotations", { method: "POST", body: { customerId: otherCust.id, items: [{ description: "x", quantity: 1, rate: 100 }], quoteType: "NON_GST", validUntil: "2099-12-31" } })).json?.data;
ok((await admin(`/api/leads/${L1.id}`, { method: "POST", body: { action: "link-quote", quoteId: otherQ.id } })).status === 400, "a quotation of a different customer can't be linked");
ok((await admin(`/api/leads/${L1.id}`, { method: "POST", body: { action: "link-quote", quoteId: q.id } })).json?.data?.lead?.quoteNumber === q.quoteNumber, "the lead's quotation is linked");
await admin(`/api/leads/${L1.id}`, { method: "PATCH", body: { status: "WON" } });
ok((await admin(`/api/leads/${L1.id}`, { method: "POST", body: { action: "convert", serviceId: svc.id, scheduledDate: "2027-02-01", scheduledTimeSlot: "09:00 - 11:00" } })).status === 409, "with a linked quotation, the quotation is what gets converted (prices carry over)");
const conv = await admin(`/api/quotations/${q.id}`, { method: "POST", body: { action: "convert-job", scheduledDate: "2027-02-01", scheduledTimeSlot: "09:00 - 11:00" } });
const L1after = (await getLead(L1.id)).lead;
ok(conv.status === 201 && L1after.convertedJobId === conv.json.data.jobId && L1after.status === "WON" && L1after.convertedJobNumber, "converting the quotation links the job to the lead automatically");
ok(Number(sql(`select count(*) from "Customer" where right(regexp_replace(phone,'\\D','','g'),10)='9845000001'`)) === 1, "no duplicate customer was created");

// Direct conversion (no quotation), new customer, with a concurrent double click.
const L2 = call1.json.data.lead;
await admin(`/api/leads/${L2.id}`, { method: "PATCH", body: { status: "WON", propertyAddress: "7 Brigade Rd", city: "Bengaluru" } });
const convBody = { action: "convert", serviceId: svc.id, scheduledDate: "2027-02-02", scheduledTimeSlot: "10:00 - 12:00", invoiceType: "NON_GST" };
const jobsBefore = Number(sql(`select count(*) from "Job"`));
const both = await Promise.all([admin(`/api/leads/${L2.id}`, { method: "POST", body: convBody }), admin(`/api/leads/${L2.id}`, { method: "POST", body: convBody })]);
ok(both.filter((x) => x.status === 201).length === 1 && both.filter((x) => x.status === 409).length === 1 && Number(sql(`select count(*) from "Job"`)) === jobsBefore + 1, `two simultaneous conversions → exactly one job (${both.map((x) => x.status)})`);
const L2after = (await getLead(L2.id));
ok(L2after.lead.convertedCustomerId && L2after.lead.convertedPropertyId && L2after.lead.convertedJobId && L2after.activity.some((a) => a.type === "CONVERTED") && L2after.activity.some((a) => a.type === "CALL_LOGGED"), "the lead keeps its history and points at the new customer, property and job");
ok(sql(`select source||'|'||name from "Customer" where id='${L2after.lead.convertedCustomerId}'`) === "direct|Bina Shah", "the new customer carries the lead's name");
ok(sql(`select "propertyId"||'|'||"customerId" from "Job" where id='${L2after.lead.convertedJobId}'`) === `${L2after.lead.convertedPropertyId}|${L2after.lead.convertedCustomerId}`, "the job uses the converted customer and property");
ok((await admin(`/api/leads/${L2.id}`, { method: "POST", body: convBody })).status === 409, "converting again is refused");
ok((await admin(`/api/leads/${L2.id}`, { method: "PATCH", body: { status: "LOST", lostReason: "x y z" } })).status === 409, "a converted lead's status is final");

// The Google Ads lead is won and converted → it becomes an offline conversion.
await admin(`/api/leads/${W}`, { method: "PATCH", body: { status: "WON" } });
ok((await admin(`/api/leads/${W}`, { method: "POST", body: { action: "convert", serviceId: svc.id, scheduledDate: "2027-02-10", scheduledTimeSlot: "14:00 - 16:00" } })).status === 201, "the website (Google Ads) lead converts to a customer and job");

console.log("--- Dashboard, filters, export");
const all = (await admin("/api/leads?pageSize=100")).json?.data;
const s = all.stats;
ok(s.total === leadCount() && s.won === 3 && s.lost === 1 && s.conversionRate === 75, `dashboard counts (total ${s.total}, won ${s.won}, lost ${s.lost}, conversion ${s.conversionRate}%)`);
ok(s.bySource.WHATSAPP === 1 && s.bySource.GOOGLE_ADS === 1 && s.bySource.PHONE_CALL >= 2 && s.bySource.REFERRAL === 1, "leads by source");
ok(s.quotationsSent >= 1 && typeof s.pipelineValue === "number", "quotations sent and pipeline value");
ok((await admin("/api/leads?source=WHATSAPP")).json?.data?.rows?.every((r) => r.source === "WHATSAPP"), "source filter");
ok((await admin("/api/leads?status=WON")).json?.data?.rows?.length === 3, "status filter");
ok((await admin(`/api/leads?q=${encodeURIComponent("98450 00004")}`)).json?.data?.rows?.[0]?.id === W, "search by phone in any format");
ok((await admin(`/api/leads?from=${today}&to=${today}`)).json?.data?.total === leadCount(), "date filter (today)");
ok((await admin("/api/leads?from=2020-01-01&to=2020-01-31")).json?.data?.total === 0, "date filter (a past month)");
const board = (await admin("/api/leads?view=board")).json?.data;
ok(board.rows.length === leadCount(), "Kanban view loads every lead");
const csv = await admin("/api/leads?format=csv", { raw: true });
ok(csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type")) && (await csv.text()).includes("LD-"), "CSV export");
const ads = await (await admin("/api/leads?format=ads-conversions", { raw: true })).text();
ok(/Google Click ID/.test(ads) && ads.includes("Cj0KCQ-test-click") && /\+0530/.test(ads) && !ads.includes(L1.leadNumber), "Google Ads offline-conversion export lists the won lead's click id (and only leads that have one)");
const gm = (await admin("/api/leads/google-metrics")).json?.data;
ok(gm && gm.configured === false && Object.keys(gm.totals).length === 0, "Google Business Profile metrics report 'not connected' without credentials (no fake numbers)");

console.log("--- Persistence");
const again = await getLead(L1.id);
ok(again.lead.leadNumber === L1.leadNumber && again.lead.estimatedValue === 9000 && again.lead.quoteId === q.id, "data persists across reloads");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
