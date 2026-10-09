// Job start verification modes: DIRECT, QR, QR_GPS, GPS — enforced by the API.
// Run AFTER scripts/e2e-verify.mjs (reuses its users) against the same server and DB:
//   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/start-verify.mjs
import { execSync } from "node:child_process";
const BASE = process.env.BASE_URL || "http://localhost:3100";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();
function client() {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}
const login = async (e, p) => { const c = client(); await c("/api/auth/login", { method: "POST", body: { email: e, password: p } }); return c; };
const admin = await login("admin@test.local", "adminpass123");
const fmc = await login("fm1@test.local", "password123");
const fm2c = await login("fm2@test.local", "password123");
const qcc = await login("qc@test.local", "password123");
const fm1 = sql(`select id from "User" where email='fm1@test.local'`);
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const HOME = { lat: 12.95, lng: 77.6 };
const NEAR = { lat: 12.9503, lng: 77.6002, accuracy: 12 }; // ~40 m away
const FAR = { lat: 12.97, lng: 77.62, accuracy: 10 }; // ~3 km away
const FUZZY = { lat: 12.9501, lng: 77.6001, accuracy: 450 }; // close but inaccurate

const cust = (await admin("/api/customers", { method: "POST", body: { name: "Start Mode Customer", phone: "+919800000777", address: "7 Gate Rd" } })).json?.data;
const prop = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Gate Villa", address: "7 Gate Rd", ...HOME } })).json?.data;
const prop2 = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Other Villa", address: "9 Far Rd", lat: 13.1, lng: 77.7 } })).json?.data;
const noPin = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "No Pin Flat", address: "Unknown" } })).json?.data;
const svc = (await admin("/api/services")).json?.data?.[0];
let hour = 6;
const mkJob = async (mode, p = prop) => {
  const h = String(hour++).padStart(2, "0"), h2 = String(hour).padStart(2, "0");
  const j = (await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: p.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: `${h}:00 - ${h2}:00`, assignedManagerId: fm1, invoiceType: "NON_GST" } })).json?.data?.job;
  if (mode) await admin(`/api/jobs/${j.id}`, { method: "PATCH", body: { startVerificationMode: mode } });
  return j;
};
const token = async (jobId) => (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId } })).json?.data?.linkUrl?.split("/").pop();
const start = (c, id, arrival) => c(`/api/jobs/${id}`, { method: "PATCH", body: { status: "ARRIVED", arrival } });
const statusOf = (id) => sql(`select status from "Job" where id='${id}'`);
const methodOf = (id) => sql(`select "arrivalVerification" from "Job" where id='${id}'`);
const attempts = (id, result) => Number(sql(`select count(*) from "JobStartVerification" where "jobId"='${id}'${result ? ` and result='${result}'` : ""}`));

/* ------------------------------------------------------------ settings */
console.log("--- Settings");
let st = (await admin("/api/settings")).json?.data?.jobStartVerification;
ok(st?.defaultMode === "GPS" && st.maxDistanceMeters === 300 && st.maxAccuracyMeters === 100 && st.allowPerJobOverride === true, "defaults: GPS, 300 m, ±100 m, per-job allowed");
ok((await fmc("/api/settings", { method: "PATCH", body: { jobStartVerification: { defaultMode: "DIRECT" } } })).status === 403, "Field Manager cannot change the start verification setting");
ok((await admin("/api/settings", { method: "PATCH", body: { jobStartVerification: { defaultMode: "FACE_ID" } } })).status === 400, "unknown mode refused");
ok((await admin("/api/settings", { method: "PATCH", body: { jobStartVerification: { maxDistanceMeters: 0 } } })).status === 400, "distance below 10 m refused");
ok((await admin("/api/settings", { method: "PATCH", body: { jobStartVerification: { maxAccuracyMeters: 99999 } } })).status === 400, "accuracy above 1000 m refused");
ok((await fmc("/api/settings")).json?.data?.jobStartVerification?.defaultMode === "GPS", "Field Manager can read which mode applies");

/* ------------------------------------------------------------ DIRECT */
console.log("--- DIRECT");
const jd = await mkJob("DIRECT");
ok((await fmc(`/api/jobs/${jd.id}`)).json?.data?.startVerificationMode === "DIRECT", "the job's mode is visible to its Field Manager");
ok([403, 404].includes((await start(fm2c, jd.id, {})).status), "another Field Manager cannot start it");
ok((await start(qcc, jd.id, {})).status === 403, "QC cannot start a job");
const dRes = await start(fmc, jd.id, {});
ok(dRes.status === 200 && statusOf(jd.id) === "ARRIVED" && methodOf(jd.id) === "DIRECT", "DIRECT: starts with no GPS or QR, recorded as DIRECT");
ok(sql(`select "userId"||'|'||mode||'|'||result||'|'||"statusBefore"||'|'||"statusAfter" from "JobStartVerification" where "jobId"='${jd.id}'`) === `${fm1}|DIRECT|PASSED|ASSIGNED|ARRIVED`, "DIRECT: log has user, mode, result, status before → after");
ok((await start(fmc, jd.id, {})).status === 409, "a second Start Job request is refused");
ok(statusOf(jd.id) === "ARRIVED", "…and the job is unchanged");

/* ------------------------------------------------------------ QR */
console.log("--- QR");
const jq = await mkJob("QR");
const jqOther = await mkJob("QR");
const jqFar = await mkJob("QR", prop2);
const tq = await token(jq.id), tOther = await token(jqOther.id), tFar = await token(jqFar.id);
ok(tq && tOther && tFar, "customer QR links exist from booking");
let r = await start(fmc, jq.id, {});
ok(r.status === 409 && r.json?.code === "QR_MISSING", "QR: no QR → refused (QR_MISSING)");
r = await start(fmc, jq.id, { qrToken: "x".repeat(43) });
ok(r.status === 409 && r.json?.code === "QR_INVALID", "QR: made-up QR → refused (QR_INVALID)");
r = await start(fmc, jq.id, { qrToken: tOther });
ok(r.status === 409 && r.json?.code === "QR_OTHER_JOB", "QR: QR of another job at the same property → refused");
r = await start(fmc, jq.id, { qrToken: tFar });
ok(r.status === 409 && r.json?.code === "QR_OTHER_JOB", "QR: QR of another property → refused");
r = await start(fmc, jq.id, { bypassReason: "GPS broken today" });
ok(r.status === 403 && r.json?.code === "OVERRIDE_NOT_ALLOWED", "QR: a Field Manager cannot skip the check with a reason");
ok(statusOf(jq.id) === "ASSIGNED", "QR: failed attempts leave the job unstarted");
r = await start(fmc, jq.id, { qrToken: tq });
ok(r.status === 200 && methodOf(jq.id) === "QR" && sql(`select "qrResult" from "JobStartVerification" where "jobId"='${jq.id}' and result='PASSED'`) === "VALID", "QR: the job's own QR starts it without GPS (QR, qrResult VALID)");
ok(attempts(jq.id, "FAILED") === 5 && attempts(jq.id, "PASSED") === 1, "QR: every failed attempt is logged (5 failed, 1 passed)");
ok(Number(sql(`select count(*) from "AuditLog" where "jobId"='${jq.id}' and action='JOB_START_VERIFICATION_FAILED'`)) === 5, "QR: failures are in the audit log too");
// revoked QR
await admin("/api/qr-links", { method: "POST", body: { action: "purge-job", jobId: jqOther.id } });
r = await start(fmc, jqOther.id, { qrToken: tOther });
ok(r.status === 409 && r.json?.code === "QR_INVALID", "QR: a revoked QR is refused");

/* ------------------------------------------------------------ QR + GPS */
console.log("--- QR_GPS");
const jb = await mkJob("QR_GPS");
const tb = await token(jb.id);
r = await start(fmc, jb.id, { ...NEAR });
ok(r.status === 409 && r.json?.code === "QR_MISSING", "QR+GPS: good GPS without QR → refused");
r = await start(fmc, jb.id, { qrToken: tb });
ok(r.status === 409 && r.json?.code === "GPS_MISSING", "QR+GPS: QR without GPS (GPS disabled) → refused");
r = await start(fmc, jb.id, { ...FUZZY, qrToken: tb });
ok(r.status === 409 && r.json?.code === "GPS_INACCURATE", "QR+GPS: inaccurate GPS → refused even with a valid QR");
r = await start(fmc, jb.id, { ...FAR, qrToken: tb });
ok(r.status === 409 && r.json?.code === "GPS_TOO_FAR" && /m from the job location/.test(r.json?.error ?? ""), "QR+GPS: outside the allowed distance → refused with the distance");
r = await start(fmc, jb.id, { ...NEAR, qrToken: tb });
ok(r.status === 200 && methodOf(jb.id) === "QR_GPS", "QR+GPS: both pass → started (QR_GPS)");
const row = sql(`select round(lat::numeric,4)||'|'||round(lng::numeric,4)||'|'||accuracy||'|'||"distanceM"||'|'||"qrResult" from "JobStartVerification" where "jobId"='${jb.id}' and result='PASSED'`).split("|");
ok(row[0] === "12.9503" && row[1] === "77.6002" && row[2] === "12" && Number(row[3]) > 0 && Number(row[3]) < 100 && row[4] === "VALID", `QR+GPS: coordinates, accuracy, distance (${row[3]} m) and QR result stored`);
ok(sql(`select count(*) from "JobActivityEvent" where "jobId"='${jb.id}' and message like '%GPS%m from the job + QR scanned%'`) === "1", "QR+GPS: verification shown in the job activity log");
// Admin override
const jo = await mkJob("QR_GPS");
ok((await start(admin, jo.id, {})).status === 400, "override needs a reason");
r = await start(admin, jo.id, { bypassReason: "Customer confirmed by phone, GPS dead zone" });
ok(r.status === 200 && methodOf(jo.id) === "ADMIN_OVERRIDE", "Admin override starts the job (ADMIN_OVERRIDE)");
ok(sql(`select result||'|'||"overrideReason"||'|'||"userRole" from "JobStartVerification" where "jobId"='${jo.id}'`) === "OVERRIDE|Customer confirmed by phone, GPS dead zone|admin", "override recorded with reason and who did it");

/* ------------------------------------------------------------ GPS */
console.log("--- GPS");
const jg = await mkJob("GPS");
const tg = await token(jg.id);
r = await start(fmc, jg.id, {});
ok(r.status === 409 && r.json?.code === "GPS_MISSING" && /location/i.test(r.json?.error ?? ""), "GPS: no location (GPS disabled / permission denied) → helpful retry message");
r = await start(fmc, jg.id, { ...FUZZY });
ok(r.status === 409 && r.json?.code === "GPS_INACCURATE", "GPS: inaccurate → refused");
r = await start(fmc, jg.id, { lat: 12.9501, lng: 77.6001 });
ok(r.status === 409 && r.json?.code === "GPS_INACCURATE", "GPS: no accuracy reported → refused");
r = await start(fmc, jg.id, { ...FAR });
ok(r.status === 409 && r.json?.code === "GPS_TOO_FAR", "GPS: outside the distance → refused");
r = await start(fmc, jg.id, { ...FAR, qrToken: tg });
ok(r.status === 409 && r.json?.code === "GPS_TOO_FAR", "GPS: a QR does NOT replace GPS (no silent switch)");
r = await fmc(`/api/jobs/${jg.id}`, { method: "PATCH", body: { status: "ARRIVED", startVerificationMode: "DIRECT", arrival: { ...FAR, mode: "DIRECT", verification: "DIRECT" } } });
ok(r.status >= 400 && statusOf(jg.id) === "ASSIGNED", "GPS: the app can't choose its own mode in the request");
const tries = await Promise.all([1, 2, 3].map(() => start(fmc, jg.id, { ...NEAR })));
ok(tries.filter((x) => x.status === 200).length === 1 && methodOf(jg.id) === "GPS", `GPS: 3 simultaneous valid starts → exactly one (${tries.map((x) => x.status)})`);
const jn = await mkJob("GPS", noPin);
r = await start(fmc, jn.id, { ...NEAR });
ok(r.status === 409 && r.json?.code === "NO_SAVED_LOCATION", "GPS: a job without a saved location can't be GPS-verified (clear message)");

/* ------------------------------------------------------------ defaults + per-job policy */
console.log("--- Policy");
const jdef = await mkJob(null);
ok((await admin("/api/settings", { method: "PATCH", body: { jobStartVerification: { defaultMode: "QR" } } })).status === 200, "Admin sets the company default to QR");
r = await start(fmc, jdef.id, { ...NEAR });
ok(r.status === 409 && r.json?.code === "QR_MISSING", "a job with no own mode follows the company default (QR)");
ok((await fmc(`/api/jobs/${jdef.id}`, { method: "PATCH", body: { startVerificationMode: "DIRECT" } })).status === 403, "Field Manager cannot change a job's mode");
ok((await admin(`/api/jobs/${jdef.id}`, { method: "PATCH", body: { startVerificationMode: "SELFIE" } })).status === 400, "unknown per-job mode refused");
await admin(`/api/jobs/${jdef.id}`, { method: "PATCH", body: { startVerificationMode: "DIRECT" } });
await admin("/api/settings", { method: "PATCH", body: { jobStartVerification: { allowPerJobOverride: false } } });
r = await start(fmc, jdef.id, {});
ok(r.status === 409 && r.json?.code === "QR_MISSING", "with per-job modes turned off, the company default applies");
ok((await admin(`/api/jobs/${jdef.id}`, { method: "PATCH", body: { startVerificationMode: "GPS" } })).status === 409, "…and a per-job mode can't be set");
await admin("/api/settings", { method: "PATCH", body: { jobStartVerification: { allowPerJobOverride: true, defaultMode: "GPS" } } });
ok((await start(fmc, jdef.id, {})).status === 200 && methodOf(jdef.id) === "DIRECT", "per-job DIRECT applies again once allowed");
ok((await admin(`/api/jobs/${jdef.id}`, { method: "PATCH", body: { startVerificationMode: "QR" } })).status === 409, "the mode can't be changed after the job has started");
ok(sql(`select count(*) from "AuditLog" where "jobId"='${jdef.id}' and action='JOB_START_MODE_CHANGED'`) === "1", "per-job mode change is audited");
const hist = (await admin(`/api/jobs/${jq.id}/start-verification`)).json?.data;
ok(hist?.attempts?.length === 6 && hist.mode === "QR", "Admin sees the full attempt history for a job");
ok([403, 404].includes((await fmc(`/api/jobs/${jq.id}/start-verification`)).status), "Field Manager cannot read the verification history API");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
