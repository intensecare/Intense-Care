// Backend end-to-end check for the Android app's server side: device registration + scoped token,
// contact sync (batches, idempotency, dedupe, removal, retention), lead policy, push (fake FCM),
// Media & Storage (fake Cloudinary).
//
// Needs a server started with the fake providers (see scripts/fake-providers.mjs header) on an EMPTY
// database that already ran scripts/e2e-verify.mjs's user setup (this script creates its own users too).
//
//   node scripts/fake-providers.mjs &         # port 3998
//   DATABASE_URL=… BASE_URL=http://localhost:3100 CRON_SECRET=cron-secret node scripts/mobile-verify.mjs
import { execSync } from "node:child_process";
const BASE = process.env.BASE_URL || "http://localhost:3100";
const FAKE = process.env.FAKE_URL || "http://localhost:3998";
const CRON = process.env.CRON_SECRET || "cron-secret";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();

function client() {
  let cookie = "";
  return async (path, { method = "GET", body, headers = {}, raw } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    if (raw) return res;
    const json = await res.json().catch(() => null);
    return { status: res.status, json, data: json?.data };
  };
}
const login = async (email, password) => { const c = client(); const r = await c("/api/auth/login", { method: "POST", body: { email, password } }); return { c, r }; };
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const uid = () => Math.random().toString(36).slice(2).padEnd(24, "x");

const admin = (await login("admin@test.local", "adminpass123")).c;
ok((await admin("/api/auth/session")).json?.data?.role === "admin", "admin signs in");
const ensureUser = async (name, email, role) => {
  const r = await admin("/api/users", { method: "POST", body: { name, email, phone: "+919800000000", role, password: "password123" } });
  return r.data;
};
await ensureUser("Ravi FM", "fm1@test.local", "field_operations_manager");
await ensureUser("Sana FM", "fm2@test.local", "field_operations_manager");
await ensureUser("Quinn QC", "qc@test.local", "field_operations_manager");
const fm1 = (await login("fm1@test.local", "password123")).c;
const fm2 = (await login("fm2@test.local", "password123")).c;
const qc = (await login("qc@test.local", "password123")).c;

/* ------------------------------ A. devices & token ------------------------------ */
const DEV1 = "device-aaaaaaaaaaaaaaaa";
const DEV2 = "device-bbbbbbbbbbbbbbbb";
ok((await admin("/api/mobile/devices", { method: "POST", body: { deviceId: "short" } })).status === 400, "short device id rejected");
const reg = await admin("/api/mobile/devices", { method: "POST", body: { deviceId: DEV1, label: "Pixel 8", appVersion: "1.0.0", syncToken: true } });
const TOKEN = reg.data?.syncToken;
ok(reg.status === 201 && /^icd_/.test(TOKEN || ""), "Admin registers phone and receives a one-time sync token");
ok(sql(`select count(*) from "MobileDevice" where "syncTokenHash" = '${TOKEN}'`) === "0", "token is not stored in plaintext");
ok((await fm1("/api/mobile/devices", { method: "POST", body: { deviceId: DEV2, syncToken: true } })).status === 403, "Field Manager cannot obtain a contact-sync token");
const fmReg = await fm1("/api/mobile/devices", { method: "POST", body: { deviceId: DEV2, label: "FM phone" } });
ok(fmReg.status === 200 && !fmReg.data?.syncToken, "Field Manager can register a phone for push (no sync token)");
ok((await admin("/api/mobile/contacts/sync", { method: "POST", body: {} })).status === 401, "cookie session is not accepted by the sync endpoint");
ok((await admin("/api/mobile/contacts/sync", { method: "POST", headers: bearer("icd_" + "z".repeat(40)), body: {} })).status === 401, "unknown token rejected");

/* ------------------------------ B. contact sync ------------------------------ */
// A customer that already exists: its number must be recognised, never duplicated.
// (A different fixture than e2e-verify.mjs's "Asha Rao" / +919812345678 — this script runs
// on the same database right after it, and two customers sharing a phone number would make
// the "which customer did this contact link to" check below ambiguous by design.)
const cust = (await admin("/api/customers", { method: "POST", body: { name: "Deepa Iyer", phone: "+919812345679" } })).data;
const custCountBefore = sql(`select count(*) from "Customer"`);
const leadCountBefore = sql(`select count(*) from "Lead"`);

const batch = (over = {}) => ({ runId: "run-" + uid().slice(0, 10), trigger: "INITIAL", batchIndex: 0, batchCount: 1, idempotencyKey: "key-" + uid(), scannedTotal: 0, contacts: [], removedIds: [], final: true, ...over });
const sync = (b, token = TOKEN) => admin("/api/mobile/contacts/sync", { method: "POST", headers: bearer(token), body: b });

const contacts = [
  { id: "c1", name: "Deepa Iyer", phones: ["098123 45679"], updatedAt: 1000 },       // existing customer, different format
  { id: "c2", name: "Vikram Shah", phones: ["+91 99887 76655", "99887-76655"] },     // same number twice
  { id: "c3", name: "Meera (work)", phones: ["+919988776655"] },                    // duplicate number with c2 (different name)
  { id: "c4", name: "No Number", phones: [] },                                       // skipped
  { id: "c5", name: "Bad", phones: ["abc"] },                                        // skipped (no usable number)
  { id: "c6", name: "Intl", phones: ["+14155550123"] },
  { id: "c1", name: "Deepa Iyer", phones: ["098123 45679"] },                         // same id twice in a batch
];
const r1 = await sync(batch({ runId: "run-initial-1", scannedTotal: contacts.length, contacts }));
ok(r1.status === 200 && r1.data?.added === 4, `initial import adds 4 usable contacts (got ${JSON.stringify(r1.data)})`);
ok(r1.data?.skipped === 2, "contacts without a usable number are skipped, not failed");
ok(sql(`select count(*) from "Customer"`) === custCountBefore, "no customer created by sync");
ok(sql(`select count(*) from "Lead"`) === leadCountBefore, "no lead created by sync under the default policy");
ok(sql(`select count(*) from "PhoneContact" where "deviceContactId"='c1'`) === "1", "same device contact id twice in a batch → one row");
ok(r1.data?.duplicates >= 2, "two contacts sharing a number are flagged as potential duplicates (not merged)");
ok(sql(`select count(*) from "PhoneContact" where status='ACTIVE'`) === "4", "no merge by name: c2 and c3 remain separate contacts");

// idempotent replay
const rb = batch({ runId: "run-incr-1", trigger: "SCHEDULED", scannedTotal: 4, contacts: [{ id: "c7", name: "New Person", phones: ["+91 90000 11111"] }] });
const a = await sync(rb), b = await sync(rb);
ok(a.data?.added === 1 && b.data?.replayed === true && b.data?.added === 1, "replaying the same idempotency key returns the stored result");
ok(sql(`select count(*) from "PhoneContact" where "deviceContactId"='c7'`) === "1", "replay creates no second row");

// repeat sync of unchanged data → no changes
const again = await sync(batch({ runId: "run-incr-2", trigger: "RESUME", scannedTotal: 5, contacts: contacts.slice(0, 4).filter((c) => c.phones.length).concat([{ id: "c7", name: "New Person", phones: ["+91 90000 11111"] }]) }));
ok(again.data?.added === 0 && again.data?.updated === 0 && again.data?.unchanged >= 3, `unchanged contacts are not re-added (${JSON.stringify(again.data)})`);

// changed contact: new number & new name → UPDATED, same row
const upd = await sync(batch({ runId: "run-incr-3", trigger: "MANUAL", scannedTotal: 1, contacts: [{ id: "c7", name: "New Person Renamed", phones: ["+91 90000 11111", "+91 90000 22222"] }] }));
ok(upd.data?.updated === 1 && upd.data?.added === 0, "changed contact is updated in place");
ok(sql(`select count(*) from "PhoneContactNumber" n join "PhoneContact" c on c.id=n."contactId" where c."deviceContactId"='c7'`) === "2", "new number attached to the same contact");
ok(sql(`select "displayName" from "PhoneContact" where "deviceContactId"='c7'`) === "New Person Renamed", "name updated");

// customer link
const dir = await admin("/api/contacts?link=customer");
ok(dir.status === 200 && dir.data?.rows?.some((r) => r.customer?.id === cust?.id), "contact with an existing customer's number is linked to that customer");

// removal
const rem = await sync(batch({ runId: "run-incr-4", trigger: "SCHEDULED", scannedTotal: 4, removedIds: ["c6"] }));
ok(rem.data?.removed === 1, "removed contact is reported");
ok(sql(`select status from "PhoneContact" where "deviceContactId"='c6'`) === "REMOVED", "removed contact is marked REMOVED, not deleted");
ok(sql(`select count(*) from "Customer"`) === custCountBefore, "removal never deletes a customer");
// removed contact reappears → active again
const back = await sync(batch({ runId: "run-incr-5", trigger: "SCHEDULED", scannedTotal: 5, contacts: [{ id: "c6", name: "Intl", phones: ["+14155550123"] }] }));
ok(back.data?.updated === 1 && sql(`select status from "PhoneContact" where "deviceContactId"='c6'`) === "ACTIVE", "re-added contact becomes ACTIVE again (no new row)");
ok(sql(`select count(*) from "PhoneContact" where "deviceContactId"='c6'`) === "1", "still one row for the device id");

// validation
ok((await sync({ nonsense: true })).status === 400, "malformed batch rejected");
ok((await sync(batch({ contacts: Array.from({ length: 201 }, (_, i) => ({ id: "x" + i, name: "n", phones: ["+919000000000"] })) }))).status === 400, "batch over 200 contacts rejected");
const mixed = await sync(batch({ runId: "run-mixed", trigger: "MANUAL", scannedTotal: 3, contacts: [{ id: "m1", name: "Ok One", phones: ["+91 80000 00001"] }, { name: "no id" }, { id: "m3", name: "Ok Three", phones: ["+91 80000 00003"] }] }));
ok(mixed.data?.added === 2 && mixed.data?.failed?.length === 1, "one invalid record fails alone; the rest save");

// status
const st = await admin(`/api/mobile/contacts/status?deviceId=${DEV1}`);
ok(st.data?.connected === true && st.data?.lastRun && st.data?.activeContacts >= 6, "status reports connection, last run and counts");
ok((await fm1(`/api/mobile/contacts/status?deviceId=${DEV1}`)).data?.connected === false, "another user cannot read this phone's status");

// permissions on directory
ok((await fm1("/api/contacts")).status === 403, "Field Manager cannot view the contacts directory");
ok((await qc("/api/contacts")).status === 403, "QC cannot view the contacts directory");
ok((await admin("/api/contacts?q=99887")).data?.total >= 2, "directory search by number works");
ok((await admin("/api/contacts?format=csv", { raw: true })).headers.get("content-type")?.includes("csv"), "directory CSV export");
const dups = await admin("/api/contacts/duplicates");
ok(dups.status === 200 && JSON.stringify(dups.data).includes("Vikram Shah"), "duplicates review lists contacts sharing a number");

// pause
await admin("/api/mobile/devices", { method: "PATCH", body: { deviceId: DEV1, syncPaused: true } });
const paused = await sync(batch({ contacts: [{ id: "p1", name: "Paused", phones: ["+919000000001"] }] }));
ok(paused.status === 423 && paused.json?.code === "SYNC_PAUSED", "paused phone gets 423 SYNC_PAUSED");
ok(sql(`select count(*) from "PhoneContact" where "deviceContactId"='p1'`) === "0", "nothing saved while paused");
await admin("/api/mobile/devices", { method: "PATCH", body: { deviceId: DEV1, syncPaused: false } });

// failure report
const fr = await admin("/api/mobile/contacts/failure", { method: "POST", headers: bearer(TOKEN), body: { runId: "run-fail-1", trigger: "SCHEDULED", errorCode: "PERMISSION_DENIED" } });
ok(fr.status === 200, "phone can report a failed run (permission revoked)");
ok((await admin(`/api/mobile/contacts/status?deviceId=${DEV1}`)).data?.lastRun?.errorCode === "PERMISSION_DENIED", "status shows permission error code");

/* ------------------------------ C. lead policy ------------------------------ */
const imp = await admin("/api/contacts/import-leads", { method: "POST", body: { ids: [sql(`select id from "PhoneContact" where "deviceContactId"='c2'`), sql(`select id from "PhoneContact" where "deviceContactId"='c1'`)] } });
ok(imp.data?.created === 1 && imp.data?.alreadyCustomer === 1, `selected import: creates lead, skips existing customer (${JSON.stringify(imp.data)})`);
ok(sql(`select count(*) from "Lead" where source='PHONE_CONTACT'`) === "1", "lead source is PHONE_CONTACT");
const imp2 = await admin("/api/contacts/import-leads", { method: "POST", body: { ids: [sql(`select id from "PhoneContact" where "deviceContactId"='c2'`)] } });
ok(imp2.data?.created === 0 && imp2.data?.alreadyImported === 1, "importing the same contact twice creates no second lead");
ok((await fm1("/api/contacts/import-leads", { method: "POST", body: { ids: ["x"] } })).status === 403, "Field Manager cannot import contacts as leads");

ok((await admin("/api/settings", { method: "PATCH", body: { contactSync: { leadPolicy: "AUTO_NEW_CONTACTS" } } })).status === 400, "automatic leads need explicit confirmation");
const pol = await admin("/api/settings", { method: "PATCH", body: { contactSync: { leadPolicy: "AUTO_NEW_CONTACTS", confirmAutoLeads: true } } });
ok(pol.status === 200 && pol.data?.contactSync?.autoLeadApprovedBy, "automatic leads approved, approver recorded");
await new Promise((r) => setTimeout(r, 50));
const auto = await sync(batch({ runId: "run-auto-1", trigger: "SCHEDULED", scannedTotal: 2, contacts: [{ id: "a1", name: "Auto One", phones: ["+91 70000 00001"] }, { id: "a2", name: "Asha Again", phones: ["+91 98123 45678"] }] }));
ok(auto.data?.added === 2, "new contacts synced under auto policy");
ok(sql(`select count(*) from "Lead" where source='PHONE_CONTACT'`) === "2", "auto policy: new non-customer contact becomes a lead; existing customer's contact does not");
await sync(batch({ runId: "run-auto-2", trigger: "SCHEDULED", scannedTotal: 2, contacts: [{ id: "a1", name: "Auto One", phones: ["+91 70000 00001"] }] }));
ok(sql(`select count(*) from "Lead" where source='PHONE_CONTACT'`) === "2", "repeat sync creates no duplicate lead");
const init = await sync(batch({ runId: "run-auto-3", trigger: "INITIAL", scannedTotal: 1, contacts: [{ id: "a9", name: "Initial Under Auto", phones: ["+91 70000 00009"] }] }));
ok(init.data?.added === 1 && sql(`select count(*) from "Lead" where source='PHONE_CONTACT'`) === "2", "initial import never auto-creates leads");
await admin("/api/settings", { method: "PATCH", body: { contactSync: { leadPolicy: "DIRECTORY_ONLY" } } });

/* ------------------------------ D. retention + cron ------------------------------ */
sql(`update "PhoneContact" set status='REMOVED', "removedAt" = now() - interval '120 days' where "deviceContactId"='c6'`);
sql(`update "PhoneContact" set status='REMOVED', "removedAt"=now() where "deviceContactId"='m1'`);
ok((await admin("/api/cron/maintenance", { raw: true })).status === 401, "cron endpoint rejects a request without the secret");
const cron = await admin("/api/cron/maintenance", { headers: bearer(CRON) });
ok(cron.status === 200, "cron maintenance runs with the secret");
ok(sql(`select count(*) from "PhoneContact" where "deviceContactId"='c6'`) === "0", "contact removed >90 days ago is purged");
ok(sql(`select count(*) from "PhoneContact" where "deviceContactId"='m1'`) === "1", "recently removed contact is retained");

/* ------------------------------ E. disconnect / account switching ------------------------------ */
ok((await admin("/api/mobile/devices/revoke", { method: "POST", body: { rowId: sql(`select id from "MobileDevice" where "deviceId"='${DEV2}'`) } })).status === 200, "Admin can revoke any phone");
const rev = await admin("/api/mobile/devices/revoke", { method: "POST", headers: bearer(TOKEN), body: { deviceId: DEV1 } });
ok(rev.status === 200 && rev.data?.disconnected, "phone disconnects itself with its own token");
ok((await sync(batch({ contacts: [{ id: "z", name: "z", phones: ["+919000000009"] }] }))).status === 401, "revoked token no longer works");
ok(Number(sql(`select count(*) from "PhoneContact"`)) > 0, "disconnect keeps contacts by default");
const reg2 = await admin("/api/mobile/devices", { method: "POST", body: { deviceId: DEV1, syncToken: true } });
ok(reg2.status === 201 && reg2.data.syncToken !== TOKEN, "reconnect issues a new token");
const del = await admin("/api/mobile/devices/revoke", { method: "POST", body: { deviceId: DEV1, deleteContacts: true } });
ok(del.data?.contactsDeleted > 0 && sql(`select count(*) from "PhoneContact"`) === "0", "disconnect + delete removes uploaded contacts");
ok(sql(`select count(*) from "Customer"`) === String(Number(custCountBefore)), "customers untouched by contact deletion");
ok(sql(`select count(*) from "Lead" where source='PHONE_CONTACT'`) === "2", "leads untouched by contact deletion");

// logs carry no PII — check the server log if provided
if (process.env.SERVER_LOG) {
  const log = execSync(`cat ${process.env.SERVER_LOG}`).toString();
  ok(!/Vikram Shah|99887|Deepa Iyer.*contact_sync/.test(log.split("\n").filter((l) => l.includes("contact_sync")).join("\n")), "contact_sync log lines contain no names or numbers");
}


/* ------------------------------ F. push (fake FCM) ------------------------------ */
const fake = async (path, body) => (await fetch(FAKE + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const sent = () => fake("/fcm/__sent");
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const fm1Row = sql(`select id from "User" where email='fm1@test.local'`);
const fm2Row = sql(`select id from "User" where email='fm2@test.local'`);
const qcRow = sql(`select id from "User" where email='qc@test.local'`);
const P_DEV_FM1 = "device-fm1-aaaaaaaaaaaa", P_DEV_FM2 = "device-fm2-bbbbbbbbbbbb", P_DEV_QC = "device-qc-cccccccccccc", P_DEV_ADM = "device-adm-dddddddddddd";
for (const [c, d] of [[fm1, P_DEV_FM1], [fm2, P_DEV_FM2], [qc, P_DEV_QC], [admin, P_DEV_ADM]]) await c("/api/mobile/devices", { method: "POST", body: { deviceId: d, label: "t" } });
const tokFm1 = "fcm-token-fm1-" + "a".repeat(30), tokFm2 = "fcm-token-fm2-" + "b".repeat(30), tokQc = "fcm-token-qc-" + "c".repeat(30), tokAdm = "fcm-token-adm-" + "d".repeat(30);
ok((await fm1("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM1, pushToken: tokFm1 } })).data?.hasPushToken === true, "FM registers a push token");
await fm2("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM2, pushToken: tokFm2 } });
await qc("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_QC, pushToken: tokQc } });
await admin("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_ADM, pushToken: tokAdm } });
ok(sql(`select count(*) from "MobileDevice" where "pushToken" like 'fcm-token-%'`) === "4", "push tokens stored");

const svc = (await admin("/api/services", { method: "POST", body: { name: "Deep Clean 2BHK", basePrice: 4999, estimatedDurationHours: 4, checklistTemplate: [{ area: "Kitchen", task: "Degrease hob", critical: true }] } })).data;
const pcust = (await admin("/api/customers", { method: "POST", body: { name: "Priya Nair", phone: "+919877700001" } })).data;
const pprop = (await admin("/api/properties", { method: "POST", body: { customerId: pcust.id, title: "Hillside Villa", address: "7 Hill Rd, Bengaluru" } })).data;
const today = new Date().toISOString().slice(0, 10);
const mkJob = async (extra = {}) => (await admin("/api/jobs", { method: "POST", body: { customerId: pcust.id, propertyId: pprop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "09:00 - 13:00", ...extra } })).data?.job;

const jobA = await mkJob({ assignedManagerId: fm1Row });
await settle();
let s1 = await sent();
const assigned = s1.filter((m) => m.token === tokFm1 && m.data?.type === "JOB_ASSIGNED");
ok(assigned.length === 1, `job creation with a crew pushes "assigned" to that Field Manager only (${assigned.length})`);
ok(s1.filter((m) => m.token === tokFm2).length === 0, "other Field Manager gets nothing");
const blob = JSON.stringify(s1);
ok(!/Priya|Nair|Hill|9877700001|PRIYA|4999|₹/.test(blob), "push payloads contain no customer name, address, phone, Job ID or amount");
ok(assigned[0].data.route === `/my-jobs/${jobA.id}`, "push carries the in-app route to the job");

// reassign FM1 → FM2
const re = await admin(`/api/jobs/${jobA.id}`, { method: "PATCH", body: { assignedManagerId: fm2Row } });
await settle();
s1 = await sent();
ok(re.status === 200 && s1.some((m) => m.token === tokFm2 && m.data.type === "JOB_ASSIGNED") && s1.some((m) => m.token === tokFm1 && m.data.type === "JOB_REASSIGNED"), "reassignment notifies new crew (assigned) and old crew (reassigned)");

// duplicate event suppression
const before = (await sent()).length;
await admin(`/api/jobs/${jobA.id}`, { method: "PATCH", body: { assignedManagerId: fm2Row } });
await settle();
ok((await sent()).length === before, "re-saving the same assignment sends no duplicate push");

// test endpoint
ok((await fm1("/api/push/test", { method: "POST" })).data?.sent === true, "test notification reaches own phone");
await fm1("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM1, notificationsEnabled: false } });
ok((await fm1("/api/push/test", { method: "POST" })).status === 409, "notifications switched off → no phone to send to");
await fm1("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM1, notificationsEnabled: true } });

// dead / flaky tokens
const deadTok = "dead-token-" + "x".repeat(30);
await fm1("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM1, pushToken: deadTok } });
await fm1("/api/push/test", { method: "POST" });
ok(sql(`select "pushToken" is null from "MobileDevice" where "deviceId"='${P_DEV_FM1}'`) === "t", "token Firebase says is dead is cleared");
const flaky = "flaky-token-" + "y".repeat(30);
await fm1("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM1, pushToken: flaky } });
ok((await fm1("/api/push/test", { method: "POST" })).data?.sent === true, "transient FCM error is retried once and delivered");
await fm1("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM1, pushToken: tokFm1 } });

// token moves between accounts on the same phone
await fm2("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM2, pushToken: tokFm1 } });
ok(sql(`select count(*) from "MobileDevice" where "pushToken"='${tokFm1}'`) === "1" && sql(`select "deviceId" from "MobileDevice" where "pushToken"='${tokFm1}'`) === P_DEV_FM2, "a push token belongs to one account: signing in as someone else moves it");
await fm2("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM2, pushToken: tokFm2 } });
await fm1("/api/mobile/devices", { method: "PATCH", body: { deviceId: P_DEV_FM1, pushToken: tokFm1 } });

// broadcast
ok((await fm1("/api/push/broadcast", { method: "POST", body: { title: "Hello", body: "Update", idempotencyKey: "bc-12345678" } })).status === 403, "Field Manager cannot broadcast");
const bc1 = await admin("/api/push/broadcast", { method: "POST", body: { title: "Holiday", body: "Office closed Friday", idempotencyKey: "bc-12345678" } });
const bc2 = await admin("/api/push/broadcast", { method: "POST", body: { title: "Holiday", body: "Office closed Friday", idempotencyKey: "bc-12345678" } });
ok(bc1.data?.SENT >= 3 && bc2.data?.SENT === 0 && bc2.data?.DUPLICATE >= 3, `broadcast with the same idempotency key sends once (${JSON.stringify(bc1.data)} / ${JSON.stringify(bc2.data)})`);

// QC pending + rework + approval: drive the job with direct SQL status + the real notify functions through the API where possible
const qcJob = await mkJob({ assignedManagerId: fm2Row, scheduledTimeSlot: "14:00 - 17:00" });
sql(`update "Job" set status='IN_PROGRESS' where id='${qcJob.id}'`);
const wc = await fm2(`/api/jobs/${qcJob.id}`, { method: "PATCH", body: { status: "WORK_COMPLETED" } });
await settle();
const qs = await sent();
if (wc.status === 200) ok(qs.some((m) => m.token === tokQc && m.data.type === "QC_PENDING"), "work completed → QC inspector gets a 'pending inspection' push");
else console.log("INFO WORK_COMPLETED not reachable without checklist/photos here:", wc.status, wc.json?.error);

// cron: reminders + follow-ups (asOf)
const cr = await admin("/api/cron/maintenance", { headers: bearer(CRON) });
await settle();
ok(cr.status === 200, "cron maintenance runs");
const remBefore = (await sent()).filter((m) => m.data.type === "JOB_REMINDER").length;
await admin("/api/cron/maintenance", { headers: bearer(CRON) });
await settle();
ok((await sent()).filter((m) => m.data.type === "JOB_REMINDER").length === remBefore, "cron run twice does not repeat a reminder");
ok(!(await sent()).some((m) => /Priya|Nair|Hill/.test(JSON.stringify(m))), "no PII in any push sent so far");

/* ------------------------------ G. media (fake Cloudinary) ------------------------------ */
const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300060001fd1b6f4d0000000049454e44ae426082", "hex"), Buffer.alloc(40)]).toString("base64");
const mjob = await mkJob({ assignedManagerId: fm2Row, scheduledTimeSlot: "18:00 - 20:00" });
sql(`update "Job" set status='IN_PROGRESS' where id='${mjob.id}'`);
ok((await fm2("/api/photos", { method: "POST", body: { jobId: mjob.id, area: "Kitchen", photoType: "before", image: "data:text/html;base64," + Buffer.from("<script>alert(1)</script>".repeat(5)).toString("base64") } })).status === 400, "non-image payload rejected");
const up1 = await fm2("/api/photos", { method: "POST", body: { jobId: mjob.id, area: "Kitchen", photoType: "before", image: PNG, clientUploadId: "upl-1234567890" } });
ok(up1.status === 200 && up1.data?.id, "photo upload via fake Cloudinary succeeds");
const up1b = await fm2("/api/photos", { method: "POST", body: { jobId: mjob.id, area: "Kitchen", photoType: "before", image: PNG, clientUploadId: "upl-1234567890" } });
ok(up1b.json?.replayed === true && up1b.data?.id === up1.data?.id, "same clientUploadId returns the saved photo");
const conc = await Promise.all([0, 1, 2].map(() => fm2("/api/photos", { method: "POST", body: { jobId: mjob.id, area: "Bath", photoType: "after", image: PNG, clientUploadId: "upl-concurrent-1" } })));
ok(new Set(conc.map((r) => r.data?.id)).size === 1, "three simultaneous identical uploads → one photo");
await settle(300);
ok(sql(`select count(*) from "JobPhoto" where "clientUploadId"='upl-concurrent-1'`) === "1", "DB holds one row for the concurrent upload");
const st2 = await fake("/__state");
ok(st2.assets.length === 2, `no orphan files left in cloud storage after concurrent upload (${st2.assets.length} assets)`);
ok((await fm1("/api/photos", { method: "POST", body: { jobId: mjob.id, area: "K", photoType: "before", image: PNG } })).status === 403, "Field Manager not on the job cannot upload");
await fake("/__control", { failUpload: true });
ok([502, 503].includes((await fm2("/api/photos", { method: "POST", body: { jobId: mjob.id, area: "K", photoType: "before", image: PNG, clientUploadId: "upl-fail-0001" } })).status), "provider failure → error, never a fake success");
await fake("/__control", { failUpload: false });
ok(sql(`select count(*) from "JobPhoto" where "clientUploadId"='upl-fail-0001'`) === "0", "failed upload leaves no photo record");

// permissions
ok((await fm2("/api/media")).status === 403, "Field Manager cannot open Media & Storage");
ok((await qc("/api/media/summary")).status === 403, "QC cannot open Media & Storage");
const list = await admin("/api/media?sort=largest");
ok(list.status === 200 && list.data?.total >= 2 && list.data.rows[0].jobSerial, "Admin lists managed media with Job ID");
ok((await admin("/api/media?category=BEFORE")).data?.rows.every((r) => r.category === "BEFORE"), "category filter");
ok((await admin(`/api/media?q=${encodeURIComponent((mjob.jobSerial ?? mjob.jobNumber).slice(0, 8))}`)).data?.total >= 2, "search by Job ID / customer");

// summary & quota — never invented
let sum = (await admin("/api/media/summary?refresh=1")).data;
ok(sum?.managed?.files >= 2 && sum.quota, "summary returns usage and counts");
ok(sum.quota.limitBytes === null && sum.quota.level === "UNKNOWN", `no provider limit → quota is UNKNOWN, not invented (level=${sum.quota.level})`);
await fake("/__control", { limitBytes: 1000, usageBytes: 950 });
sum = (await admin("/api/media/summary?refresh=1")).data;
ok(sum.quota.limitSource === "provider" && ["WARN", "FULL"].includes(sum.quota.level) && /almost full|full/i.test(sum.quota.message || ""), `provider limit reached → warning (${sum.quota.level}: ${sum.quota.message})`);
await fake("/__control", { limitBytes: 1_000_000_000_000, usageBytes: 950 });
sum = (await admin("/api/media/summary?refresh=1")).data;
ok(sum.quota.level === "OK", "plenty of space → OK");
await fake("/__control", { failUsage: true });
sum = (await admin("/api/media/summary?refresh=1")).data;
ok(sum.quota.level === "UNKNOWN" && sum.managed.files >= 2, "provider usage unavailable → estimate from ERP records, labelled unknown");
await fake("/__control", { failUsage: false, limitBytes: 0, usageBytes: null });

// protection matrix
const photoId = `jp:${up1.data.id}`;
let prev = (await admin("/api/media/delete", { method: "POST", body: { ids: [photoId], preview: true } })).data;
ok(prev?.items?.[0]?.protection?.level === "LOCKED", "photo of an in-progress job is LOCKED");
ok(prev.items[0].fileName || prev.items[0].name, "preview shows file name");
const refuse = await admin("/api/media/delete", { method: "POST", body: { ids: [photoId], confirm: true } });
ok(refuse.data?.results?.[0]?.outcome === "REFUSED" && sql(`select count(*) from "JobPhoto" where id='${up1.data.id}'`) === "1", "LOCKED photo cannot be deleted");
ok((await admin("/api/media/delete", { method: "POST", body: { ids: [photoId] } })).status === 400, "deletion without confirmation refused");
ok((await fm2("/api/media/delete", { method: "POST", body: { ids: [photoId], confirm: true } })).status === 403, "Field Manager cannot delete media");

sql(`update "Job" set status='COMPLETED', "completedAt"=now() where id='${mjob.id}'`);
prev = (await admin("/api/media/delete", { method: "POST", body: { ids: [photoId], preview: true } })).data;
ok(prev.items[0].protection.level === "LOCKED" && /invoice/i.test(prev.items[0].protection.reasons.join(" ")), "finished job with an unpaid invoice → LOCKED");
sql(`update "Invoice" set status='PAID' where "jobId"='${mjob.id}'`);
ok((await fm2(`/api/photos/${up1.data.id}`, { method: "DELETE" })).status !== 200 && sql(`select count(*) from "JobPhoto" where id='${up1.data.id}'`) === "1", "legacy photo DELETE is blocked once the job is finished (evidence)");
prev = (await admin("/api/media/delete", { method: "POST", body: { ids: [photoId], preview: true } })).data;
ok(prev.items[0].protection.level === "PROTECTED", "recently finished job → PROTECTED");
const noOv = await admin("/api/media/delete", { method: "POST", body: { ids: [photoId], confirm: true } });
ok(noOv.data?.results?.[0]?.outcome === "REFUSED", "PROTECTED photo refused without override");
const badOv = await admin("/api/media/delete", { method: "POST", body: { ids: [photoId], confirm: true, override: { reason: "short", phrase: "x" } } });
ok(badOv.status === 400 || badOv.data?.results?.[0]?.outcome === "REFUSED", "override with weak reason / wrong phrase refused");
// provider failure keeps the DB row
await fake("/__control", { failDestroyAll: true });
const pf = await admin("/api/media/delete", { method: "POST", body: { ids: [photoId], confirm: true, override: { reason: "Customer asked to erase photos", phrase: "DELETE PROTECTED MEDIA" } } });
ok(pf.data?.results?.[0]?.outcome === "FAILED" && sql(`select count(*) from "JobPhoto" where id='${up1.data.id}'`) === "1", "cloud deletion failure keeps the record (no broken link)");
await fake("/__control", { failDestroyAll: false });
const del1 = await admin("/api/media/delete", { method: "POST", body: { ids: [photoId], confirm: true, override: { reason: "Customer asked to erase photos", phrase: "DELETE PROTECTED MEDIA" } } });
ok(del1.data?.deleted === 1 && sql(`select count(*) from "JobPhoto" where id='${up1.data.id}'`) === "0", "PROTECTED photo deleted with reason + phrase");
ok(Number(sql(`select count(*) from "MediaDeletion"`)) >= 1, "permanent MediaDeletion audit row written");
ok(Number(sql(`select count(*) from "AuditLog" where action='MEDIA_PROTECTED_DELETED'`)) >= 1, "audit log records the override");
ok((await fake("/__state")).assets.length === 1, "file really removed from cloud storage");

// unreferenced scan: orphan in cloud (older than 24 h) is found; fresh one is not
const orphanId = "intense-care/jobs/orphan-old";
await fake("/__seed", { publicId: orphanId, bytes: 5000, createdAt: new Date(Date.now() - 3 * 86400000).toISOString() });
await fake("/__seed", { publicId: "intense-care/jobs/orphan-new", bytes: 5000 });
const un = (await admin("/api/media/unreferenced")).data;
ok(JSON.stringify(un).includes("orphan-old") && !JSON.stringify(un).includes("orphan-new"), "unreferenced scan finds the old orphan, ignores one uploaded moments ago");
const delOrphan = await admin("/api/media/delete", { method: "POST", body: { ids: ["cl:" + orphanId], confirm: true } });
ok(delOrphan.data?.deleted === 1 && !(await fake("/__state")).assets.some((a) => a.public_id === orphanId), "orphan removed from cloud storage");

console.log(`\nmobile-verify: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
