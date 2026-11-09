// Browser checks (Playwright / Chromium) for the fast quotation form, quote → job dialog, Quick Create Job and the PDF
// preview — desktop and phone widths. Run after scripts/e2e-verify.mjs on the same server/DB.
//   DATABASE_URL=… BASE_URL=http://localhost:3100 CHROMIUM_PATH=… SHOTS=dir node scripts/fast-flow-ui-verify.mjs
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const SHOTS = process.env.SHOTS;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q).replace(/\$/g, "\\$")}`).toString().trim();
const pwPath = process.env.PLAYWRIGHT_PATH || createRequire(import.meta.url).resolve("playwright", { paths: [execSync("npm root -g").toString().trim()] });
const pw = await import(pathToFileURL(pwPath).href);
const chromium = pw.chromium ?? pw.default.chromium;
const login = async (email, password) => (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).headers.get("set-cookie").split(";")[0];
const adminCk = await login("admin@test.local", "adminpass123");
const api = async (p, body) => (await fetch(BASE + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", cookie: adminCk }, body: body ? JSON.stringify(body) : undefined })).json();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
async function open(viewport) {
  const ctx = await browser.newContext({ viewport, baseURL: BASE, hasTouch: viewport.width < 600 });
  await ctx.addCookies([{ name: adminCk.split("=")[0], value: adminCk.split("=").slice(1).join("="), url: BASE }]);
  const p = await ctx.newPage();
  p.setDefaultTimeout(20000);
  return p;
}
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const propCount = () => Number(sql(`select count(*) from "Property"`));

// seed: an existing customer with one property, a service, and an accepted quotation with only a typed address
const svc = (await api("/api/services")).data?.[0];
const ex = (await api("/api/customers", { name: "Browser Existing", phone: "+919822200101" })).data;
await api("/api/properties", { customerId: ex.id, title: "Browser Home", address: "5 Elm Street, Whitefield" });
const accepted = (await api("/api/quotations", { customerId: ex.id, items: [{ description: "Carpet cleaning", quantity: 2, rate: 1500 }], validUntil: "2030-01-01", serviceAddress: "77 Typed Lane, HSR Layout, Bengaluru", status: "sent" })).data;
await api(`/api/quotations/${accepted.id}`, { action: "accept" });

/* ---------------------------------------------------------------- quotation form, desktop */
let p = await open({ width: 1280, height: 900 });
await p.goto("/quotations/new");
const props0 = propCount();
const search = p.getByRole("combobox", { name: /Search customer/ });
await search.waitFor();
await search.fill("Brand New Co");
await p.getByRole("option", { name: /New customer “Brand New Co”/ }).click();
ok(await p.getByLabel("Name").inputValue() === "Brand New Co", "typing a new name and choosing “New customer” fills the inline form — no page change");
await p.getByLabel("Phone").fill("+91 98222 00102");
await p.getByRole("button", { name: "Make custom" }).first().click();
await p.getByLabel("Line 1 description").fill("Balcony glass deep clean");
await p.getByLabel("Rate (₹)").fill("2000");
await p.getByLabel("Qty").fill("2");
await p.getByLabel("Service address").fill("Flat 9, Skyline Towers, Marathahalli, Bengaluru");
ok((await p.locator("text=Total").first().isVisible()), "totals update while typing");
await shot(p, "quote-form-desktop");
await p.getByRole("button", { name: "Generate PDF" }).click();
await p.waitForURL(/\/quotations\/[^/]+\?view=pdf/);
const qid = /quotations\/([^/?]+)/.exec(p.url())[1];
ok(propCount() === props0, "a quotation for a new customer was created without any property");
ok(sql(`select "propertyId" is null and "serviceAddress"='Flat 9, Skyline Towers, Marathahalli, Bengaluru' from "Quote" where id='${qid}'`) === "t", "…and keeps the typed service address");
ok(sql(`select c.name||'|'||c.phone from "Customer" c join "Quote" q on q."customerId"=c.id where q.id='${qid}'`) === "Brand New Co|+91 98222 00102", "the new customer was saved");
await p.locator('iframe[title="PDF preview"]').waitFor();
ok((await p.locator('iframe[title="PDF preview"]').getAttribute("src")).startsWith(`/api/quotations/${qid}/pdf?inline=1`), "“Generate PDF” opens the server PDF preview");
ok(await p.getByRole("link", { name: /Download PDF/ }).getAttribute("href") === `/api/quotations/${qid}/pdf`, "Download PDF links to the server-generated file");
await shot(p, "quote-detail-pdf");

// existing customer by phone, recents, property fills address
await p.goto("/quotations/new");
await p.getByRole("combobox", { name: /Search customer/ }).fill("98222 00101");
await p.getByRole("option", { name: /Browser Existing/ }).first().click();
ok(await p.getByText("Browser Existing").first().isVisible(), "an existing customer is found by phone number");
await p.getByLabel("Saved property").selectOption({ label: "Browser Home — 5 Elm Street, Whitefield" });
ok((await p.getByLabel("Service address").inputValue()).includes("5 Elm Street"), "choosing a property fills in its address");
await p.goto("/quotations/new");
await p.getByRole("combobox", { name: /Search customer/ }).focus();
await p.keyboard.type("browser exi");
await p.getByRole("option", { name: /Browser Existing/ }).first().waitFor();
await p.keyboard.press("Enter");
ok(await p.getByRole("button", { name: "Change customer" }).isVisible(), "keyboard only: type a few letters, Enter selects the first match");

/* ---------------------------------------------------------------- convert dialog */
await p.goto(`/quotations/${accepted.id}`);
await p.getByRole("button", { name: /Convert to Job/ }).click();
ok(await p.getByLabel(/Use the quotation's service address/).isChecked(), "Convert to Job offers the quotation's service address by default");
ok(await p.getByText("77 Typed Lane, HSR Layout, Bengaluru").first().isVisible(), "…and shows it");
ok(await p.getByLabel(/Choose a saved property/).isVisible() && await p.getByLabel(/Add a new property/).isVisible(), "…or a saved property, or a quick new one");
await shot(p, "convert-dialog");
await p.getByRole("button", { name: "Create job" }).click();
await p.waitForURL(/\/jobs\/[^/]+$/);
const jid = /jobs\/([^/?]+)/.exec(p.url())[1];
ok(sql(`select q.status||'|'||(j."quoteId"=q.id)::text||'|'||j."locationAddress" from "Job" j join "Quote" q on q."jobId"=j.id where j.id='${jid}'`) === "converted_to_job|true|77 Typed Lane, HSR Layout, Bengaluru", "converted from the dialog: linked both ways, address preserved");

/* ---------------------------------------------------------------- quick job */
await p.goto("/jobs/new");
await p.getByRole("tab", { name: "Quick create" }).waitFor();
ok(await p.getByRole("tab", { name: "Advanced" }).isVisible(), "Quick create and Advanced entry points");
await p.getByRole("combobox", { name: /Search customer/ }).fill("Browser Existing");
await p.getByRole("option", { name: /Browser Existing/ }).first().click();
await p.getByLabel("Saved property").waitFor();
await p.getByLabel("Saved property").selectOption("");
const jobProps0 = propCount();
await p.getByLabel("Service address").fill("301 Quick Heights, Koramangala 5th Block, Bengaluru");
await p.getByRole("button", { name: /Search services/ }).click();
await p.getByRole("button", { name: new RegExp(svc.name.slice(0, 8)) }).first().click();
await p.getByLabel(/Choose for this job/).click();
await p.getByRole("radio", { name: /No Verification/ }).click();
await shot(p, "quick-job-desktop");
await p.getByRole("button", { name: "Create job" }).click();
await p.waitForURL((u) => /\/jobs\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith("/new"));
const qjid = /jobs\/([^/?]+)/.exec(p.url())[1];
ok(propCount() === jobProps0 + 1 && sql(`select p.address||'|'||coalesce(p.lat::text,'none')||'|'||j."startVerificationMode" from "Job" j join "Property" p on p.id=j."propertyId" where j.id='${qjid}'`) === "301 Quick Heights, Koramangala 5th Block, Bengaluru|none|DIRECT", "Quick Create Job: typed address, no GPS needed, chosen verification mode saved");
await p.goto("/jobs/new?mode=advanced");
await p.getByRole("heading", { name: "Customer" }).first().waitFor();
ok(await p.getByRole("tab", { name: "Advanced", selected: true }).isVisible(), "Advanced job creation is still available");

/* ---------------------------------------------------------------- phone */
p = await open({ width: 390, height: 800 });
for (const [path, wait] of [["/quotations/new", "Search customer"], ["/jobs/new", "Search customer"]]) {
  await p.goto(path);
  await p.getByRole("combobox", { name: new RegExp(wait) }).waitFor();
  ok(await noOverflow(p), `${path}: no horizontal scroll on a phone`);
}
await p.getByRole("combobox", { name: /Search customer/ }).fill("Brand");
await p.getByRole("option", { name: /New customer/ }).click();
ok(await noOverflow(p), "inline new-customer form fits a phone");
await shot(p, "quote-form-phone");
await p.goto(`/quotations/${qid}`);
await p.getByRole("link", { name: /Download PDF/ }).waitFor();
ok(await noOverflow(p), "quotation page with PDF actions fits a phone");
await browser.close();
console.log(`\nfast-flow-ui-verify: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
