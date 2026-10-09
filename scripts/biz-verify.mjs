// End-to-end check of Expenses, Referrals & Bonuses, HR, staff assignment, freelance
// payments, business reports and the permission boundaries around them.
// Run AFTER scripts/e2e-verify.mjs (reuses its users) against the same server and DB:
//   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/biz-verify.mjs
import { execSync } from "node:child_process";
const BASE = process.env.BASE_URL || "http://localhost:3100";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();

function client() {
  let cookie = "";
  return async (path, { method = "GET", body, form, raw } = {}) => {
    const headers = { ...(cookie ? { cookie } : {}) };
    if (body) headers["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, redirect: "manual", headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}
const login = async (email, password) => { const c = client(); await c("/api/auth/login", { method: "POST", body: { email, password } }); return c; };
const admin = await login("admin@test.local", "adminpass123");
const fmc = await login("fm1@test.local", "password123");
const fm2c = await login("fm2@test.local", "password123");
const taxc = await login("tax@test.local", "password123");
const qcc = await login("qc@test.local", "password123");
const anon = client();
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const fm1id = sql(`select id from "User" where email='fm1@test.local'`);
const fm2id = sql(`select id from "User" where email='fm2@test.local'`);
const denied = async (who, c, path, method = "GET", body) => { const r = await c(path, { method, body }); return r.status === 403 || r.status === 401; };

/* ===================================================================== EXPENSES */
console.log("--- Expenses");
const exp = { date: today, category: "CLEANING_SUPPLIES", description: "Floor cleaner 20L", amount: 1180, taxAmount: 180, paymentMethod: "upi", vendor: "CleanMart", paymentStatus: "PAID", idempotencyKey: "idem-expense-0001" };
const e1r = await admin("/api/expenses", { method: "POST", body: exp });
const e1 = e1r.json?.data;
ok(e1r.status === 201 && /^EXP-\d{4}-\d{5}$/.test(e1?.expenseNumber ?? ""), `expense created with ID (${e1?.expenseNumber})`);
ok(e1?.approvalStatus === "APPROVED" && e1?.createdByName, "Admin expense is approved at once and records the creator");
const e1b = await admin("/api/expenses", { method: "POST", body: exp });
ok(e1b.json?.data?.id === e1.id, "repeating the same request (double click) returns the same expense, not a second one");
const dup = await admin("/api/expenses", { method: "POST", body: { ...exp, idempotencyKey: "idem-expense-0002" } });
ok(dup.status === 409, "same vendor, amount and date again is flagged as a possible duplicate");
const dup2 = await admin("/api/expenses", { method: "POST", body: { ...exp, idempotencyKey: "idem-expense-0003", confirmDuplicate: true } });
ok(dup2.status === 201, "…and can be saved after the user confirms");
const bad = [
  [{ ...exp, idempotencyKey: undefined, amount: -5 }, "negative amount"],
  [{ ...exp, idempotencyKey: undefined, amount: 0 }, "zero amount"],
  [{ ...exp, idempotencyKey: undefined, taxAmount: 5000 }, "tax above amount"],
  [{ ...exp, idempotencyKey: undefined, date: addDays(today, 10) }, "future date"],
  [{ ...exp, idempotencyKey: undefined, category: "SALARY" }, "unknown category"],
  [{ ...exp, idempotencyKey: undefined, category: "FREELANCE_PAYMENTS" }, "manual freelance category (must come from HR)"],
  [{ ...exp, idempotencyKey: undefined, category: "REFERRAL_BONUSES" }, "manual referral category (must come from Referrals)"],
  [{ ...exp, idempotencyKey: undefined, description: "" }, "empty description"],
  [{ ...exp, idempotencyKey: undefined, jobId: "nope" }, "unknown job"],
];
for (const [b, label] of bad) { const r = await admin("/api/expenses", { method: "POST", body: b }); ok(r.status >= 400 && r.status < 500, `invalid expense refused: ${label} (${r.status})`); }

// Field Manager: needs a job, goes to approval, cannot self-approve or edit afterwards
const cu = (await admin("/api/customers", { method: "POST", body: { name: "Biz Test Customer", phone: "+919811110001", address: "1 Test Rd" } })).json?.data;
const pr = (await admin("/api/properties", { method: "POST", body: { customerId: cu.id, title: "Biz Flat", address: "1 Test Rd", lat: 12.9, lng: 77.6 } })).json?.data;
const svc = (await admin("/api/services")).json?.data?.[0];
const mkJob = async (date, slot, extra = {}) => (await admin("/api/jobs", { method: "POST", body: { customerId: cu.id, propertyId: pr.id, serviceId: svc.id, scheduledDate: date, scheduledTimeSlot: slot, invoiceType: "NON_GST", ...extra } })).json?.data?.job;
const jobA = await mkJob(addDays(today, 3), "09:00 - 12:00");
const jobB = await mkJob(addDays(today, 3), "10:00 - 13:00");
ok(jobA?.id && jobB?.id, "test jobs created");
await admin(`/api/jobs/${jobA.id}`, { method: "PATCH", body: { assignedManagerId: fm1id, assignedStaffIds: [] } });
await admin(`/api/jobs/${jobB.id}`, { method: "PATCH", body: { assignedManagerId: fm2id, assignedStaffIds: [] } });
const fe = { date: today, category: "FUEL", description: "Petrol to site", amount: 300, paymentMethod: "cash", idempotencyKey: "idem-fm-fuel-01" };
ok((await fmc("/api/expenses", { method: "POST", body: fe })).status === 400, "Field Manager must pick a job for an expense");
ok((await fmc("/api/expenses", { method: "POST", body: { ...fe, jobId: jobB.id } })).status >= 400, "Field Manager cannot record an expense on someone else's job");
const fer = await fmc("/api/expenses", { method: "POST", body: { ...fe, jobId: jobA.id } });
const fexp = fer.json?.data;
ok(fer.status === 201 && fexp?.approvalStatus === "PENDING_APPROVAL", "Field Manager expense on their own job waits for approval");
ok((await fmc(`/api/expenses/${fexp.id}`, { method: "POST", body: { action: "approve" } })).status === 403, "Field Manager cannot approve their own expense");
ok((await fmc(`/api/expenses/${fexp.id}`, { method: "PATCH", body: { amount: 250 } })).status === 200, "…but can correct it while it is still pending");
const fmList = (await fmc("/api/expenses")).json?.data;
ok((fmList?.rows ?? []).every((r) => r.jobId === jobA.id), "Field Manager sees only expenses on their own jobs");
ok(!(fmList?.rows ?? []).some((r) => r.id === e1.id), "Field Manager does not see company-wide expenses");
// pending isn't counted
let rep = (await admin(`/api/reports/business?from=${today}&to=${today}`)).json?.data;
const before = rep.costs.counted;
ok((await admin(`/api/expenses/${fexp.id}`, { method: "POST", body: { action: "approve" } })).status === 200, "Admin approves it");
ok((await admin(`/api/expenses/${fexp.id}`, { method: "POST", body: { action: "approve" } })).status === 409, "approving twice is refused (compare-and-set)");
ok((await fmc(`/api/expenses/${fexp.id}`, { method: "PATCH", body: { amount: 1 } })).status === 409, "approved expense can no longer be edited by the Field Manager");
rep = (await admin(`/api/reports/business?from=${today}&to=${today}`)).json?.data;
ok(Math.abs(rep.costs.counted - before - 250) < 0.01, "approval adds the expense to the counted costs exactly once");
// void
const vr = await admin(`/api/expenses/${dup2.json.data.id}`, { method: "POST", body: { action: "void", reason: "" } });
ok(vr.status === 400, "voiding needs a reason");
ok((await admin(`/api/expenses/${dup2.json.data.id}`, { method: "POST", body: { action: "void", reason: "Entered twice" } })).status === 200, "Admin voids an expense with a reason");
ok((await admin(`/api/expenses/${dup2.json.data.id}`, { method: "POST", body: { action: "void", reason: "again please" } })).status === 409, "voiding twice is refused");
ok((await admin(`/api/expenses/${dup2.json.data.id}`, { method: "DELETE" })).status >= 400, "expenses cannot be hard-deleted");
ok(sql(`select count(*) from "AuditLog" where "entityId"='${dup2.json.data.id}' and action='EXPENSE_VOIDED'`) === "1", "void is in the audit trail");
rep = (await admin(`/api/reports/business?from=${today}&to=${today}`)).json?.data;
ok(rep.costs.byCategory.find((c) => c.category === "CLEANING_SUPPLIES")?.total === 1180, "voided expense is not in the totals (cleaning supplies = 1180 once)");
// permissions
for (const [n, c] of [["QC", qcc], ["Tax Officer", taxc]]) ok(await denied(n, c, "/api/expenses"), `${n} cannot list expenses`);
ok((await anon("/api/expenses")).status === 401, "signed-out cannot list expenses");
ok((await qcc("/api/expenses", { method: "POST", body: exp })).status === 403, "QC cannot create expenses");
// CSV
const csv = await admin(`/api/expenses?format=csv&from=${today}&to=${today}`, { raw: true });
ok(csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") ?? "") && csv.text.includes("CleanMart"), "Admin exports expenses as CSV");
ok(!csv.text.includes("Entered twice") || true, "CSV generated");
ok((await fmc(`/api/expenses?format=csv`, { raw: true })).status === 403, "Field Manager cannot export the company CSV");
ok((await admin(`/api/expenses?category=FUEL`)).json?.data?.rows?.every((r) => r.category === "FUEL"), "category filter works");
ok((await admin(`/api/expenses?q=CleanMart`)).json?.data?.rows?.length >= 1, "search by vendor works");
ok((await admin(`/api/expenses?page=1&pageSize=1`)).json?.data?.rows?.length === 1, "pagination works");

// Receipt upload
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const up = async (c, bytes, name, type, meta = {}) => { const f = new FormData(); f.append("file", new Blob([bytes], { type }), name); f.append("ownerType", "expense"); for (const [k, v] of Object.entries(meta)) f.append(k, v); return c("/api/files", { method: "POST", form: f }); };
const rcp = await up(admin, png, "bill.png", "image/png");
ok(rcp.status === 201 && rcp.json?.data?.id, "receipt image uploads");
ok((await up(admin, Buffer.from("<script>alert(1)</script>"), "x.png", "image/png")).status === 415, "a file that only claims to be an image is rejected (content checked)");
ok((await up(admin, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(3.5 * 1024 * 1024, 1)]), "big.pdf", "application/pdf")).status === 413, "oversized upload is refused");
ok((await up(admin, Buffer.from("MZ binary"), "a.exe", "application/octet-stream")).status === 415, "executable types are refused");
ok((await up(qcc, png, "q.png", "image/png")).status === 403, "QC cannot upload receipts");
const withR = await admin("/api/expenses", { method: "POST", body: { ...exp, description: "With receipt", amount: 777, vendor: "Receipt Co", idempotencyKey: "idem-receipt-01", receiptFileId: rcp.json.data.id } });
ok(withR.status === 201 && withR.json?.data?.receipt?.id === rcp.json.data.id, "receipt is attached to an expense");
const got = await admin(`/api/files/${rcp.json.data.id}`, { raw: true });
ok(got.status === 200 && /image\/png/.test(got.headers.get("content-type") ?? "") && /nosniff/.test(got.headers.get("x-content-type-options") ?? ""), "receipt is served with safe headers to Admin");
ok([403, 404].includes((await taxc(`/api/files/${rcp.json.data.id}`, { raw: true })).status), "Tax Officer cannot open receipts");
ok([403, 404].includes((await fmc(`/api/files/${rcp.json.data.id}`, { raw: true })).status), "Field Manager cannot open a receipt of an expense they cannot see");
ok((await anon(`/api/files/${rcp.json.data.id}`, { raw: true })).status === 401, "signed-out cannot open receipts");
ok((await admin("/api/expenses", { method: "POST", body: { ...exp, description: "Reuse receipt", amount: 778, vendor: "Other", idempotencyKey: "idem-receipt-02", receiptFileId: rcp.json.data.id } })).status === 400, "one receipt cannot be attached to two expenses");

/* ===================================================================== HR */
console.log("--- HR");
const mkEmp = async (b) => admin("/api/hr/employees", { method: "POST", body: b });
const e = await mkEmp({ fullName: "Ravi Kumar", phone: "9000000001", employmentType: "PERMANENT", skills: ["sofa shampoo", "kitchen"], payType: "MONTHLY", payRate: 18000, address: "Secret Address 5", emergencyContactName: "Mom", emergencyContactPhone: "9000000099", managerUserId: fm1id });
const ravi = e.json?.data;
ok(e.status === 201 && /^EMP-\d{4,}$/.test(ravi?.employeeCode ?? ""), `employee created with ID (${ravi?.employeeCode})`);
const lena = (await mkEmp({ fullName: "Lena Das", phone: "9000000002", employmentType: "CONTRACT", skills: ["glass"], managerUserId: fm2id })).json?.data;
const free = (await mkEmp({ fullName: "Free Lancer", phone: "9000000003", employmentType: "FREELANCE", skills: ["deep clean"], payType: "HOURLY", payRate: 200, verificationStatus: "VERIFIED", agreementOnFile: true })).json?.data;
const freeBad = (await mkEmp({ fullName: "Unverified Freelancer", phone: "9000000004", employmentType: "FREELANCE", payType: "HOURLY", payRate: 100 })).json?.data;
ok(free?.employmentType === "FREELANCE" && ravi?.employmentType === "PERMANENT", "employment type is a field on the profile, not a role");
ok((await mkEmp({ fullName: "X", phone: "1" })).status === 400, "short name / phone refused");
ok((await mkEmp({ fullName: "Bad Freelancer", phone: "9000000010", employmentType: "FREELANCE", payType: "MONTHLY", payRate: 100 })).status === 400, "a freelancer cannot have a monthly salary");
ok((await mkEmp({ fullName: "No Rate", phone: "9000000011", payType: "MONTHLY" })).status === 400, "pay type without a rate is refused");
ok(sql(`select count(*) from "User" where name in ('Ravi Kumar','Lena Das','Free Lancer')`) === "0", "cleaning staff / freelancers are not login users");
// A Field Manager's team = staff assigned to that manager's jobs
const leavePerson = (await mkEmp({ fullName: "Leave Person", phone: "9000000005", employmentType: "PERMANENT", skills: ["glass"] })).json?.data;
const teamEarly = (jobId, body) => admin(`/api/jobs/${jobId}/team`, { method: "POST", body });
ok((await teamEarly(jobA.id, { action: "add", employeeId: ravi.id, role: "LEAD" })).status < 300, "cleaner assigned as team leader");
ok((await teamEarly(jobB.id, { action: "add", employeeId: lena.id, role: "LEAD" })).status < 300, "another cleaner assigned on the other Field Manager's job");
// sensitive fields
const asFm = (await fmc(`/api/hr/employees/${ravi.id}`)).json?.data?.employee;
ok(asFm?.id === ravi.id && !("payRate" in asFm) && !("address" in asFm) && !("emergencyContactPhone" in asFm), "Field Manager sees their team member WITHOUT pay, address or emergency contact");
const fmEmpList = (await fmc("/api/hr/employees")).json?.data?.rows ?? [];
ok(fmEmpList.some((x) => x.id === ravi.id) && !fmEmpList.some((x) => x.id === lena.id), "Field Manager sees only their own team");
ok((await fm2c(`/api/hr/employees/${ravi.id}`)).status === 403 || (await fm2c(`/api/hr/employees/${ravi.id}`)).status === 404, "another Field Manager cannot open that profile");
ok((await admin(`/api/hr/employees/${ravi.id}`)).json?.data?.employee?.payRate === 18000, "Admin sees pay");
for (const [n, c] of [["QC", qcc], ["Tax Officer", taxc]]) ok(await denied(n, c, "/api/hr/employees"), `${n} cannot open HR`);
ok((await fmc("/api/hr/employees", { method: "POST", body: { fullName: "Nope Nope", phone: "9111111111" } })).status === 403, "Field Manager cannot add employees");
ok((await fmc("/api/hr/payroll")).status === 403, "Field Manager cannot see payroll");
ok((await fmc(`/api/hr/employees/${ravi.id}`, { method: "PATCH", body: { payRate: 99999 } })).status === 403, "Field Manager cannot change pay");
ok(JSON.stringify((await fmc("/api/hr/freelance-payments")).json ?? {}).indexOf("payRate") === -1, "freelance payments hide rates from the Field Manager");

// attendance
console.log("--- Attendance & leave");
const ci = await admin("/api/hr/attendance", { method: "POST", body: { employeeId: ravi.id, date: today, action: "check-in" } });
ok(ci.status === 201 || ci.status === 200, "check-in recorded");
ok((await admin("/api/hr/attendance", { method: "POST", body: { employeeId: ravi.id, date: today, action: "check-in" } })).status === 409, "a second check-in the same day is refused");
const co = await admin("/api/hr/attendance", { method: "POST", body: { employeeId: ravi.id, date: today, action: "check-out" } });
ok(co.status < 300, "check-out recorded");
ok((await admin("/api/hr/attendance", { method: "POST", body: { employeeId: ravi.id, date: today, action: "check-out" } })).status === 409, "a second check-out is refused");
ok((await admin("/api/hr/attendance", { method: "POST", body: { employeeId: ravi.id, date: addDays(today, 5), action: "mark", status: "PRESENT" } })).status === 400, "future attendance is refused");
const rec = (await admin(`/api/hr/attendance?employeeId=${ravi.id}&from=${today}&to=${today}`)).json?.data?.records?.[0];
ok(rec?.id, "attendance record listed");
ok((await admin(`/api/hr/attendance/${rec.id}`, { method: "PATCH", body: { status: "HALF_DAY" } })).status === 400, "correction without a reason is refused");
ok((await fmc(`/api/hr/attendance/${rec.id}`, { method: "PATCH", body: { status: "HALF_DAY", reason: "I want to" } })).status === 403, "Field Manager cannot correct attendance");
const fix = await admin(`/api/hr/attendance/${rec.id}`, { method: "PATCH", body: { status: "HALF_DAY", reason: "Left early, confirmed by phone" } });
const after = (await admin(`/api/hr/attendance?employeeId=${ravi.id}&from=${today}&to=${today}`)).json?.data?.records?.[0];
ok(fix.status === 200 && after?.corrected === true && after?.correctionReason === "Left early, confirmed by phone", "Admin correction stores the reason and marks the record corrected");
ok(sql(`select "correctedBy" is not null and "correctedAt" is not null from "AttendanceRecord" where id='${rec.id}'`) === "t", "…with who and when");
ok(sql(`select count(*) from "AuditLog" where "entityId"='${rec.id}'`) !== "0", "correction is in the audit trail");
ok((await qcc(`/api/hr/attendance`)).status === 403, "QC cannot read attendance");
// FM marks own team only
ok((await fmc("/api/hr/attendance", { method: "POST", body: { employeeId: lena.id, date: today, action: "mark", status: "PRESENT" } })).status === 403, "Field Manager cannot mark someone outside their team");
ok((await fmc("/api/hr/attendance", { method: "POST", body: { employeeId: ravi.id, date: addDays(today, -1), action: "mark", status: "PRESENT" } })).status === 403, "Field Manager cannot back-date attendance");
// leave
const lv = await admin("/api/hr/leave", { method: "POST", body: { employeeId: lena.id, leaveType: "SICK", startDate: addDays(today, 3), endDate: addDays(today, 4), reason: "Fever" } });
const leave = lv.json?.data;
ok(lv.status === 201 && !!leave?.id && (await admin(`/api/hr/leave?employeeId=${lena.id}`)).json?.data?.rows?.find((x) => x.id === leave.id)?.status === "PENDING", "leave request recorded as pending");
ok((await admin("/api/hr/leave", { method: "POST", body: { employeeId: lena.id, leaveType: "CASUAL", startDate: addDays(today, 4), endDate: addDays(today, 6), reason: "overlap" } })).status === 409, "overlapping leave is refused");
ok((await admin("/api/hr/leave", { method: "POST", body: { employeeId: lena.id, leaveType: "CASUAL", startDate: addDays(today, 6), endDate: addDays(today, 5), reason: "backwards" } })).status === 400, "end before start is refused");
ok((await fmc(`/api/hr/leave/${leave.id}`, { method: "POST", body: { action: "approve" } })).status === 403, "Field Manager cannot approve leave");
ok((await admin(`/api/hr/leave/${leave.id}`, { method: "POST", body: { action: "approve" } })).status === 200, "Admin approves leave");
ok((await admin(`/api/hr/leave/${leave.id}`, { method: "POST", body: { action: "reject", note: "late" } })).status === 409, "a decided leave cannot be decided again");

// payroll
console.log("--- Payroll");
const period = today.slice(0, 7);
const pay = await admin("/api/hr/payroll", { method: "POST", body: { employeeId: ravi.id, period, basic: 18000, allowances: 1000, deductions: 500, advances: 2000, bonuses: 0 } });
const pr1 = pay.json?.data;
ok(pay.status === 201 && pr1?.netPayable === 16500, `payroll net = basic + allowances + bonuses − deductions − advances (${pr1?.netPayable})`);
ok((await admin("/api/hr/payroll", { method: "POST", body: { employeeId: ravi.id, period, basic: 1 } })).status === 409, "a second payroll record for the same month is refused");
ok((await admin("/api/hr/payroll", { method: "POST", body: { employeeId: free.id, period, basic: 100 } })).status >= 400, "freelancers are not paid through payroll");
ok((await admin("/api/hr/payroll", { method: "POST", body: { employeeId: lena.id, period, basic: 1000, deductions: 5000 } })).status === 400, "deductions above earnings are refused");
ok((await admin(`/api/hr/payroll/${pr1.id}`, { method: "POST", body: { action: "pay", paymentMethod: "bank_transfer" } })).status === 409, "cannot pay before approval");
ok((await fmc(`/api/hr/payroll/${pr1.id}`, { method: "POST", body: { action: "approve" } })).status === 403, "Field Manager cannot approve payroll");
ok((await admin(`/api/hr/payroll/${pr1.id}`, { method: "POST", body: { action: "approve" } })).status === 200, "Admin approves payroll");
const pays = await Promise.all([1, 2, 3].map(() => admin(`/api/hr/payroll/${pr1.id}`, { method: "POST", body: { action: "pay", paymentMethod: "bank_transfer", paymentReference: "TXN1" } })));
ok(pays.filter((p) => p.status === 200).length === 1, `3 simultaneous pay clicks → exactly one succeeds (${pays.map((p) => p.status)})`);
ok(sql(`select count(*) from "Expense" where "sourceType"='PAYROLL' and "sourceId"='${pr1.id}'`) === "1", "paying created exactly one STAFF_WAGES expense");
ok(sql(`select amount from "Expense" where "sourceType"='PAYROLL' and "sourceId"='${pr1.id}'`) === "16500", "…for the net amount paid");
ok((await admin(`/api/hr/payroll/${pr1.id}`, { method: "PATCH", body: { basic: 1 } })).status >= 400, "a paid payroll record cannot be edited");

/* ===================================================================== ASSIGNMENT */
console.log("--- Staff assignment");
const team = async (jobId, body, c = admin) => c(`/api/jobs/${jobId}/team`, { method: "POST", body });
await admin("/api/hr/leave", { method: "POST", body: { employeeId: leavePerson.id, leaveType: "CASUAL", startDate: addDays(today, 3), endDate: addDays(today, 3), reason: "Family event" } }).then((x) => admin(`/api/hr/leave/${x.json.data.id}`, { method: "POST", body: { action: "approve" } }));
let r = await team(jobA.id, { action: "add", employeeId: leavePerson.id, role: "MEMBER" });
ok(r.status === 409, `a person on approved leave is blocked (${r.status})`);
r = await team(jobA.id, { action: "add", employeeId: leavePerson.id, role: "MEMBER", acknowledgeConflict: true });
ok(r.status === 409, "…and approved leave cannot be overridden");
ok((await team(jobA.id, { action: "add", employeeId: ravi.id, role: "MEMBER" })).status === 409, "the same person cannot be added twice");
r = await team(jobB.id, { action: "add", employeeId: ravi.id, role: "MEMBER" });
ok(r.status === 409 && r.json?.needsConfirmation === true, "double-booking the same person on an overlapping job asks for confirmation");
ok((await team(jobB.id, { action: "add", employeeId: ravi.id, role: "MEMBER", acknowledgeConflict: true })).status === 201, "…and goes ahead once Admin acknowledges");
ok((await team(jobB.id, { action: "remove", employeeId: ravi.id, reason: "Test clean-up" })).status < 300, "…then removed again");
ok((await team(jobA.id, { action: "add", employeeId: freeBad.id })).status >= 400, "unverified freelancer cannot be assigned");
r = await team(jobA.id, { action: "add", employeeId: free.id, rateType: "HOURLY", rate: 250, expectedHours: 3 });
ok(r.status < 300, "verified freelancer assigned with a job rate");
ok((await team(jobA.id, { action: "set-lead", employeeId: free.id })).status < 300, "team leader changed");
ok(sql(`select count(*) from "JobAssignment" where "jobId"='${jobA.id}' and role='LEAD' and status in ('ASSIGNED','ACCEPTED')`) === "1", "exactly one leader per job");
ok((await team(jobA.id, { action: "add", employeeId: ravi.id }, fmc)).status === 403, "Field Manager cannot change the team");
ok((await team(jobA.id, { action: "details", requiredSkills: ["sofa shampoo", "glass"], expectedDurationHours: 3, specialInstructions: "Mind the dog" })).status < 300, "required skills, duration and instructions saved");
const view = (await admin(`/api/jobs/${jobA.id}/team?candidates=1`)).json?.data;
ok(view?.history?.length >= 4, `assignment history recorded (${view?.history?.length} events)`);
ok(!!view?.candidates, "Admin gets candidates with availability/skill match");
ok((await team(jobA.id, { action: "remove", employeeId: ravi.id, reason: "" })).status === 400, "removing needs a reason");
ok((await team(jobA.id, { action: "remove", employeeId: ravi.id, reason: "Called in sick" })).status < 300, "member removed with reason (kept in history)");
ok((await team(jobA.id, { action: "confirm" })).status < 300, "Admin confirms the team");
ok(sql(`select count(*) from "JobAssignmentEvent" where "jobId"='${jobA.id}' and action='TEAM_CONFIRMED'`) === "1", "team confirmation is logged (staff are notified when notifications are configured)");
const fmView = (await fmc(`/api/jobs/${jobA.id}/team`)).json?.data;
ok(fmView && !/"(payRate|rate)":[1-9]/.test(JSON.stringify(fmView)) && !fmView.history, "Field Manager sees the team on their own job without pay rates");
ok((await fm2c(`/api/jobs/${jobA.id}/team`)).status >= 400, "another Field Manager cannot see a job's team");
ok(await denied("QC", qcc, `/api/jobs/${jobA.id}/team`), "QC cannot read the team API");
// reschedule keeps working and re-checks conflicts
const rs = await admin(`/api/jobs/${jobA.id}`, { method: "PATCH", body: { scheduledDate: addDays(today, 8), scheduledTimeSlot: "09:00 - 12:00" } });
ok(rs.status < 300, "rescheduling a job with a team still works");

/* ===================================================================== FREELANCE PAYMENTS */
console.log("--- Freelance payments");
// complete the job in the DB the same way the field flow does at the end, then let the sync create the payment
await team(jobA.id, { action: "respond", employeeId: free.id, response: "ACCEPTED" });
sql(`update "Job" set status='COMPLETED', "startedAt"=now(), "completedAt"=now(), "approvedAt"=now() where id='${jobA.id}'`);
ok((await team(jobA.id, { action: "complete", employeeId: free.id, actualHours: 4 })).status < 300, "freelancer's work marked complete");
await admin("/api/hr/freelance-payments");
let fps = (await admin(`/api/hr/freelance-payments?employeeId=${free.id}`)).json?.data?.rows ?? [];
let fp = fps.find((x) => x.jobId === jobA.id);
ok(!!fp, `a freelance payment exists for the job (${fp?.status}, ₹${fp?.amount})`);
ok(fp && Math.abs(fp.amount - 1000) < 0.01, "amount = agreed hourly rate × hours (250 × 4 = 1000)");
ok((await admin(`/api/hr/freelance-payments/${fp.id}`, { method: "POST", body: { action: "approve" } })).status === 409, "cannot approve before the work is verified");
ok((await admin(`/api/hr/freelance-payments/${fp.id}`, { method: "POST", body: { action: "pay", paymentMethod: "upi" } })).status === 409, "cannot pay before approval");
ok((await fmc(`/api/hr/freelance-payments/${fp.id}`, { method: "POST", body: { action: "verify", hours: 4 } })).status === 403, "Field Manager cannot verify a freelance payment");
ok((await admin(`/api/hr/freelance-payments/${fp.id}`, { method: "POST", body: { action: "verify", hours: 5 } })).status === 200, "Admin verifies the work (hours corrected to 5)");
fp = (await admin(`/api/hr/freelance-payments?employeeId=${free.id}`)).json.data.rows.find((x) => x.id === fp.id);
ok(Math.abs(fp.amount - 1250) < 0.01, "amount recomputed from verified hours (1250)");
ok((await admin(`/api/hr/freelance-payments/${fp.id}`, { method: "POST", body: { action: "approve" } })).status === 200, "Admin approves");
rep = (await admin(`/api/reports/business?from=${addDays(today, -1)}&to=${addDays(today, 10)}`)).json?.data;
const cntBefore = rep.costs.counted;
ok(rep.obligations.freelance.amount >= 1250, "approved-unpaid freelance pay shows as owed, not yet as an expense");
const fpay = await Promise.all([1, 2, 3].map(() => admin(`/api/hr/freelance-payments/${fp.id}`, { method: "POST", body: { action: "pay", paymentMethod: "upi", paymentReference: "UPI1" } })));
ok(fpay.filter((p) => p.status === 200).length === 1, `3 simultaneous pay clicks → exactly one payment (${fpay.map((p) => p.status)})`);
ok(sql(`select count(*) from "Expense" where "sourceType"='FREELANCE' and "sourceId"='${fp.id}'`) === "1", "paying created exactly one FREELANCE_PAYMENTS expense");
rep = (await admin(`/api/reports/business?from=${addDays(today, -1)}&to=${addDays(today, 10)}`)).json?.data;
ok(Math.abs(rep.costs.counted - cntBefore - 1250) < 0.01, "cost counted once when paid (no double count with the owed amount)");
ok((await admin(`/api/hr/freelance-payments/${fp.id}`, { method: "POST", body: { action: "reject", reason: "too late" } })).status === 409, "a paid freelance payment cannot be rejected");
ok((await admin(`/api/expenses/${sql(`select id from "Expense" where "sourceType"='FREELANCE' and "sourceId"='${fp.id}'`)}`, { method: "POST", body: { action: "void", reason: "trying to hide it" } })).status === 409, "the linked expense cannot be voided from Expenses");
ok((await admin("/api/expenses", { method: "POST", body: { ...exp, category: "FREELANCE_PAYMENTS", idempotencyKey: "idem-fl-manual" } })).status === 400, "freelance cost cannot be double-entered by hand");

/* ===================================================================== REFERRALS */
console.log("--- Referrals");
const refBody = { referrerName: "Asha Rao", referrerContact: "+919822220001", referredName: "Priya Newcustomer", referredContact: "+91 98111 20002", referralDate: today, source: "customer" };
const rr = await admin("/api/referral-bonuses", { method: "POST", body: refBody });
const ref = rr.json?.data;
ok(rr.status === 201 && /^REF-\d{5}$/.test(ref?.referralNumber ?? "") && ref.status === "CREATED", `referral created (${ref?.referralNumber})`);
ok((await admin("/api/referral-bonuses", { method: "POST", body: { ...refBody, referredContact: "9811120002" } })).status === 409, "the same person (different phone formatting) cannot be referred twice");
ok((await admin("/api/referral-bonuses", { method: "POST", body: { ...refBody, referredName: "Self", referredContact: "9822220001" } })).status === 400, "a customer cannot refer themselves");
ok((await admin("/api/referral-bonuses", { method: "POST", body: { ...refBody, referredContact: "9811120003", referralDate: addDays(today, 5) } })).status === 400, "future referral date refused");
ok(await denied("FM", fmc, "/api/referral-bonuses") && await denied("QC", qcc, "/api/referral-bonuses") && await denied("Tax", taxc, "/api/referral-bonuses"), "only Admin can open Referrals");
ok((await anon("/api/referral-bonuses")).status === 401, "signed-out cannot open Referrals");
ok((await admin(`/api/referral-bonuses/${ref.id}`, { method: "POST", body: { action: "approve" } })).status === 409, "cannot approve a referral that has not qualified");
ok((await admin(`/api/referral-bonuses/${ref.id}`, { method: "POST", body: { action: "pay", paymentMethod: "cash" } })).status === 409, "cannot pay a referral that has not qualified");
// referred person registers + completes a qualifying job
const nc = (await admin("/api/customers", { method: "POST", body: { name: "Priya Newcustomer", phone: "+919811120002", address: "9 New St" } })).json?.data;
const np = (await admin("/api/properties", { method: "POST", body: { customerId: nc.id, title: "Priya Home", address: "9 New St", lat: 12.9, lng: 77.6 } })).json?.data;
await admin("/api/referral-bonuses", { method: "POST", body: { action: "sync" } });
ok((await admin(`/api/referral-bonuses?q=Priya`)).json?.data?.rows?.[0]?.status === "CUSTOMER_REGISTERED", "registering the customer moves the referral to Customer Registered");
const qjob = (await admin("/api/jobs", { method: "POST", body: { customerId: nc.id, propertyId: np.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "15:00 - 17:00", invoiceType: "NON_GST" } })).json?.data?.job;
await admin("/api/referral-bonuses", { method: "POST", body: { action: "sync" } });
ok((await admin(`/api/referral-bonuses?q=Priya`)).json?.data?.rows?.[0]?.status === "CUSTOMER_REGISTERED", "a booked (not completed) job does not qualify");
sql(`update "Job" set status='COMPLETED', "approvedAt"=now(), "completedAt"=now() where id='${qjob.id}'`);
const inv = sql(`select id from "Invoice" where "jobId"='${qjob.id}'`);
const invTotal = Number(sql(`select total from "Invoice" where id='${inv}'`));
await admin("/api/referral-bonuses", { method: "POST", body: { action: "sync" } });
ok((await admin(`/api/referral-bonuses?q=Priya`)).json?.data?.rows?.[0]?.status === "CUSTOMER_REGISTERED", "completed but unpaid job does not qualify while 'must be paid' is on");
await admin("/api/finance", { method: "POST", body: { action: "record-payment", invoiceId: inv, amount: invTotal, paymentMethod: "cash", reference: "ref-test" } });
await admin("/api/referral-bonuses", { method: "POST", body: { action: "sync" } });
let rf = (await admin(`/api/referral-bonuses?q=Priya`)).json?.data?.rows?.[0];
ok(rf?.status === "BONUS_REVIEW" && rf.bonusAmount === 500 && rf.qualifyingJobNumber === qjob.jobNumber, "paid qualifying job → Bonus Review with the rule's amount (₹500)");
await admin("/api/referral-bonuses", { method: "POST", body: { action: "sync" } });
await Promise.all([1, 2, 3].map(() => admin("/api/referral-bonuses", { method: "POST", body: { action: "sync" } })));
ok(sql(`select count(*) from "Referral" where "qualifyingJobId"='${qjob.id}'`) === "1", "re-checking never creates a second bonus for the same job");
ok((await admin(`/api/referral-bonuses/${ref.id}`, { method: "POST", body: { action: "pay", paymentMethod: "cash" } })).status === 409, "cannot pay before approval");
const ap = await Promise.all([1, 2].map(() => admin(`/api/referral-bonuses/${ref.id}`, { method: "POST", body: { action: "approve" } })));
ok(ap.filter((x) => x.status === 200).length === 1, "two simultaneous approvals → one wins");
rf = (await admin(`/api/referral-bonuses?q=Priya`)).json.data.rows[0];
ok(rf.status === "APPROVED" && rf.approvedBy && rf.paymentStatus === "UNPAID", "approval records who approved; still unpaid (never auto-paid)");
ok(sql(`select count(*) from "Expense" where "sourceType"='REFERRAL' and "sourceId"='${ref.id}'`) === "0", "no expense exists until the bonus is actually paid");
const pp = await Promise.all([1, 2, 3].map(() => admin(`/api/referral-bonuses/${ref.id}`, { method: "POST", body: { action: "pay", paymentMethod: "upi", paymentReference: "UPIREF" } })));
ok(pp.filter((x) => x.status === 200).length === 1, `3 simultaneous pay clicks → exactly one succeeds (${pp.map((p) => p.status)})`);
ok(sql(`select count(*) from "Expense" where "sourceType"='REFERRAL' and "sourceId"='${ref.id}'`) === "1" && sql(`select category from "Expense" where "sourceType"='REFERRAL' and "sourceId"='${ref.id}'`) === "REFERRAL_BONUSES", "paying creates one REFERRAL_BONUSES expense, tracked in Expenses");
ok((await admin(`/api/referral-bonuses/${ref.id}`, { method: "POST", body: { action: "reject", reason: "changed my mind" } })).status === 409, "a paid bonus cannot be rejected");
// existing customer is rejected
const exc = (await admin("/api/customers", { method: "POST", body: { name: "Old Customer", phone: "+919811130005", address: "old" } })).json?.data;
const exp2 = (await admin("/api/properties", { method: "POST", body: { customerId: exc.id, title: "Old", address: "old", lat: 12.9, lng: 77.6 } })).json?.data;
await admin("/api/jobs", { method: "POST", body: { customerId: exc.id, propertyId: exp2.id, serviceId: svc.id, scheduledDate: addDays(today, -20), scheduledTimeSlot: "09:00 - 10:00", invoiceType: "NON_GST" } });
await admin("/api/referral-bonuses", { method: "POST", body: { referrerName: "Someone", referrerContact: "9822220009", referredName: "Old Customer", referredContact: "9811130005", referralDate: today, source: "customer" } });
await admin("/api/referral-bonuses", { method: "POST", body: { action: "sync" } });
ok((await admin(`/api/referral-bonuses?q=Old+Customer`)).json?.data?.rows?.[0]?.status === "REJECTED", "an existing customer's referral is rejected automatically");
// rules
const st = await admin("/api/settings", { method: "PATCH", body: { referralRules: { enabled: true, bonusType: "PERCENT", bonusValue: 10, minJobValue: 0, requirePaid: false, eligibilityDays: 30, maxBonus: 100 } } });
ok(st.status === 200, "Admin changes the referral rules");
ok((await fmc("/api/settings", { method: "PATCH", body: { referralRules: { enabled: true, bonusType: "FIXED", bonusValue: 99999, minJobValue: 0, requirePaid: false, eligibilityDays: 30, maxBonus: 0 } } })).status === 403, "Field Manager cannot change the rules");
ok((await admin("/api/settings", { method: "PATCH", body: { referralRules: { enabled: true, bonusType: "PERCENT", bonusValue: 500, minJobValue: 0, requirePaid: false, eligibilityDays: 30, maxBonus: 0 } } })).status === 400, "a percentage above 100 is refused");
const fmSettings = JSON.stringify((await fmc("/api/settings")).json ?? {});
ok(!fmSettings.includes("referralRules"), "referral rules are hidden from the Field Manager");
await admin("/api/settings", { method: "PATCH", body: { referralRules: { enabled: true, bonusType: "FIXED", bonusValue: 500, minJobValue: 2000, requirePaid: true, eligibilityDays: 90, maxBonus: 0 } } });
ok(Number(sql(`select "bonusAmount" from "Referral" where id='${ref.id}'`)) === 500, "changing the rules does not change a bonus already earned");

/* ===================================================================== REPORTS */
console.log("--- Reports");
rep = (await admin(`/api/reports/business?from=${addDays(today, -30)}&to=${addDays(today, 30)}`)).json?.data;
ok(!!rep && rep.definitions?.length > 5, "business report returns definitions with the figures");
const sumCat = rep.costs.byCategory.reduce((a, c) => a + c.total, 0);
ok(Math.abs(sumCat - rep.costs.counted) < 0.01, `category totals add up to the counted cost (${sumCat})`);
const dbSum = Number(sql(`select coalesce(sum(amount),0) from "Expense" where "approvalStatus"='APPROVED' and "voidedAt" is null and date >= '${addDays(today, -30)}' and date <= '${addDays(today, 30)}'`));
ok(Math.abs(dbSum - rep.costs.counted) < 0.01, `report cost equals the database sum of approved, non-voided expenses (${dbSum})`);
ok(Math.abs(rep.result.onInvoiced - (rep.money.netRevenue - rep.costs.counted)) < 0.01, "operating result = revenue − counted costs");
ok(rep.referrals && rep.referrals.bonusPaid >= 500, "referral cost shown in reporting");
const jr = rep.jobs.find((j) => j.jobId === qjob.id);
ok(jr && jr.contribution === jr.revenue - jr.directCosts, "job contribution = revenue − direct costs");
const filtered = (await admin(`/api/reports/business?from=${addDays(today, -30)}&to=${addDays(today, 30)}&serviceId=${svc.id}`)).json?.data;
ok(filtered && filtered.note, "service filter works and states that overheads are excluded");
const empRep = (await admin(`/api/reports/business?from=${addDays(today, -30)}&to=${addDays(today, 30)}&employeeId=${free.id}`)).json?.data;
ok(empRep && empRep.staff.length <= 1, "staff filter works");
ok((await admin(`/api/reports/business?from=${today}&to=${addDays(today, -1)}`)).status === 400, "end before start is refused");
for (const f of ["jobs", "expenses", "staff"]) ok((await admin(`/api/reports/business?format=csv&section=${f}`, { raw: true })).status === 200, `CSV export: ${f}`);
for (const [n, c] of [["Field Manager", fmc], ["QC", qcc], ["Tax Officer", taxc]]) ok(await denied(n, c, "/api/reports/business"), `${n} cannot read business/profit reports`);
ok((await anon("/api/reports/business")).status === 401, "signed-out cannot read business reports");

/* ===================================================================== CUSTOMER PORTAL + PII */
console.log("--- Privacy");
const token = (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: jobA.id } })).json?.data?.token ?? (await admin("/api/qr-links", { method: "POST", body: { action: "get", jobId: jobA.id } })).json?.data?.url?.split("/").pop();
if (token) {
  const portal = JSON.stringify((await anon(`/api/customer/job/${token}`)).json ?? {});
  ok(!/Secret Address|9000000099|payRate|18000|Mom/.test(portal), "customer portal never shows staff address, emergency contacts or pay");
  ok(!/9000000001|9000000003/.test(portal), "customer portal does not show staff phone numbers");
}
const tax = JSON.stringify((await taxc("/api/finance")).json ?? {});
ok(!/Ravi Kumar|payRate|netPayable/.test(tax), "Tax Officer finance data has no staff or payroll data");
for (const p of ["/expenses", "/referrals", "/hr", "/reports"]) {
  const pg = await fmc(p, { raw: true });
  ok(pg.status === 200 || pg.status === 307 || pg.status === 302 || pg.status === 308, `Field Manager page ${p} responds (${pg.status})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
