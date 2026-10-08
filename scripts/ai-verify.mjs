// Intense AI security + plumbing check, with a stand-in AI provider.
//
// The stand-in obeys scripted questions like "CALL get_invoices {"type":"NON_GST"}"
// — i.e. it behaves like a model that ASKS for data it should not get — so this
// proves the server enforces permissions regardless of what the model wants.
// Run after scripts/e2e-verify.mjs on the same database, with the app started as:
//   GEMINI_API_KEY=test-key GEMINI_API_BASE=http://localhost:3999 npm run start -- -p 3100
//   BASE_URL=http://localhost:3100 node scripts/ai-verify.mjs
import http from "node:http";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const BASE = process.env.BASE_URL || "http://localhost:3100";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();

/* ---------------------------------------------------- stand-in provider */
const seen = [];
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    seen.push({ url: req.url, key: req.headers["x-goog-api-key"], body });
    const contents = body.contents ?? [];
    const last = contents[contents.length - 1];
    const firstUser = contents.find((c) => c.role === "user")?.parts?.[0]?.text ?? "";
    const lastUserText = [...contents].reverse().find((c) => c.role === "user" && c.parts?.[0]?.text)?.parts[0].text ?? "";
    const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (lastUserText.startsWith("ERROR")) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Gemini API internal error at generativelanguage.googleapis.com" } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const fr = last?.parts?.find((p) => p.functionResponse);
    if (fr && !lastUserText.startsWith("LOOP")) {
      const text = "RESULT " + JSON.stringify(last.parts.map((p) => p.functionResponse.response));
      sse({ candidates: [{ content: { role: "model", parts: [{ text: text.slice(0, 20) }] } }] });
      sse({ candidates: [{ content: { role: "model", parts: [{ text: text.slice(20) }] }, finishReason: "STOP" }] });
      return res.end();
    }
    const m = /^(?:CALL|LOOP) (\w+)\s*(\{.*\})?/.exec(lastUserText);
    if (m && body.toolConfig?.functionCallingConfig?.mode !== "NONE") {
      sse({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: m[1], args: JSON.parse(m[2] || "{}") }, thoughtSignature: "sig-123" }] } }] });
      return res.end();
    }
    sse({ candidates: [{ content: { role: "model", parts: [{ text: `Hello from the model (${firstUser.slice(0, 20)})` }] }, finishReason: "STOP" }] });
    res.end();
  });
});
await new Promise((r) => mock.listen(3999, r));

/* --------------------------------------------------------------- helpers */
async function login(email, password) {
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return r.headers.get("set-cookie").split(";")[0];
}
async function chat(cookie, question, extra = {}) {
  const r = await fetch(BASE + "/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ messages: [{ role: "user", content: question }], ...extra }) });
  if (!r.headers.get("content-type")?.includes("ndjson")) return { status: r.status, json: await r.json().catch(() => null), events: [], text: "" };
  const events = (await r.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  return { status: r.status, events, text, result: text.startsWith("RESULT ") ? JSON.parse(text.slice(7))[0] : null };
}
const declared = () => (seen[seen.length - 1].body.tools?.[0]?.functionDeclarations ?? []).map((d) => d.name).sort();

const admin = await login("admin@test.local", "adminpass123");
const fm = await login("fm1@test.local", "password123");
const qc = await login("qc@test.local", "password123");
const tax = await login("tax@test.local", "password123");

/* --------------------------------------------------------------- checks */
ok((await fetch(BASE + "/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) })).status === 401, "signed-out request refused (401)");
ok((await (await fetch(BASE + "/api/ai/chat", { headers: { cookie: admin } })).json()).data.enabled === true, "Intense AI reports enabled when the key is set");

let r = await chat(admin, "Hello");
ok(r.text.startsWith("Hello from the model") && r.events.at(-1).type === "done", "plain answer streams back and finishes");
await fetch(BASE + "/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json", cookie: admin }, body: JSON.stringify({ messages: [{ role: "assistant", content: "Welcome" }, { role: "user", content: "first try" }, { role: "user", content: "Hello again" }] }) }).then((x) => x.text());
ok(JSON.stringify(seen.at(-1).body.contents.map((c) => c.role)) === '["user"]' && seen.at(-1).body.contents[0].parts[0].text.includes("Hello again"), "history after a failed answer is merged into one user turn");
ok(seen.at(-1).key === "test-key" && seen.at(-1).url.includes(":streamGenerateContent?alt=sse"), "server calls the provider with the server-side key (streaming)");
ok(seen.at(-1).body.systemInstruction.parts[0].text.includes("You are INTENSE AI"), "assistant is instructed to be Intense AI");

r = await chat(admin, 'CALL get_revenue_summary {"period":"all_time","compare_previous":true}');
ok(r.events.some((e) => e.type === "status" && e.text === "Checking revenue"), "tool progress shown to the user ('Checking revenue')");
ok(typeof r.result?.result?.current?.billed === "number", `admin revenue tool returns real figures (billed ₹${r.result?.result?.current?.billed})`);
ok(seen.at(-1).body.contents.some((c) => c.role === "model" && c.parts.some((p) => p.thoughtSignature === "sig-123")), "model turn echoed back verbatim (thought signature kept)");
ok(declared().includes("get_revenue_summary") && declared().includes("get_field_manager_performance") && declared().includes("get_customer_feedback"), "admin is offered the full business toolset");

r = await chat(admin, 'CALL get_business_metrics {"period":"all_time"}');
const bm = r.result?.result;
ok(bm?.jobs?.booked >= 1 && "revenue" in bm && "firstTimePassRatePercent" in bm.quality, "admin business metrics include jobs, quality and revenue");

// Tax Officer — GST only, whatever the model asks for
await chat(tax, "Hello");
ok(JSON.stringify(declared()) === JSON.stringify(["get_gst_summary", "get_invoices"]), `Tax Officer is offered only GST tools (${declared().join(", ")})`);
r = await chat(tax, 'CALL get_revenue_summary {}');
ok(/Not permitted/.test(r.result?.result?.error ?? ""), "Tax Officer: model asking for revenue → Not permitted");
r = await chat(tax, 'CALL get_jobs {}');
ok(/Not permitted/.test(r.result?.result?.error ?? ""), "Tax Officer: model asking for jobs → Not permitted");
r = await chat(tax, 'CALL get_invoices {"type":"NON_GST","period":"all_time"}');
ok(/Not permitted/.test(r.result?.result?.error ?? ""), "Tax Officer: model asking for Non-GST invoices → Not permitted");
r = await chat(tax, 'CALL get_invoices {"type":"ALL","period":"all_time","limit":50}');
const taxInv = r.result?.result?.invoices ?? [];
const gstCount = Number(sql(`select count(*) from "Invoice" where "invoiceType"='GST'`));
ok(taxInv.length > 0 && taxInv.every((i) => i.type === "GST") && r.result.result.count === gstCount && taxInv.every((i) => !("paid" in i)), `Tax Officer: type=ALL still returns GST invoices only (${taxInv.length}/${gstCount}), no payment details`);
r = await chat(tax, 'CALL get_gst_summary {"period":"all_time"}');
ok(r.result?.result?.totals?.invoices === gstCount, "Tax Officer: GST summary counts GST invoices only");

// Field Manager — assigned jobs only, no money
const fmJobs = (await (await fetch(BASE + "/api/jobs", { headers: { cookie: fm } })).json()).data;
r = await chat(fm, 'CALL get_jobs {"period":"all_time","limit":50}');
const fmAi = r.result?.result;
ok(fmAi?.total === fmJobs.length && fmAi.jobs.every((j) => fmJobs.some((x) => x.jobNumber === j.jobId)), `Field Manager: jobs tool = exactly their assigned jobs (${fmAi?.total})`);
ok(fmAi.jobs.every((j) => !("amount" in j)), "Field Manager: no job amounts");
ok(!declared().includes("get_revenue_summary") && !declared().includes("get_business_metrics") && declared().includes("get_my_work_summary"), "Field Manager is not offered revenue / business tools");
const otherJob = sql(`select "jobSerial" from "Job" where coalesce("assignedManagerId",'') <> (select id from "User" where email='fm1@test.local') and not ((select id from "User" where email='fm1@test.local') = any("assignedStaffIds")) limit 1`);
r = await chat(fm, `CALL get_job_details {"job_id":"${otherJob}"}`);
ok(/Not permitted/.test(r.result?.result?.error ?? ""), `Field Manager: another team's job ${otherJob} → Not permitted`);
r = await chat(fm, 'CALL get_revenue_summary {}');
ok(/Not permitted/.test(r.result?.result?.error ?? ""), "Field Manager: model asking for revenue → Not permitted");
r = await chat(fm, 'CALL get_customers {"segment":"all"}');
const fmCustomers = (await (await fetch(BASE + "/api/customers", { headers: { cookie: fm } })).json()).data;
ok(r.result?.result?.totalCustomers === fmCustomers.length && r.result.result.customers.every((c) => !("phone" in c) && !("totalBookedValue" in c)), "Field Manager: customers limited to their jobs, no phone or money");

// QC — quality data, no money
r = await chat(qc, 'CALL get_qc_report {"period":"all_time"}');
ok(r.result?.result?.inspections >= 1 && "firstTimePassRatePercent" in r.result.result, "QC: QC report works");
ok(JSON.stringify(declared()) === JSON.stringify(["get_job_details", "get_jobs", "get_qc_report", "get_rework_report"]), `QC is offered quality tools only (${declared().join(", ")})`);
r = await chat(qc, 'CALL get_invoices {}');
ok(/Not permitted/.test(r.result?.result?.error ?? ""), "QC: model asking for invoices → Not permitted");
r = await chat(qc, 'CALL get_jobs {"period":"all_time"}');
ok(r.result?.result?.jobs?.every((j) => !("amount" in j)), "QC: jobs carry no amounts");

// Customer — their own job only, via the QR token
const jobId = sql(`select id from "Job" where status='COMPLETED' limit 1`);
const link = (await (await fetch(BASE + "/api/qr-links", { method: "POST", headers: { cookie: admin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "get", jobId }) })).json()).data.linkUrl;
const token = link.split("/").pop();
r = await chat(null, "CALL get_my_service {}", { token });
ok(r.result?.result?.jobId === sql(`select "jobSerial" from "Job" where id='${jobId}'`), "Customer (QR token): sees their own service");
ok(JSON.stringify(declared()) === JSON.stringify(["get_my_service"]), "Customer is offered only their own service");
// What the real provider rejects: OBJECT schemas without properties, conversations not starting with the user.
ok(seen.every((x) => (x.body.tools?.[0]?.functionDeclarations ?? []).every((d) => !d.parameters || Object.keys(d.parameters.properties ?? {}).length > 0)), "no tool is declared with an empty parameter object");
ok(seen.every((x) => x.body.contents[0].role === "user" && x.body.contents.every((c, i) => i === 0 || c.role !== x.body.contents[i - 1].role)), "every request starts with the user and alternates roles");
ok(seen.every((x) => x.body.generationConfig?.thinkingConfig?.thinkingBudget > 0), "thinking is capped so answers are not cut off");
r = await chat(null, 'CALL get_jobs {}', { token });
ok(/Not permitted/.test(r.result?.result?.error ?? ""), "Customer: model asking for all jobs → Not permitted");
r = await chat(null, 'CALL get_customers {}', { token });
ok(/Not permitted/.test(r.result?.result?.error ?? ""), "Customer: model asking for other customers → Not permitted");
ok((await chat(null, "hi", { token: token.slice(0, -3) + "xyz" })).status >= 400, "Customer: tampered token refused");

// Robustness + branding
r = await chat(admin, "ERROR please");
const err = r.events.find((e) => e.type === "error");
ok(err && !/gemini|google/i.test(err.message), `provider failure becomes a plain message: "${err?.message}"`);
r = await chat(admin, 'LOOP get_jobs {}');
ok(r.events.at(-1).type === "done" && seen.at(-1).body.toolConfig.functionCallingConfig.mode === "NONE", "endless tool calling is cut off (final round answers without tools)");
ok((await chat(admin, "x".repeat(4001))).status === 400, "over-long question refused");

const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
walk(".next/static");
const leaks = files.filter((f) => /\.(js|css|html)$/.test(f) && /gemini|GEMINI_API_KEY|generativelanguage/i.test(fs.readFileSync(f, "utf8")));
ok(leaks.length === 0, `browser bundles never mention the provider or key (${leaks.length} files)`);

mock.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
