// Location health check for existing data.
//
//   DATABASE_URL=… node scripts/location-diagnose.mjs            # report only (read-only)
//   DATABASE_URL=… node scripts/location-diagnose.mjs --apply    # also apply the SAFE corrections
//   DATABASE_URL=… node scripts/location-diagnose.mjs --json     # machine-readable report
//
// Safe corrections (each one is written to "LocationRepair" first):
//   - a pin saved as lng,lat (outside India, inside India once swapped) is swapped back
//   - an open job with no pin takes its property's saved pin
// Everything else is REPORTED for a person to fix (wrong pin, missing pin, no
// address) — the script never invents a location and never overwrites a good one.
import pg from "pg";
import { randomUUID } from "node:crypto";

const APPLY = process.argv.includes("--apply");
const JSON_OUT = process.argv.includes("--json");
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL.");
  process.exit(2);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const IN = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };
const inIndia = (lat, lng) => lat >= IN.minLat && lat <= IN.maxLat && lng >= IN.minLng && lng <= IN.maxLng;
const valid = (lat, lng) => typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const OPEN = ["DRAFT", "SCHEDULED", "ASSIGNED"];
const R = 6371000;
const dist = (a, b, c, d) => {
  const t = (x) => (x * Math.PI) / 180;
  const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const props = (await db.query(`select id, title, address, city, "postalCode", lat, lng, "customerId" from "Property"`)).rows;
const jobs = (await db.query(`select id, "jobSerial", status, "propertyId", "locationLat", "locationLng", "locationAddress", "locationSource" from "Job"`)).rows;
const propById = new Map(props.map((p) => [p.id, p]));

const findings = [];
const add = (severity, entityType, entityId, label, problem, fix) => findings.push({ severity, entityType, entityId, label, problem, fix });

for (const p of props) {
  const label = `${p.title} (${p.address || "no address"})`;
  if (p.lat === null && p.lng === null) add("warn", "property", p.id, label, "No saved map pin", "Open the property → Edit → set the pin (search the address or drop the pin)");
  else if (!valid(p.lat, p.lng)) add("error", "property", p.id, label, `Invalid coordinates ${p.lat},${p.lng}`, "Clear and set the pin again");
  else if (!inIndia(p.lat, p.lng) && inIndia(p.lng, p.lat)) add("error", "property", p.id, label, `Latitude/longitude look swapped (${p.lat},${p.lng})`, "SAFE: swap them");
  else if (!inIndia(p.lat, p.lng)) add("warn", "property", p.id, label, `Pin is outside India (${p.lat},${p.lng})`, "Check the pin");
  if (!String(p.address ?? "").trim()) add("warn", "property", p.id, label, "No address text", "Add the full address");
  if (!String(p.city ?? "").trim() && !String(p.postalCode ?? "").trim()) add("info", "property", p.id, label, "No city or postal code", "Add them for search and documents");
}
for (const j of jobs) {
  const p = propById.get(j.propertyId);
  const label = `${j.jobSerial} [${j.status}]`;
  if (!p) {
    add("error", "job", j.id, label, "Job points to a property that doesn't exist", "Re-link the job to the right property");
    continue;
  }
  const hasJob = valid(j.locationLat, j.locationLng);
  const hasProp = valid(p.lat, p.lng);
  if (!hasJob && hasProp && OPEN.includes(j.status)) add("warn", "job", j.id, label, "Open job has no pin but its property has one", "SAFE: copy the property's pin");
  else if (!hasJob && !hasProp) add(OPEN.includes(j.status) ? "warn" : "info", "job", j.id, label, "No pin on the job or its property", "Set the property's pin");
  if (hasJob && !inIndia(j.locationLat, j.locationLng) && inIndia(j.locationLng, j.locationLat)) add("error", "job", j.id, label, `Latitude/longitude look swapped (${j.locationLat},${j.locationLng})`, "SAFE: swap them");
  if (hasJob && hasProp && j.locationSource === "JOB") {
    const d = Math.round(dist(j.locationLat, j.locationLng, p.lat, p.lng));
    if (d > 2000) add("warn", "job", j.id, label, `Job's own pin is ${d} m from its property's pin`, "Check that the job uses the right property");
  }
  if (hasJob && hasProp && j.locationSource !== "JOB") {
    const d = Math.round(dist(j.locationLat, j.locationLng, p.lat, p.lng));
    if (d > 1 && OPEN.includes(j.status)) add("warn", "job", j.id, label, `Open job follows the property but its pin is ${d} m away (stale copy)`, "SAFE: copy the property's pin");
  }
}

const applied = [];
if (APPLY) {
  await db.query("BEGIN");
  try {
    const log = (entityType, entityId, action, oldValue, newValue, reason) =>
      db.query(`insert into "LocationRepair"(id,"entityType","entityId",action,"oldValue","newValue",reason) values ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), entityType, entityId, action, oldValue, newValue, reason]);
    // Property corrections first, so a job that copies its property's pin gets the corrected one.
    const safe = findings.filter((x) => x.fix.startsWith("SAFE")).sort((a, b) => (a.entityType === b.entityType ? 0 : a.entityType === "property" ? -1 : 1));
    for (const f of safe) {
      if (f.entityType === "property" && f.problem.startsWith("Latitude/longitude look swapped")) {
        const p = propById.get(f.entityId);
        await log("property", p.id, "SWAPPED_LAT_LNG", `${p.lat},${p.lng}`, `${p.lng},${p.lat}`, "Saved as longitude,latitude");
        await db.query(`update "Property" set lat=$1, lng=$2, "locationUpdatedAt"=now() where id=$3 and lat=$2 and lng=$1`, [p.lng, p.lat, p.id]);
        propById.set(p.id, { ...p, lat: p.lng, lng: p.lat });
        applied.push(f);
      } else if (f.entityType === "job" && f.problem.startsWith("Latitude/longitude look swapped")) {
        const j = jobs.find((x) => x.id === f.entityId);
        await log("job", j.id, "SWAPPED_LAT_LNG", `${j.locationLat},${j.locationLng}`, `${j.locationLng},${j.locationLat}`, "Saved as longitude,latitude");
        await db.query(`update "Job" set "locationLat"=$1, "locationLng"=$2 where id=$3 and "locationLat"=$2 and "locationLng"=$1`, [j.locationLng, j.locationLat, j.id]);
        applied.push(f);
      } else if (f.entityType === "job") {
        const j = jobs.find((x) => x.id === f.entityId);
        const p = propById.get(j.propertyId);
        await log("job", j.id, "COPIED_PROPERTY_PIN", j.locationLat === null ? null : `${j.locationLat},${j.locationLng}`, `${p.lat},${p.lng}`, f.problem);
        await db.query(`update "Job" set "locationLat"=$1, "locationLng"=$2, "locationSource"='PROPERTY' where id=$3 and status = any($4)`, [p.lat, p.lng, j.id, OPEN]);
        applied.push(f);
      }
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
const repairs = (await db.query(`select "entityType","entityId",action,"oldValue","newValue",reason,"createdAt" from "LocationRepair" order by "createdAt"`).catch(() => ({ rows: [] }))).rows;
await db.end();

const summary = {
  properties: props.length,
  propertiesWithPin: props.filter((p) => valid(p.lat, p.lng)).length,
  jobs: jobs.length,
  jobsWithPin: jobs.filter((j) => valid(j.locationLat, j.locationLng)).length,
  findings: findings.length,
  applied: applied.length,
  repairsLogged: repairs.length,
};
if (JSON_OUT) {
  console.log(JSON.stringify({ summary, findings, applied, repairs }, null, 2));
} else {
  console.log("Location health\n===============");
  for (const [k, v] of Object.entries(summary)) console.log(`${k.padEnd(18)} ${v}`);
  for (const sev of ["error", "warn", "info"]) {
    const list = findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    console.log(`\n${sev.toUpperCase()} (${list.length})`);
    for (const f of list) console.log(`  ${f.entityType} ${f.label}: ${f.problem} → ${f.fix}`);
  }
  if (APPLY) console.log(`\nApplied ${applied.length} safe correction(s).`);
  else if (findings.some((f) => f.fix.startsWith("SAFE"))) console.log("\nRun with --apply to make the SAFE corrections (each is logged in LocationRepair).");
  if (repairs.length) {
    console.log(`\nCorrections on record (${repairs.length}):`);
    for (const r of repairs) console.log(`  ${r.entityType} ${r.entityId}: ${r.action} ${r.oldValue ?? "∅"} → ${r.newValue ?? "∅"} (${r.reason})`);
  }
}
