// End-to-end check against a running server and an EMPTY test database:
// five user types, one Job ID and ONE QR/link from booking to feedback,
// rework loop, GST / Non-GST invoices, Tax Officer limits, logout, security.
//
//   DATABASE_URL=… npx prisma migrate deploy
//   SEED_SUPERADMIN_EMAIL=admin@test.local SEED_SUPERADMIN_PASSWORD=adminpass123 npm run db:seed
//   APP_BASE_URL=https://example.test npm run build && npm run start -- -p 3100
//   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/e2e-verify.mjs
//
// Needs the psql client (rows are inserted directly where Cloudinary would be needed).
import { execSync } from "node:child_process";
const BASE = process.env.BASE_URL || "http://localhost:3100";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();

function client() {
  let cookie = "";
  return async (path, { method = "GET", body, raw } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    if (raw) return res;
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
}
const login = async (email, password) => { const c = client(); const r = await c("/api/auth/login", { method: "POST", body: { email, password } }); return { c, r }; };

const admin = (await login("admin@test.local", "adminpass123")).c;
ok((await admin("/api/auth/session")).json?.data?.role === "admin", "admin signs in as Admin");

// Users: Field Managers + QC
const mk = async (name, email, role) => (await admin("/api/users", { method: "POST", body: { name, email, phone: "+919800000000", role, password: "password123" } })).json?.data;
const fm1 = await mk("Ravi FM", "fm1@test.local", "field_manager");
const fm2 = await mk("Sana FM", "fm2@test.local", "field_manager");
const qcU = await mk("Quinn QC", "qc@test.local", "qc_inspector");
ok(fm1 && fm2 && qcU, "admin creates 2 Field Managers + 1 QC");
ok((await admin("/api/users", { method: "POST", body: { name: "X", email: "x@test.local", phone: "+919800000000", role: "referral_partner", password: "password123" } })).status === 400, "cannot create a 5th role (referral_partner)");
ok((await admin("/api/users", { method: "POST", body: { name: "X", email: "x2@test.local", phone: "+919800000000", role: "customer", password: "password123" } })).status === 400, "cannot create a customer login");

// Legacy role still signs in (mapped), a customer-role row cannot.
sql(`insert into "User"(id,name,email,phone,role,"passwordHash",active) values ('legacy1','Old Ops','ops@test.local','1','ops_manager',(select "passwordHash" from "User" where email='admin@test.local'),true), ('cust1','Cust Login','cust@test.local','1','customer',(select "passwordHash" from "User" where email='admin@test.local'),true)`);
const legacy = await login("ops@test.local", "adminpass123");
ok(legacy.r.status === 200 && legacy.r.json?.data?.role === "admin", "legacy ops_manager account signs in as Admin");
ok((await login("cust@test.local", "adminpass123")).r.status === 403, "customer-role account cannot sign in");

// Catalog, customer, property, job
const svc = (await admin("/api/services", { method: "POST", body: { name: "Deep Clean 2BHK", basePrice: 4999, estimatedDurationHours: 4, checklistTemplate: [{ area: "Kitchen", task: "Degrease hob", critical: true }, { area: "Bathroom", task: "Descale tiles", critical: true }, { area: "Bathroom", task: "Polish mirror" }] } })).json?.data;
const cust = (await admin("/api/customers", { method: "POST", body: { name: "Asha Rao", phone: "+919812345678" } })).json?.data;
const prop = (await admin("/api/properties", { method: "POST", body: { customerId: cust?.id, title: "Lakeside 2BHK", address: "12 Lake Rd, Bengaluru" } })).json?.data;
ok(svc?.id && cust?.id && prop?.id, "service, customer, property created");
sql(`update "Property" set lat=12.9716, lng=77.5946 where id='${prop.id}'`);
const today = new Date().toISOString().slice(0, 10);
const jobR = await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "09:00 - 13:00" } });
const job = jobR.json?.data?.job;
const ddmmyyyy = `${today.slice(8, 10)}${today.slice(5, 7)}${today.slice(0, 4)}`;
ok(job?.jobNumber === `ASHA-RAO-${ddmmyyyy}-001`, `Job ID = CUSTOMER-NAME-DDMMYYYY-001 (${job?.jobNumber})`);
const job2 = (await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "14:00 - 18:00" } })).json?.data?.job;
ok(job2?.jobNumber === `ASHA-RAO-${ddmmyyyy}-002`, `same customer, same date → next sequence (${job2?.jobNumber})`);

// Job IDs: special characters, other dates, concurrent bookings, DB uniqueness
const cust3 = (await admin("/api/customers", { method: "POST", body: { name: "  ABC  Cleaning & Co. (Pvt) ", phone: "+919811111111" } })).json?.data;
const prop3 = (await admin("/api/properties", { method: "POST", body: { customerId: cust3.id, title: "Office", address: "MG Road" } })).json?.data;
const burst = await Promise.all([0, 1, 2, 3, 4].map((i) => admin("/api/jobs", { method: "POST", body: { customerId: cust3.id, propertyId: prop3.id, serviceId: svc.id, scheduledDate: "2026-12-24", scheduledTimeSlot: `${String(8 + i).padStart(2, "0")}:00 - ${String(9 + i).padStart(2, "0")}:00`, invoiceType: "NON_GST" } })));
const burstIds = burst.map((r) => r.json?.data?.job?.jobNumber).filter(Boolean).sort();
ok(burstIds.length === 5 && new Set(burstIds).size === 5 && burstIds[0] === "ABC-CLEANING-AND-CO-PVT-24122026-001" && burstIds[4] === "ABC-CLEANING-AND-CO-PVT-24122026-005", `5 simultaneous bookings → 5 unique Job IDs (${burstIds[0]} … ${burstIds[4]})`);
let dupBlocked = false;
try { sql(`update "Job" set "jobSerial"='${job.jobNumber}' where id='${job2.id}'`); } catch { dupBlocked = true; }
ok(dupBlocked, "database refuses a duplicate Job ID (unique constraint)");

// Invoices: GST (default) vs Non-GST, separate number series, correct GST maths
const invOf = async (jobId) => (await admin("/api/finance")).json?.data?.invoices.find((i) => i.jobId === jobId);
const gstInv = await invOf(job.id);
ok(gstInv?.invoiceType === "GST" && /^GST-\d{4}-\d{5}$/.test(gstInv.invoiceNumber), `GST invoice created with the job (${gstInv?.invoiceNumber})`);
ok(gstInv.cgst === 449.91 && gstInv.sgst === 449.91 && gstInv.igst === 0 && gstInv.tax === 899.82 && gstInv.total === 5898.82 && gstInv.gstRate === 18, "GST 18% intra-state: CGST 449.91 + SGST 449.91 = 899.82, total 5898.82");
const nonGstInv = await invOf(burst[0].json.data.job.id);
ok(nonGstInv?.invoiceType === "NON_GST" && /^INV-\d{4}-\d{5}$/.test(nonGstInv.invoiceNumber) && nonGstInv.tax === 0 && nonGstInv.cgst === 0 && nonGstInv.total === 4999, `Non-GST invoice: no GST at all, total = amount (${nonGstInv?.invoiceNumber})`);
const igstJob = (await admin("/api/jobs", { method: "POST", body: { customerId: cust3.id, propertyId: prop3.id, serviceId: svc.id, scheduledDate: "2026-12-26", scheduledTimeSlot: "10:00 - 12:00", invoiceType: "GST", interState: true } })).json?.data?.job;
const igstInv = await invOf(igstJob.id);
ok(igstInv?.igst === 899.82 && igstInv.cgst === 0 && igstInv.sgst === 0 && igstInv.interState === true, "inter-state GST → IGST 899.82, no CGST/SGST");
let constraintHeld = false;
try { sql(`update "Invoice" set tax=10 where id='${nonGstInv.id}'`); } catch { constraintHeld = true; }
ok(constraintHeld, "database refuses GST on a Non-GST invoice (check constraint)");
const toGst = await admin("/api/finance", { method: "POST", body: { action: "update-invoice", invoiceId: nonGstInv.id, invoiceType: "GST", customerGstin: "29ABCDE1234F1Z5" } });
ok(toGst.json?.data?.invoiceType === "GST" && toGst.json.data.invoiceNumber.startsWith("GST-") && toGst.json.data.customerGstin === "29ABCDE1234F1Z5" && toGst.json.data.total === 5898.82, "admin switches a draft to GST: GST number series + GSTIN + recalculated");
ok((await admin("/api/finance", { method: "POST", body: { action: "update-invoice", invoiceId: nonGstInv.id, invoiceType: "GST", customerGstin: "NOT-A-GSTIN" } })).status === 400, "invalid customer GSTIN refused");
await admin("/api/finance", { method: "POST", body: { action: "update-invoice", invoiceId: nonGstInv.id, invoiceType: "NON_GST" } });
const backNon = await invOf(burst[0].json.data.job.id);
ok(backNon.invoiceType === "NON_GST" && backNon.tax === 0 && !backNon.customerGstin && backNon.invoiceNumber.startsWith("INV-"), "switching back to Non-GST removes every GST field");
const adminAll = (await admin("/api/invoices?type=ALL")).json?.data?.invoices ?? [];
const adminGst = (await admin("/api/invoices?type=GST")).json?.data?.invoices ?? [];
const adminNon = (await admin("/api/invoices?type=NON_GST")).json?.data?.invoices ?? [];
ok(adminAll.length === adminGst.length + adminNon.length && adminGst.every((i) => i.invoiceType === "GST") && adminNon.every((i) => i.invoiceType === "NON_GST") && adminNon.length >= 4, `admin filters: All ${adminAll.length} = GST ${adminGst.length} + Non-GST ${adminNon.length}`);
await admin("/api/finance", { method: "POST", body: { action: "finalize-invoice", invoiceId: gstInv.id } });
ok((await admin("/api/finance", { method: "POST", body: { action: "update-invoice", invoiceId: gstInv.id, invoiceType: "NON_GST" } })).status === 409, "a finalized invoice cannot change type");

// Tax Officer: GST invoices + GST reports ONLY, enforced by the server
const taxU = await mk("Tara Tax", "tax@test.local", "tax_officer");
ok(taxU?.role === "tax_officer", "admin creates a Tax Officer");
const taxc = (await login("tax@test.local", "password123")).c;
const taxSess = (await taxc("/api/auth/session")).json?.data;
ok(taxSess?.role === "tax_officer" && taxSess.workspace.home === "/gst" && taxSess.workspace.nav.map((n) => n.label).join("|") === "GST Dashboard|GST Invoices|GST Reports|Intense AI", "Tax Officer lands on the GST workspace (3 GST pages + Intense AI)");
const taxList = (await taxc("/api/invoices")).json?.data?.invoices ?? [];
ok(taxList.length === adminGst.length && taxList.every((i) => i.invoiceType === "GST"), `Tax Officer list = GST invoices only (${taxList.length})`);
ok((await taxc("/api/invoices?type=NON_GST")).status === 403, "Tax Officer asking for Non-GST invoices → 403");
ok(((await taxc("/api/invoices?type=ALL")).json?.data?.invoices ?? []).every((i) => i.invoiceType === "GST"), "type=ALL still returns GST only for a Tax Officer");
ok((await taxc(`/api/invoices/${backNon.id}`)).status === 404, "Non-GST invoice id typed by hand → 404");
const taxDetail = (await taxc(`/api/invoices/${gstInv.id}`)).json?.data;
ok(taxDetail?.invoice?.cgst === 449.91 && taxDetail.customer.name === "Asha Rao" && taxDetail.customer.phone === undefined && taxDetail.job.id === undefined, "Tax Officer GST invoice detail: GST breakdown, no phone, no job link");
ok(((await taxc(`/api/invoices?customerId=${cust3.id}`)).json?.data?.invoices ?? []).every((i) => i.customerId === cust3.id && i.invoiceType === "GST"), "Tax Officer customer filter stays GST-only");
ok(((await taxc(`/api/invoices?from=2026-12-25&to=2026-12-31`)).json?.data?.invoices ?? []).every((i) => i.invoiceType === "GST"), "Tax Officer date filter stays GST-only");
const rep0 = (await taxc("/api/invoices/report")).json?.data;
ok(rep0?.totals?.invoices === taxList.length && Math.abs(rep0.totals.totalGst - taxList.reduce((a, i) => a + i.tax, 0)) < 0.01, "GST report totals = GST invoices only");
for (const [path, method, body] of [["/api/finance", "GET"], ["/api/jobs", "GET"], ["/api/customers", "GET"], ["/api/users", "GET"], ["/api/photos", "GET"], ["/api/services", "GET"], [`/api/jobs/${job.id}`, "GET"], [`/api/feedback?jobId=${job.id}`, "GET"], ["/api/finance", "POST", { action: "update-invoice", invoiceId: gstInv.id, discount: 1 }], ["/api/finance", "POST", { action: "record-payment", invoiceId: gstInv.id, amount: 1, paymentMethod: "cash", reference: "x" }], ["/api/users", "POST", { name: "Y", email: "y@test.local", phone: "1234567", role: "admin", password: "password123" }], [`/api/jobs/${job.id}`, "PATCH", { status: "CANCELLED" }], ["/api/qr-links", "POST", { action: "get", jobId: job.id }], ["/api/settings", "PATCH", {}]]) {
  const r = await taxc(path, { method, body });
  ok(r.status === 403, `Tax Officer blocked: ${method} ${path.split("?")[0]} (${r.status})`);
}
const taxQ = (await taxc("/api/quality")).json?.data;
ok(taxQ && taxQ.qualityChecks.length === 0 && taxQ.reworkTasks.length === 0, "Tax Officer sees no QC / rework data");

// Logout: server-side revocation, cookie cleared, protected pages redirect
const logoutC = client();
await logoutC("/api/auth/login", { method: "POST", body: { email: "tax@test.local", password: "password123" } });
const loginCookie = await (async () => { const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "tax@test.local", password: "password123" }) }); return r.headers.get("set-cookie").split(";")[0]; })();
const pageBefore = await fetch(BASE + "/gst", { headers: { cookie: loginCookie }, redirect: "manual" });
ok(pageBefore.status === 200 && /no-store/.test(pageBefore.headers.get("cache-control") || ""), "signed in: protected page served with Cache-Control no-store");
const out = await fetch(BASE + "/api/auth/session", { method: "DELETE", headers: { cookie: loginCookie } });
const cleared = out.headers.get("set-cookie") || "";
ok(out.status === 200 && /erp_session=;/.test(cleared) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(cleared) && /storage/.test(out.headers.get("clear-site-data") || ""), "logout expires the cookie and clears site storage");
ok((await fetch(BASE + "/api/auth/session", { headers: { cookie: loginCookie } })).status === 401, "the old cookie no longer works (session revoked server-side)");
ok((await fetch(BASE + "/api/invoices", { headers: { cookie: loginCookie } })).status === 401, "revoked cookie cannot read GST invoices");
for (const page of ["/", "/jobs", "/gst", "/gst/invoices", "/my-jobs", "/quality-queue", "/invoices"]) {
  const r = await fetch(BASE + page, { redirect: "manual" });
  ok([307, 308].includes(r.status) && (r.headers.get("location") || "").endsWith("/login"), `signed out: ${page} → /login`);
}
ok((await fetch(BASE + "/login", { redirect: "manual" })).status === 200, "login page stays public");

// Dashboard
let ws = (await admin("/api/me/workspace")).json?.data;
ok(ws?.counts?.today >= 2 && ws.attention.some((a) => a.jobId === job.id && /No Field Manager/.test(a.reason)), "Operations: today's jobs + 'No Field Manager' attention");

// Assign FM1 to job, FM2 to job2
ok((await admin(`/api/jobs/${job.id}`, { method: "PATCH", body: { assignedManagerId: fm1.id, assignedStaffIds: [] } })).json?.data?.status === "ASSIGNED", "admin assigns Field Manager → ASSIGNED");
await admin(`/api/jobs/${job2.id}`, { method: "PATCH", body: { assignedManagerId: fm2.id, assignedStaffIds: [] } });

const fmc = (await login("fm1@test.local", "password123")).c;
const fm2c = (await login("fm2@test.local", "password123")).c;
const qcc = (await login("qc@test.local", "password123")).c;

// FM scope
const fmJobs = (await fmc("/api/jobs")).json?.data ?? [];
ok(fmJobs.length === 1 && fmJobs[0].id === job.id, "FM sees only their assigned job");
ok(fmJobs[0].amount === undefined || fmJobs[0].amount === null, "FM never receives the job amount (revenue)");
ok((await fm2c(`/api/jobs/${job.id}`)).status === 403, "other FM cannot open the job");
for (const p of ["/api/finance", "/api/users", "/api/settings"]) {
  const r = await fmc(p, { method: p === "/api/settings" ? "PATCH" : "GET", body: p === "/api/settings" ? {} : undefined });
  ok(r.status === 403, `FM blocked from ${p} (${r.status})`);
}

sql(`insert into "Customer"(id,name,phone,"updatedAt") values ('other_c','Other Customer','+910000000000',now())`);
const fmCust = (await fmc("/api/customers")).json?.data ?? [];
ok(fmCust.length === 1 && fmCust[0].id === cust.id, "FM sees only the customer of their assigned job (not the directory)");
ok((await admin("/api/customers")).json?.data?.length === 3, "Admin sees the full customer directory (all 3)");

// Customer link before arrival
const link = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: job.id } })).json?.data;
ok(link?.linkUrl?.startsWith("https://example.test/customer/service/"), "customer link uses APP_BASE_URL + /customer/service/");
const token = link.linkUrl.split("/").pop();
const cust1 = client();
ok((await cust1(`/api/customer/job/${token}`, { method: "POST", body: { action: "confirm" } })).status === 409, "customer cannot confirm before the team arrives");
const oldPath = await fetch(`${BASE}/customer/job/${token}`, { redirect: "manual" });
ok([301, 308].includes(oldPath.status) && oldPath.headers.get("location")?.includes(`/customer/service/${token}`), "old /customer/job link redirects to /customer/service");
const qrOff = await admin("/api/qr-links", { method: "POST", body: { action: "qr", tokenId: link.tokenId } });
ok(qrOff.status === 400, "no separate QR tokens — the job QR is drawn from the one customer link");

// Arrival: far away → 409, at the property → GPS verified
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { lat: 13.5, lng: 77.5, accuracy: 10 } } })).status === 409, "I'm Here far from the property is refused");
ok((await qcc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { lat: 12.9716, lng: 77.5946 } } })).status === 403, "QC cannot mark arrival");
const arr = await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { lat: 12.9717, lng: 77.5947, accuracy: 15 } } });
ok(arr.json?.data?.status === "ARRIVED", "I'm Here at the property → ARRIVED");
ok(sql(`select "arrivalVerification" from "Job" where id='${job.id}'`) === "gps", "arrival GPS verified");
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "IN_PROGRESS" } })).status >= 400, "FM cannot start before customer confirms");
let cv = (await cust1(`/api/customer/job/${token}`)).json?.data;
ok(cv?.job?.status === "ARRIVED", "customer page shows ARRIVED");
ok(cv.job.amount === undefined && cv.qualityCheck === null && cv.qualityResult === null, "customer payload has no internal amount / QC internals");
ok(cv.invoice?.invoiceType === "GST" && cv.invoice.cgst === 449.91 && cv.invoice.total === 5898.82 && cv.invoice.invoiceNumber === gstInv.invoiceNumber, "customer portal shows their own GST invoice");
const cvNon = (await cust1(`/api/customer/job/${(await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: burst[0].json.data.job.id } })).json.data.linkUrl.split("/").pop()}`)).json?.data;
ok(cvNon?.invoice?.invoiceType === "NON_GST" && !("cgst" in cvNon.invoice) && !("customerGstin" in cvNon.invoice) && !("totalGst" in cvNon.invoice), "Non-GST invoice on the portal carries no GST fields");
ok((await cust1(`/api/customer/job/${token}`, { method: "POST", body: { action: "confirm" } })).json?.data?.status === "CUSTOMER_VERIFIED", "customer CONFIRM & START");
ok((await cust1(`/api/customer/job/${token}`, { method: "POST", body: { action: "confirm" } })).json?.data?.alreadyConfirmed === true, "confirm is idempotent");

// Start + checklist + complete
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "IN_PROGRESS" } })).json?.data?.status === "IN_PROGRESS", "START SERVICE");
const items = (await fmc(`/api/checklist?jobId=${job.id}`)).json?.data ?? [];
ok(items.length === 3, "checklist instantiated from the service (3 items)");
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "WORK_COMPLETED" } })).status === 409, "cannot complete with required checklist items open");
for (const it of items) await fmc("/api/quality", { method: "PATCH", body: { itemId: it.id, status: "completed" } });
ok(sql(`select count(*) from "JobChecklistItem" where "jobId"='${job.id}' and status='completed'`) === "3", "checklist completed");
// Photos (Cloudinary is not configured here) — insert evidence rows directly.
for (const [t, a] of [["before", "Kitchen"], ["after", "Kitchen"], ["qc", "Kitchen"]]) sql(`insert into "JobPhoto"(id,"jobId",area,"photoType","cloudinaryPublicId","photoUrl","uploadedByUserId","uploadedByName") values ('ph_${t}','${job.id}','${a}','${t}','x','https://res.cloudinary.com/demo/image/upload/sample.jpg','${fm1.id}','Ravi')`);
await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { notes: "Hob had heavy grease" } });
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "WORK_COMPLETED" } })).json?.data?.status === "WORK_COMPLETED", "COMPLETE WORK → waiting for QC");
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "WORK_COMPLETED" } })).status >= 400, "double tap does not re-complete");
cv = (await cust1(`/api/customer/job/${token}`)).json?.data;
ok(cv.photos.length === 2 && cv.photos.every((p) => p.photoType !== "qc"), "customer sees before/after only — QC evidence hidden");
ok(cv.qualityResult === "checking", "customer QC result: being checked");
ok((await fetch(`${BASE}/api/secure-photo/ph_qc?t=${token}`)).status === 404, "secure-photo refuses QC evidence on the customer link");

// QC round 1: rework
ok((await fmc("/api/quality", { method: "POST", body: { action: "submit-check", jobId: job.id, score: 100, decision: "PASS", issues: [] } })).status === 403, "FM cannot pass QC");
ok((await qcc("/api/quality", { method: "POST", body: { action: "start-inspection", jobId: job.id } })).json?.data?.status === "QUALITY_CHECK", "QC INSPECT starts inspection");
const r1 = await qcc("/api/quality", { method: "POST", body: { action: "submit-check", jobId: job.id, score: 90, decision: "REWORK_REQUIRED", issues: [{ area: "Bathroom", itemDescription: "Mirror has streaks", severity: "major", notes: "Re-polish" }] } });
ok(r1.status === 201, "QC REWORK REQUIRED with area/issue/comment");
ok(sql(`select status from "Job" where id='${job.id}'`) === "REWORK_ASSIGNED", "rework goes straight to the Field Manager (same job)");
ok(sql(`select count(*) from "Job" where "propertyId"='${prop.id}'`) === "2", "no duplicate job created for rework");
cv = (await cust1(`/api/customer/job/${token}`)).json?.data;
ok(cv.qualityCheck === null && !JSON.stringify(cv).includes("streaks") && cv.qualityResult === "improving", "customer never sees QC findings (just 'finishing touches')");
ws = (await admin("/api/me/workspace")).json?.data;
ok(ws.counts.rework === 1 && ws.attention.some((a) => a.jobId === job.id && a.reason === "Rework pending"), "Operations: Rework Pending count + attention");

// FM fixes → submit → reinspection → rework again → fix → pass
const tasks = (await fmc("/api/quality")).json?.data?.reworkTasks.filter((t) => t.jobId === job.id && t.status !== "completed");
ok(tasks.length === 1, "FM sees the rework item in My Jobs");
for (const t of tasks) await fmc("/api/quality", { method: "POST", body: { action: "complete-rework", taskId: t.id, notes: "Fixed" } });
ok(sql(`select status from "Job" where id='${job.id}'`) === "REWORK_COMPLETED", "SUBMIT FOR QC → reinspection");
await qcc("/api/quality", { method: "POST", body: { action: "submit-check", jobId: job.id, score: 95, decision: "REWORK_REQUIRED", issues: [{ area: "Bathroom", itemDescription: "Corner still dusty", severity: "major", notes: "" }] } });
ok(sql(`select status from "Job" where id='${job.id}'`) === "REWORK_ASSIGNED", "REWORK AGAIN on reinspection");
for (const t of (await fmc("/api/quality")).json.data.reworkTasks.filter((t) => t.jobId === job.id && t.status !== "completed")) await fmc("/api/quality", { method: "POST", body: { action: "complete-rework", taskId: t.id, notes: "Fixed" } });
const pr = await qcc("/api/quality", { method: "POST", body: { action: "reinspect-pass", jobId: job.id, notes: "" } });
ok(pr.json?.data?.status === "CUSTOMER_APPROVAL", "reinspection PASS → customer approval");
const hist = (await qcc("/api/quality")).json.data.qualityChecks.filter((q) => q.jobId === job.id);
ok(hist.length === 3 && hist.every((q) => q.inspectorName === "Quinn QC"), "full QC history kept (3 rounds, inspector named)");
ok(sql(`select count(*) from "QualityIssue" where "jobId"='${job.id}'`) === "2", "both rework issues kept in history");

// Customer approves + rates
cv = (await cust1(`/api/customer/job/${token}`)).json?.data;
ok(cv.job.status === "CUSTOMER_APPROVAL" && cv.qualityCheck?.passed === true && cv.qualityResult === "passed", "customer page: QC PASSED → approve");
ok((await cust1(`/api/customer/job/${token}`, { method: "POST", body: { action: "approve", signatoryName: "Asha Rao", confirmChecked: true } })).json?.data?.status === "COMPLETED", "APPROVE SERVICE → COMPLETED");
ok((await cust1(`/api/customer/job/${token}`, { method: "POST", body: { action: "approve", signatoryName: "Asha Rao", confirmChecked: true } })).json?.data?.alreadyApproved === true, "approve is idempotent");
ok((await cust1(`/api/customer/job/${token}`, { method: "POST", body: { action: "feedback", rating: 5, googleReviewClicked: true } })).status === 200, "star rating + Google review recorded");
ok(sql(`select "customerFeedbackRating" from "Job" where id='${job.id}'`) === "5", "rating stored on the job");

// Complaint → attention → resolve
await cust1(`/api/customer/job/${token}`, { method: "POST", body: { action: "complaint", category: "quality", description: "Balcony door glass smudged" } });
ws = (await admin("/api/me/workspace")).json?.data;
const comp = ws.attention.find((a) => a.key.startsWith("complaint-"));
ok(!!comp, "customer issue appears in Attention Required");
const cid = comp.key.replace("complaint-", "");
ok((await qcc("/api/quality", { method: "POST", body: { action: "resolve-complaint", complaintId: cid } })).status === 403, "QC cannot resolve customer issues");
ok((await admin("/api/quality", { method: "POST", body: { action: "resolve-complaint", complaintId: cid, notes: "Re-cleaned" } })).status === 200, "admin resolves the customer issue");
ws = (await admin("/api/me/workspace")).json?.data;
ok(!ws.attention.some((a) => a.key === comp.key), "resolved issue leaves Attention Required");

// ONE QR per job: the property QR is gone; the job QR is the customer link
const oldPropQr = await admin(`/api/properties/${prop.id}/access-link`, { method: "POST" });
ok(oldPropQr.status === 404, "no property QR endpoint any more");
ok((await fetch(`${BASE}/customer/property/anything`, { redirect: "manual" })).status === 404, "no property QR page any more");
const sameLink = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: job.id } })).json?.data;
ok(sameLink.linkUrl === link.linkUrl, "the SAME job QR / link works for the whole lifecycle (booking → feedback)");
const qrTok = sameLink.linkUrl.split("/customer/service/")[1];
ok(/^[A-Za-z0-9_-]{32,}$/.test(qrTok) && ![cust.id, job.id, job.jobNumber, "9812345678", "Asha", gstInv.invoiceNumber].some((v) => qrTok.includes(v)), "QR content is only a random token — no phone, name, ids or invoice data");

// Customer link isolation
const link2 = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: job2.id } })).json?.data;
const token2 = link2.linkUrl.split("/").pop();
ok((await fetch(`${BASE}/api/secure-photo/ph_before?t=${token2}`)).status === 404, "job B's link cannot read job A's photo");
ok((await cust1(`/api/customer/job/${token.slice(0, -2)}xx`)).status >= 400, "tampered token rejected");
const rv = await admin("/api/qr-links", { method: "POST", body: { action: "revoke", tokenId: link2.tokenId, reason: "test" } });
ok(rv.status === 200 && (await cust1(`/api/customer/job/${token2}`)).status === 410, "revoked link stops working");

// Roles cannot open each other's desks (server-rendered APIs)
ok((await qcc("/api/me/workspace")).status === 200 && (await qcc("/api/finance")).status === 403, "QC has a workspace but no finance");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
