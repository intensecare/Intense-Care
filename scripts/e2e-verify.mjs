/**
 * Production-readiness e2e suite — drives the REAL HTTP API with assertions.
 * Usage: node scripts/e2e-verify.mjs
 * Requires: dev server on :3000, seeded superadmin.
 * Credentials come from env (QA_ADMIN_PW / QA_OPS_PW / QA_STAFF_PW); the admin
 * email is resolved from the user directory (first super_admin) — nothing is
 * hardcoded.
 */
const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

async function req(jar, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(jar.cookie ? { cookie: jar.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && jar) jar.cookie = setCookie.split(";")[0];
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const admin = {};
const ops = {};
const staff = {};
const staff2 = {};

async function main() {
  // ============ 1. AUTH ============
  section("1. Authentication & RBAC");
  // Resolve the super_admin account dynamically (no hardcoded emails).
  let bootstrap = {};
  const bootPw = process.env.QA_ADMIN_PW;
  if (!bootPw) {
    console.log("Set QA_ADMIN_PW (and optionally QA_OPS_PW / QA_STAFF_PW) in the environment.");
    process.exit(1);
  }
  // Login probe: try common seeded admin emails only via env override.
  const adminEmail = process.env.QA_ADMIN_EMAIL;
  if (!adminEmail) {
    console.log("Set QA_ADMIN_EMAIL in the environment.");
    process.exit(1);
  }
  let r = await req(admin, "POST", "/api/auth/login", { email: adminEmail, password: bootPw });
  ok("superadmin login 200", r.status === 200 && r.json?.data?.role === "super_admin", JSON.stringify(r.json));

  r = await req(admin, "POST", "/api/auth/login", { email: adminEmail, password: "definitely-not-the-password" });
  ok("wrong password rejected", r.status === 401 || r.status === 400, `got ${r.status}`);

  // find ops + staff accounts from directory
  r = await req(admin, "GET", "/api/users");
  const dir = r.json?.data || [];
  const opsAcc = dir.find((u) => u.role === "ops_manager");
  const staffAccs = dir.filter((u) => u.role === "staff" && u.active);
  ok("directory has ops_manager", !!opsAcc);
  ok("directory has >=1 active staff", staffAccs.length > 0);
  if (!opsAcc || staffAccs.length === 0) {
    console.log("Cannot continue without ops/staff accounts — seed them in Users & Roles.");
    process.exit(1);
  }
  r = await req(ops, "POST", "/api/auth/login", { email: opsAcc.email, password: process.env.QA_OPS_PW || "" });
  if (r.status !== 200) {
    // ops password unknown — reset it directly via admin API
    const opsPw = "qa-ops-" + Date.now().toString(36);
    r = await req(admin, "PATCH", "/api/users", { id: opsAcc.id, password: opsPw });
    r = await req(ops, "POST", "/api/auth/login", { email: opsAcc.email, password: opsPw });
  }
  ok("ops_manager login", r.status === 200 && r.json?.data?.role === "ops_manager");

  const staffPw = "qa-staff-" + Date.now().toString(36);
  r = await req(staff, "POST", "/api/auth/login", { email: staffAccs[0].email, password: process.env.QA_STAFF_PW || "" });
  if (r.status !== 200) {
    await req(admin, "PATCH", "/api/users", { id: staffAccs[0].id, password: staffPw });
    r = await req(staff, "POST", "/api/auth/login", { email: staffAccs[0].email, password: staffPw });
  }
  ok("staff login", r.status === 200);
  if (staffAccs[1]) {
    await req(admin, "PATCH", "/api/users", { id: staffAccs[1].id, password: staffPw + "-b" });
    await req(staff2, "POST", "/api/auth/login", { email: staffAccs[1].email, password: staffPw + "-b" });
  }

  r = await req({}, "GET", "/api/jobs");
  ok("unauthenticated /api/jobs 401", r.status === 401, `got ${r.status}`);

  // ============ 2. RBAC: financial lockout ============
  section("2. RBAC — financial data lockout");
  r = await req(ops, "GET", "/api/finance");
  ok("ops /api/finance 403", r.status === 403, `got ${r.status}`);
  r = await req(ops, "GET", "/api/referrals");
  ok("ops /api/referrals 403", r.status === 403, `got ${r.status}`);
  r = await req(ops, "GET", "/api/audit");
  ok("ops /api/audit 403", r.status === 403, `got ${r.status}`);
  r = await req(ops, "GET", "/api/users");
  ok("ops /api/users (directory) 403", r.status === 403, `got ${r.status}`);
  r = await req(ops, "PUT", "/api/users");
  ok("ops staff-directory 200", r.status === 200 && Array.isArray(r.json?.data));
  const staffDir = r.json?.data || [];
  ok("staff directory has no email/role fields", staffDir.every((s) => !("email" in s) && !("role" in s)));
  r = await req(staff, "GET", "/api/finance");
  ok("staff /api/finance 403", r.status === 403, `got ${r.status}`);
  r = await req(admin, "GET", "/api/finance");
  ok("admin /api/finance 200", r.status === 200);

  // ============ 3. Company-authored catalog ============
  section("3. Service catalog & rubric (company-authored)");
  r = await req(admin, "GET", "/api/services");
  ok("admin GET services 200", r.status === 200);
  const startingCount = r.json?.data?.length || 0;

  r = await req(ops, "POST", "/api/services", { name: "X Test Svc", category: "residential", basePrice: 1000, estimatedDurationHours: 2 });
  ok("ops CANNOT create service", r.status === 403, `got ${r.status}`);

  r = await req(admin, "POST", "/api/services", {
    name: "QA Verify Service",
    category: "residential",
    description: "e2e",
    basePrice: 4000,
    estimatedDurationHours: 3,
    checklistTemplate: [
      { area: "Kitchen", task: "QA degrease", critical: true },
      { area: "Bath", task: "QA descale", critical: false },
    ],
  });
  ok("admin creates service + rubric", r.status === 201 && r.json?.data?.checklistTemplate?.length === 2, JSON.stringify(r.json).slice(0, 120));
  const svc = r.json?.data;

  r = await req(admin, "POST", "/api/services", { name: "QA Verify Service", category: "residential", basePrice: 1, estimatedDurationHours: 1 });
  ok("duplicate service name handled (slug uniquified, 201)", r.status === 201);
  const dupSvc = r.json?.data;
  if (dupSvc) await req(admin, "DELETE", "/api/services", { id: dupSvc.id });

  // ============ 4. Booking ============
  section("4. Booking creation (transactional)");
  r = await req(admin, "POST", "/api/customers", { name: "QA Verify Customer", phone: "+91 98765 43210", address: "1 Test Lane, Bengaluru" });
  ok("customer created", r.status === 201, JSON.stringify(r.json).slice(0, 120));
  const cust = r.json?.data;
  const phoneStored = cust?.phone;
  ok("phone stored in +91 format", phoneStored === "+91 98765 43210", phoneStored);

  r = await req(admin, "POST", "/api/properties", { customerId: cust.id, title: "QA Villa", address: "1 Test Lane", propertyType: "villa" });
  ok("property created", r.status === 201, JSON.stringify(r.json).slice(0, 100));
  const prop = r.json?.data;

  r = await req(ops, "POST", "/api/jobs", { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: "2099-01-01", scheduledTimeSlot: "09:00 AM - 01:30 PM" });
  ok("ops CANNOT create booking outside window (future date)", r.status === 409, `got ${r.status}`);
  r = await req(admin, "POST", "/api/jobs", { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: "2099-01-01", scheduledTimeSlot: "09:00 AM - 01:30 PM", assignedStaffIds: [] });
  ok("admin booking 201", r.status === 201, JSON.stringify(r.json).slice(0, 150));
  const booking = r.json?.data;
  const job = booking?.job;
  ok("job SCHEDULED with 0 workers", job?.status === "SCHEDULED");
  ok("invoice auto-created with GST", booking?.invoice?.total === 4000 * 1.18, JSON.stringify(booking?.invoice));
  ok("checklist instantiated from rubric (2 items)", booking?.checklist?.length === 2);

  // ops window: today-dated job visible; future job not
  const today = new Date();
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  r = await req(admin, "POST", "/api/jobs", { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: fmt(today), scheduledTimeSlot: "02:00 PM - 06:30 PM" });
  const jobToday = r.json?.data?.job;
  ok("today-dated booking created", r.status === 201);
  r = await req(ops, "GET", "/api/jobs");
  const opsJobIds = (r.json?.data || []).map((j) => j.id);
  ok("ops sees today's job", opsJobIds.includes(jobToday.id));
  ok("ops does NOT see 2099 job", !opsJobIds.includes(job.id));
  const opsJob = (r.json?.data || []).find((j) => j.id === jobToday.id);
  ok("ops job payload redacted (no amount/paymentStatus)", opsJob && !("amount" in opsJob) && !("paymentStatus" in opsJob), JSON.stringify(Object.keys(opsJob || {})));

  // ============ 5. Assignment + double-booking guard ============
  section("5. Staff assignment & double-booking guard");
  r = await req(staff, "PATCH", `/api/jobs/${jobToday.id}`, { assignedStaffIds: [staffAccs[0].id] });
  ok("staff CANNOT assign workers", r.status === 403, `got ${r.status}`);

  r = await req(ops, "PATCH", `/api/jobs/${jobToday.id}`, { assignedStaffIds: [staffAccs[0].id] });
  ok("ops assigns worker A", r.status === 200 && r.json?.data?.assignedStaffIds?.length === 1);
  ok("job auto-ASSIGNED after assignment", r.json?.data?.status === "ASSIGNED");
  ok("ops assignment response redacted", !("amount" in (r.json?.data || {})));

  // second job, same date+slot → conflict
  r = await req(admin, "POST", "/api/jobs", { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: fmt(today), scheduledTimeSlot: "02:00 PM - 06:30 PM" });
  const jobClash = r.json?.data?.job;
  r = await req(ops, "PATCH", `/api/jobs/${jobClash.id}`, { assignedStaffIds: [staffAccs[0].id] });
  ok("double-booking same slot 409", r.status === 409, `got ${r.status}`);
  r = await req(ops, "PATCH", `/api/jobs/${jobClash.id}`, { assignedStaffIds: ["usr-nonexistent"] });
  ok("phantom worker id rejected 400", r.status === 400, `got ${r.status}`);

  // Free from/to time window — canonical "HH:MM - HH:MM" (24h)
  section("5b. Free from/to time window");
  r = await req(admin, "POST", "/api/jobs", { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: fmt(today), scheduledTimeSlot: "10:30 - 15:00" });
  ok("booking accepts manually-set from/to window", r.status === 201 && r.json?.data?.job?.scheduledTimeSlot === "10:30 - 15:00", JSON.stringify(r.json).slice(0, 150));
  r = await req(admin, "POST", "/api/jobs", { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: fmt(today), scheduledTimeSlot: "whenever" });
  ok("invalid time window rejected 400", r.status === 400, `got ${r.status}`);

  // Reassignment & persistence (same PATCH path the job-console modal uses)
  r = await req(ops, "PATCH", `/api/jobs/${jobToday.id}`, { assignedStaffIds: [staffAccs[0].id, staffAccs[1].id] });
  ok("ops reassigns multiple workers", r.status === 200 && r.json?.data?.assignedStaffIds?.length === 2, JSON.stringify(r.json?.data?.assignedStaffIds));
  r = await req(ops, "PATCH", `/api/jobs/${jobToday.id}`, { assignedStaffIds: [staffAccs[1].id] });
  ok("reassignment can drop a worker", r.status === 200 && r.json?.data?.assignedStaffIds?.length === 1);
  ok("status stays ASSIGNED after partial reassignment", r.json?.data?.status === "ASSIGNED");
  r = await req(ops, "GET", "/api/jobs");
  const persistedCrew = (r.json?.data || []).find((j) => j.id === jobToday.id);
  ok("assignment persisted in DB (list shows new crew)", persistedCrew?.assignedStaffIds?.[0] === staffAccs[1].id, JSON.stringify(persistedCrew?.assignedStaffIds));
  // Restore the original lead for the OTP section below (it expects worker A)
  r = await req(ops, "PATCH", `/api/jobs/${jobToday.id}`, { assignedStaffIds: [staffAccs[0].id] });
  ok("restore original lead assignment", r.status === 200, `got ${r.status}`);

  // ============ 6. OTP lifecycle (policy only — no real SMS fired) ============
  section("6. OTP policy gates (no SMS fired)");
  // Rita (staff jar) IS the assigned lead on jobToday (status ASSIGNED):
  // wrong-status send must be 409, and authz (403) fires before status for
  // workers who are not assigned at all.
  r = await req(staff, "POST", "/api/otp/send", { jobId: jobToday.id });
  ok("OTP send on ASSIGNED job 409 (wrong_status, not ARRIVED)", r.status === 409, `got ${r.status}`);
  r = await req(staff, "POST", "/api/otp/send", { jobId: jobClash.id });
  ok("unassigned worker OTP send 403 (authz precedes state)", r.status === 403, `got ${r.status}`);
  r = await req(staff2, "POST", "/api/jobs/" + jobToday.id, { method: "X" });
  // staff2 (not assigned) tries to send OTP
  r = await req(staff2, "POST", "/api/otp/send", { jobId: jobToday.id });
  ok("non-assigned worker OTP send 403", r.status === 403, `got ${r.status}`);
  r = await req(admin, "POST", "/api/otp/verify", { jobId: jobToday.id, code: "123456" });
  ok("verify without challenge 404/409", r.status === 404 || r.status === 409, `got ${r.status}`);
  r = await req(admin, "PATCH", `/api/jobs/${jobToday.id}`, { status: "CUSTOMER_VERIFIED" });
  ok("PATCH cannot forge CUSTOMER_VERIFIED (409)", r.status === 409, `got ${r.status}`);
  r = await req(admin, "PATCH", `/api/jobs/${jobToday.id}`, { status: "ARRIVED" });
  ok("manager can mark ARRIVED", r.status === 200 && r.json?.data?.status === "ARRIVED", JSON.stringify(r.json).slice(0, 120));
  r = await req(staff2, "POST", "/api/jobs/" + jobToday.id, { method: "X" });
  r = await req(staff2, "PATCH", `/api/jobs/${jobToday.id}`, { status: "IN_PROGRESS" });
  ok("non-assigned staff transition 403", r.status === 403, `got ${r.status}`);

  // ============ 7. QC / rework / completion ============
  section("7. QC, rework, completion & commission");
  r = await req(admin, "PATCH", `/api/jobs/${jobToday.id}`, { status: "IN_PROGRESS" });
  ok("manager IN_PROGRESS", r.json?.data?.status === "IN_PROGRESS");
  r = await req(admin, "PATCH", `/api/jobs/${jobToday.id}`, { status: "WORK_COMPLETED" });
  ok("manager WORK_COMPLETED", r.json?.data?.status === "WORK_COMPLETED");
  r = await req(ops, "POST", "/api/quality", {
    action: "submit-check", jobId: jobToday.id, score: 55, decision: "REWORK_REQUIRED",
    notes: "QA rework", issues: [{ area: "Kitchen", itemDescription: "Grease left", severity: "major", notes: "redo" }],
  });
  ok("ops submits QC rework", r.status === 201 || r.status === 200, `got ${r.status}`);
  r = await req(admin, "GET", "/api/jobs");
  let jr = (r.json?.data || []).find((j) => j.id === jobToday.id);
  ok("job now REWORK_REQUIRED", jr?.status === "REWORK_REQUIRED", jr?.status);
  r = await req(ops, "GET", "/api/quality");
  const qdata = r.json?.data || {};
  const task = (qdata.reworkTasks || []).find((t) => t.jobId === jobToday.id);
  ok("rework task created", !!task);
  r = await req(ops, "POST", "/api/quality", { action: "complete-rework", taskId: task.id, notes: "done" });
  ok("rework completed", r.status === 200, `got ${r.status}`);
  r = await req(ops, "POST", "/api/quality", { action: "reinspect-pass", jobId: jobToday.id, notes: "verified" });
  ok("reinspect-pass → CUSTOMER_APPROVAL", r.status === 200, `got ${r.status}`);
  // completion link + sign-off
  r = await req(admin, "POST", `/api/jobs/${jobToday.id}/completion-link`, {});
  ok("completion link minted", r.status === 201 || r.status === 200, `got ${r.status}`);
  const linkPath = r.json?.data?.linkPath;
  ok("linkPath is a portal path", !!linkPath && linkPath.startsWith("/portal/"), linkPath);
  // fetch portal payload publicly
  const token = linkPath?.split("/portal/")[1];
  const pres = await fetch(BASE + `/api/portal/${token}`);
  const pjson = await pres.json().catch(() => null);
  ok("public portal resolves handover", pjson?.success === true && pjson?.data?.job?.id === jobToday.id);
  ok("portal exposes serviceName (not packageTier)", "serviceName" in (pjson?.data?.job || {}) && !("packageTier" in (pjson?.data?.job || {})));
  const sres = await fetch(BASE + `/api/portal/${token}/sign`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "APPROVED", signatoryName: "QA Tester" }),
  });
  ok("customer sign-off → COMPLETED", sres.status === 200, `got ${sres.status}`);
  r = await req(admin, "GET", "/api/jobs");
  jr = (r.json?.data || []).find((j) => j.id === jobToday.id);
  ok("job COMPLETED after sign-off", jr?.status === "COMPLETED", jr?.status);
  // feedback (token-gated)
  const fres = await fetch(BASE + "/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, rating: 5, tags: ["clean"], comment: "great" }),
  });
  ok("token-gated feedback recorded", fres.status === 200, `got ${fres.status}`);

  // ============ 8. Referrals & commission ============
  section("8. Referrals & commission settlement");
  r = await req(admin, "POST", "/api/referrals", { action: "create-rule", name: "QA 10pct " + Date.now(), partnerType: "influencer", calculationType: "percentage", value: 10 });
  ok("rule created", r.status === 201 || r.status === 200, `got ${r.status}`);
  const rule = r.json?.data;
  r = await req(admin, "POST", "/api/referrals", { action: "create-partner", name: "QA Partner", partnerType: "influencer", code: "QAPART" + Date.now().toString(36).slice(-4).toUpperCase(), commissionRuleId: rule.id });
  ok("partner created", r.status === 201 || r.status === 200, `got ${r.status}`);
  const partner = r.json?.data;
  const pub = await fetch(BASE + "/api/partner-portal/" + partner.code);
  const pubJson = await pub.json().catch(() => null);
  ok("public partner portal works", pubJson?.success && pubJson?.data?.partner?.code === partner.code);
  // referred booking on a fresh future job (admin scope) → complete → settle
  r = await req(admin, "POST", "/api/jobs", { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: fmt(today), scheduledTimeSlot: "08:00 - 16:00", referralPartnerId: partner.id });
  const jobRef = r.json?.data?.job;
  ok("referred booking created", r.status === 201);
  r = await req(admin, "GET", "/api/referrals");
  const pAfter = (r.json?.data?.partners || []).find((p) => p.id === partner.id);
  ok("totalReferrals incremented at booking", pAfter?.totalReferrals === 1, `got ${pAfter?.totalReferrals}`);
  for (const st of ["IN_PROGRESS", "WORK_COMPLETED", "CUSTOMER_APPROVAL", "COMPLETED"]) {
    await req(admin, "PATCH", `/api/jobs/${jobRef.id}`, { status: st });
  }
  r = await req(admin, "GET", "/api/referrals");
  const pDone = (r.json?.data?.partners || []).find((p) => p.id === partner.id);
  ok("commission settled on completion (earned=400)", pDone?.totalCommissionEarned === 400, `got ${pDone?.totalCommissionEarned}`);
  const entry = (r.json?.data?.commissionEntries || []).find((e) => e.jobId === jobRef.id);
  ok("commission entry 10% of 4000", entry?.commissionAmount === 400 && entry?.status === "COMMISSION_PENDING");
  r = await req(admin, "POST", "/api/referrals", { action: "approve-entry", id: entry.id });
  ok("entry approved", r.status === 200, `got ${r.status}`);
  r = await req(admin, "POST", "/api/referrals", { action: "create-payout", partnerId: partner.id, amount: 400, payoutMethod: "upi", referenceNumber: "QA-PAY-1" });
  ok("payout recorded", r.status === 201 || r.status === 200, `got ${r.status}`);
  r = await req(admin, "GET", "/api/referrals");
  const entryPaid = (r.json?.data?.commissionEntries || []).find((e) => e.id === entry.id);
  ok("entry PAID after payout", entryPaid?.status === "PAID", entryPaid?.status);

  // ============ 9. Finance (super_admin only) ============
  section("9. Finance operations");
  r = await req(admin, "GET", "/api/finance");
  const inv = (r.json?.data?.invoices || []).find((i) => i.jobId === jobRef.id);
  ok("invoice exists for job", !!inv);
  r = await req(admin, "POST", "/api/finance", { action: "record-payment", invoiceId: inv.id, amount: inv.total, paymentMethod: "upi", reference: "QA-TXN-1" });
  ok("payment recorded", r.status === 201 || r.status === 200, `got ${r.status}`);
  r = await req(admin, "GET", "/api/finance");
  const invPaid = (r.json?.data?.invoices || []).find((i) => i.id === inv.id);
  ok("invoice PAID, balance 0", invPaid?.status === "PAID" && invPaid?.balanceDue === 0, JSON.stringify(invPaid));
  r = await req(admin, "POST", "/api/finance", { action: "create-expense", date: fmt(today), category: "chemicals", amount: 500, description: "QA expense", paymentMethod: "cash" });
  ok("expense recorded", r.status === 201 || r.status === 200, `got ${r.status}`);
  r = await req(admin, "GET", "/api/jobs");
  const jrPaid = (r.json?.data || []).find((j) => j.id === jobRef.id);
  ok("job paymentStatus synced to PAID", jrPaid?.paymentStatus === "PAID", jrPaid?.paymentStatus);

  // ============ 10. Settings ============
  section("10. Settings");
  r = await req(ops, "PATCH", "/api/settings", { taxRatePercent: 5 });
  ok("ops CANNOT change settings", r.status === 403, `got ${r.status}`);
  r = await req(admin, "GET", "/api/settings");
  const before = r.json?.data;
  r = await req(admin, "PATCH", "/api/settings", { taxLabel: before.taxLabel });
  ok("admin settings PATCH ok", r.status === 200);

  // SMS provider credit probe (read-only — sends no SMS)
  r = await req(ops, "GET", "/api/sms/balance");
  ok("ops CANNOT read provider balance", r.status === 403, `got ${r.status}`);
  r = await req(admin, "GET", "/api/sms/balance");
  ok(
    "admin provider balance 200 (credits visible)",
    r.status === 200 && r.json?.success === true && "configured" in (r.json?.data || {}),
    JSON.stringify(r.json?.data)
  );

  // ============ 11. Persistence (data survives) ============
  section("11. DB persistence sanity");
  r = await req(admin, "GET", "/api/jobs");
  const ids = (r.json?.data || []).map((j) => j.id);
  ok("all created jobs persisted", ids.includes(jobToday.id) && ids.includes(jobRef.id) && ids.includes(job.id));

  console.log(`\n========================\nRESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("SUITE CRASH:", e);
  process.exit(1);
});
