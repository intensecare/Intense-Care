import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCoordinates, extractPlaceName, isFollowable, parseLink } from "../src/lib/map-link";

const coords = (raw: string) => {
  const p = parseLink(raw);
  assert.ok(p.ok, `parse ${raw}`);
  return extractCoordinates(p.url);
};

test("place link: the place's own point (!3d!4d) beats the map-view centre (@)", () => {
  const c = coords("https://www.google.com/maps/place/Sobha+Dream+Acres/@12.9389,77.7266,17z/data=!3m1!4b1!4m6!3m5!1s0x3bae13:0xabc!8m2!3d12.9391234!4d77.7269876!16s%2Fg%2F11abc");
  assert.deepEqual([c?.lat, c?.lng, c?.precision], [12.939123, 77.726988, "EXACT"]);
});

test("@lat,lng,zoom alone is the view centre → APPROXIMATE", () => {
  const c = coords("https://www.google.com/maps/@12.9716,77.5946,15z");
  assert.deepEqual([c?.lat, c?.lng, c?.precision], [12.9716, 77.5946, "APPROXIMATE"]);
});

test("coordinate parameters: q, query, ll, destination", () => {
  for (const u of [
    "https://maps.google.com/?q=12.9716,77.5946",
    "https://www.google.com/maps?q=12.9716%2C77.5946",
    "https://www.google.com/maps/search/?api=1&query=12.9716%2C77.5946",
    "https://www.google.com/maps/dir/?api=1&destination=12.9716,77.5946",
    "https://maps.google.com/maps?ll=12.9716,77.5946&z=15",
    "https://www.google.com/maps/search/12.9716,+77.5946",
    "https://www.google.com/maps/place/12.9716,77.5946",
    "google.com/maps?q=12.9716,77.5946",
  ]) {
    const c = coords(u);
    assert.deepEqual([c?.lat, c?.lng, c?.precision], [12.9716, 77.5946, "EXACT"], u);
  }
});

test("negative coordinates and long decimals", () => {
  const c = coords("https://www.google.com/maps?q=-33.8688197,151.2092955");
  assert.deepEqual([c?.lat, c?.lng], [-33.868820, 151.209296]);
});

test("OpenStreetMap, Apple Maps and geo: links", () => {
  assert.deepEqual(((c) => [c?.lat, c?.lng, c?.precision])(coords("https://www.openstreetmap.org/?mlat=12.97&mlon=77.59#map=17/12.97/77.59")), [12.97, 77.59, "EXACT"]);
  assert.equal(coords("https://www.openstreetmap.org/#map=16/12.9/77.5")?.precision, "APPROXIMATE");
  assert.deepEqual(((c) => [c?.lat, c?.lng])(coords("https://maps.apple.com/?ll=12.97,77.59&q=Home")), [12.97, 77.59]);
  assert.deepEqual(((c) => [c?.lat, c?.lng])(coords("geo:12.9716,77.5946?q=x")), [12.9716, 77.5946]);
});

test("links without coordinates give none", () => {
  assert.equal(coords("https://maps.app.goo.gl/AbCdEf123"), null);
  assert.equal(coords("https://www.google.com/maps/place/Sobha+Dream+Acres+Panathur"), null);
  assert.equal(coords("https://www.google.com/maps?q=Some+Place+Bengaluru"), null);
});

test("out-of-range, (0,0) and half pairs are never accepted", () => {
  assert.equal(coords("https://www.google.com/maps/@95.5,77.5,15z"), null);
  assert.equal(coords("https://www.google.com/maps/@12.9,200.5,15z"), null);
  assert.equal(coords("https://www.google.com/maps/@0,0,15z"), null);
  assert.equal(coords("https://www.google.com/maps?q=12.9716"), null);
  assert.equal(coords("https://www.google.com/maps?q=91.0,77.0"), null);
});

test("place names are found for geocoding, coordinates are not mistaken for names", () => {
  const n = (u: string) => { const p = parseLink(u); assert.ok(p.ok); return extractPlaceName(p.url); };
  assert.equal(n("https://www.google.com/maps/place/Sobha+Dream+Acres+Panathur/data=!4m2"), "Sobha Dream Acres Panathur");
  assert.equal(n("https://www.google.com/maps?q=Some+Place+Bengaluru"), "Some Place Bengaluru");
  assert.equal(n("https://www.google.com/maps?q=12.9716,77.5946"), null);
  assert.equal(n("https://www.google.com/maps/place/12.9716,77.5946"), null);
});

test("what counts as a usable link", () => {
  assert.equal(parseLink("").ok, false);
  assert.equal((parseLink("hello there") as { code: string }).code, "INVALID_URL");
  assert.equal((parseLink("javascript:alert(1)") as { code: string }).code, "INVALID_URL");
  assert.equal((parseLink("ftp://google.com/maps") as { code: string }).code, "INVALID_URL");
  assert.equal((parseLink("https://evil.example/maps?q=12.9,77.5") as { code: string }).code, "UNSUPPORTED_HOST");
  assert.equal((parseLink("https://google.com.evil.example/maps") as { code: string }).code, "UNSUPPORTED_HOST");
  assert.equal((parseLink("https://x".padEnd(2100, "x")) as { code: string }).code, "TOO_LONG");
  const short = parseLink("Check this: https://maps.app.goo.gl/AbCd (my flat)");
  assert.ok(short.ok && short.kind === "SHORT");
  assert.ok(parseLink("https://www.google.co.in/maps/@12.9,77.5,15z").ok);
  assert.ok(parseLink("https://maps.google.com/?q=1,2").ok);
});

test("the server only follows redirects to https Google hosts", () => {
  assert.equal(isFollowable(new URL("https://maps.app.goo.gl/x")), true);
  assert.equal(isFollowable(new URL("https://www.google.com/maps/place/x")), true);
  assert.equal(isFollowable(new URL("https://consent.google.com/ml?continue=x")), true);
  assert.equal(isFollowable(new URL("http://maps.app.goo.gl/x")), false);
  assert.equal(isFollowable(new URL("https://127.0.0.1/x")), false);
  assert.equal(isFollowable(new URL("https://169.254.169.254/latest")), false);
  assert.equal(isFollowable(new URL("https://evil.example/x")), false);
  assert.equal(isFollowable(new URL("https://maps.app.goo.gl:8443/x")), false);
});
