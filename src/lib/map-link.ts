import { normalizeCoords, type Coords } from "./location";

/**
 * Reading a pasted map link — pure, no network, so every rule is unit-tested.
 *
 * What counts as "coordinates in the link": numbers the URL states explicitly as a point, in order of trust:
 *   1. !3d<lat>!4d<lng>   the place's own point inside a Google "place" link (the real pin of the business / address)
 *   2. q= / query= / ll= / destination= / daddr= / center= / sll= / mlat+mlon with "lat,lng"
 *   3. /maps/search/<lat,lng>  and  /place/<lat,lng>
 *   4. @<lat>,<lng>,<zoom>   the CENTRE OF THE MAP VIEW — usually, but not always, the place (the map may be panned): marked APPROXIMATE
 *   5. geo:<lat>,<lng>, OpenStreetMap #map=z/lat/lng (view centre → APPROXIMATE) and Apple Maps ll=
 * Anything else (a place name, a short link) carries no coordinates; the caller resolves or geocodes it.
 * A pair is only returned if it is a valid latitude / longitude (never 0,0, never out of range).
 */

export const MAX_LINK_LENGTH = 2000;

/** Hosts whose links we understand. Short-link hosts are resolved by following redirects on the server. */
const GOOGLE_HOST = /^(?:www\.|maps\.|m\.)?google\.(?:com|co\.in|co\.uk|ca|com\.au|[a-z]{2})$/;
export const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co", "share.google"];
const OSM_HOST = /^(?:www\.)?openstreetmap\.org$/;
const APPLE_HOST = /^maps\.apple\.com$/;

export type LinkKind = "GOOGLE" | "SHORT" | "OSM" | "APPLE" | "GEO";

export type ParsedLink =
  | { ok: true; kind: LinkKind; url: URL }
  | { ok: false; code: "EMPTY" | "TOO_LONG" | "INVALID_URL" | "UNSUPPORTED_HOST"; message: string };

/** TEST ONLY: a host (e.g. "localhost:3998") treated as a Google short-link host, so the redirect handling can be exercised without the internet. Unset in production. */
const testHost = () => (process.env.MAP_LINK_TEST_HOST || "").toLowerCase();

export function parseLink(raw: string): ParsedLink {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, code: "EMPTY", message: "Paste a map link first." };
  if (text.length > MAX_LINK_LENGTH) return { ok: false, code: "TOO_LONG", message: "That link is too long to be a map link." };
  if (/^geo:/i.test(text)) {
    try {
      return { ok: true, kind: "GEO", url: new URL(text) };
    } catch {
      return { ok: false, code: "INVALID_URL", message: "That doesn't look like a map link." };
    }
  }
  // People paste "https://…" with surrounding words or without the scheme.
  const found = text.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? (/^[\w.-]+\.[a-z]{2,}\/\S*/i.test(text) ? `https://${text}` : null);
  if (!found) return { ok: false, code: "INVALID_URL", message: "That doesn't look like a web link. Paste the link from Google Maps → Share." };
  let url: URL;
  try {
    url = new URL(found);
  } catch {
    return { ok: false, code: "INVALID_URL", message: "That link isn't valid. Copy it again from Google Maps → Share." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, code: "INVALID_URL", message: "Only web links (https://…) are supported." };
  const host = url.hostname.toLowerCase();
  if (testHost() && url.host.toLowerCase() === testHost()) return { ok: true, kind: "SHORT", url };
  if (SHORT_HOSTS.includes(host)) return { ok: true, kind: "SHORT", url };
  if (GOOGLE_HOST.test(host)) return { ok: true, kind: "GOOGLE", url };
  if (OSM_HOST.test(host)) return { ok: true, kind: "OSM", url };
  if (APPLE_HOST.test(host)) return { ok: true, kind: "APPLE", url };
  return { ok: false, code: "UNSUPPORTED_HOST", message: "Only Google Maps, OpenStreetMap and Apple Maps links are supported. Open the place in Google Maps and use Share → Copy link." };
}

export interface Extracted extends Coords {
  /** EXACT = the link states this point for the place; APPROXIMATE = centre of the map view the link opens. */
  precision: "EXACT" | "APPROXIMATE";
  via: string;
}

const NUM = "-?\\d{1,3}(?:\\.\\d+)?";
const PAIR = new RegExp(`^\\s*(${NUM})\\s*[, ]\\s*(${NUM})\\s*$`);

function pair(text: string | null | undefined): Coords | null {
  if (!text) return null;
  const m = PAIR.exec(decodeURIComponent(text.replace(/\+/g, " ")));
  return m ? normalizeCoords(m[1], m[2]) : null;
}

/** Coordinates the link itself states, or null (then the caller resolves a short link or geocodes the place name). */
export function extractCoordinates(url: URL): Extracted | null {
  const full = safeDecode(url.pathname + url.search + url.hash);
  // 1. The place's own point.
  const d = new RegExp(`!3d(${NUM})!4d(${NUM})`).exec(full);
  if (d) {
    const c = normalizeCoords(d[1], d[2]);
    if (c) return { ...c, precision: "EXACT", via: "place point (!3d!4d)" };
  }
  // 2. Explicit parameters.
  for (const key of ["q", "query", "ll", "destination", "daddr", "center", "sll", "saddr"]) {
    const c = pair(url.searchParams.get(key));
    if (c) return { ...c, precision: "EXACT", via: `${key}=` };
  }
  const mlat = url.searchParams.get("mlat");
  const mlon = url.searchParams.get("mlon");
  if (mlat && mlon) {
    const c = normalizeCoords(mlat, mlon);
    if (c) return { ...c, precision: "EXACT", via: "mlat/mlon" };
  }
  // 3. Path segment that is just a coordinate pair: /maps/search/12.9,77.5  or  /maps/place/12.9,77.5
  for (const seg of url.pathname.split("/")) {
    const c = pair(safeDecode(seg));
    if (c) return { ...c, precision: "EXACT", via: "path coordinates" };
  }
  // geo: URIs — geo:12.9,77.5?q=...
  if (url.protocol === "geo:") {
    const c = pair(url.pathname.split(";")[0]);
    if (c) return { ...c, precision: "EXACT", via: "geo:" };
  }
  // 4. The centre of the map view.
  const at = new RegExp(`@(${NUM}),(${NUM})(?:,[\\d.]+[a-z]?)?`).exec(full);
  if (at) {
    const c = normalizeCoords(at[1], at[2]);
    if (c) return { ...c, precision: "APPROXIMATE", via: "map view centre (@)" };
  }
  const osm = new RegExp(`#map=\\d+/(${NUM})/(${NUM})`).exec(url.hash);
  if (osm) {
    const c = normalizeCoords(osm[1], osm[2]);
    if (c) return { ...c, precision: "APPROXIMATE", via: "OpenStreetMap view centre" };
  }
  return null;
}

/** The place NAME a link points at (for geocoding when it has no coordinates), e.g. /maps/place/Sobha+Dream+Acres/… or ?q=Place+Name. */
export function extractPlaceName(url: URL): string | null {
  const q = url.searchParams.get("q") ?? url.searchParams.get("query");
  if (q && !pair(q) && q.trim().length >= 3) return q.replace(/\+/g, " ").trim().slice(0, 200);
  const m = /\/maps\/(?:place|search)\/([^/@?]+)/.exec(url.pathname);
  if (m) {
    const name = safeDecode(m[1]).replace(/\+/g, " ").trim();
    if (name.length >= 3 && !pair(name)) return name.slice(0, 200);
  }
  return null;
}

/** A Google consent / interstitial page wraps the real link in ?continue=… */
export function unwrapContinue(url: URL): URL | null {
  const c = url.searchParams.get("continue") ?? url.searchParams.get("url");
  if (!c) return null;
  try {
    return new URL(c);
  } catch {
    return null;
  }
}

/** May the server follow a redirect to this URL? Only https, only the hosts above (no IPs, no other sites). */
export function isFollowable(u: URL): boolean {
  if (testHost() && u.host.toLowerCase() === testHost()) return true;
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (u.port && u.port !== "443") return false;
  return SHORT_HOSTS.includes(h) || GOOGLE_HOST.test(h) || h === "consent.google.com";
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
