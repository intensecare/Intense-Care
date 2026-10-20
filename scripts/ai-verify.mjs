// Intense AI security + plumbing check, with a stand-in AI provider (Groq's OpenAI-compatible
// chat completions wire format).
//
// The stand-in obeys scripted questions like `CALL get_invoices {"type":"NON_GST"}`
// — i.e. it behaves like a model that ASKS for data it should not get — so this
// proves the server enforces permissions regardless of what the model wants.
// Run after scripts/e2e-verify.mjs on the same database, with the app started as:
//   GROQ_API_KEY=test-key GROQ_API_BASE=http://localhost:3999 npm run start -- -p 3100
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
    seen.push({ url: req.url, auth: req.headers["authorization"], body });
    const messages = body.messages ?? [];
    const last = messages[messages.length - 1];
    const firstUser = messages.find((m) => m.role === "user")?.content ?? "";
    const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (lastUserText.startsWith("ERROR")) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Groq API internal error", type: "server_error" } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (last?.role === "tool" && !lastUserText.startsWith("LOOP")) {
      // Gather every trailing "tool" message (one round can answer several parallel calls).
      const trailing = [];
      for (let i = messages.length - 1; i >= 0 && messages[i].role === "tool"; i--) trailing.unshift(messages[i]);
      const text = "RESULT " + JSON.stringify(trailing.map((t) => JSON.parse(t.content)));
      sse({ choices: [{ index: 0, delta: { role: "assistant", content: text.slice(0, 20) }, finish_reason: null }] });
      sse({ choices: [{ index: 0, delta: { content: text.slice(20) }, finish_reason: "stop" }] });
      return res.end();
    }
    const m = /^(?:CALL|LOOP) (\w+)\s*(\{.*\})?/.exec(lastUserText);
    if (m && body.tool_choice !== "none") {
      sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_test_1", type: "function", function: { name: m[1], arguments: m[2] || "{}" } }] }, finish_reason: null }] });
      sse({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      return res.end();
    }
    sse({ choices: [{ index: 0, delta: { role: "assistant", content: `Hello from the model (${firstUser.slice(0, 20)})` }, finish_reason: "stop" }] });
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
const declared = () => (seen[seen.length - 1].body.tools ?? []).map((t) => t.function.name).sort();

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
ok(JSON.stringify(seen.at(-1).body.messages.map((m) => m.role)) === '["system","user"]' && seen.at(-1).body.messages[1].content.includes("Hello again"), "history after a failed answer is merged into one user turn (after the system prompt)");
ok(seen.at(-1).auth === "Bearer test-key" && seen.at(-1).url.includes("/chat/completions"), "server calls the provider with the server-side key (streaming)");
ok(seen.at(-1).body.messages[0].role === "system" && seen.at(-1).body.messages[0].content.includes("You are INTENSE AI"), "assistant is instructed to be Intense AI");

r = await chat(admin, 'CALL get_revenue_summary {"period":"all_time","compare_previous":true}');
ok(r.events.some((e) => e.type === "status" && e.text === "Checking revenue"), "tool progress shown to the user ('Checking revenue')");
ok(typeof r.result?.result?.current?.billed === "number", `admin revenue tool returns real figures (billed ₹${r.result?.result?.current?.billed})`);
ok(declared().includes("get_revenue_summary") && declared().includes("get_field_manager_performance") && declared().includes("get_customer_feedback"), "admin is offered the full business toolset");

r = await chat(admin, 'CALL get_business_metrics {"period":"all_time"}');
const bm = r.result?.result;
ok(bm?.jobs?.booked >= 1 && "revenue" in bm && "firstTimePassRatePercent" in bm.quality, "admin business metrics include jobs, quality and revenue");

// Intense AI is for internal ERP users (ai.use) — Admin, Field Manager, QC and Tax Officer all now
// get it, each scoped to exactly what their existing permissions already allow (no new role access
// was invented; ai.use was simply missing from three of the four roles' grants until now).
for (const [who, c, expectTools, forbidTools] of [
  ["Field Manager", fm, ["get_jobs", "get_my_work_summary", "get_qc_report", "get_rework_report", "get_customers"], ["get_leads", "get_revenue_summary", "get_business_metrics", "get_gst_summary"]],
  ["QC", qc, ["get_qc_report", "get_rework_report", "get_jobs"], ["get_leads", "get_revenue_summary", "get_customers", "get_gst_summary"]],
  ["Tax Officer", tax, ["get_invoices", "get_gst_summary"], ["get_leads", "get_revenue_summary", "get_jobs", "get_customers", "get_business_metrics"]],
]) {
  const res = await chat(c, "Hello");
  ok(res.status === 200 && res.text.startsWith("Hello from the model"), `${who}: Intense AI now answers (ai.use was missing before this fix)`);
  ok((await fetch(BASE + "/api/ai/chat", { headers: { cookie: c } })).status === 200, `${who}: AI status check succeeds`);
  const d = declared();
  for (const t of expectTools) ok(d.includes(t), `${who}: offered ${t}`);
  for (const t of forbidTools) ok(!d.includes(t), `${who}: NOT offered ${t} (no permission for it)`);
}

// Defense in depth: even a tool never DECLARED to a role is refused server-side if a (compromised)
// model asks for it anyway — the model's own tool list is never the security boundary.
r = await chat(tax, 'CALL get_leads {}'); // leads.view is Admin-only
ok(/Not permitted/.test(r.result?.result?.error ?? JSON.stringify(r.result)), "Tax Officer: undeclared get_leads call is refused server-side");
r = await chat(fm, 'CALL get_revenue_summary {}'); // finance.view — Field Manager never has it
ok(/Not permitted/.test(r.result?.result?.error ?? JSON.stringify(r.result)), "Field Manager: undeclared get_revenue_summary call is refused server-side");

// get_leads — the new Customers & Leads tool, Admin-only (leads.view), real data, correctly shaped.
r = await chat(admin, 'CALL get_leads {"segment":"due_followup"}');
const leadsResult = r.result?.result;
ok(leadsResult && "byStatus" in leadsResult && "winRatePercent" in leadsResult && "totalLeads" in leadsResult, "Admin: get_leads returns byStatus / winRatePercent / totalLeads");
ok(Array.isArray(leadsResult?.leads), "…and the matching leads themselves");

// Intense AI is internal-only now — there is no customer path at all, token or otherwise.
ok((await chat(null, "hi")).status >= 400, "No session, no token field → refused outright");
const jobId = sql(`select id from "Job" where status='COMPLETED' limit 1`);
const link = (await (await fetch(BASE + "/api/qr-links", { method: "POST", headers: { cookie: admin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "get", jobId }) })).json()).data.linkUrl;
const token = link.split("/").pop();
const beforeCustomer = seen.length;
ok((await chat(null, "CALL get_my_service {}", { token })).status >= 400, "A request carrying a valid customer QR token is STILL refused — token is not a bypass, the field is simply ignored");
ok(seen.length === beforeCustomer, "…and nothing was sent to the AI provider for it");
ok((await fetch(BASE + `/api/ai/chat?token=${encodeURIComponent(token)}`)).status >= 400, "GET with ?token= no longer grants access either");
ok(!seen.some((x) => (x.body.tools ?? []).some((t) => t.function.name === "get_my_service")), "get_my_service no longer exists as a tool at all");
ok(seen.every((x) => x.body.messages[0]?.role === "system" && (x.body.messages[1]?.role ?? "user") === "user"), "every request opens with the system prompt then the user");
ok(seen.every((x) => x.body.reasoning_effort === "low"), "reasoning effort is capped so answers are not slow or cut off");

// Robustness + branding
r = await chat(admin, "ERROR please");
const err = r.events.find((e) => e.type === "error");
ok(err && !/groq|gemini|google/i.test(err.message), `provider failure becomes a plain message: "${err?.message}"`);
r = await chat(admin, 'LOOP get_jobs {}');
ok(r.events.at(-1).type === "done" && seen.at(-1).body.tool_choice === "none", "endless tool calling is cut off (final round forced to answer without tools)");
ok((await chat(admin, "x".repeat(4001))).status === 400, "over-long question refused");

const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
walk(".next/static");
const leaks = files.filter((f) => /\.(js|css|html)$/.test(f) && /groq|GROQ_API_KEY|gemini|generativelanguage/i.test(fs.readFileSync(f, "utf8")));
ok(leaks.length === 0, `browser bundles never mention the provider or key (${leaks.length} files)`);

mock.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
