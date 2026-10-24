// Browser check of the Android-app screens, with the native Capacitor bridge MOCKED in the page.
//
// This proves the web layer end to end: the real ERP server, the real pages and the real Capacitor JS client talk to a
// scripted stand-in for the Android plugins (ContactSync, DeviceStorage, PushNotifications …). It does NOT prove anything
// about the Java code or a real phone — see docs/ANDROID.md → "What was and wasn't tested".
//
//   server + fake providers running as for scripts/mobile-verify.mjs, then:
//   DATABASE_URL=… BASE_URL=http://localhost:3100 node scripts/mobile-ui-verify.mjs
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const FAKE = process.env.FAKE_URL || "http://localhost:3998";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c ${JSON.stringify(q)}`).toString().trim();

const pwPath = process.env.PLAYWRIGHT_PATH || createRequire(import.meta.url).resolve("playwright", { paths: [execSync("npm root -g").toString().trim()] });
const pw = await import(pathToFileURL(pwPath).href);
const chromium = pw.chromium ?? pw.default.chromium;

// ------------------------------------------------------------------ API helpers (cookie session)
async function api(cookie, path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function login(email, password) {
  const res = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return res.headers.get("set-cookie").split(";")[0];
}
const adminCookie = await login("admin@test.local", "adminpass123");

// A job with two photos, one of a finished-and-paid job (PROTECTED) so the deletion dialog has something to say.
const mk = async (name, email, role) => (await api(adminCookie, "/api/users", { method: "POST", body: { name, email, phone: "+919800000000", role, password: "password123" } })).json?.data;
await mk("UI FM", "uifm@test.local", "field_operations_manager");
const fmId = sql(`select id from "User" where email='uifm@test.local'`);
const fmCookie = await login("uifm@test.local", "password123");
const svc = (await api(adminCookie, "/api/services", { method: "POST", body: { name: "UI Clean", basePrice: 1000, estimatedDurationHours: 2, checklistTemplate: [{ area: "Hall", task: "Dust", critical: false }] } })).json.data;
const cust = (await api(adminCookie, "/api/customers", { method: "POST", body: { name: "Uma Verma", phone: "+919877711111" } })).json.data;
const prop = (await api(adminCookie, "/api/properties", { method: "POST", body: { customerId: cust.id, title: "Flat 4", address: "4 Park Rd" } })).json.data;
const today = new Date().toISOString().slice(0, 10);
const job = (await api(adminCookie, "/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "10:00 - 12:00", assignedManagerId: fmId } })).json.data.job;
const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300060001fd1b6f4d0000000049454e44ae426082", "hex"), Buffer.alloc(40)]).toString("base64");
sql(`update "Job" set status='IN_PROGRESS' where id='${job.id}'`);
const photo = (await api(fmCookie, "/api/photos", { method: "POST", body: { jobId: job.id, area: "Hall", photoType: "before", image: PNG, clientUploadId: "uiverify-photo-1" } })).json.data;
ok(!!photo?.id, "fixture: a job photo exists");
sql(`update "Job" set status='COMPLETED', "completedAt"=now() where id='${job.id}'`);
sql(`update "Invoice" set status='PAID' where "jobId"='${job.id}'`);

// ------------------------------------------------------------------ the mocked Android side
const DEVICE_ID = "andtestdevice0000000000000001";
const native = {
  calls: [],
  perm: "prompt",
  grantOnRequest: true,
  cs: { enabled: false, paused: false, token: null, userId: null, lastRun: null, running: false },
  pushPerm: "prompt",
  cacheBytes: 5 * 1024 * 1024,
};
function status() {
  const s = native.cs;
  return {
    supported: true, deviceId: DEVICE_ID, enabled: s.enabled, paused: s.paused, running: s.running,
    permission: native.perm, permissionBlocked: false, userId: s.userId, lastRun: s.lastRun,
    nextAttemptAt: s.enabled ? Date.now() + 6 * 3600e3 : null, pendingBatches: 0, failedRecords: 0, contactsOnPhone: 3,
  };
}
async function realSync(trigger) {
  // What the native worker does, minus Java: post one batch with the phone's scoped token.
  const res = await fetch(BASE + "/api/mobile/contacts/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${native.cs.token}` },
    body: JSON.stringify({ runId: "ui-run-" + Date.now(), trigger: trigger === "MANUAL" && !native.cs.lastRun ? "INITIAL" : trigger, batchIndex: 0, batchCount: 1, idempotencyKey: "ui-key-" + Date.now(), scannedTotal: 3, final: true, removedIds: [],
      contacts: [{ id: "u1", name: "Ravi Kumar", phones: ["+919811100001"] }, { id: "u2", name: "Asha Rao Mobile", phones: ["+919877711111"] }, { id: "u3", name: "Twin A", phones: ["+919811100003"] }, { id: "u4", name: "Twin B", phones: ["09811100003"] }] }),
  });
  const j = await res.json().catch(() => null);
  native.cs.lastRun = { at: Date.now(), trigger, ok: res.ok, errorCode: res.ok ? null : "SERVER", scanned: 3, added: j?.data?.added ?? 0, updated: j?.data?.updated ?? 0, removed: 0, skipped: 0, duplicates: j?.data?.duplicates ?? 0, failed: 0 };
}
async function nativeCall(plugin, method, options) {
  native.calls.push(`${plugin}.${method}`);
  if (plugin === "ContactSync") {
    switch (method) {
      case "getStatus": return status();
      case "requestPermission": native.perm = native.grantOnRequest ? "granted" : "denied"; return { permission: native.perm, blocked: !native.grantOnRequest };
      case "enable": Object.assign(native.cs, { enabled: true, paused: false, token: options.token, userId: options.userId }); native.cs.enableOptions = options; return status();
      case "syncNow": await realSync(options?.trigger ?? "MANUAL"); return { started: true };
      case "retryFailed": return { started: true };
      case "pause": native.cs.paused = true; return status();
      case "resume": native.cs.paused = false; return status();
      case "disable": Object.assign(native.cs, { enabled: false, token: null, lastRun: null }); return status();
      case "signedIn": return { switched: false };
      case "signedOut": return {};
      case "openAppSettings": return {};
      case "addListener": return { id: "x" };
      default: return {};
    }
  }
  if (plugin === "DeviceStorage") {
    if (method === "getInfo") return { cacheBytes: native.cacheBytes, filesBytes: 2048, freeBytes: 12 * 1024 ** 3 };
    if (method === "clearCache") { const f = native.cacheBytes; native.cacheBytes = 0; return { freedBytes: f }; }
  }
  if (plugin === "PushNotifications") {
    if (method === "checkPermissions") return { receive: native.pushPerm };
    if (method === "requestPermissions") { native.pushPerm = "granted"; return { receive: "granted" }; }
    return {};
  }
  if (plugin === "Camera") return { camera: "granted", photos: "granted" };
  if (plugin === "Geolocation") return { location: "granted", coarseLocation: "granted" };
  return {};
}

const leadsBefore = Number(sql(`select count(*) from "Lead" where source='PHONE_CONTACT'`));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
async function newPage(cookie, { nativeApp = true, viewport = { width: 390, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport, baseURL: BASE });
  await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  if (nativeApp) {
    await page.exposeFunction("__nativeCall", nativeCall);
    await page.addInitScript(() => {
      window.androidBridge = { postMessage() {} };
      // The native side tells the web layer which plugins exist and what their methods are.
      const plugin = (name, methods) => ({ name, methods: [...methods, "addListener", "removeListener", "removeAllListeners"].map((m) => ({ name: m, rtype: m === "addListener" ? "callback" : "promise" })) });
      window.Capacitor = {
        DEBUG: false,
        isLoggingEnabled: false,
        PluginHeaders: [
          plugin("ContactSync", ["getStatus", "requestPermission", "openAppSettings", "enable", "syncNow", "retryFailed", "pause", "resume", "disable", "signedOut", "signedIn"]),
          plugin("DeviceStorage", ["getInfo", "clearCache"]),
          plugin("PushNotifications", ["checkPermissions", "requestPermissions", "register", "unregister"]),
          plugin("Camera", ["getPhoto", "checkPermissions", "requestPermissions"]),
          plugin("Geolocation", ["getCurrentPosition", "checkPermissions", "requestPermissions"]),
          plugin("StatusBar", ["setStyle", "setBackgroundColor", "setOverlaysWebView"]),
          plugin("SplashScreen", ["hide", "show"]),
          plugin("App", ["minimizeApp", "exitApp", "getInfo"]),
          plugin("Network", ["getStatus"]),
          plugin("BarcodeScanner", ["isSupported", "scan"]),
        ],
        nativePromise: (plugin, method, options) => window.__nativeCall(plugin, method, options || {}),
        nativeCallback: () => "cb" + Math.random(),
      };
    });
  }
  page._errors = errors;
  return page;
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ------------------------------------------------------------------ 1. Contact sync screen (inside the "app")
{
  const page = await newPage(adminCookie);
  await page.goto("/contacts");
  await page.getByRole("button", { name: /Turn on contact sync/ }).waitFor({ timeout: 20000 });
  ok(true, "app: Contacts screen offers 'Turn on contact sync' when not connected");
  ok(!native.calls.includes("ContactSync.requestPermission"), "permission is NOT requested just by opening the screen");
  await page.getByRole("button", { name: /Turn on contact sync/ }).click();
  await page.getByText("Allow Intense Care to read your contacts?").waitFor();
  ok(/never become leads|do not.*become leads|not.*become leads/i.test(await page.locator('[role="dialog"]').innerText()) || (await page.locator('[role="dialog"]').innerText()).includes("become leads"), "rationale explains what is read and that nothing becomes a lead automatically");
  await page.getByRole("button", { name: "Not now" }).click();
  ok(!native.calls.includes("ContactSync.requestPermission"), "'Not now' → still no permission request");

  // Denied path
  native.grantOnRequest = false;
  await page.getByRole("button", { name: /Turn on contact sync/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/Contacts permission was refused|was not given/).waitFor({ timeout: 10000 });
  ok(native.calls.includes("ContactSync.requestPermission") && !native.calls.includes("ContactSync.enable"), "permission refused → clear message, nothing enabled, nothing uploaded");
  ok(sql(`select count(*) from "PhoneContact" where "deviceContactId" like 'u%'`) === "0", "no contacts reached the server after a refusal");

  // Granted path → real device registration + real server sync
  native.grantOnRequest = true;
  await page.getByRole("button", { name: /Turn on contact sync/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Sync now/ }).waitFor({ timeout: 20000 });
  ok(/^icd_/.test(native.cs.token || ""), "granted → the phone received a scoped sync token and handed it to the native side");
  ok(native.cs.enableOptions?.baseUrl === new URL(BASE).origin && native.cs.userId, "native enable() got the ERP address and the user id");
  await page.waitForFunction(() => document.body.innerText.includes("In ERP directory"), null, { timeout: 15000 });
  const dirCount = sql(`select count(*) from "PhoneContact" pc join "MobileDevice" d on d.id=pc."deviceRowId" where pc.status='ACTIVE' and d."deviceId"='${DEVICE_ID}'`);
  ok(dirCount === "4", `initial sync reached the server (${dirCount} contacts)`);
  ok(Number(sql(`select count(*) from "Lead" where source='PHONE_CONTACT'`)) === leadsBefore, "synced contacts did not become leads");
  const text = await page.locator("main, body").first().innerText();
  ok(/Last successful sync/.test(text) && /Next attempt/.test(text) && /Possible duplicates/.test(text) && /Failed/.test(text) && /Added/.test(text) && /Contacts scanned/.test(text), "status shows last sync, next attempt, scanned, added, duplicates, failed");
  ok(/Android decides the exact time/.test(text), "no fixed interval is promised");
  for (const b of ["Sync now", "Retry failed", "Review duplicates", "Pause sync", "Disconnect sync"]) ok(await page.getByRole("button", { name: new RegExp(b, "i") }).count() > 0, `button present: ${b}`);

  // Directory shows the contacts, existing customer recognised, duplicates flagged
  await page.getByRole("tab", { name: "Directory" }).click();
  await page.getByText("Ravi Kumar").waitFor({ timeout: 10000 });
  ok(await page.getByText("Customer: Uma Verma").count() > 0, "contact whose number belongs to an existing customer is linked to that customer");
  ok(await page.getByText("Possible duplicate").count() >= 2, "contacts sharing a number are flagged, not merged");
  await page.getByRole("button", { name: /Review duplicates/i }).click();
  await page.getByText(/Nothing here is merged automatically/).waitFor();
  ok(true, "Review duplicates opens the duplicates list");

  // Import as lead (selected only)
  await page.getByRole("tab", { name: "Directory" }).click();
  await page.getByLabel("Select Ravi Kumar").check();
  await page.getByRole("button", { name: /Import as leads/ }).click();
  await page.getByText(/lead\(s\) created/).waitFor({ timeout: 10000 });
  ok(Number(sql(`select count(*) from "Lead" where source='PHONE_CONTACT'`)) === leadsBefore + 1, "selected contact imported as ONE lead with source PHONE_CONTACT");

  // Pause / resume
  await page.getByRole("button", { name: /Pause sync/ }).click();
  await page.getByRole("button", { name: /Resume sync/ }).waitFor({ timeout: 10000 });
  ok(sql(`select "syncPaused" from "MobileDevice" where "deviceId"='${DEVICE_ID}'`) === "t", "Pause is recorded on the server too");
  await page.getByRole("button", { name: /Resume sync/ }).click();
  await page.getByRole("button", { name: /Pause sync/ }).waitFor({ timeout: 10000 });
  ok(sql(`select "syncPaused" from "MobileDevice" where "deviceId"='${DEVICE_ID}'`) === "f", "Resume clears it");

  // Permission revoked while connected
  native.perm = "denied";
  await page.reload();
  await page.getByText(/Contacts permission is off/).waitFor({ timeout: 15000 });
  ok(true, "permission revoked in Android settings → clear 'permission off' message with a fix");
  native.perm = "granted";

  // Settings tab
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByText("What happens to synced contacts").waitFor();
  ok(await page.getByRole("button", { name: "Save" }).count() > 0, "lead policy settings are on the screen");

  // Disconnect, keeping contacts
  await page.getByRole("button", { name: /Disconnect sync/ }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: /Turn on contact sync/ }).waitFor({ timeout: 15000 });
  ok(sql(`select "syncTokenHash" is null from "MobileDevice" where "deviceId"='${DEVICE_ID}'`) === "t", "Disconnect revokes the token on the server");
  ok(sql(`select count(*) from "PhoneContact" pc join "MobileDevice" d on d.id=pc."deviceRowId" where pc.status='ACTIVE' and d."deviceId"='${DEVICE_ID}'`) === "4", "…and keeps already-uploaded contacts by default");
  ok(native.calls.includes("ContactSync.disable"), "native side was told to forget the connection");
  ok(page._errors.length === 0, `no uncaught page errors (${page._errors.join("; ")})`);
  ok(await noHScroll(page), "Contacts: no horizontal scrolling at phone width");
  await page.context().close();
}

// ------------------------------------------------------------------ 2. Media & Storage
{
  const page = await newPage(adminCookie);
  await page.goto("/media");
  await page.getByRole("heading", { name: "Media & Storage" }).waitFor({ timeout: 20000 });
  await page.getByText("Storage used").waitFor();
  ok(true, "Media & Storage shows the storage summary");
  const t = await page.locator("body").innerText();
  ok(/Storage limit/.test(t) && /Files managed/.test(t) && /Before-service photos/.test(t) && /QC & rework photos/.test(t), "usage, file counts and the six categories are shown");
  ok(/Not reported|Your storage provider didn't state a limit/.test(t), "no invented quota: 'not reported' when the provider gives none");
  await page.getByText("Hall (before).png").first().waitFor({ timeout: 10000 }).catch(() => {});
  const row = page.getByRole("listitem").filter({ hasText: "Hall (before)" }).first();
  ok(await row.count() === 1, "the photo is listed with its details");
  ok(/Job .*UMA-VERMA/.test(await row.innerText()), "row shows the Job ID");
  ok(/Protected record/.test(await row.innerText()), "finished, paid job within retention → 'Protected record'");
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Review & delete/ }).click();
  await page.getByText("Confirm deletion").waitFor();
  const dlg = await page.locator('[role="dialog"]').innerText();
  ok(/Hall \(before\)/.test(dlg) && /image/.test(dlg) && /UMA-VERMA/.test(dlg) && /used by a record/.test(dlg), "confirmation shows file name, type, Job ID and whether a record uses it");
  const del = page.getByRole("button", { name: /^Delete 1 file/ });
  ok(await del.isDisabled(), "protected file: Delete stays disabled until a reason and the phrase are entered");
  await page.getByLabel("Reason").fill("too short");
  await page.getByLabel("Type the phrase to confirm").fill("DELETE PROTECTED MEDIA");
  ok(await del.isDisabled(), "…a short reason is not enough");
  await page.getByLabel("Reason").fill("Customer asked us to erase their photos");
  ok(!(await del.isDisabled()), "…reason + phrase enable it");
  await page.getByRole("button", { name: "Cancel" }).click();
  ok(sql(`select count(*) from "JobPhoto" where id='${photo.id}'`) === "1", "cancelling deletes nothing");
  // Filters
  await page.getByLabel("Search files").fill("nomatchxyz");
  await page.getByText("No files match").waitFor({ timeout: 10000 });
  ok(true, "search with no match shows an empty state");
  ok(await noHScroll(page), "Media: no horizontal scrolling at phone width");
  ok(page._errors.length === 0, `no uncaught page errors on Media (${page._errors.join("; ")})`);
  await page.context().close();
}

// ------------------------------------------------------------------ 3. Device storage (Field Manager, inside the app)
{
  const page = await newPage(fmCookie);
  await page.goto("/device-storage");
  await page.getByText("This device").waitFor({ timeout: 20000 });
  const t = await page.locator("body").innerText();
  ok(/Intense Care Android app/.test(t), "Device storage recognises the Android app");
  ok(/Temporary cache/.test(t) && /5\.00 MB|5 MB/.test(t), "shows the temporary cache size from the native side");
  ok(/Photos waiting to upload/.test(t) && /Nothing is waiting/.test(t), "pending-uploads section (empty)");
  const callsBefore = native.calls.length;
  await page.getByRole("button", { name: /Clear temporary cache/ }).click();
  await page.getByText(/Only downloadable, temporary files are removed/).waitFor();
  await page.getByRole("button", { name: "Clear cache", exact: true }).click();
  await page.getByText(/Freed 5\.00 MB/).waitFor({ timeout: 10000 });
  ok(native.cacheBytes === 0, "Clear cache calls the native cache clear and reports what was freed");
  ok(!native.calls.slice(callsBefore).some((c) => /signedOut|disable|enable|syncNow/.test(c)), "clearing the cache does not touch the contact connection or sign-in");
  // Notifications: permission only after the rationale
  ok(native.pushPerm === "prompt", "notification permission is not asked on opening the screen");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await page.getByText(/never include customer names, addresses or amounts/).waitFor();
  ok(native.pushPerm === "prompt", "rationale shown before any Android prompt");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/Notifications are on for this phone/).waitFor({ timeout: 10000 });
  ok(native.pushPerm === "granted" && sql(`select count(*) from "MobileDevice" where "notificationsEnabled" and "userId"='${fmId}'`) >= "1", "after consent the phone is registered for notifications");
  ok(await noHScroll(page), "Device storage: no horizontal scrolling at phone width");
  ok(page._errors.length === 0, `no uncaught page errors on Device storage (${page._errors.join("; ")})`);
  await page.context().close();
}

// ------------------------------------------------------------------ 4. Role gates and the plain-browser case
{
  const fm = await newPage(fmCookie, { nativeApp: false });
  await fm.goto("/media");
  await fm.waitForURL((u) => !u.pathname.startsWith("/media"), { timeout: 15000 });
  ok(!new URL(fm.url()).pathname.startsWith("/media"), "Field Manager is redirected away from Media & Storage");
  await fm.goto("/contacts");
  await fm.waitForURL((u) => !u.pathname.startsWith("/contacts"), { timeout: 15000 });
  ok(!new URL(fm.url()).pathname.startsWith("/contacts"), "Field Manager is redirected away from Contacts");
  await fm.context().close();

  const web = await newPage(adminCookie, { nativeApp: false, viewport: { width: 1280, height: 800 } });
  await web.goto("/contacts");
  await web.getByText(/synced from the Intense Care Android app/).waitFor({ timeout: 20000 });
  ok(true, "in a normal browser the Contacts page explains sync runs from the Android app (no native controls)");
  ok(await web.getByRole("button", { name: /Turn on contact sync/ }).count() === 0, "no native controls in a browser");
  await web.goto("/device-storage");
  await web.getByText("Web browser").waitFor({ timeout: 15000 });
  ok(true, "Device storage works in a browser too");
  await web.context().close();
}

await browser.close();
console.log(`\nmobile-ui-verify: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
