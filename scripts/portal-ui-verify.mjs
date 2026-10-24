// Browser checks (Playwright / Chromium, phone viewport) for: the customer photo gallery + viewer, the property "paste a map link"
// control, and the customer's Pay now flow. Real server + DB; storage / short links / search are the local fakes.
//   (server and fakes as for scripts/portal-verify.mjs)   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/portal-ui-verify.mjs
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const FAKE = process.env.FAKE_URL || "http://localhost:3998";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();
const fake = async (path, body) => (await fetch(FAKE + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const pwPath = process.env.PLAYWRIGHT_PATH || createRequire(import.meta.url).resolve("playwright", { paths: [execSync("npm root -g").toString().trim()] });
const pw = await import(pathToFileURL(pwPath).href);
const chromium = pw.chromium ?? pw.default.chromium;

async function api(cookie, path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const login = async (email, password) => (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).headers.get("set-cookie").split(";")[0];
const adminCk = await login("admin@test.local", "adminpass123");
await api(adminCk, "/api/users", { method: "POST", body: { name: "Gal FM", email: "galfm@test.local", phone: "+919800000000", role: "field_operations_manager", password: "password123" } });
const fmId = sql(`select id from "User" where email='galfm@test.local'`);
const fmCk = await login("galfm@test.local", "password123");
const svc = (await api(adminCk, "/api/services", { method: "POST", body: { name: "Gallery Clean", basePrice: 3000, estimatedDurationHours: 2, checklistTemplate: [{ area: "Hall", task: "x", critical: false }] } })).json.data;
const cust = (await api(adminCk, "/api/customers", { method: "POST", body: { name: "Gita Rao", phone: "+919833300001" } })).json.data;
const prop = (await api(adminCk, "/api/properties", { method: "POST", body: { customerId: cust.id, title: "Gita Flat", address: "9 Rose Rd, Bengaluru", lat: 12.9716, lng: 77.5946, locationSource: "MAP_PIN" } })).json.data;
const today = new Date().toISOString().slice(0, 10);
const job = (await api(adminCk, "/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "09:00 - 11:00", assignedManagerId: fmId, invoiceType: "GST" } })).json.data.job;
sql(`update "Job" set status='IN_PROGRESS' where id='${job.id}'`);
const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300060001fd1b6f4d0000000049454e44ae426082", "hex"), Buffer.alloc(40)]).toString("base64");
let n = 0;
for (const [area, type, caption] of [["Hall", "before", "Dusty floor"], ["Kitchen", "before", null], ["Hall", "after", "Floor shining"], ["Kitchen", "after", null]]) {
  await api(fmCk, "/api/photos", { method: "POST", body: { jobId: job.id, area, photoType: type, image: PNG, caption: caption ?? undefined, clientUploadId: `gal-photo-${++n}-xxxx` } });
}
sql(`insert into "JobPhoto"(id,"jobId",area,"photoType","cloudinaryPublicId","photoUrl","uploadedByUserId","uploadedByName",caption) values ('gal_qc','${job.id}','Hall','qc','x','http://localhost:3998/img/qc.png','${fmId}','QC','INTERNAL QC NOTE')`);
const token = (await api(adminCk, "/api/qr-links", { method: "POST", body: { action: "get", jobId: job.id } })).json.data.linkUrl.split("/").pop();
await api(adminCk, "/api/settings", { method: "PATCH", body: { upi: { enabled: true, vpa: "intensecare@okhdfcbank", payeeName: "Intense Care", description: "Deep cleaning" } } });
// the job's work is done and QC has passed, so the customer sees the completed stage and its photos / invoice
sql(`update "Job" set status='CUSTOMER_APPROVAL' where id='${job.id}'`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
async function page(cookie, viewport = { width: 390, height: 800 }, extra) {
  const ctx = await browser.newContext({ viewport, baseURL: BASE, hasTouch: viewport.width < 600 });
  if (cookie) await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: BASE }]);
  const p = await ctx.newPage();
  p._errors = [];
  p.on("pageerror", (e) => p._errors.push(String(e)));
  p.on("dialog", (d) => d.accept());
  if (extra) await extra(p, ctx);
  return p;
}
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/* ------------------------------------------------------------ 1. customer gallery */
{
  let p = await page(null);
  await p.goto(`/customer/service/${token}`);
  await p.getByRole("button", { name: /Reports/ }).first().click({ timeout: 20000 });
  await p.getByRole("heading", { name: /Before photos/ }).waitFor({ timeout: 15000 });
  ok(await p.getByRole("heading", { name: /Before photos \(2\)/ }).count() === 1 && await p.getByRole("heading", { name: /After photos \(2\)/ }).count() === 1, "photos are grouped: Before photos (2) and After photos (2)");
  const thumbs = p.getByRole("button", { name: /^Open photo:/ });
  ok(await thumbs.count() === 4, "four thumbnails (the internal QC photo is not shown)");
  await p.waitForFunction(() => Array.from(document.querySelectorAll("section[aria-label$='photos'] img")).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  ok(true, "every thumbnail actually loaded (naturalWidth > 0)");
  const body = await p.locator("body").innerText();
  ok(!/INTERNAL QC NOTE/.test(body), "internal QC caption is nowhere on the page");
  ok(/Hall/.test(body) && /Kitchen/.test(body) && /\d{1,2} \w{3} \d{4}/.test(body), "area names and upload dates are shown");
  ok(await noHScroll(p), "gallery: no horizontal scrolling at 390 px");
  const thumbBox = await thumbs.first().boundingBox();
  ok(thumbBox.width >= 80 && thumbBox.height >= 80, `thumbnails are tap-sized (${Math.round(thumbBox.width)}×${Math.round(thumbBox.height)})`);

  await thumbs.first().tap();
  const dlg = p.getByRole("dialog", { name: /Photo viewer/ });
  await dlg.waitFor();
  ok(/1 of 4/.test(await dlg.innerText()), "tapping a thumbnail opens the large viewer at photo 1 of 4");
  await p.waitForFunction(() => { const i = document.querySelector("[role=dialog] img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  ok(/Dusty floor/.test(await dlg.innerText()), "the viewer shows the photo's caption");
  await p.getByRole("button", { name: "Next photo" }).click();
  ok(/2 of 4/.test(await dlg.innerText()), "Next → photo 2 of 4");
  await p.keyboard.press("ArrowLeft");
  ok(/1 of 4/.test(await dlg.innerText()), "ArrowLeft → back to photo 1");
  await p.getByRole("button", { name: "Previous photo" }).click();
  ok(/4 of 4/.test(await dlg.innerText()), "Previous from the first wraps to the last");
  const img = dlg.locator("img");
  const tf = () => img.evaluate((e) => e.style.transform);
  ok(/scale\(1\)/.test(await tf()), "starts un-zoomed");
  await p.getByRole("button", { name: "Zoom in" }).click();
  await p.getByRole("button", { name: "Zoom in" }).click();
  ok(/scale\((1\.9|1\.96)/.test(await tf()), `zoom in works (${await tf()})`);
  await p.getByRole("button", { name: "Reset zoom" }).click();
  ok(/scale\(1\)/.test(await tf()), "reset zoom");
  await img.dblclick();
  ok(/scale\(2\.5\)/.test(await tf()), "double-tap zooms");
  await p.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached" });
  ok(true, "Escape closes the viewer");
  await thumbs.nth(2).tap();
  await dlg.waitFor();
  await p.getByRole("button", { name: "Close viewer" }).click();
  await dlg.waitFor({ state: "detached" });
  ok(true, "the Close button closes the viewer");

  // A storage outage is visible and recoverable, not a silent blank box
  await fake("/__control", { imgStatus: 500 });
  await p.context().close();
  const q = await page(null); // a fresh browser profile: nothing cached from the good load
  p = q;
  await p.goto(`/customer/service/${token}`);
  await p.getByRole("button", { name: /Reports/ }).first().click();
  await p.getByText("Tap to retry").first().waitFor({ timeout: 20000 });
  ok(true, "thumbnails that can't load say so (Tap to retry) instead of staying blank");
  await p.getByRole("button", { name: /^Open photo:/ }).first().tap();
  await p.getByText("This photo couldn't be loaded.").waitFor({ timeout: 15000 });
  await fake("/__control", { imgStatus: 0 });
  await p.getByRole("button", { name: "Try again" }).click();
  await p.waitForFunction(() => { const i = document.querySelector("[role=dialog] img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  ok(true, "…and Try again loads the photo once the storage is back");
  ok(p._errors.length === 0, `no uncaught page errors (${p._errors.join("; ")})`);
  await p.context().close();

  // Desktop width too
  const d = await page(null, { width: 1280, height: 800 });
  await d.goto(`/customer/service/${token}`);
  await d.getByRole("button", { name: /Reports/ }).first().click();
  await d.getByRole("heading", { name: /After photos \(2\)/ }).waitFor({ timeout: 15000 });
  ok(await d.getByRole("button", { name: /^Open photo:/ }).count() === 4, "desktop: the same gallery");
  await d.context().close();
}

/* ------------------------------------------------------------ 2. admin job page */
{
  const p = await page(adminCk, { width: 1280, height: 900 });
  await p.goto(`/jobs/${job.id}`);
  await p.getByRole("heading", { name: "Photos" }).waitFor({ timeout: 20000 });
  await p.getByRole("heading", { name: /QC photos/ }).waitFor({ timeout: 15000 });
  ok(await p.getByRole("button", { name: /^Open photo:/ }).count() === 5, "Admin sees all five photos including QC, grouped");
  await p.getByRole("button", { name: /^Open photo:/ }).last().click();
  await p.getByRole("dialog", { name: /Photo viewer/ }).waitFor();
  await p.waitForFunction(() => { const i = document.querySelector("[role=dialog] img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  ok(true, "Admin's viewer loads a staff-proxied image");
  await p.context().close();
}

/* ------------------------------------------------------------ 3. property map link */
{
  await fake("/__control", { short: { coords: "https://www.google.com/maps/place/Home/@12.9716,77.5946,17z/data=!3d12.935!4d77.614", dead: undefined }, places: [] });
  const p = await page(adminCk, { width: 390, height: 900 });
  await p.goto("/properties");
  await p.getByRole("button", { name: "Gita Flat" }).first().click({ timeout: 20000 });
  await p.getByRole("button", { name: /Edit/ }).click();
  const link = p.getByLabel("Google Maps link / location link");
  await link.waitFor();
  const lat = p.locator("#pf-loc-lat"), lng = p.locator("#pf-loc-lng");
  ok((await lat.inputValue()) === "12.9716" && (await lng.inputValue()) === "77.5946", "the property's saved pin is shown");
  ok(await p.getByRole("button", { name: "Extract Location" }).count() === 1, "the Extract Location button is there");

  // Failure never changes the saved location
  await link.fill("my flat near the park");
  await p.getByRole("button", { name: "Extract Location" }).click();
  await p.getByRole("alert").filter({ hasText: /current location was not changed/ }).waitFor({ timeout: 15000 });
  ok((await lat.inputValue()) === "12.9716" && (await lng.inputValue()) === "77.5946", "an invalid link → clear message, saved coordinates untouched");
  await link.fill("http://localhost:3998/short/doesnotexist");
  await p.getByRole("button", { name: "Extract Location" }).click();
  await p.getByRole("alert").filter({ hasText: /current location was not changed/ }).waitFor({ timeout: 15000 });
  ok((await lat.inputValue()) === "12.9716", "a dead short link → clear message, coordinates untouched");
  await link.fill("https://www.google.com/maps");
  await p.getByRole("button", { name: "Extract Location" }).click();
  await p.getByText(/No location could be read from that link/).waitFor({ timeout: 15000 });
  ok((await lat.inputValue()) === "12.9716", "a link with no location → says so, lets you place the pin by hand");

  // Success
  await link.fill("http://localhost:3998/short/coords");
  await p.getByRole("button", { name: "Extract Location" }).click();
  await p.waitForFunction(() => document.querySelector("#pf-loc-lat")?.value === "12.935", null, { timeout: 15000 });
  ok((await lat.inputValue()) === "12.935" && (await lng.inputValue()) === "77.614", "short link → latitude and longitude fields filled");
  ok(await p.locator(".leaflet-marker-icon").count() >= 1, "the pin is shown on the map");
  // manual adjustment
  await lat.fill("12.9361");
  ok((await lat.inputValue()) === "12.9361", "the pin can be adjusted manually after extraction");
  await p.getByRole("button", { name: /Save|Update/ }).last().click();
  await p.waitForFunction(() => !document.querySelector("#pf-loc-lat"), null, { timeout: 15000 });
  const row = sql(`select lat||','||lng||','||"locationSource"||','||coalesce("mapLink",'') from "Property" where id='${prop.id}'`);
  ok(row === "12.9361,77.614,MANUAL,http://localhost:3998/short/coords", `saved: manual pin + the pasted link (${row})`);

  // Saving with a failed extraction keeps the old pin
  await p.getByRole("button", { name: "Gita Flat" }).first().click();
  await p.getByRole("button", { name: /Edit/ }).click();
  await p.getByLabel("Google Maps link / location link").fill("nonsense");
  await p.getByRole("button", { name: "Extract Location" }).click();
  await p.getByRole("alert").filter({ hasText: /current location was not changed/ }).waitFor({ timeout: 15000 });
  await p.getByRole("button", { name: /Save|Update/ }).last().click();
  await p.getByText(/map link must be a web link/).waitFor({ timeout: 10000 });
  ok(true, "a pasted text that isn't a web link is refused with a plain message on save");
  await p.getByLabel("Google Maps link / location link").fill("");
  await p.getByRole("button", { name: /Save|Update/ }).last().click();
  await p.waitForFunction(() => !document.querySelector("#pf-loc-lat"), null, { timeout: 15000 });
  ok(sql(`select lat||','||lng from "Property" where id='${prop.id}'`) === "12.9361,77.614", "saving after a failed extraction does not touch the saved location");
  ok(p._errors.length === 0, `no uncaught page errors (${p._errors.join("; ")})`);
  await p.context().close();
}

/* ------------------------------------------------------------ 4. customer Pay now */
{
  const invoice = sql(`select "invoiceNumber"||'|'||total from "Invoice" where "jobId"='${job.id}'`).split("|");
  const total = Number(invoice[1]);
  const open = async (p) => { await p.goto(`/customer/service/${token}`); await p.getByRole("button", { name: /Reports/ }).first().click({ timeout: 20000 }); };
  const p = await page(null, { width: 390, height: 900 });
  await open(p);
  await p.getByRole("heading", { name: "Payment" }).waitFor({ timeout: 15000 });
  const panel = p.getByRole("region", { name: "Payment" });
  const t = await panel.innerText();
  ok(t.includes(invoice[0]) && /Job ID/.test(t) && /Invoice total/.test(t) && /Already paid/.test(t) && /Outstanding/.test(t) && /UPI/.test(t) && /Unpaid/.test(t), "payment screen shows invoice number, Job ID, total, paid so far, outstanding, method and status");
  ok(t.includes(new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(total)), "…with the invoice's outstanding amount");
  const payBtn = panel.getByRole("button", { name: /Pay now/ });
  ok(await payBtn.count() === 1, "Pay now is offered");

  const reqPromise = p.waitForEvent("request", { predicate: (r) => r.url().includes("/payment"), timeout: 15000 });
  await payBtn.click({ noWaitAfter: true });
  const req = await reqPromise;
  const reqBody = JSON.parse(req.postData() || "{}");
  ok(reqBody.action === "start" && reqBody.amount === undefined, "Pay now asks the server to prepare the payment and sends no amount");
  await p.getByText("No UPI app opened.").waitFor({ timeout: 10000 });
  ok(true, "no UPI app on this (desktop) browser → a clear fallback is shown, not a dead button");
  ok(await p.getByRole("img", { name: "UPI payment QR code" }).count() === 1, "…with a QR code to scan from a phone");
  ok(await p.getByRole("button", { name: /Copy UPI ID: intensecare@okhdfcbank/ }).count() === 1, "…and the UPI ID to copy");
  ok((await p.locator("body").innerText()).includes("Did you complete the payment?"), "the page asks for the UTR instead of assuming success");
  ok(sql(`select status from "Invoice" where "jobId"='${job.id}'`) === "UNPAID" && Number(sql(`select count(*) from "Payment" where "jobId"='${job.id}'`)) === 0, "nothing is marked paid just because Pay now was tapped");
  const submit = p.getByRole("button", { name: /I've paid/ });
  ok(await submit.isDisabled(), "'I've paid' stays disabled until a reference number is typed");
  await p.getByLabel("UTR or UPI reference number").fill("5678 1234 9900");
  await submit.evaluate((b) => b.scrollIntoView({ block: "center" })); // keep it clear of the fixed bottom tab bar
  // (headless Chromium keeps the page "navigating" after the upi: link, which swallows pointer input; a DOM click is the same handler)
  await submit.evaluate((b) => b.click());
  await p.getByText(/being checked|checking it against our bank/).first().waitFor({ timeout: 15000 });
  ok(/Payment submitted — being checked/.test(await panel.innerText()), "after submitting: status 'Payment submitted — being checked'");
  ok(await panel.getByRole("button", { name: /Pay now/ }).count() === 0, "Pay now is hidden while the payment is being checked");
  ok(sql(`select status from "Invoice" where "jobId"='${job.id}'`) === "UNPAID", "the invoice is still UNPAID until an Admin confirms");
  ok(await noHScroll(p), "payment screen: no horizontal scrolling at 390 px");
  ok(p._errors.length === 0, `no uncaught page errors (${p._errors.join("; ")})`);
  await p.context().close();

  // Admin confirms in the UI
  const a = await page(adminCk, { width: 1280, height: 1000 });
  const invId = sql(`select id from "Invoice" where "jobId"='${job.id}'`);
  await a.goto("/invoices");
  await a.getByText(/UPI payment.* waiting to be checked/).waitFor({ timeout: 20000 });
  ok(true, "Invoices page flags the payment waiting to be checked");
  await a.goto(`/invoices/${invId}`);
  await a.getByRole("heading", { name: "Customer UPI payments" }).waitFor({ timeout: 20000 });
  ok(/5678 ?1234 ?9900|567812349900/.test(await a.locator("body").innerText()), "Admin sees the customer's UTR");
  await a.getByRole("button", { name: /Confirm received/ }).click();
  await a.getByText("Payment confirmed and recorded on the invoice.").waitFor({ timeout: 15000 });
  ok(sql(`select status from "Invoice" where id='${invId}'`) === "PAID", "Admin confirms → invoice PAID");
  await a.context().close();
  const c2 = await page(null, { width: 390, height: 900 });
  await open(c2);
  await c2.getByText("Payment received. Thank you!").waitFor({ timeout: 15000 });
  ok(true, "the customer now sees 'Payment received' — only after the Admin confirmed");
  await c2.context().close();
}

await browser.close();
console.log(`\nportal-ui-verify: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
