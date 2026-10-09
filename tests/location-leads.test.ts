import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { normalizeCoords, resolveServiceLocation, looksSwapped, navigateUrl, formatAddress, hasCoords, distanceMeters } from "../src/lib/location";
import { START_MODES, effectiveStartMode, normalizeStartMode, modeNeedsGps, modeNeedsQr, DEFAULT_START_VERIFICATION } from "../src/lib/start-verification";
import { attributeWebsiteLead, phoneKey, isPlausiblePhone } from "../src/lib/leads";
import { validSignature } from "../src/lib/server/webhook-signature";
import { sumGbpResponse } from "../src/lib/server/google-business";
import { tokenFromQr } from "../src/components/common/QrScanner";

test("coordinates: only real, complete pairs are accepted", () => {
  assert.deepEqual(normalizeCoords(12.9716, 77.5946), { lat: 12.9716, lng: 77.5946 });
  assert.deepEqual(normalizeCoords("12.9716", " 77.5946 "), { lat: 12.9716, lng: 77.5946 }, "numeric strings are parsed");
  assert.equal(normalizeCoords(0, 0), null, "(0,0) is a placeholder, not a location");
  assert.equal(normalizeCoords(12.9, null), null, "half a pair");
  assert.equal(normalizeCoords(null, null), null);
  assert.equal(normalizeCoords(91, 77), null, "latitude out of range");
  assert.equal(normalizeCoords(12, 181), null, "longitude out of range");
  assert.equal(normalizeCoords("abc", "77"), null);
  assert.equal(normalizeCoords(NaN, 77), null);
  assert.equal(hasCoords({ lat: 0, lng: 0 }), false);
});

test("coordinates: swapped lng,lat is detected for India", () => {
  assert.equal(looksSwapped({ lat: 77.209, lng: 28.6139 }), true);
  assert.equal(looksSwapped({ lat: 28.6139, lng: 77.209 }), false);
  assert.equal(looksSwapped({ lat: 51.5, lng: -0.12 }), false, "outside India both ways — not flagged as swapped");
});

test("service location: job pin first, then the property's — never anything else", () => {
  const prop = { address: "1 MG Rd", city: "Bengaluru", postalCode: "560001", lat: 12.97, lng: 77.59 };
  const own = resolveServiceLocation({ locationLat: 12.98, locationLng: 77.6, locationAddress: "Tower B gate" }, prop);
  assert.deepEqual(own, { lat: 12.98, lng: 77.6, address: "Tower B gate", source: "JOB" });
  const follow = resolveServiceLocation({ locationLat: null, locationLng: null, locationAddress: null }, prop);
  assert.deepEqual(follow, { lat: 12.97, lng: 77.59, address: "1 MG Rd, Bengaluru, 560001", source: "PROPERTY" });
  const copied = resolveServiceLocation({ locationLat: 12.97, locationLng: 77.59, locationSource: "PROPERTY" }, prop);
  assert.equal(copied.source, "PROPERTY", "a job following its property reports the property as the source");
  const moved = resolveServiceLocation({ locationLat: 12.5, locationLng: 77.1, locationSource: "PROPERTY" }, prop);
  assert.deepEqual([moved.lat, moved.lng, moved.source], [12.97, 77.59, "PROPERTY"], "a stale copy on a following job never wins over the property's current pin");
  const broken = resolveServiceLocation({ locationLat: 0, locationLng: 0, locationAddress: "" }, prop);
  assert.equal(broken.source, "PROPERTY", "a (0,0) job pin is ignored, the property's pin is used");
  const none = resolveServiceLocation({ locationLat: null, locationLng: null }, { address: "4 None Rd", lat: null, lng: null });
  assert.deepEqual(none, { lat: null, lng: null, address: "4 None Rd", source: null });
});

test("navigation uses the saved pin, else the address; nothing → no link", () => {
  assert.match(navigateUrl({ lat: 12.97, lng: 77.59, address: "x" })!, /destination=12\.97%2C77\.59$/);
  assert.match(navigateUrl({ lat: null, lng: null, address: "1 MG Rd" })!, /destination=1%20MG%20Rd$/);
  assert.equal(navigateUrl({ lat: null, lng: null, address: "  " }), null);
});

test("address formatting does not repeat parts already in the full address", () => {
  assert.equal(formatAddress({ address: "Flat 4, Indiranagar, Bengaluru", locality: "Indiranagar", city: "Bengaluru", postalCode: "560038" }), "Flat 4, Indiranagar, Bengaluru, 560038");
  assert.equal(formatAddress({ address: "", addressLine: "12 Main St", city: "Pune" }), "12 Main St, Pune");
});

test("distance: ~40 m and ~3 km", () => {
  assert.ok(Math.abs(distanceMeters(12.95, 77.6, 12.9503, 77.6002) - 39) < 5);
  assert.ok(distanceMeters(12.95, 77.6, 12.97, 77.62) > 3000);
});

test("start modes: exactly DIRECT, GPS, GPS_QR; retired values never weaken", () => {
  assert.deepEqual([...START_MODES], ["DIRECT", "GPS", "GPS_QR"]);
  assert.equal(normalizeStartMode("QR"), "GPS_QR");
  assert.equal(normalizeStartMode("QR_GPS"), "GPS_QR");
  assert.equal(normalizeStartMode("FACE_ID"), null);
  const s = { ...DEFAULT_START_VERIFICATION, defaultMode: "GPS" as const };
  assert.equal(effectiveStartMode(null, s), "GPS");
  assert.equal(effectiveStartMode("DIRECT", s), "DIRECT");
  assert.equal(effectiveStartMode("QR", s), "GPS_QR");
  assert.equal(effectiveStartMode("DIRECT", { ...s, allowPerJobOverride: false }), "GPS", "per-job mode ignored when overrides are off");
  assert.equal(effectiveStartMode(null, { ...s, defaultMode: "QR_GPS" as never }), "GPS_QR", "a stored retired default reads as GPS_QR");
  assert.deepEqual([modeNeedsGps("DIRECT"), modeNeedsGps("GPS"), modeNeedsGps("GPS_QR")], [false, true, true]);
  assert.deepEqual([modeNeedsQr("DIRECT"), modeNeedsQr("GPS"), modeNeedsQr("GPS_QR")], [false, false, true]);
});

test("QR scan: the token is the last path segment of the customer link", () => {
  assert.equal(tokenFromQr("https://erp.example.com/customer/service/AbCdEfGhIjKlMnOpQrStUv"), "AbCdEfGhIjKlMnOpQrStUv");
});

test("leads: phone key and plausibility", () => {
  assert.equal(phoneKey("+91 98450-12345"), "9845012345");
  assert.equal(phoneKey("09845012345"), "9845012345");
  assert.equal(isPlausiblePhone("98450 12345"), true);
  assert.equal(isPlausiblePhone("12345"), false);
  assert.equal(isPlausiblePhone("0000000000"), false);
});

test("leads: website source attribution uses only what the browser sent", () => {
  assert.equal(attributeWebsiteLead({ gclid: "abc" }).source, "GOOGLE_ADS");
  assert.equal(attributeWebsiteLead({ utmSource: "google", utmMedium: "cpc", utmCampaign: "Diwali" }).source, "GOOGLE_ADS");
  assert.match(attributeWebsiteLead({ utmSource: "google", utmMedium: "cpc", utmCampaign: "Diwali" }).details, /Diwali/);
  assert.equal(attributeWebsiteLead({ utmSource: "gmb", utmMedium: "organic" }).source, "GOOGLE_MAPS");
  assert.equal(attributeWebsiteLead({ utmSource: "google", utmMedium: "organic" }).source, "GOOGLE_SEARCH");
  assert.equal(attributeWebsiteLead({ referrerUrl: "https://www.google.co.in/" }).source, "GOOGLE_SEARCH");
  assert.equal(attributeWebsiteLead({ utmSource: "whatsapp" }).source, "WHATSAPP");
  assert.equal(attributeWebsiteLead({ utmSource: "newsletter", utmMedium: "email" }).source, "WEBSITE");
  assert.equal(attributeWebsiteLead({}).source, "WEBSITE");
});

test("WhatsApp webhook signature: HMAC-SHA256 of the raw body, constant-time compare", () => {
  const body = '{"object":"whatsapp_business_account"}';
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(validSignature(body, sig, "s3cret"), true);
  assert.equal(validSignature(body + " ", sig, "s3cret"), false, "tampered body");
  assert.equal(validSignature(body, sig, "other"), false, "wrong secret");
  assert.equal(validSignature(body, null, "s3cret"), false, "missing header");
  assert.equal(validSignature(body, "sha256=zz", "s3cret"), false, "garbage header");
});

test("Google Business Profile: daily series are summed per metric", () => {
  const totals = sumGbpResponse({
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: [
          { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ value: "3" }, { value: "4" }, {}] } },
          { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ value: "10" }] } },
          { dailyMetric: "SOMETHING_ELSE", timeSeries: { datedValues: [{ value: "99" }] } },
        ],
      },
    ],
  });
  assert.deepEqual(totals, { CALL_CLICKS: 7, WEBSITE_CLICKS: 10 });
  assert.deepEqual(sumGbpResponse(null), {});
});
