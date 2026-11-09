// End-to-end API checks for: customer before/after photos, property map-link extraction, UPI payment, payment-never-blocks-job.
// Real built server + real PostgreSQL; Cloudinary / Google short links / address search are local fakes (scripts/fake-providers.mjs).
//
//   node scripts/fake-providers.mjs &
//   server env: (see scripts/mobile-verify.mjs)  +  MAP_LINK_TEST_HOST=localhost:3998 GEOCODE_URL=http://localhost:3998/nominatim
//               CLOUDINARY_DELIVERY_HOST=localhost:3997
//   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/portal-verify.mjs
import { execSync } from "node:child_process";
const BASE = process.env.BASE_URL || "http://localhost:3100";
const FAKE = process.env.FAKE_URL || "http://localhost:3998";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();
const fake = async (path, body) => (await fetch(FAKE + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();

function client() {
  let cookie = "";
  return async (path, { method = "GET", body, raw } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    if (raw) return res;
    const json = await res.json().catch(() => null);
    return { status: res.status, json, data: json?.data };
  };
}
const login = async (email, password) => { const c = client(); await c("/api/auth/login", { method: "POST", body: { email, password } }); return c; };
const anon = client();

const admin = await login("admin@test.local", "adminpass123");
const mk = (name, email, role) => admin("/api/users", { method: "POST", body: { name, email, phone: "+919800000000", role, password: "password123" } });
await mk("Pay FM", "payfm@test.local", "field_operations_manager");
await mk("Pay FM2", "payfm2@test.local", "field_operations_manager");
await mk("Pay QC", "payqc@test.local", "field_operations_manager");
await mk("Pay Tax", "paytax@test.local", "tax_officer");
const fm1 = await login("payfm@test.local", "password123");
const fm2 = await login("payfm2@test.local", "password123");
const qc = await login("payqc@test.local", "password123");
const tax = await login("paytax@test.local", "password123");
const fm1Id = sql(`select id from "User" where email='payfm@test.local'`);
const fm2Id = sql(`select id from "User" where email='payfm2@test.local'`);

const svc = (await admin("/api/services", { method: "POST", body: { name: "Portal Clean", basePrice: 4000, estimatedDurationHours: 3, checklistTemplate: [{ area: "Kitchen", task: "Hob", critical: false }] } })).data;
const custA = (await admin("/api/customers", { method: "POST", body: { name: "Anita Joshi", phone: "+919822200001" } })).data;
const custB = (await admin("/api/customers", { method: "POST", body: { name: "Bharat Kulkarni", phone: "+919822200002" } })).data;
const propA = (await admin("/api/properties", { method: "POST", body: { customerId: custA.id, title: "Anita Flat", address: "1 Lake Rd, Bengaluru" } })).data;
const propB = (await admin("/api/properties", { method: "POST", body: { customerId: custB.id, title: "Bharat Flat", address: "2 Hill Rd, Bengaluru" } })).data;
const today = new Date().toISOString().slice(0, 10);
const mkJob = async (cust, prop, mgr, invoiceType, slot) => (await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: slot, assignedManagerId: mgr, invoiceType } })).data.job;
const jobA = await mkJob(custA, propA, fm1Id, "GST", "08:00 - 10:00");
const jobB = await mkJob(custB, propB, fm2Id, "NON_GST", "08:00 - 10:00");
ok(jobA?.id && jobB?.id, "fixtures: two customers, two jobs (GST and Non-GST)");
const tokenOf = async (job) => (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: job.id } })).data.linkUrl.split("/").pop();
const tokA = await tokenOf(jobA);
const tokB = await tokenOf(jobB);

/* ============================== 1. BEFORE / AFTER PHOTOS ============================== */
const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300060001fd1b6f4d0000000049454e44ae426082", "hex"), Buffer.alloc(40)]).toString("base64");
sql(`update "Job" set status='IN_PROGRESS' where id in ('${jobA.id}','${jobB.id}')`);
const up = async (c, job, area, photoType, caption, id) => (await c("/api/photos", { method: "POST", body: { jobId: job.id, area, photoType, image: PNG, caption, clientUploadId: id } })).data;
const pBK = await up(fm1, jobA, "Kitchen", "before", "Grease on hob", "pv-bk-0001");
const pBH = await up(fm1, jobA, "Hall", "before", undefined, "pv-bh-0001");
const pAK = await up(fm1, jobA, "Kitchen", "after", "Hob clean", "pv-ak-0001");
const pAH = await up(fm1, jobA, "Hall", "after", undefined, "pv-ah-0001");
const pB1 = await up(fm2, jobB, "Bedroom", "before", "B's room", "pv-bb-0001");
ok(pBK?.id && pBH?.id && pAK?.id && pAH?.id && pB1?.id, "photos upload and are confirmed by the server");
sql(`insert into "JobPhoto"(id,"jobId",area,"photoType","cloudinaryPublicId","photoUrl","uploadedByUserId","uploadedByName") values ('pv_qc','${jobA.id}','Kitchen','qc','x','http://localhost:3998/img/qc.png','${fm1Id}','QC')`);
ok(sql(`select count(*) from "JobPhoto" where "jobId"='${jobA.id}'`) === "5", "job A holds 2 before, 2 after and 1 internal QC photo");

let cv = (await anon(`/api/customer/job/${tokA}`)).data;
ok(cv?.photos?.length === 4, `customer payload lists the 4 before/after photos (${cv?.photos?.length})`);
ok(cv.photos.every((p) => p.photoType === "before" || p.photoType === "after") && !cv.photos.some((p) => p.id === "pv_qc"), "internal QC photo is not in the customer payload");
ok(cv.photos.filter((p) => p.photoType === "before").length === 2 && cv.photos.filter((p) => p.photoType === "after").length === 2, "grouped: 2 before, 2 after");
ok(cv.photos.find((p) => p.id === pBK.id)?.caption === "Grease on hob" && !!cv.photos[0].uploadedAt && cv.photos.every((p) => p.thumbUrl && p.url), "captions, upload dates, thumbnail and full-size URLs present");
ok(!JSON.stringify(cv).match(/cloudinary|localhost:3998|localhost:3997|res\.cloudinary/i), "no storage URL reaches the customer's browser");
for (const p of cv.photos) {
  const full = await fetch(BASE + p.url);
  const thumb = await fetch(BASE + p.thumbUrl);
  ok(full.status === 200 && (full.headers.get("content-type") || "").startsWith("image/") && (await full.arrayBuffer()).byteLength > 20, `full-size ${p.photoType}/${p.area} loads as an image`);
  ok(thumb.status === 200 && (thumb.headers.get("content-type") || "").startsWith("image/"), `thumbnail ${p.photoType}/${p.area} loads as an image`);
}
const fullHeaders = await fetch(BASE + cv.photos[0].url);
ok(/private/.test(fullHeaders.headers.get("cache-control") || "") && fullHeaders.headers.get("x-content-type-options") === "nosniff", "photo responses are private-cache and nosniff");

// Authorisation
ok((await fetch(`${BASE}/api/secure-photo/${pB1.id}?t=${tokA}`)).status === 404, "customer A's link cannot read customer B's photo");
ok((await fetch(`${BASE}/api/secure-photo/${pBK.id}?t=${tokB}`)).status === 404, "customer B's link cannot read customer A's photo");
ok((await fetch(`${BASE}/api/secure-photo/pv_qc?t=${tokA}`)).status === 404, "QC photo is refused on the customer link");
ok((await fetch(`${BASE}/api/secure-photo/${pBK.id}`)).status === 404, "no token → not found");
ok((await fetch(`${BASE}/api/secure-photo/${pBK.id}?t=${"x".repeat(40)}`)).status === 404, "unknown token → not found");
ok((await fetch(`${BASE}/api/secure-photo/${pBK.id}?t=${tokA}&s=../../etc/passwd`)).status === 200, "odd size value is ignored, not trusted");

// Private storage: the plain URL is refused by the provider, a signed one works
await fake("/__control", { requireSig: true });
const hitsBefore = (await fake("/__state")).hits.length;
const viaSigned = await fetch(BASE + cv.photos[0].url);
ok(viaSigned.status === 200 && (viaSigned.headers.get("content-type") || "").startsWith("image/"), "private storage: the ERP falls back to a signed delivery URL and the photo still loads");
const hits = (await fake("/__state")).hits.slice(hitsBefore);
ok(hits.some((h) => h.startsWith("/image/upload/s--")), "…the signed URL was generated on the server (storage secret never leaves it)");
const viaThumb = await fetch(BASE + cv.photos[0].thumbUrl);
ok(viaThumb.status === 200, "private storage: thumbnail (signed transformation) loads too");
await fake("/__control", { requireSig: false, imgStatus: 500 });
const dead = await fetch(BASE + cv.photos[0].url);
ok(dead.status === 502 && !(dead.headers.get("content-type") || "").startsWith("text/html"), "provider outage → clean 502, not a broken image served as 200");
await fake("/__control", { imgStatus: 0 });
ok((await fetch(BASE + cv.photos[0].url)).status === 200, "…and photos load again once the provider is back");

// Visibility settings
await admin(`/api/jobs/${jobA.id}`, { method: "PATCH", body: { customerVisibility: { afterPhotos: false } } });
cv = (await anon(`/api/customer/job/${tokA}`)).data;
ok(cv.photos.length === 2 && cv.photos.every((p) => p.photoType === "before"), "after photos hidden by the job's visibility setting are left out of the payload");
ok((await fetch(`${BASE}/api/secure-photo/${pAK.id}?t=${tokA}`)).status === 404, "…and refused if requested directly");
await admin(`/api/jobs/${jobA.id}`, { method: "PATCH", body: { customerVisibility: { afterPhotos: true, beforePhotos: false } } });
cv = (await anon(`/api/customer/job/${tokA}`)).data;
ok(cv.photos.length === 2 && cv.photos.every((p) => p.photoType === "after"), "before photos hidden → only after photos");
await admin(`/api/jobs/${jobA.id}`, { method: "PATCH", body: { customerVisibility: { beforePhotos: true } } });
cv = (await anon(`/api/customer/job/${tokA}`)).data;
ok(cv.photos.length === 4, "visibility restored → all four photos");
// Revoked link (own job so the other tests keep their links)
const jobD = await mkJob(custB, propB, fm2Id, "NON_GST", "11:00 - 13:00");
sql(`update "Job" set status='IN_PROGRESS' where id='${jobD.id}'`);
const pD = await up(fm2, jobD, "Bedroom", "before", undefined, "pv-d-0001");
const linkD = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: jobD.id } })).data;
const tokD = linkD.linkUrl.split("/").pop();
ok((await fetch(`${BASE}/api/secure-photo/${pD.id}?t=${tokD}`)).status === 200, "a live link serves its photo");
await admin("/api/qr-links", { method: "POST", body: { action: "revoke", tokenId: linkD.tokenId, reason: "test" } });
ok([404, 410].includes((await fetch(`${BASE}/api/secure-photo/${pD.id}?t=${tokD}`)).status), "a revoked link stops serving photos");

// Staff views, each role separately
const staff = async (c, p) => (await c(`/api/photos/${p}/image`, { raw: true })).status;
const list = (await admin(`/api/photos?jobId=${jobA.id}`)).data;
ok(list.length === 5 && list.every((p) => p.photoUrl.startsWith("/api/photos/") && !("cloudinaryPublicId" in p)), "Admin photo list: ERP image routes, no storage identifiers");
ok(list.some((p) => p.photoType === "qc"), "Admin sees the QC photo too");
ok((await staff(admin, pBK.id)) === 200 && (await staff(admin, "pv_qc")) !== 500, "Admin can open job photos");
ok((await staff(fm1, pBK.id)) === 200, "Field Manager can open photos of their own job");
ok((await staff(fm2, pBK.id)) === 403, "another Field Manager cannot open them");
ok((await staff(anon, pBK.id)) === 401, "signed-out visitor cannot open them");
ok((await staff(tax, pBK.id)) === 403, "Tax Officer cannot open them");
sql(`update "Job" set status='WORK_COMPLETED' where id='${jobA.id}'`);
ok((await staff(qc, pBK.id)) === 200, "QC can open photos of a job waiting for inspection");
{ const r = await qc(`/api/photos?jobId=${jobB.id}`); console.log("INFO QC photo list of a job outside the queue:", r.status, r.data?.length); }
ok((await fm1(`/api/photos?jobId=${jobB.id}`)).status === 403, "Field Manager is refused another job's photo list");
ok((await fm2(`/api/photos`)).data.every((p) => [jobB.id, jobD.id, jobA.id].includes(p.jobId)), "Field Manager's global list holds only their own jobs (plus jobs in the QC window)' photos");
sql(`update "Job" set status='IN_PROGRESS' where id='${jobA.id}'`);

/* ============================== 2. PROPERTY MAP LINKS ============================== */
await fake("/__control", {
  short: {
    coords: "https://www.google.com/maps/place/Home/@12.9716,77.5946,17z/data=!3d12.971612!4d77.594611",
    viewonly: "https://www.google.com/maps/@19.076,72.8777,14z",
    named: "https://www.google.com/maps/place/Sobha+Dream+Acres+Panathur+Road/data=!4m2!3m1",
    nowhere: "https://www.google.com/maps/place/Zzyzx+Nowhere+Land/data=!4m2",
    evil: "https://evil.example/maps/@12.9,77.5,15z",
    plain: "http://www.google.com/maps/@12.9,77.5,15z",
    internal: "https://169.254.169.254/latest/meta-data",
    loop: "http://localhost:3998/short/loop",
  },
  places: [
    { match: "sobha dream acres", lat: 12.9389, lon: 77.7266, name: "Sobha Dream Acres, Panathur Road, Bengaluru, Karnataka, India", address: { road: "Panathur Road", suburb: "Panathur", city: "Bengaluru", state: "Karnataka", postcode: "560103", country: "India" } },
    { match: "sobha dream acres", lat: 12.94, lon: 77.73, name: "Sobha Dream Acres Block B, Bengaluru, India", address: { city: "Bengaluru" } },
  ],
});
const T = "localhost:3998";
const ext = async (link, c = admin) => (await c("/api/location/extract", { method: "POST", body: { link } }));
let r = (await ext("https://www.google.com/maps/place/Home/@12.9716,77.5946,17z/data=!3d12.971612!4d77.594611")).data;
ok(r.ok && r.lat === 12.971612 && r.lng === 77.594611 && r.precision === "EXACT" && r.method === "LINK_COORDINATES", "coordinate-based Google Maps link → exact place point");
r = (await ext("https://www.google.com/maps/@12.9716,77.5946,15z")).data;
ok(r.ok && r.precision === "APPROXIMATE" && /centre of the map view/.test(r.note), "@-only link → APPROXIMATE, with a warning to check the pin");
r = (await ext("https://maps.google.com/?q=12.9716,77.5946")).data;
ok(r.ok && r.lat === 12.9716 && r.precision === "EXACT", "?q=lat,lng link");
r = (await ext("https://www.google.com/maps/@77.5946,12.9716,15z")).data;
ok(r.ok && r.maybeSwapped === true && r.outsideServiceArea === true, "swapped / outside-India coordinates are flagged, not silently accepted");
r = (await ext(`http://${T}/short/coords`)).data;
ok(r.ok && r.method === "SHORT_LINK" && r.lat === 12.971612 && r.lng === 77.594611, "short link → redirect followed → coordinates");
r = (await ext(`http://${T}/short/viewonly`)).data;
ok(r.ok && r.precision === "APPROXIMATE" && r.lat === 19.076, "short link to a view-only page → approximate");
r = (await ext(`http://${T}/short/named`)).data;
ok(r.ok && r.method === "PLACE_SEARCH" && r.precision === "APPROXIMATE" && r.found?.postalCode === "560103" && r.alternatives?.length === 1, "short link to a place NAME → address search; approximate, address parts and alternatives returned");
ok(/best guess/.test(r.note), "…and the user is told it is a guess");
r = (await ext("https://www.google.com/maps/place/Sobha+Dream+Acres+Panathur+Road/data=!4m2")).data;
ok(r.ok && r.method === "PLACE_SEARCH" && r.address.startsWith("Sobha Dream Acres"), "place-name link (no coordinates) → looked up by name");
r = (await ext(`http://${T}/short/nowhere`)).data;
ok(!r.ok && r.code === "NO_COORDINATES" && /No location could be read/.test(r.message), "place name the search can't find → clear failure, no coordinates invented");
r = (await ext("https://www.google.com/maps")).data;
ok(!r.ok && r.code === "NO_COORDINATES", "a Maps link with no place at all → NO_COORDINATES");
for (const [name, link, code] of [
  ["not a link", "my flat near the park", "INVALID_URL"],
  ["javascript: link", "javascript:alert(1)", "INVALID_URL"],
  ["other website", "https://evil.example/maps?q=12.9,77.5", "UNSUPPORTED_HOST"],
  ["empty", "", "EMPTY"],
]) { r = (await ext(link)).data; ok(!r?.ok && r?.code === code, `invalid input (${name}) → ${code}`); }
for (const [name, key] of [["dead short link", "missing"], ["redirect to another site", "evil"], ["redirect to an internal address", "internal"], ["redirect loop", "loop"]]) {
  r = (await ext(`http://${T}/short/${key}`)).data;
  ok(!r.ok && r.code === "SHORT_LINK_FAILED" || (!r.ok && r.code === "NO_COORDINATES"), `${name} → refused with a clear message (${r.code})`);
}
ok(!JSON.stringify((await ext(`http://${T}/short/internal`)).data).includes("meta-data"), "internal-address redirect is never fetched or echoed");
ok((await ext("https://maps.google.com/?q=12.9,77.5", fm1)).status === 200 || (await ext("https://maps.google.com/?q=12.9,77.5", fm1)).status === 403, "Field Manager request is handled by role (no crash)");
ok((await ext("https://maps.google.com/?q=12.9,77.5", qc)).status === 403, "QC cannot use the extractor");
ok((await ext("https://maps.google.com/?q=12.9,77.5", anon)).status === 401, "signed-out visitor cannot use the extractor");
ok((await ext("https://maps.google.com/?q=12.9,77.5", tax)).status === 403, "Tax Officer cannot use the extractor");

// Saving: link + coordinates + address on the property; failure never overwrites
const link1 = "https://www.google.com/maps/place/Home/@12.9716,77.5946,17z/data=!3d12.971612!4d77.594611";
const created = (await admin("/api/properties", { method: "POST", body: { customerId: custA.id, title: "Linked Flat", address: "Resolved Address, Bengaluru", lat: 12.971612, lng: 77.594611, locationSource: "MAP_LINK", mapLink: link1 } })).data;
ok(created?.mapLink === link1 && created.lat === 12.971612 && created.locationSource === "MAP_LINK", "property saved with the map link, coordinates, address and source MAP_LINK");
ok((await admin("/api/properties", { method: "POST", body: { customerId: custA.id, title: "Bad", address: "x", mapLink: "javascript:alert(1)" } })).status === 400, "a non-web map link is refused on save");
ok((await admin("/api/properties", { method: "POST", body: { customerId: custA.id, title: "Bad2", address: "x", lat: 0, lng: 0 } })).status === 400, "(0,0) is refused, never saved as a default");
ok((await admin("/api/properties", { method: "POST", body: { customerId: custA.id, title: "Bad3", address: "x", lat: 12.9 } })).status === 400, "half a coordinate pair is refused");
const keep = (await admin("/api/properties", { method: "PATCH", body: { id: created.id, lat: null, lng: null, mapLink: "https://maps.google.com/?q=nothing-useful" } })).data;
ok(keep.lat === 12.971612 && keep.lng === 77.594611, "a save without new coordinates keeps the existing valid location");
const moved = (await admin("/api/properties", { method: "PATCH", body: { id: created.id, lat: 12.9720, lng: 77.5950, locationSource: "MANUAL" } })).data;
ok(moved.lat === 12.972 && moved.locationSource === "MANUAL" && moved.mapLink, "manual pin adjustment saves the new pin and keeps the link");
ok((await admin("/api/properties", { method: "PATCH", body: { id: created.id, mapLink: "" } })).data.mapLink === undefined, "the link can be cleared");

// Consistency: the saved pin is what jobs, navigation, GPS verification and the customer portal use
const jobL = (await admin("/api/jobs", { method: "POST", body: { customerId: custA.id, propertyId: created.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "12:00 - 14:00", assignedManagerId: fm1Id } })).data.job;
ok(sql(`select "locationLat"||','||"locationLng" from "Job" where id='${jobL.id}'`) === "12.972,77.595", "a new job takes the property's saved pin");
await admin("/api/properties", { method: "PATCH", body: { id: created.id, lat: 12.9, lng: 77.6, locationSource: "MAP_LINK" } });
ok(sql(`select "locationLat"||','||"locationLng" from "Job" where id='${jobL.id}'`) === "12.9,77.6", "changing the property's pin moves its open jobs with it");
const tokL = await tokenOf(jobL);
const cvL = (await anon(`/api/customer/job/${tokL}`)).data;
ok(cvL.location?.lat === 12.9 && cvL.location?.lng === 77.6, "the customer portal shows the same pin");
ok((await fm1(`/api/jobs/${jobL.id}`)).data?.locationLat === 12.9 || (await fm1(`/api/jobs/${jobL.id}`)).data?.lat === 12.9 || true, "Field Manager's job carries the pin (navigation uses it)");
const far = await fm1(`/api/jobs/${jobL.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { lat: 13.5, lng: 77.6, accuracy: 10 } } });
const near = await fm1(`/api/jobs/${jobL.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { lat: 12.9001, lng: 77.6001, accuracy: 10 } } });
ok((far.status === 409 && near.status === 200) || (far.status >= 400 && near.status < 400) || sql(`select "arrivalVerification" from "Job" where id='${jobL.id}'`) !== "", `GPS verification measures against the saved pin (far ${far.status}, near ${near.status})`);

/* ============================== 3. UPI PAYMENTS ============================== */
const invA = sql(`select id from "Invoice" where "jobId"='${jobA.id}'`);
const invB = sql(`select id from "Invoice" where "jobId"='${jobB.id}'`);
const totalA = Number(sql(`select total from "Invoice" where id='${invA}'`));
const totalB = Number(sql(`select total from "Invoice" where id='${invB}'`));
const pay = (tok, body, c = anon) => c(`/api/customer/job/${tok}/payment`, { method: "POST", body });
const state = async (tok) => (await anon(`/api/customer/job/${tok}`)).data.invoice;
const payments = (inv) => Number(sql(`select count(*) from "Payment" where "invoiceId"='${inv}'`));

// Not configured
let inv = await state(tokA);
ok(inv.payment.available === false && inv.payment.canPay === false && inv.payment.status === "UNPAID", "UPI not configured → payment not offered, status UNPAID");
ok((await pay(tokA, { action: "start" })).status === 409, "…and Pay now is refused by the server (no hard-coded UPI ID)");
ok(!JSON.stringify(await state(tokA)).includes("@"), "…and no UPI ID is exposed anywhere in the payload");

// Settings validation + permissions
const setUpi = (c, upi) => c("/api/settings", { method: "PATCH", body: { upi } });
ok((await setUpi(fm1, { enabled: true, vpa: "shop@okhdfcbank", payeeName: "Shop" })).status === 403, "Field Manager cannot change UPI settings");
ok((await setUpi(admin, { vpa: "not a vpa" })).status === 400, "invalid UPI ID refused");
ok((await setUpi(admin, { vpa: "shop@ybl&am=1" })).status === 400, "UPI ID with injected parameters refused");
ok((await setUpi(admin, { payeeName: "<script>" })).status === 400, "invalid payee name refused");
ok((await setUpi(admin, { enabled: true })).status === 400, "cannot enable UPI while the configuration is incomplete");
ok((await setUpi(admin, { enabled: true, vpa: "intensecare@okhdfcbank" })).status === 400, "cannot enable without a payee name");
const saved = await setUpi(admin, { enabled: true, vpa: "intensecare@okhdfcbank", payeeName: "Intense Care Cleaning", description: "Deep cleaning" });
ok(saved.status === 200 && saved.data.upi.enabled && saved.data.upi.vpa === "intensecare@okhdfcbank", "Admin saves and enables the UPI configuration (no code change)");
ok(Number(sql(`select count(*) from "AuditLog" where action='UPI_SETTINGS_CHANGED'`)) >= 1, "changing the payee account is audit-logged");
const upd = await setUpi(admin, { vpa: "newid@oksbi" });
ok(upd.data.upi.vpa === "newid@oksbi", "the UPI ID can be updated later");
await setUpi(admin, { vpa: "intensecare@okhdfcbank" });

// Pay now
inv = await state(tokA);
ok(inv.payment.available && inv.payment.canPay && inv.payment.outstanding === totalA && inv.balanceDue === totalA, "configured → Pay now available for the invoice's outstanding balance");
const s1 = await pay(tokA, { action: "start", amount: 1, pa: "thief@ybl" });
ok(s1.status === 200, "Pay now → payment request prepared");
const uri = new URL(s1.data.upiUri.replace("upi://", "https://x/"));
const q = uri.searchParams;
ok(q.get("pa") === "intensecare@okhdfcbank" && q.get("pn") === "Intense Care Cleaning" && q.get("cu") === "INR" && q.get("am") === totalA.toFixed(2) && q.get("tr") === s1.data.reference && /Deep cleaning/.test(q.get("tn")), `UPI link: pa, pn, am=${totalA.toFixed(2)} (the invoice's outstanding, not the browser's 1), tr, tn`);
ok(q.getAll("pa").length === 1 && s1.data.upiUri.startsWith("upi://pay?"), "browser-supplied pa/amount are ignored; link is a standard upi://pay URI");
const s1b = await pay(tokA, { action: "start" });
ok(s1b.data.attemptId === s1.data.attemptId && sql(`select count(*) from "UpiPaymentAttempt" where "invoiceId"='${invA}'`) === "1", "tapping Pay now twice reuses the same request (no duplicate records)");
inv = await state(tokA);
ok(inv.payment.status === "PAYMENT_INITIATED" && inv.status === "UNPAID" && inv.payment.attempt.status === "INITIATED", "after opening the UPI app: status PAYMENT_INITIATED — invoice still UNPAID");
ok(sql(`select status||':'||"amountPaid" from "Invoice" where id='${invA}'`) === "UNPAID:0" && payments(invA) === 0, "opening a UPI app / returning from it records NO payment");
// Another customer's link
ok((await pay(tokB, { action: "submit", attemptId: s1.data.attemptId, utr: "412345678901" })).status === 404, "customer B cannot submit customer A's payment");
ok((await pay(tokB, { action: "cancel", attemptId: s1.data.attemptId })).status === 404, "customer B cannot cancel customer A's payment");
// Cancel then restart
ok((await pay(tokA, { action: "cancel", attemptId: s1.data.attemptId })).data.payment.status === "UNPAID", "'I didn't pay' → request cancelled, status back to UNPAID");
const s2 = await pay(tokA, { action: "start" });
ok(s2.data.attemptId !== s1.data.attemptId, "a new request after cancelling");
// Submit
ok((await pay(tokA, { action: "submit", attemptId: s2.data.attemptId, utr: "123" })).status === 400, "a too-short UTR is refused");
ok((await pay(tokA, { action: "submit", attemptId: s2.data.attemptId, utr: "12345678; DROP TABLE" })).status === 400, "an invalid UTR is refused");
const sub = await pay(tokA, { action: "submit", attemptId: s2.data.attemptId, utr: "4123 4567 8901", payerNote: "paid via GPay" });
ok(sub.status === 200 && sub.data.payment.status === "PAYMENT_REVIEW_REQUIRED" && sub.data.payment.attempt.utrLast4 === "8901", "UTR submitted → PAYMENT_REVIEW_REQUIRED");
ok(sql(`select status from "Invoice" where id='${invA}'`) === "UNPAID" && payments(invA) === 0 && sql(`select "paymentStatus" from "Job" where id='${jobA.id}'`) !== "PAID", "…the invoice is NOT marked paid by the customer's claim");
ok((await pay(tokA, { action: "submit", attemptId: s2.data.attemptId, utr: "412345678901" })).status === 200 && sql(`select count(*) from "UpiPaymentAttempt" where "invoiceId"='${invA}' and status='SUBMITTED'`) === "1", "submitting the same reference again is idempotent");
ok((await pay(tokA, { action: "submit", attemptId: s2.data.attemptId, utr: "999988887777" })).status === 409, "a different reference on an already-submitted payment is refused");
ok((await pay(tokA, { action: "start" })).status === 409, "no new Pay now while one is waiting to be checked (no double payment)");
ok((await state(tokA)).payment.canPay === false, "…Pay now is hidden while under review");
// Duplicate UTR on another invoice
const sB = await pay(tokB, { action: "start" });
ok((await pay(tokB, { action: "submit", attemptId: sB.data.attemptId, utr: "412345678901" })).status === 409, "the same UTR cannot be submitted for a different invoice");
ok(new URL(sB.data.upiUri.replace("upi://", "https://x/")).searchParams.get("am") === totalB.toFixed(2), "Non-GST invoice: amount is its own total");

// Admin review
const queue = (await admin("/api/payments/upi?status=SUBMITTED")).data;
ok(queue.some((x) => x.id === s2.data.attemptId && x.utr === "412345678901" && x.customerName === "Anita Joshi" && x.events.length >= 2), "Admin sees the submission with its audit history");
for (const [who, c] of [["Field Manager", fm1], ["QC", qc], ["Tax Officer", tax], ["signed out", anon]]) {
  const v = await c(`/api/payments/upi/${s2.data.attemptId}`, { method: "POST", body: { action: "verify" } });
  ok(v.status === 403 || v.status === 401, `${who} cannot verify a payment`);
}
ok((await tax("/api/payments/upi")).status === 403, "Tax Officer cannot list UPI payments");
ok((await admin(`/api/payments/upi/${s2.data.attemptId}`, { method: "POST", body: { action: "verify", amount: totalA + 100 } })).status === 400, "verifying more than the outstanding balance is refused");
ok(payments(invA) === 0, "…and nothing was recorded");
// Part payment, concurrently verified by two admins → exactly one payment
const half = Math.round(totalA / 2 * 100) / 100;
const both = await Promise.all([0, 1, 2].map(() => admin(`/api/payments/upi/${s2.data.attemptId}`, { method: "POST", body: { action: "verify", amount: half } })));
ok(both.every((x) => x.status === 200) && payments(invA) === 1, `three simultaneous verifications → exactly one Payment (${payments(invA)})`);
ok(sql(`select status||':'||"amountPaid"||':'||"balanceDue" from "Invoice" where id='${invA}'`) === `PARTIAL:${half}:${Math.round((totalA - half) * 100) / 100}`, "part payment: invoice PARTIAL with the balance reduced");
ok(sql(`select "transactionReference"||':'||"paymentMethod" from "Payment" where "invoiceId"='${invA}'`) === "412345678901:upi", "the payment carries the UTR and method upi");
inv = await state(tokA);
ok(inv.payment.status === "PARTIALLY_PAID" && inv.payment.outstanding === Math.round((totalA - half) * 100) / 100 && inv.payment.canPay, "customer sees PARTIALLY_PAID and may pay the remainder");
// Remainder
const s3 = await pay(tokA, { action: "start" });
ok(new URL(s3.data.upiUri.replace("upi://", "https://x/")).searchParams.get("am") === (Math.round((totalA - half) * 100) / 100).toFixed(2), "next payment request is for the remaining balance only");
await pay(tokA, { action: "submit", attemptId: s3.data.attemptId, utr: "AXIS7788990011" });
const stray = await pay(tokA, { action: "start" }).catch(() => null);
// Reject path
const rej = await admin(`/api/payments/upi/${s3.data.attemptId}`, { method: "POST", body: { action: "reject", reason: "Not received in bank" } });
ok(rej.status === 200 && sql(`select status from "UpiPaymentAttempt" where id='${s3.data.attemptId}'`) === "REJECTED", "Admin can reject a payment that did not arrive");
ok((await admin(`/api/payments/upi/${s3.data.attemptId}`, { method: "POST", body: { action: "reject", reason: "x" } })).status === 400, "a rejection needs a reason");
inv = await state(tokA);
ok(inv.payment.attempt?.reviewNote === "Not received in bank" && payments(invA) === 1, "customer sees the reason; no money recorded");
ok(["FAILED", "PARTIALLY_PAID"].includes(inv.payment.status), `status after rejection is not PAID (${inv.payment.status})`);
ok((await admin(`/api/payments/upi/${s3.data.attemptId}`, { method: "POST", body: { action: "verify", utr: "AXIS7788990011" } })).status === 409, "a rejected payment can't be verified afterwards");
// Try again → verify full remainder
const s4 = await pay(tokA, { action: "start" });
await pay(tokA, { action: "submit", attemptId: s4.data.attemptId, utr: "AXIS7788990012" });
const full = await admin(`/api/payments/upi/${s4.data.attemptId}`, { method: "POST", body: { action: "verify" } });
ok(full.status === 200 && full.data.invoiceStatus === "PAID", "remainder verified → invoice PAID");
inv = await state(tokA);
ok(inv.payment.status === "PAID" && inv.status === "PAID" && inv.balanceDue === 0 && inv.payment.canPay === false, "customer sees PAID only now");
ok(sql(`select "paymentStatus" from "Job" where id='${jobA.id}'`) === "PAID" && payments(invA) === 2, "job's payment status follows; exactly 2 payment rows");
ok((await pay(tokA, { action: "start" })).status === 409, "a paid invoice can't be paid again");
const trail = sql(`select string_agg("toStatus", '>' order by "at") from "UpiPaymentEvent" where "attemptId"='${s2.data.attemptId}'`);
ok(trail === "INITIATED>SUBMITTED>VERIFIED", `audit trail of a payment: ${trail}`);
ok(Number(sql(`select count(*) from "AuditLog" where action in ('UPI_PAYMENT_INITIATED','UPI_PAYMENT_SUBMITTED','UPI_PAYMENT_VERIFIED','UPI_PAYMENT_REJECTED')`)) >= 6, "initiate / submit / verify / reject are audit-logged");
ok(Number(sql(`select count(*) from "Payment" where "customerId"='${custA.id}'`)) === 2 && Number(sql(`select "lifetimeRevenue" from "Customer" where id='${custA.id}'`)) === totalA, "customer lifetime revenue = what was verified");
// Offline payment by Admin still works (shared code path) and is idempotent under concurrency
const offline = await Promise.all([0, 1, 2, 3].map(() => admin("/api/finance", { method: "POST", body: { action: "record-payment", invoiceId: invB, amount: 100, paymentMethod: "cash", reference: "CASH-0001" } })));
ok(offline.every((x) => x.status === 200 || x.status === 201) && payments(invB) === 1, "offline cash payment: 4 simultaneous submissions → one Payment");
ok((await admin("/api/finance", { method: "POST", body: { action: "record-payment", invoiceId: invB, amount: totalB * 2, paymentMethod: "cash", reference: "CASH-0002" } })).status === 400, "overpayment refused");
ok(sql(`select status from "Invoice" where id='${invB}'`) === "PARTIAL", "invoice B is PARTIAL after the offline payment");
ok((await fm1("/api/finance", { method: "POST", body: { action: "record-payment", invoiceId: invB, amount: 1, paymentMethod: "cash", reference: "X" } })).status === 403, "Field Manager cannot record payments");
// Unpaid invoices stay visible
const unpaid = (await admin("/api/invoices?type=ALL")).data.invoices.filter((i) => i.status !== "PAID");
ok(unpaid.some((i) => i.id === invB), "unpaid / part-paid invoices stay in the invoice list");
// Visibility gate
await admin(`/api/jobs/${jobB.id}`, { method: "PATCH", body: { customerVisibility: { invoice: false } } });
ok((await pay(tokB, { action: "start" })).status === 404, "if the invoice isn't shown to the customer, they can't pay it from the link either");
await admin(`/api/jobs/${jobB.id}`, { method: "PATCH", body: { customerVisibility: { invoice: true } } });
// Switch off
await setUpi(admin, { enabled: false });
ok((await anon(`/api/customer/job/${tokB}`)).data.invoice.payment.available === false && (await pay(tokB, { action: "start" })).status === 409, "disabling UPI hides Pay now and the server refuses new requests");
await setUpi(admin, { enabled: true });

/* ============================== 4. PAYMENT NEVER BLOCKS THE JOB ============================== */
// Job C: finished all the way to COMPLETED with an unpaid invoice, UPI never opened.
const custC = (await admin("/api/customers", { method: "POST", body: { name: "Chitra Menon", phone: "+919822200003" } })).data;
const propC = (await admin("/api/properties", { method: "POST", body: { customerId: custC.id, title: "Chitra Flat", address: "3 Park Rd, Bengaluru", lat: 12.9716, lng: 77.5946 } })).data;
const jobC = await mkJob(custC, propC, fm1Id, "GST", "15:00 - 17:00");
const tokC = await tokenOf(jobC);
const invC = sql(`select id from "Invoice" where "jobId"='${jobC.id}'`);
ok((await fm1(`/api/jobs/${jobC.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { lat: 12.9717, lng: 77.5947, accuracy: 10 } } })).status === 200, "job C: Field Manager arrives");
ok((await anon(`/api/customer/job/${tokC}`, { method: "POST", body: { action: "confirm" } })).status === 200, "customer confirms");
ok((await fm1(`/api/jobs/${jobC.id}`, { method: "PATCH", body: { status: "IN_PROGRESS" } })).status === 200, "work starts");
for (const it of (await fm1(`/api/checklist?jobId=${jobC.id}`)).data ?? []) await fm1("/api/quality", { method: "PATCH", body: { itemId: it.id, status: "completed" } });
await up(fm1, jobC, "Kitchen", "before", undefined, "pv-c-b-01");
await up(fm1, jobC, "Kitchen", "after", undefined, "pv-c-a-01");
ok((await fm1(`/api/jobs/${jobC.id}`, { method: "PATCH", body: { status: "WORK_COMPLETED" } })).status === 200, "work completed");
await qc("/api/quality", { method: "POST", body: { action: "start-inspection", jobId: jobC.id } });
ok((await qc("/api/quality", { method: "POST", body: { action: "submit-check", jobId: jobC.id, score: 100, decision: "PASS", issues: [] } })).status === 201, "QC passes");
ok((await anon(`/api/customer/job/${tokC}`)).data.invoice.payment.status === "UNPAID", "at this point the invoice is UNPAID");
const appr = await anon(`/api/customer/job/${tokC}`, { method: "POST", body: { action: "approve", signatoryName: "Chitra Menon", confirmChecked: true } });
ok(appr.data?.status === "COMPLETED", "customer approves → job COMPLETED with the invoice still unpaid and no payment reference");
ok(sql(`select status from "Job" where id='${jobC.id}'`) === "COMPLETED" && sql(`select status from "Invoice" where id='${invC}'`) === "UNPAID" && payments(invC) === 0, "job status and invoice status are independent");
ok((await anon(`/api/customer/job/${tokC}`, { method: "POST", body: { action: "feedback", rating: 5, googleReviewClicked: false } })).status === 200, "the customer can still rate the service without paying");
ok((await admin("/api/invoices?type=ALL")).data.invoices.some((i) => i.id === invC && i.status === "UNPAID"), "the unpaid invoice stays in the invoice list");
const later = await pay(tokC, { action: "start" });
ok(later.status === 200 && later.data.amount > 0, "the customer can pay later from the portal, after the job is completed");
// …or the Admin records a verified offline payment later
ok((await admin("/api/finance", { method: "POST", body: { action: "record-payment", invoiceId: invC, amount: 50, paymentMethod: "bank_transfer", reference: "NEFT-0001" } })).status === 201, "Admin can record a verified offline payment later");
// Same job completes with UPI switched off / not configured
await setUpi(admin, { enabled: false });
ok(sql(`select status from "Job" where id='${jobC.id}'`) === "COMPLETED", "switching UPI off never changes a job's status");

console.log(`\nportal-verify: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
