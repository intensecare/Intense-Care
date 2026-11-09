// Browser checks (Playwright / Chromium) for the WhatsApp inbox (Leads → WhatsApp inbox) and Settings → WhatsApp.
// Run after scripts/whatsapp-verify.mjs on the same server/DB (needs its conversations), fake Graph on :3998.
//   DATABASE_URL=… BASE_URL=http://localhost:3100 SHOTS=/some/dir node scripts/whatsapp-ui-verify.mjs
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const FAKE = process.env.FAKE_URL || "http://localhost:3998";
const SHOTS = process.env.SHOTS;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q).replace(/\$/g, "\\$")}`).toString().trim();
const pwPath = process.env.PLAYWRIGHT_PATH || createRequire(import.meta.url).resolve("playwright", { paths: [execSync("npm root -g").toString().trim()] });
const pw = await import(pathToFileURL(pwPath).href);
const chromium = pw.chromium ?? pw.default.chromium;
const login = async (email, password) => (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).headers.get("set-cookie").split(";")[0];
const adminCk = await login("admin@test.local", "adminpass123");
const fmCk = await login("fm1@test.local", "password123");
const post = async (payload) => { const raw = JSON.stringify(payload); return fetch(BASE + "/api/webhooks/whatsapp", { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=" + createHmac("sha256", "wa-secret").update(raw).digest("hex") }, body: raw }); };
const ts = () => String(Math.floor(Date.now() / 1000));
const wrap = (v) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "100200300", display_phone_number: "919999900000" }, ...v } }] }] });

const UI = "919877700123";
await post(wrap({ contacts: [{ wa_id: UI, profile: { name: "Browser Customer" } }], messages: [{ from: UI, id: "wamid.UI" + Date.now(), timestamp: ts(), type: "text", text: { body: "Is Saturday possible for a deep clean?" } }] }));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
async function open(cookie, viewport) {
  const ctx = await browser.newContext({ viewport, baseURL: BASE, hasTouch: viewport.width < 600 });
  await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: BASE }]);
  return ctx.newPage();
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

/* desktop */
let p = await open(adminCk, { width: 1280, height: 860 });
await p.goto("/leads");
await p.getByRole("link", { name: /WhatsApp inbox/ }).waitFor();
ok(true, "Leads page links to the WhatsApp inbox");
await p.getByRole("link", { name: /WhatsApp inbox/ }).click();
await p.waitForURL(/\/leads\/inbox/);
await p.getByText("Browser Customer").first().waitFor();
ok(await p.getByLabel(/1 unread/).first().isVisible(), "unread count badge on the conversation");
await p.getByText("Browser Customer").first().click();
await p.getByText("Is Saturday possible for a deep clean?").waitFor();
ok(true, "opening the conversation shows the customer's message");
await p.waitForTimeout(800);
ok(sql(`select "unreadCount" from "WhatsAppContact" where "waId"='${UI}'`) === "0", "opening it marks it read");
await p.locator('textarea[aria-label="Message"]').fill("Yes, Saturday 10 am works. Shall we book it?");
await p.getByRole("button", { name: "Send", exact: true }).click();
await p.locator("p", { hasText: "Yes, Saturday 10 am works. Shall we book it?" }).last().waitFor();
const bubble = p.locator('[data-status]').last();
await bubble.waitFor();
ok((await bubble.getAttribute("data-status")) === "ACCEPTED" && /Accepted/.test(await bubble.innerText()), "just-sent reply shows 'Accepted', not delivered");
const wamid = sql(`select "providerMessageId" from "WhatsAppMessage" where body='Yes, Saturday 10 am works. Shall we book it?' order by "createdAt" desc limit 1`);
for (const st of ["sent", "delivered", "read"]) await post(wrap({ statuses: [{ id: wamid, status: st, recipient_id: UI, timestamp: ts() }] }));
await p.waitForFunction(() => document.querySelector('[data-status="READ"]'), null, { timeout: 20000 });
ok(true, "after WhatsApp's status webhooks the tick turns to Read (page refreshes itself)");
await shot(p, "inbox-desktop");
// filters + search
await p.getByRole("tab", { name: "Unread" }).click();
await p.waitForTimeout(500);
ok(await p.getByRole("tab", { name: "Unread" }).getAttribute("aria-selected") === "true", "unread filter tab selected (the read conversation drops out of the list)" );
await p.getByRole("tab", { name: "All" }).click();
await p.getByLabel("Search conversations").fill("98777 00123".replace(/\s/g, ""));
await p.getByText("Browser Customer").first().waitFor();
ok(true, "search by phone finds the conversation");
// closed window → composer switches to templates
sql(`update "WhatsAppContact" set "lastInboundAt" = now() - interval '30 hours' where "waId"='${UI}'`);
await p.getByLabel("Search conversations").fill("");
await p.getByText("Browser Customer").first().click();
await p.getByText(/24-hour reply window is closed/).first().waitFor();
ok(await p.locator('textarea[aria-label="Message"]').count() === 0, "after 24 h there is no free-text box, only templates");
await shot(p, "inbox-window-closed");
// opt-out
await p.getByLabel("Customer opted out").click();
await p.getByText(/opted out\. Nothing can be sent/).waitFor();
ok(true, "ticking 'opted out' removes every way to send");
await p.getByLabel("Customer opted out").click();
await p.waitForTimeout(600);

/* phone */
p = await open(adminCk, { width: 390, height: 800 });
await p.goto("/leads/inbox");
await p.getByText("Browser Customer").first().waitFor();
ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "inbox list has no horizontal scroll on a phone");
await p.getByText("Browser Customer").first().click();
await p.getByRole("button", { name: "Back to conversations" }).waitFor();
ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "conversation view has no horizontal scroll on a phone");
await shot(p, "inbox-phone");

/* settings */
p = await open(adminCk, { width: 1280, height: 1000 });
await p.goto("/settings/whatsapp");
await p.getByRole("heading", { name: /WhatsApp Business/ }).waitFor();
const text = await p.locator("main, body").first().innerText();
ok(/WHATSAPP_ACCESS_TOKEN/.test(text) && (text.match(/Configured/g) || []).length >= 3, "settings page shows the three secrets as Configured");
ok(!text.includes("wa-test-token") && !text.includes("wa-secret") && !text.includes("verify-me"), "no secret value appears on the page");
await p.getByRole("button", { name: /Test connection/ }).click();
await p.getByText(/Connected to Intense Care/).waitFor();
ok(true, "Test connection reports the verified business name");
ok(await p.getByText(/\/api\/webhooks\/whatsapp/).first().isVisible(), "callback URL shown");
await shot(p, "settings-whatsapp");

/* non-admin */
p = await open(fmCk, { width: 1280, height: 800 });
await p.goto("/settings/whatsapp");
await p.waitForTimeout(1200);
const t2 = await p.locator("body").innerText();
ok(!/Configured/.test(t2) && !t2.includes("WHATSAPP_ACCESS_TOKEN"), "a Field Operations Manager does not get the integration page");
await p.goto("/leads/inbox");
await p.waitForTimeout(1200);
ok(!(await p.getByText("Browser Customer").count()), "…nor the WhatsApp inbox");

await browser.close();
console.log(`\nwhatsapp-ui-verify: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
