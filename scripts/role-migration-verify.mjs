// Role-merge migration verification on a POPULATED legacy database.
//   1. creates a scratch DB at the schema as it was BEFORE 20261024000000_merge_field_manager_qc
//   2. seeds legacy Field Manager / QC users, a job, a QC record and audit rows
//   3. applies the merge migration
//   4. boots the ERP against it and checks logins, preserved data and the new rules
// Usage: ADMIN_DB_URL=postgresql://postgres:…@localhost:5432/postgres node scripts/role-migration-verify.mjs
// (needs a production build: `npm run build`)
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import bcrypt from "bcryptjs";

const ADMIN = process.env.ADMIN_DB_URL || process.env.DATABASE_URL?.replace(/\/[^/]+$/, "/postgres");
const DB = "ic_mig";
const URL_ = ADMIN.replace(/\/[^/]+$/, `/${DB}`);
const PORT = 3101, BASE = `http://localhost:${PORT}`;
const MIG = "prisma/migrations";
const MERGE = "20261024000000_merge_field_manager_qc";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const psql = (url, q) => execSync(`psql "${url}" -v ON_ERROR_STOP=1 -tA -c ${JSON.stringify(q).replace(/\$/g, "\\$")}`).toString().trim();
const sql = (q) => psql(URL_, q);

psql(ADMIN, `DROP DATABASE IF EXISTS ${DB}`);
psql(ADMIN, `CREATE DATABASE ${DB}`);
for (const d of fs.readdirSync(MIG).filter((d) => fs.existsSync(`${MIG}/${d}/migration.sql`)).sort()) {
  if (d >= MERGE) continue;
  execSync(`psql "${URL_}" -v ON_ERROR_STOP=1 -q -f ${MIG}/${d}/migration.sql`, { stdio: "pipe" });
}
console.log("--- legacy schema ready (migrations before the merge applied)");

const pw = await bcrypt.hash("legacypass1", 6);
const users = [
  ["u_admin", "admin@mig.local", "admin"],
  ["u_fm", "fm@mig.local", "field_manager"],
  ["u_fm2", "fm2@mig.local", "field_manager"],
  ["u_fs", "fs@mig.local", "field_staff"],
  ["u_qc", "qc@mig.local", "qc_inspector"],
  ["u_qc2", "qc2@mig.local", "qc"],
  ["u_tax", "tax@mig.local", "tax_officer"],
];
for (const [id, email, role] of users)
  sql(`insert into "User"(id,name,email,phone,role,"passwordHash") values ('${id}','${role} user','${email}','+9199000000${id.length}','${role}','${pw}')`);
sql(`insert into "Customer"(id,name,phone) values ('c1','Legacy Customer','+919811111111')`);
sql(`insert into "Property"(id,"customerId",title,address) values ('p1','c1','Legacy Flat','1 Old Rd')`);
sql(`insert into "Service"(id,name,slug,description,"basePrice","estimatedDurationHours") values ('s1','Legacy Service','legacy','d',100,1)`);
sql(`insert into "Job"(id,"jobSerial","customerId","propertyId","serviceId","scheduledDate","scheduledTimeSlot",amount,status,"assignedManagerId","updatedAt") values ('j1',1,'c1','p1','s1',now(),'09:00 - 10:00',100,'WORK_COMPLETED','u_fm',now())`);
sql(`insert into "Job"(id,"jobSerial","customerId","propertyId","serviceId","scheduledDate","scheduledTimeSlot",amount,status,"assignedManagerId","updatedAt") values ('j2',2,'c1','p1','s1',now(),'11:00 - 12:00',100,'ASSIGNED','u_fm',now())`);
sql(`insert into "QualityCheck"(id,"jobId","inspectorId",score,decision) values ('q1','j1','u_qc',90,'PASS')`);
sql(`insert into "AuditLog"(id,action,"performedBy","entityType","entityId") values ('a1','QC_PASSED','u_qc','Job','j1'),('a2','JOB_ASSIGNED','u_admin','Job','j1')`);
const before = sql(`select id||'|'||email||'|'||"passwordHash"||'|'||active from "User" order by id`);
const counts = () => ["User", "Job", "QualityCheck", "AuditLog", "Customer"].map((t) => `${t}=${sql(`select count(*) from "${t}"`)}`).join(",");
const cBefore = counts();

execSync(`psql "${URL_}" -v ON_ERROR_STOP=1 -q -f ${MIG}/${MERGE}/migration.sql`, { stdio: "pipe" });
console.log("--- merge migration applied");

ok(sql(`select count(*) from "User" where role in ('field_manager','field_staff','qc_inspector','qc','staff')`) === "0", "no user keeps a legacy FM/QC role");
ok(sql(`select count(*) from "User" where role='field_operations_manager'`) === "5", "5 FM/QC users became Field Operations Manager");
ok(sql(`select role from "User" where id in ('u_admin','u_tax') order by id`) === "admin\ntax_officer", "Admin and Tax Officer untouched");
ok(sql(`select count(*) from "RoleMigration"`) === "5", "RoleMigration records one row per migrated user");
ok(sql(`select "previousRole" from "RoleMigration" where "userId"='u_qc'`) === "qc_inspector", "previous role (qc_inspector) is retained");
ok(sql(`select id||'|'||email||'|'||"passwordHash"||'|'||active from "User" order by id`) === before, "user ids, emails, password hashes and active flags unchanged");
ok(counts() === cBefore, `no rows deleted or created (${cBefore})`);
ok(sql(`select "assignedManagerId" from "Job" where id='j1'`) === "u_fm", "job assignment preserved");
ok(sql(`select "inspectorId"||'|'||decision from "QualityCheck" where id='q1'`) === "u_qc|PASS", "legacy QC record preserved");
ok(sql(`select count(*) from "AuditLog" where action='QC_PASSED' and "performedBy"='u_qc'`) === "1", "audit log rows preserved");
ok(sql(`select "inspectorOnCrew" from "QualityCheck" where id='q1'`) === "f" && sql(`select "startedAt" is null from "QualityCheck" where id='q1'`) === "t", "new QC columns exist; legacy rows default safely");
// idempotent re-run
execSync(`psql "${URL_}" -v ON_ERROR_STOP=1 -q -f ${MIG}/${MERGE}/migration.sql`, { stdio: "pipe" });
ok(sql(`select count(*) from "RoleMigration"`) === "5", "re-running the migration is a no-op");

const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env: { ...process.env, DATABASE_URL: URL_, APP_BASE_URL: BASE, PORT: String(PORT) }, stdio: "pipe" });
let slog = ""; server.stdout.on("data", (d) => (slog += d)); server.stderr.on("data", (d) => (slog += d));
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/login")).status < 500) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }

function client() {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}
const login = async (email) => { const c = client(); const r = await c("/api/auth/login", { method: "POST", body: { email, password: "legacypass1" } }); return { c, r }; };
try {
  console.log("--- legacy users log in with their existing passwords");
  const sessions = {};
  for (const e of ["fm", "fm2", "fs", "qc", "qc2", "admin", "tax"]) {
    const { c, r } = await login(`${e}@mig.local`); sessions[e] = c;
    ok(r.status === 200, `${e}@mig.local logs in (${r.status})`);
  }
  for (const e of ["fm", "fs", "qc", "qc2"]) {
    const me = (await sessions[e]("/api/me/workspace")).json?.data;
    ok(me?.role === "field_operations_manager" || me?.workspace?.role === "field_operations_manager" || JSON.stringify(me ?? {}).includes("field_operations_manager"), `${e}: resolves to Field Operations Manager workspace`);
  }
  const jobFm = await sessions.fm("/api/jobs/j1");
  ok(jobFm.status === 200, "former Field Manager still sees their assigned job");
  ok((await sessions.fm2("/api/jobs/j2")).status !== 200, "another former FM cannot open a job assigned to someone else (not in the QC pipeline)");
ok((await sessions.fm2("/api/jobs/j1")).status === 200, "a job awaiting QC is visible to every Field Operations Manager (QC window)");
  const jobQc = await sessions.qc("/api/jobs/j1");
  ok(jobQc.status === 200, "former QC user can open the job awaiting QC (QC window)");
  const quality = await sessions.qc("/api/quality");
  ok(quality.status === 200 && JSON.stringify(quality.json).includes("q1"), "legacy QC history visible to the QC user");

  console.log("--- separation of duties");
  const sod = (await sessions.admin("/api/settings")).json?.data?.qualityControl;
  ok(sod?.separationOfDuties === true, "setting defaults to ON for a migrated database");
  const own = await sessions.fm("/api/quality", { method: "POST", body: { action: "start-inspection", jobId: "j1" } });
  ok(own.status === 403, `assigned crew member cannot inspect their own job (${own.status})`);
  ok(sql(`select count(*) from "AuditLog" where action='QC_SEPARATION_BLOCKED'`) !== "0", "blocked attempt is audited (QC_SEPARATION_BLOCKED)");
  const other = await sessions.qc("/api/quality", { method: "POST", body: { action: "start-inspection", jobId: "j1" } });
  ok([200, 201].includes(other.status), `a different Field Operations Manager can start the inspection (${other.status})`);
  ok(sql(`select "qcStartedBy" from "Job" where id='j1'`) === "u_qc", "inspection start is attributed to the inspector");
  await sessions.admin("/api/settings", { method: "PATCH", body: { qualityControl: { separationOfDuties: false } } });
  const owner2 = await sessions.fm("/api/quality", { method: "POST", body: { action: "start-inspection", jobId: "j1" } });
  ok(owner2.status !== 403 || !JSON.stringify(owner2.json).includes("separation"), "when Admin turns the rule off, the self-inspection restriction is lifted explicitly");
  await sessions.admin("/api/settings", { method: "PATCH", body: { qualityControl: { separationOfDuties: true } } });

  console.log("--- unauthorized access & user management");
  ok((await sessions.fm("/api/users")).status === 403, "Field Operations Manager cannot list/manage users");
  ok((await sessions.fm("/api/settings", { method: "PATCH", body: { qualityControl: { separationOfDuties: false } } })).status === 403, "Field Operations Manager cannot change QC policy");
  ok((await sessions.tax("/api/quality", { method: "POST", body: { action: "start-inspection", jobId: "j1" } })).status === 403, "Tax Officer cannot perform QC");
  for (const legacy of ["field_manager", "qc_inspector"]) {
    const r = await sessions.admin("/api/users", { method: "POST", body: { name: "X", email: `${legacy}@mig.local`, phone: "+919800000001", role: legacy, password: "Passw0rd!x" } });
    ok(r.status === 400, `creating a user with legacy role ${legacy} is rejected (${r.status})`);
  }
  const mk = await sessions.admin("/api/users", { method: "POST", body: { name: "New FOM", email: "newfom@mig.local", phone: "+919800000002", role: "field_operations_manager", password: "Passw0rd!x" } });
  ok(mk.status === 200 || mk.status === 201, `Admin can create a Field Operations Manager (${mk.status})`);
} finally {
  server.kill();
  execSync(`fuser -k ${PORT}/tcp || true`, { stdio: "ignore", shell: "/bin/bash" });
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(slog.slice(-1500)); process.exit(1); }
