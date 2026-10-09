// Location end-to-end check: properties, jobs, the customer page and the Field
// Manager all use the SAME saved location; bad coordinates are refused; a good
// pin is never wiped by empty values. Run AFTER scripts/e2e-verify.mjs (reuses
// its users) against the same server and DB:
//   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/location-verify.mjs
import { execSync } from "node:child_process";
const BASE = process.env.BASE_URL || "http://localhost:3100";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`, { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
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
const anon = client();
const fm1 = sql(`select id from "User" where email='fm1@test.local'`);
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const svc = (await admin("/api/services")).json?.data?.[0];
const getProp = async (id) => (await admin("/api/properties")).json?.data?.find((p) => p.id === id);
const getJob = async (c, id) => (await c(`/api/jobs/${id}`)).json?.data;
let slot = 0;
const mkJob = async (body) => {
  const h = String(slot++).padStart(2, "0");
  return (await admin("/api/jobs", { method: "POST", body: { serviceId: svc.id, scheduledDate: "2027-01-15", scheduledTimeSlot: `${h}:00 - ${h}:30`, invoiceType: "NON_GST", ...body } })).json?.data?.job;
};

console.log("--- Property: create with address search result, reopen");
const cust = (await admin("/api/customers", { method: "POST", body: { name: "Location Tester", phone: "+919811100001", address: "HQ" } })).json?.data;
const created = await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Koramangala Flat", address: "Flat 402, Tower B, 80 Ft Rd", addressLine: "Flat 402, Tower B", locality: "Koramangala", city: "Bengaluru", state: "Karnataka", postalCode: "560034", country: "India", locationNotes: "Opposite the park, gate 3", lat: 12.935192, lng: 77.624481, locationSource: "SEARCH" } });
ok(created.status === 201, "property created with structured address and a picked search result");
let p = await getProp(created.json.data.id);
ok(p && p.lat === 12.935192 && p.lng === 77.624481 && p.locality === "Koramangala" && p.state === "Karnataka" && p.postalCode === "560034" && p.country === "India" && p.locationNotes === "Opposite the park, gate 3" && p.addressLine === "Flat 402, Tower B", "after reopening: coordinates and every address field are exactly as saved");
ok(p.locationSource === "SEARCH" && !!p.locationUpdatedAt && !p.locationVerifiedAt, "location source and updated time are recorded; not yet verified on site");
ok(sql(`select pg_typeof(lat)::text from "Property" where id='${p.id}'`) === "double precision", "coordinates are stored as numbers (not strings)");
ok(!("gpsCoordinates" in p), "no placeholder (0,0) coordinates are sent for any property");

console.log("--- Property: bad coordinates are refused, good ones never wiped");
ok((await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Half", address: "x road", lat: 12.9 } })).status === 400, "latitude without longitude → 400");
ok((await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Zero", address: "x road", lat: 0, lng: 0 } })).status === 400, "(0,0) → 400");
ok((await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Str", address: "x road", lat: "12.9", lng: "77.6" } })).status === 400, "coordinates as strings → 400");
ok((await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Blank", address: "" } })).status === 400, "empty address → 400");
let dbRefused = false;
try { sql(`insert into "Property"(id,"customerId",title,address,lat,lng) values ('bad0','${cust.id}','t','a',0,0)`); } catch { dbRefused = true; }
ok(dbRefused, "the database itself refuses (0,0)");
ok((await admin("/api/properties", { method: "PATCH", body: { id: p.id, lat: null, lng: null, title: "Koramangala Flat 402" } })).status === 200 && (await getProp(p.id)).lat === 12.935192, "saving the form with empty coordinates keeps the saved pin");
ok((await admin("/api/properties", { method: "PATCH", body: { id: p.id, lat: 12.9 } })).status === 400 && (await getProp(p.id)).lat === 12.935192, "a half pin on edit is refused and the saved pin stays");
ok((await fmc("/api/properties", { method: "PATCH", body: { id: p.id, lat: 1, lng: 1 } })).status === 403, "Field Manager cannot edit a property's location");

console.log("--- Jobs use their property's location");
const j1 = await mkJob({ customerId: cust.id, propertyId: p.id, assignedManagerId: fm1 });
ok(j1?.locationSource === "PROPERTY" && j1.serviceLocation?.lat === 12.935192 && j1.serviceLocation.source === "PROPERTY", "a job for an existing property follows the property's pin");
ok(j1.propertyId === p.id && /Koramangala/.test(j1.serviceLocation.address), "the job references the selected property and its address");
const fmView = await getJob(fmc, j1.id);
ok(fmView?.serviceLocation?.lat === 12.935192 && fmView.serviceLocation.lng === 77.624481, "the Field Manager receives the same saved location for navigation");
const tok = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: j1.id } })).json?.data?.linkUrl?.split("/").pop();
let cp = (await anon(`/api/customer/job/${tok}`)).json?.data;
ok(cp?.location?.lat === 12.935192 && cp.location.lng === 77.624481, "the customer page shows the same location");

console.log("--- Editing the property moves its open jobs (only)");
const started = await mkJob({ customerId: cust.id, propertyId: p.id, assignedManagerId: fm1 });
await admin(`/api/jobs/${started.id}`, { method: "PATCH", body: { startVerificationMode: "DIRECT" } });
ok((await fmc(`/api/jobs/${started.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: {} } })).status === 200, "(a second job is started on site)");
ok((await admin("/api/properties", { method: "PATCH", body: { id: p.id, lat: 12.9361, lng: 77.6251, locationSource: "MAP_PIN" } })).status === 200, "the property pin is corrected (dragged on the map)");
p = await getProp(p.id);
ok(p.lat === 12.9361 && p.lng === 77.6251 && p.locationSource === "MAP_PIN", "the new pin is saved and survives a reload");
ok((await getJob(admin, j1.id)).serviceLocation.lat === 12.9361 && sql(`select "locationLat" from "Job" where id='${j1.id}'`) === "12.9361", "the open job now uses the corrected pin (API and database)");
ok(sql(`select "locationLat" from "Job" where id='${started.id}'`) === "12.935192", "a job already under way keeps the location it was started at");
cp = (await anon(`/api/customer/job/${tok}`)).json?.data;
ok(cp?.location?.lat === 12.9361, "the customer page follows the corrected pin");

console.log("--- A job with its own pin");
const own = await mkJob({ customerId: cust.id, propertyId: p.id, locationLat: 12.9372, locationLng: 77.6263, locationAddress: "Service entrance, 2nd Cross" });
ok(own?.locationSource === "JOB" && own.serviceLocation.lat === 12.9372 && own.serviceLocation.source === "JOB", "a different pin for one job is kept as the job's own");
await admin("/api/properties", { method: "PATCH", body: { id: p.id, lat: 12.9362, lng: 77.6252 } });
ok((await getJob(admin, own.id)).serviceLocation.lat === 12.9372, "moving the property does not move a job with its own pin");
ok((await admin(`/api/jobs/${own.id}`, { method: "PATCH", body: { location: { lat: null, lng: null, address: null } } })).status === 200 && (await getJob(admin, own.id)).serviceLocation.lat === 12.9372, "saving a job location with empty values keeps its pin");
ok((await admin(`/api/jobs/${own.id}`, { method: "PATCH", body: { location: { lat: 12.9, lng: null, address: null } } })).status === 400, "a half job pin is refused");
const back = await admin(`/api/jobs/${own.id}`, { method: "PATCH", body: { location: { lat: null, lng: null, address: null, followProperty: true } } });
ok(back.status === 200 && back.json?.data?.locationSource === "PROPERTY" && back.json.data.serviceLocation.lat === 12.9362, "“Use property's pin” makes the job follow the property again");

console.log("--- Missing coordinates: warnings, never a false location");
const noPin = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Unpinned", address: "12 Unknown Lane", city: "Mysuru", postalCode: "570001" } })).json?.data;
ok(noPin.lat === null && noPin.lng === null && noPin.address === "12 Unknown Lane", "an address-only property is saved with its typed address (geocoding not needed)");
const jn = await mkJob({ customerId: cust.id, propertyId: noPin.id, assignedManagerId: fm1 });
ok(jn.serviceLocation.lat === null && jn.serviceLocation.source === null && /Unknown Lane/.test(jn.serviceLocation.address), "a job at an unpinned property has no coordinates — only the address");
const tn = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: jn.id } })).json?.data?.linkUrl?.split("/").pop();
cp = (await anon(`/api/customer/job/${tn}`)).json?.data;
ok(cp?.location === null && /Unknown Lane/.test(cp?.property?.address ?? ""), "the customer page shows the address and no map pin (no substitute location)");
await admin(`/api/jobs/${jn.id}`, { method: "PATCH", body: { startVerificationMode: "GPS" } });
const r = await fmc(`/api/jobs/${jn.id}`, { method: "PATCH", body: { status: "ARRIVED", arrival: { lat: 12.3, lng: 76.6, accuracy: 10 } } });
ok(r.status === 409 && r.json?.code === "NO_SAVED_LOCATION", "GPS start is refused with a clear message — the phone's location is never used as the property's");
ok(sql(`select lat is null from "Property" where id='${noPin.id}'`) === "t", "…and the property still has no pin (device GPS never saved onto it)");
const jp = await mkJob({ customerId: cust.id, propertyId: noPin.id, locationLat: 12.3051, locationLng: 76.6551, saveLocationToProperty: true });
ok(jp.serviceLocation.lat === 12.3051 && (await getProp(noPin.id)).lat === 12.3051, "New Job: a pin set for an unpinned property can be saved on the property too");
ok((await getJob(admin, jn.id)).serviceLocation.lat === 12.3051, "…and the earlier open job at that property now has the location");

console.log("--- Different cities and postal codes");
const cities = [["Andheri flat", "12 Link Rd, Andheri West", "Mumbai", "Maharashtra", "400053", 19.1364, 72.8296], ["CP office", "Block A, Connaught Place", "New Delhi", "Delhi", "110001", 28.6315, 77.2167], ["T Nagar home", "4 Usman Rd, T Nagar", "Chennai", "Tamil Nadu", "600017", 13.0418, 80.2341]];
for (const [title, address, city, state, postalCode, lat, lng] of cities) {
  const x = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title, address, city, state, postalCode, lat, lng } })).json?.data;
  const y = await getProp(x.id);
  const j = await mkJob({ customerId: cust.id, propertyId: x.id });
  ok(y.city === city && y.postalCode === postalCode && y.lat === lat && y.lng === lng && j.serviceLocation.lat === lat && j.serviceLocation.address.includes(postalCode), `${city} ${postalCode}: property and job agree on ${lat}, ${lng}`);
}

console.log("--- Customer + other property: jobs never use the customer's general address");
const second = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "Weekend house", address: "Plot 9, Nandi Hills Rd", city: "Chikkaballapur", lat: 13.37, lng: 77.68 } })).json?.data;
const js = await mkJob({ customerId: cust.id, propertyId: second.id });
ok(js.serviceLocation.lat === 13.37 && /Nandi Hills/.test(js.serviceLocation.address) && !/HQ/.test(js.serviceLocation.address), "a customer with several properties: each job uses its selected property");
ok((await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: "nope", serviceId: svc.id, scheduledDate: "2027-01-16", scheduledTimeSlot: "09:00 - 10:00" } })).status >= 400, "a job can't be created for a property that doesn't exist");

console.log("--- Repair log");
ok(sql(`select count(*) from information_schema.tables where table_name='LocationRepair'`) === "1", "LocationRepair table exists for audited corrections");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
