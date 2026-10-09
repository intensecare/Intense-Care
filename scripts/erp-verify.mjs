// End-to-end check of the ERP structure features, run AFTER scripts/e2e-verify.mjs
// against the same server and database (it reuses that run's users):
// quotations (GST / Non-GST, custom lines, share + accept, convert), job location,
// customer visibility enforced by the API, GPS + QR arrival, custom services,
// settings, Reviews & Feedback and the dashboard numbers.
//
//   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/erp-verify.mjs
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
const login = async (email, password) => { const c = client(); await c("/api/auth/login", { method: "POST", body: { email, password } }); return c; };
const admin = await login("admin@test.local", "adminpass123");
const fmc = await login("fm1@test.local", "password123");
const taxc = await login("tax@test.local", "password123");
const qcc = await login("qc@test.local", "password123");
const anon = client();
const fm1 = sql(`select id from "User" where email='fm1@test.local'`);

// ---------------------------------------------------------------- setup
const svc = (await admin("/api/services", { method: "POST", body: { name: "Sofa Shampoo", category: "residential", description: "Fabric sofa", basePrice: 2000, estimatedDurationHours: 2, checklistTemplate: [{ area: "Living", task: "Shampoo sofa", critical: true }] } })).json?.data;
const custom = (await admin("/api/services", { method: "POST", body: { name: "Chandelier dusting", category: "specialized", description: "One-off", basePrice: 1500, estimatedDurationHours: 1, isCustom: true, gstTreatment: "NON_GST", notes: "Bring tall ladder", checklistTemplate: [] } })).json?.data;
ok(svc?.id && custom?.isCustom === true && custom.gstTreatment === "NON_GST" && custom.notes === "Bring tall ladder", "custom service saved with GST treatment and notes");
const cust = (await admin("/api/customers", { method: "POST", body: { name: "Meera Iyer", phone: "+919822222222", address: "5 Palm Ave, Bengaluru" } })).json?.data;
const prop = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Palm Villa", address: "5 Palm Ave, Bengaluru", lat: 12.95, lng: 77.6 } })).json?.data;
ok(prop?.lat === 12.95 && prop?.lng === 77.6, "property stores its map location (lat/lng)");

// ---------------------------------------------------------------- quotations
const qBody = { customerId: cust.id, propertyId: prop.id, items: [{ serviceId: svc.id, quantity: 2, rate: 2000 }, { description: "Balcony glass cleaning", quantity: 1, rate: 1000 }], discount: 500, quoteType: "GST", validUntil: "2099-12-31", status: "draft" };
const q1 = (await admin("/api/quotations", { method: "POST", body: qBody })).json?.data;
ok(/^QT-\d{4}-\d{5}$/.test(q1?.quoteNumber ?? ""), `quotation number QT-FY-##### (${q1?.quoteNumber})`);
ok(q1?.items?.length === 2 && q1.items[1].custom === true && q1.items[0].description === "Sofa Shampoo", "catalogue + custom lines");
ok(q1?.subtotal === 5000 && q1.discount === 500 && q1.taxable === 4500 && q1.tax === 810 && q1.cgst === 405 && q1.sgst === 405 && q1.total === 5310, "GST quotation maths (5000 − 500 + 18% = 5310)");
ok(q1?.terms && q1?.paymentTerms, "quotation picks up default terms and payment terms from Settings");
for (const [who, c] of [["Field Manager", fmc], ["Tax Officer", taxc], ["QC", qcc]]) ok((await c("/api/quotations")).status === 403, `${who} cannot list quotations`);
ok((await anon("/api/quotations")).status === 401, "signed-out cannot list quotations");
ok((await admin("/api/quotations", { method: "POST", body: { ...qBody, discount: 999999 } })).status === 400, "discount above the subtotal is refused");
ok((await admin("/api/quotations", { method: "POST", body: { ...qBody, items: [{ description: "", quantity: 1, rate: 10 }] } })).status === 400, "a custom line needs a description");

const doc = (await admin(`/api/quotations/${q1.id}`)).json?.data;
ok(doc?.company?.name && doc?.customer?.name === "Meera Iyer" && doc?.property?.title === "Palm Villa" && doc.shareUrl === null, "quotation document: company, customer, property; no share link yet");
const share = (await admin(`/api/quotations/${q1.id}`, { method: "POST", body: { action: "share" } })).json?.data;
ok(share?.url?.startsWith("https://example.test/customer/quote/"), "share link uses APP_BASE_URL + /customer/quote/");
const qtok = share.url.split("/").pop();
ok(!/[A-Za-z0-9_-]*Meera|cust|QT-/.test(qtok) && qtok.length >= 32, "share token is random — no customer or quotation data inside");
ok(sql(`select status from "Quote" where id='${q1.id}'`) === "sent", "sharing a draft marks it sent");
const share2 = (await admin(`/api/quotations/${q1.id}`, { method: "POST", body: { action: "share" } })).json?.data;
ok(share2?.url === share.url, "sharing again re-uses the same link");
const pub = (await anon(`/api/quote/${qtok}`)).json?.data;
ok(pub?.quote?.total === 5310 && pub.quote.jobId === undefined && pub.quote.customerId === undefined && pub.customer?.phone === undefined, "public quotation page: document only — no ids or phone");
ok((await anon(`/api/quote/${"x".repeat(43)}`)).status === 404, "a made-up quotation token is refused");
ok((await anon(`/api/quote/${qtok}`, { method: "POST", body: { action: "accept", name: "M" } })).status === 400, "accepting needs the customer's name");
ok((await anon(`/api/quote/${qtok}`, { method: "POST", body: { action: "accept", name: "Meera Iyer" } })).json?.data?.status === "accepted", "customer accepts from the link");
ok(sql(`select "acceptedBy" from "Quote" where id='${q1.id}'`) === "Meera Iyer", "acceptance records who accepted");
ok((await anon(`/api/quote/${qtok}`, { method: "POST", body: { action: "decline", name: "Meera Iyer" } })).status === 409, "an answered quotation can't be answered again");

const dup = (await admin(`/api/quotations/${q1.id}`, { method: "POST", body: { action: "duplicate" } })).json?.data;
ok(dup?.id !== q1.id && dup?.status === "draft" && dup?.total === 5310 && dup.quoteNumber !== q1.quoteNumber, "duplicate → a new draft with a new number");
const edited = (await admin(`/api/quotations/${dup.id}`, { method: "PATCH", body: { ...qBody, discount: 0 } })).json?.data;
ok(edited?.total === 5900, "edit recalculates (no discount → 5900)");
ok((await admin(`/api/quotations/${dup.id}`, { method: "DELETE" })).json?.data?.deleted === true, "an unconverted quotation can be deleted");

const today = new Date().toISOString().slice(0, 10);
const conv = await admin(`/api/quotations/${q1.id}`, { method: "POST", body: { action: "convert-job", scheduledDate: today, scheduledTimeSlot: "15:00 - 17:00", assignedManagerId: fm1 } });
ok(conv.status === 201 && conv.json?.data?.jobNumber?.startsWith("MEERA-IYER-"), "Convert to Job → job with the customer's Job ID");
const cj = conv.json.data;
ok(sql(`select status||'|'||"jobId" from "Quote" where id='${q1.id}'`) === `converted_to_job|${cj.jobId}`, "quotation is marked converted and linked to the job");
ok(sql(`select "quoteId" from "Job" where id='${cj.jobId}'`) === q1.id, "job remembers its quotation");
const cinv = JSON.parse(sql(`select json_build_object('type',"invoiceType",'total',total,'items',jsonb_array_length(items),'q',"quoteId") from "Invoice" where id='${cj.invoiceId}'`));
ok(cinv.type === "GST" && cinv.total === 5310 && cinv.items === 2 && cinv.q === q1.id, "its invoice carries the quotation lines and total");
ok((await admin(`/api/quotations/${q1.id}`, { method: "POST", body: { action: "convert-job", scheduledDate: today, scheduledTimeSlot: "15:00 - 17:00" } })).status === 409, "a converted quotation can't become a second job");
ok((await admin(`/api/quotations/${q1.id}`, { method: "PATCH", body: qBody })).status === 409, "a converted quotation can't be edited");
ok((await admin(`/api/quotations/${q1.id}`, { method: "DELETE" })).status === 409, "a converted quotation is kept for the record");

const q2 = (await admin("/api/quotations", { method: "POST", body: { customerId: cust.id, items: [{ description: "Terrace pressure wash", quantity: 1, rate: 3000 }], quoteType: "NON_GST", validUntil: "2099-12-31" } })).json?.data;
ok(q2?.tax === 0 && q2.total === 3000 && q2.cgst === 0, "Non-GST quotation has no GST");
ok((await admin(`/api/quotations/${q2.id}`, { method: "POST", body: { action: "convert-invoice", scheduledDate: "2026-12-28", scheduledTimeSlot: "10:00 - 12:00" } })).status === 400, "a quotation without a property asks for one when converting");
const c2 = (await admin(`/api/quotations/${q2.id}`, { method: "POST", body: { action: "convert-invoice", propertyId: prop.id, scheduledDate: "2026-12-28", scheduledTimeSlot: "10:00 - 12:00" } })).json?.data;
ok(c2?.invoiceId && sql(`select "invoiceType"||'|'||tax||'|'||total from "Invoice" where id='${c2.invoiceId}'`) === "NON_GST|0|3000", "Convert to Invoice → Non-GST invoice, no GST");
ok(sql(`select s."isCustom" from "Job" j join "Service" s on s.id=j."serviceId" where j.id='${c2.jobId}'`) === "t", "an all-custom quotation becomes a job on a custom service");
ok((await taxc(`/api/invoices/${c2.invoiceId}`)).status === 404, "Tax Officer still cannot open the Non-GST invoice");
const expired = (await admin("/api/quotations", { method: "POST", body: { ...qBody, validUntil: "2020-01-01" } })).json?.data;
ok(expired?.status === "expired", "a quotation past its date shows as expired");
const exTok = (await admin(`/api/quotations/${expired.id}`, { method: "POST", body: { action: "share" } })).json?.data.url.split("/").pop();
ok((await anon(`/api/quote/${exTok}`, { method: "POST", body: { action: "accept", name: "Meera Iyer" } })).status === 409, "an expired quotation can't be accepted");

// ---------------------------------------------------------------- job location + custom service
const lj = (await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: custom.id, scheduledDate: today, scheduledTimeSlot: "18:00 - 19:00", assignedManagerId: fm1, locationLat: 12.9601, locationLng: 77.6012, locationAddress: "Gate 2, 5 Palm Ave", customerNotes: "Please keep the dog inside" } })).json?.data;
const job = lj?.job;
ok(job?.locationLat === 12.9601 && job?.locationLng === 77.6012 && job?.locationAddress === "Gate 2, 5 Palm Ave", "job stores its own map location");
ok(sql(`select "invoiceType" from "Invoice" where "jobId"='${job.id}'`) === "NON_GST", "a Non-GST custom service makes a Non-GST invoice by default");
const noLoc = (await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: "2026-12-29", scheduledTimeSlot: "09:00 - 10:00" } })).json?.data?.job;
ok(noLoc?.locationLat === 12.95 && noLoc?.locationLng === 77.6, "without a pin, the job takes the property's location");
ok((await admin(`/api/jobs/${noLoc.id}`, { method: "PATCH", body: { location: { lat: 12.97, lng: 77.61, address: "New gate" } } })).status === 200 && sql(`select "locationLat"||','||"locationAddress" from "Job" where id='${noLoc.id}'`) === "12.97,New gate", "admin edits the job location");
ok((await fmc(`/api/jobs/${noLoc.id}`, { method: "PATCH", body: { location: { lat: 1, lng: 1, address: null } } })).status === 403, "Field Manager cannot move a job's location");

// ---------------------------------------------------------------- QR + GPS arrival
const link = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: job.id } })).json?.data;
const token = link.linkUrl.split("/").pop();
const otherProp = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Other flat", address: "9 Elm St", lat: 13.2, lng: 77.9 } })).json?.data;
const otherJob = (await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: otherProp.id, serviceId: svc.id, scheduledDate: "2026-12-30", scheduledTimeSlot: "09:00 - 10:00" } })).json?.data?.job;
const otherTok = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: otherJob.id } })).json?.data.linkUrl.split("/").pop();
const far = { lat: 13.5, lng: 77.5, accuracy: 10 };
ok((await admin(`/api/jobs/${job.id}`, { method: "PATCH", body: { startVerificationMode: "QR" } })).status === 400, "the retired QR-only mode can't be set any more");
ok((await admin(`/api/jobs/${job.id}`, { method: "PATCH", body: { startVerificationMode: "GPS_QR" } })).status === 200, "admin sets this job to GPS + QR job start");
const near = { lat: 12.9602, lng: 77.6013, accuracy: 12 };
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: near } })).status === 409, "GPS + QR: GPS alone does not start the job");
const otherPropTry = await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { ...near, qrToken: otherTok } } });
ok(otherPropTry.status === 409 && otherPropTry.json?.verification?.qr?.result === "OTHER_PROPERTY", "the QR of a different property is refused");
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { ...near, qrToken: "A".repeat(43) } } })).status === 409, "a made-up QR token is refused");
const farTry = await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { ...far, qrToken: token } } });
ok(farTry.status === 409 && farTry.json?.verification?.gps?.result === "FAILED" && farTry.json?.verification?.qr?.result === "VALID", "GPS + QR: a valid QR far from the property is refused (GPS and QR shown separately)");
const qrArr = await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { ...near, qrToken: token } } });
ok(qrArr.json?.data?.status === "ARRIVED" && sql(`select "arrivalVerification" from "Job" where id='${job.id}'`) === "GPS_QR", "GPS at the pin + the customer's QR verifies arrival (GPS_QR)");
ok(sql(`select count(*) from "JobActivityEvent" where "jobId"='${job.id}' and message like '%QR scanned%'`) === "1", "activity log records QR verification");
const gpsJob = (await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "19:00 - 20:00", assignedManagerId: fm1, locationLat: 12.9601, locationLng: 77.6012 } })).json?.data?.job;
await fmc(`/api/jobs/${gpsJob.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { lat: 12.9602, lng: 77.6013, accuracy: 12 } } });
ok(sql(`select "arrivalVerification" from "Job" where id='${gpsJob.id}'`) === "GPS", "GPS at the job's own pin verifies arrival (GPS)");
const ovJob = (await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "20:00 - 21:00", assignedManagerId: fm1 } })).json?.data?.job;
ok((await admin(`/api/jobs/${ovJob.id}`, { method: "PATCH", body: { status: "ARRIVED" } })).status === 400, "admin override needs a reason");
await admin(`/api/jobs/${ovJob.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { bypassReason: "Customer called — team on site" } } });
ok(sql(`select "arrivalVerification" from "Job" where id='${ovJob.id}'`) === "ADMIN_OVERRIDE" && sql(`select count(*) from "JobActivityEvent" where "jobId"='${ovJob.id}' and message like '%Admin override%'`) === "1", "admin override is recorded in the activity log");

// ---------------------------------------------------------------- customer visibility (server-side)
for (const [t, id] of [["before", "vb"], ["after", "va"]]) sql(`insert into "JobPhoto"(id,"jobId",area,"photoType","cloudinaryPublicId","photoUrl","uploadedByUserId","uploadedByName") values ('${id}','${job.id}','Hall','${t}','x','https://res.cloudinary.com/demo/image/upload/sample.jpg','${fm1}','Ravi')`);
let pv = (await anon(`/api/customer/job/${token}`)).json?.data;
ok(pv?.job?.id === job.jobNumber && pv.serviceNotes === "Please keep the dog inside" && pv.location?.lat === 12.9601 && pv.invoice && pv.photos.length === 2, "default: customer sees Job ID, notes, location, invoice, photos");
ok(!JSON.stringify(pv).includes("Bring tall ladder"), "internal service notes never reach the customer");
ok((await fmc(`/api/jobs/${job.id}`, { method: "PATCH", body: { customerVisibility: { invoice: false } } })).status === 403, "Field Manager cannot change what the customer sees");
await admin(`/api/jobs/${job.id}`, { method: "PATCH", body: { customerVisibility: { jobId: false, invoice: false, beforePhotos: false, location: false, serviceNotes: false, team: false, paymentStatus: false } } });
pv = (await anon(`/api/customer/job/${token}`)).json?.data;
ok(pv.job.id === null && pv.invoice === null && pv.property === null && pv.location === null && pv.serviceNotes === null && pv.team.length === 0 && pv.paymentStatus === null, "hidden items are left OUT of the customer's API response");
ok(pv.photos.length === 1 && pv.photos[0].photoType === "after", "hidden before photos are not listed");
ok(!JSON.stringify(pv).includes(job.jobNumber) && !JSON.stringify(pv).includes("Gate 2"), "no hidden value appears anywhere in the payload");
ok((await anon(`/api/secure-photo/vb?t=${token}`)).status === 404, "a hidden photo can't be fetched by id either");
await admin(`/api/jobs/${job.id}`, { method: "PATCH", body: { customerVisibility: { feedback: false } } });
ok((await anon(`/api/customer/job/${token}`)).json?.data?.company?.googleReviewUrl === "", "feedback hidden → no review link");
await admin(`/api/jobs/${job.id}`, { method: "PATCH", body: { customerVisibility: null } });
ok(sql(`select coalesce("customerVisibility"::text,'null') from "Job" where id='${job.id}'`) === "null", "Use company default clears the job's own settings");

// ---------------------------------------------------------------- settings
ok((await fmc("/api/settings", { method: "PATCH", body: { companyName: "Hacked" } })).status === 403, "Field Manager cannot change settings");
ok((await taxc("/api/settings", { method: "PATCH", body: { gstin: "X" } })).status === 403, "Tax Officer cannot change settings");
ok((await admin("/api/settings", { method: "PATCH", body: { logoDataUrl: "data:text/html;base64,PHNjcmlwdD4=" } })).status === 400, "only PNG / JPEG / WebP images are accepted as the logo");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const st = (await admin("/api/settings", { method: "PATCH", body: { logoDataUrl: png, signatoryName: "R. Kumar", quotationValidityDays: 30, customerVisibility: { invoice: false, bogus: true }, notifications: { qcReady: false } } })).json?.data;
ok(st?.logoDataUrl === png && st.signatoryName === "R. Kumar" && st.quotationValidityDays === 30, "logo, signatory and quotation validity saved");
ok(st?.customerVisibility?.invoice === false && !("bogus" in st.customerVisibility) && st.customerVisibility.feedback === true, "portal defaults: known keys only, others kept");
ok(st?.notifications?.qcReady === false && st.notifications.customerArrived === true, "notification switches saved");
ok((await anon(`/api/customer/job/${token}`)).json?.data?.invoice === null, "company default now hides invoices on the customer page");
await admin("/api/settings", { method: "PATCH", body: { customerVisibility: { invoice: true }, notifications: { qcReady: true }, logoDataUrl: "" } });
const invDoc = (await admin(`/api/invoices/${cj.invoiceId}`)).json?.data;
ok(invDoc?.invoice?.items?.length === 2 && invDoc.customer.serviceAddress && invDoc.company.signatoryName === "R. Kumar", "invoice document: items, service address, signatory");

// ---------------------------------------------------------------- feedback, reviews, dashboard
sql(`update "Job" set status='COMPLETED', "approvedAt"=now(), "approvedBy"='Meera' where id='${job.id}'`);
ok((await anon(`/api/customer/job/${token}`, { method: "POST", body: { action: "feedback", rating: 4, comment: "Great team, slightly late" } })).status === 200, "customer leaves a private rating and comment");
const rv = (await admin("/api/reviews")).json?.data;
ok(rv?.feedback?.some((f) => f.comment === "Great team, slightly late" && f.rating === 4) && rv.summary.ratings >= 1 && rv.google.configured === false, "Reviews & Feedback lists private feedback; Google section separate");
for (const [who, c] of [["Field Manager", fmc], ["Tax Officer", taxc], ["QC", qcc]]) ok((await c("/api/reviews")).status === 403, `${who} cannot open Reviews & Feedback`);
const ws = (await admin("/api/me/workspace")).json?.data;
ok(typeof ws?.finance?.revenueMonth === "number" && typeof ws.finance.pendingInvoices === "number" && ws.feedback?.count >= 1, "dashboard: revenue, pending invoices and feedback");
ok(ws?.attention?.every((a) => ["issue", "qc", "payment", "rework", "unassigned", "upcoming", "other"].includes(a.kind)) && ws.attention.some((a) => a.kind === "payment"), "Attention Required items are grouped (payment pending present)");
const fws = (await fmc("/api/me/workspace")).json?.data;
ok(fws && fws.finance === undefined && fws.feedback === undefined, "Field Manager's home has no revenue or feedback");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
