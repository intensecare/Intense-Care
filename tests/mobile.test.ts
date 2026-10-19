import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePhone } from "../src/lib/phone";
import { prepareContact } from "../src/lib/contact-clean";
import { photoProtection, receiptProtection, quotaView, filterItems, sortItems, retention } from "../src/lib/media-policy";
import { formatBytes, type MediaItem } from "../src/lib/media";
import { messages, safeRoute, dayKey, bucket } from "../src/lib/push-messages";
import { slotStartMinutes } from "../src/lib/schedule-slot";
import { hashDeviceToken, newDeviceToken, TOKEN_PREFIX } from "../src/lib/device-token";
import { scopeOf, navFor, routeAllowed } from "../src/lib/rbac";

const vectors = JSON.parse(readFileSync(new URL("./fixtures/phone-vectors.json", import.meta.url), "utf8")) as { defaultCountryCode: string; cases: { raw: string; e164: string | null; key: string | null }[] };

test("phone numbers: every shared vector normalises as specified", () => {
  for (const c of vectors.cases) {
    const r = normalizePhone(c.raw, vectors.defaultCountryCode);
    assert.equal(r?.e164 ?? null, c.e164, `e164 of ${JSON.stringify(c.raw)}`);
    assert.equal(r?.key ?? null, c.key, `key of ${JSON.stringify(c.raw)}`);
  }
});

test("contact cleaning: normalised, de-duplicated and hashed; bad records fail alone", () => {
  const a = prepareContact({ id: "1", name: "  Anil   Kumar ", phones: ["98450 12345", "+91 98450-12345", "12"], emails: ["A@X.com", "not-an-email", "a@x.com"] });
  assert.ok(a.ok);
  if (!a.ok) return;
  assert.equal(a.contact.name, "Anil Kumar");
  assert.deepEqual(a.contact.numbers.map((n) => n.key), ["9845012345"], "the same number in two formats is one number");
  assert.deepEqual(a.contact.emails, ["a@x.com"]);
  // The hash ignores order and formatting, so an unchanged contact is recognised.
  const b = prepareContact({ id: "1", name: "Anil Kumar", phones: ["09845012345"], emails: ["a@x.com"] });
  assert.ok(b.ok && b.contact.hash === a.contact.hash);
  const c = prepareContact({ id: "1", name: "Anil Kumar", phones: ["09845012345", "98450 99999"], emails: ["a@x.com"] });
  assert.ok(c.ok && c.contact.hash !== a.contact.hash, "a new number changes the hash");
  assert.deepEqual(prepareContact({ id: "2", name: "No number", phones: ["abc"] }), { ok: false, code: "SKIP", id: "2" });
  assert.deepEqual(prepareContact({ id: 7, name: "x" }), { ok: false, code: "INVALID_RECORD", id: undefined });
  assert.equal((prepareContact({ name: "no id" }) as { code: string }).code, "INVALID_RECORD");
  const long = prepareContact({ id: "3", name: "x".repeat(500), phones: ["9845012345"] });
  assert.ok(long.ok && long.contact.name.length === 200, "names are capped");
});

const NOW = new Date("2026-10-19T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);
const job = (over: Partial<{ status: string; finishedAt: Date; openComplaint: boolean; unpaidInvoice: boolean }> = {}) => ({ status: "CLOSED", finishedAt: daysAgo(30), openComplaint: false, unpaidInvoice: false, ...over });

test("media protection: job photos", () => {
  assert.equal(photoProtection("before", job({ status: "IN_PROGRESS" }), NOW).level, "LOCKED", "job in progress");
  assert.equal(photoProtection("after", job({ status: "QUALITY_CHECK" }), NOW).level, "LOCKED");
  assert.equal(photoProtection("after", job({ openComplaint: true }), NOW).level, "LOCKED", "open complaint");
  assert.equal(photoProtection("after", job({ unpaidInvoice: true }), NOW).level, "LOCKED", "unpaid invoice");
  assert.equal(photoProtection("qc", job(), NOW).level, "PROTECTED", "QC evidence inside retention");
  assert.equal(photoProtection("before", job({ status: "COMPLETED" }), NOW).level, "PROTECTED");
  assert.equal(photoProtection("before", job({ finishedAt: daysAgo(400) }), NOW).level, "CONFIRM", "past the 365-day retention");
  assert.equal(photoProtection("before", job({ status: "CANCELLED" }), NOW).level, "FREE", "cancelled job");
  assert.equal(photoProtection("before", null, NOW).level, "FREE", "job gone");
  assert.ok(photoProtection("qc", job(), NOW).reasons[0].includes("days left"));
  assert.equal(retention().evidenceDays, 365);
});

test("media protection: receipts", () => {
  const exp = (o: object = {}) => ({ approvalStatus: "APPROVED", voidedAt: null, sourceType: null, date: "2026-09-01", ...o });
  assert.equal(receiptProtection({ createdAt: daysAgo(5) }, null, NOW).level, "FREE", "attached to nothing");
  assert.equal(receiptProtection({ createdAt: new Date(NOW.getTime() - 3600_000) }, null, NOW).level, "LOCKED", "uploaded an hour ago — expense may still be saving");
  assert.equal(receiptProtection({ createdAt: daysAgo(5) }, exp({ approvalStatus: "PENDING_APPROVAL" }), NOW).level, "LOCKED");
  assert.equal(receiptProtection({ createdAt: daysAgo(5) }, exp({ sourceType: "PAYROLL" }), NOW).level, "LOCKED", "automatic payroll record");
  assert.equal(receiptProtection({ createdAt: daysAgo(5) }, exp(), NOW).level, "PROTECTED", "approved expense inside the tax record period");
  assert.equal(receiptProtection({ createdAt: daysAgo(5) }, exp({ date: "2018-01-01" }), NOW).level, "CONFIRM", "older than six years");
  assert.equal(receiptProtection({ createdAt: daysAgo(5) }, exp({ voidedAt: daysAgo(1) }), NOW).level, "CONFIRM", "voided");
});

test("storage quota: never invents a limit", () => {
  const base = { estimateBytes: 400, providerError: null, warnPercent: 80 };
  const ok = quotaView({ ...base, usedBytes: 500, providerLimit: 1000, configuredLimit: null });
  assert.deepEqual([ok.level, ok.usedPercent, ok.limitSource, ok.message], ["OK", 50, "provider", null]);
  const warn = quotaView({ ...base, usedBytes: 850, providerLimit: 1000, configuredLimit: null });
  assert.deepEqual([warn.level, warn.message], ["WARN", "Storage is almost full. Review large files or remove unnecessary media."]);
  assert.equal(quotaView({ ...base, usedBytes: 970, providerLimit: 1000, configuredLimit: null }).level, "FULL");
  const cfg = quotaView({ ...base, usedBytes: null, providerLimit: null, configuredLimit: 500 });
  assert.deepEqual([cfg.usedBytes, cfg.limitSource, cfg.usedPercent, cfg.level], [400, "configured", 80, "WARN"], "estimate vs a limit the Admin configured");
  const none = quotaView({ ...base, usedBytes: null, providerLimit: null, configuredLimit: null });
  assert.deepEqual([none.limitBytes, none.usedPercent, none.level, none.limitSource], [null, null, "UNKNOWN", null], "no limit anywhere → unknown, not a made-up number");
  assert.match(quotaView({ ...base, usedBytes: null, providerLimit: null, configuredLimit: null, providerError: "Cloudinary refused the request (401)." }).message ?? "", /401/);
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(formatBytes(null), "—");
});

const item = (o: Partial<MediaItem>): MediaItem => ({ id: "jp:x", kind: "JOB_PHOTO", category: "BEFORE", type: "image", name: "a.jpg", format: "jpg", bytes: 100, uploadedAt: "2026-10-01T00:00:00Z", uploadedBy: "Ravi", jobId: "j", jobSerial: "RAHUL-001", customerName: "Rahul", thumbnailUrl: null, url: null, referenced: true, references: [], protection: { level: "FREE", reasons: [] }, ...o });

test("media list: filters and sorts", () => {
  const items = [item({ id: "1", bytes: 5000, uploadedAt: "2026-09-01T00:00:00Z" }), item({ id: "2", bytes: 100, category: "AFTER", uploadedAt: "2026-10-10T00:00:00Z" }), item({ id: "3", bytes: 9000, type: "document", jobSerial: "MEERA-002", customerName: "Meera", referenced: false, uploadedAt: "2026-08-01T00:00:00Z" })];
  const q = { page: 1, pageSize: 50 };
  assert.deepEqual(filterItems(items, { ...q, category: "AFTER" }).map((i) => i.id), ["2"]);
  assert.deepEqual(filterItems(items, { ...q, type: "document" }).map((i) => i.id), ["3"]);
  assert.deepEqual(filterItems(items, { ...q, q: "meera" }).map((i) => i.id), ["3"], "search by customer");
  assert.deepEqual(filterItems(items, { ...q, q: "rahul-001" }).map((i) => i.id), ["1", "2"], "search by Job ID");
  assert.deepEqual(filterItems(items, { ...q, minBytes: 4000 }).map((i) => i.id), ["1", "3"], "large files");
  assert.deepEqual(filterItems(items, { ...q, referenced: "no" }).map((i) => i.id), ["3"]);
  assert.deepEqual(filterItems(items, { ...q, from: "2026-10-01", to: "2026-10-31" }).map((i) => i.id), ["2"], "upload date");
  assert.deepEqual(sortItems(items, "largest").map((i) => i.id), ["3", "1", "2"]);
  assert.deepEqual(sortItems(items, "smallest").map((i) => i.id), ["2", "1", "3"]);
  assert.equal(sortItems(items, "oldest")[0].id, "3", "oldest upload first");
  assert.equal(sortItems(items, "newest")[0].id, "2");
});

test("push: messages carry no customer details; routes are an allowlist", () => {
  const all = [messages.jobAssigned("cm123"), messages.jobReassigned(), messages.jobReminder("cm123"), messages.qcPending("cm123"), messages.qcPending("cm123", true), messages.reworkAssigned("cm123"), messages.approvalRequired("cm123"), messages.followUps(3), messages.test()];
  for (const m of all) {
    assert.ok(!/RAHUL|₹|rs\.|\d{10}/i.test(`${m.title} ${m.body}`), `no personal data in "${m.title}"`);
    assert.equal(safeRoute(m.route), m.route, `route ${m.route} is allowed`);
  }
  assert.equal(messages.followUps(1).body, "You have a lead follow-up due.");
  for (const bad of ["https://evil.example/", "//evil.example", "/jobs/../../etc", "javascript:alert(1)", "/api/settings", "/jobs/a b", "", null, undefined]) assert.equal(safeRoute(bad as string), "/", `refused ${String(bad)}`);
  assert.equal(safeRoute("/leads?followUp=today"), "/leads?followUp=today");
  assert.equal(messages.update("T".repeat(100), "B".repeat(300)).title.length, 60);
  assert.equal(dayKey(Date.parse("2026-10-19T20:00:00Z")), "2026-10-20", "the day is the Indian calendar day");
  assert.equal(bucket(600000, 1_200_000), bucket(600000, 1_799_999), "the same event inside one 10-minute window shares a key");
  assert.notEqual(bucket(600000, 1_200_000), bucket(600000, 1_800_000), "the next window is a new event");
});

test("reminders: slot start times in both formats", () => {
  assert.equal(slotStartMinutes("09:00 - 13:00"), 540);
  assert.equal(slotStartMinutes("9:30 AM - 1:00 PM"), 570);
  assert.equal(slotStartMinutes("12:15 PM - 2:00 PM"), 735);
  assert.equal(slotStartMinutes("12:15 AM - 2:00 AM"), 15);
  assert.equal(slotStartMinutes("1:00 PM - 3:00 PM"), 780);
  assert.equal(slotStartMinutes("soon"), null);
  assert.equal(slotStartMinutes("25:00 - 26:00"), null);
});

test("device tokens: random, prefixed, only the hash is storable", () => {
  const t = newDeviceToken();
  assert.ok(t.startsWith(TOKEN_PREFIX) && t.length > 40);
  assert.notEqual(newDeviceToken(), t);
  assert.match(hashDeviceToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashDeviceToken(t), t);
});

test("permissions: contacts and media are Admin-only; the device screen is for the field roles", () => {
  for (const p of ["contacts.sync", "contacts.view", "contacts.manage", "media.view", "media.manage"] as const) {
    assert.equal(scopeOf("admin", p), "ALL");
    for (const r of ["field_manager", "qc_inspector", "tax_officer", "customer"] as const) assert.equal(scopeOf(r, p), "NONE", `${r} must not have ${p}`);
  }
  assert.notEqual(scopeOf("field_manager", "mobile.device"), "NONE");
  assert.notEqual(scopeOf("qc_inspector", "mobile.device"), "NONE");
  assert.equal(scopeOf("tax_officer", "mobile.device"), "NONE");
  assert.ok(routeAllowed("field_manager", "/device-storage"));
  assert.ok(routeAllowed("qc_inspector", "/device-storage"));
  assert.ok(routeAllowed("admin", "/contacts") && routeAllowed("admin", "/media"));
  assert.ok(!routeAllowed("field_manager", "/contacts") && !routeAllowed("field_manager", "/media"));
  assert.ok(!routeAllowed("tax_officer", "/device-storage") && !routeAllowed("tax_officer", "/contacts"));
  assert.ok(navFor("admin").some((n) => n.href === "/contacts") && navFor("admin").some((n) => n.href === "/media"));
});
