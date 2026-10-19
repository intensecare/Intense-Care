import { extractCoordinates, extractPlaceName, isFollowable, parseLink, unwrapContinue, type LinkKind } from "@/lib/map-link";
import { isInServiceArea, looksSwapped } from "@/lib/location";

/**
 * Turns a pasted map link into a location the Admin can check and adjust. Nothing here saves anything.
 *
 * Network use is limited to: following the redirects of Google's short links (https, allow-listed hosts only, 5 hops,
 * no response body read) and ONE address search (OpenStreetMap Nominatim, or NEXT_PUBLIC_GEOCODE_URL) when a link names a
 * place but gives no coordinates. No API key is used or exposed.
 */

export type ExtractResult =
  | { ok: true; lat: number; lng: number; precision: "EXACT" | "APPROXIMATE"; method: "LINK_COORDINATES" | "SHORT_LINK" | "PLACE_SEARCH"; note: string; address?: string; found?: Found; resolvedUrl?: string; outsideServiceArea?: boolean; maybeSwapped?: boolean; alternatives?: { lat: number; lng: number; address: string }[] }
  | { ok: false; code: "EMPTY" | "TOO_LONG" | "INVALID_URL" | "UNSUPPORTED_HOST" | "NO_COORDINATES" | "SHORT_LINK_FAILED" | "SEARCH_FAILED"; message: string };

interface Found {
  display: string;
  addressLine?: string;
  locality?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

const GEOCODE_URL = (process.env.GEOCODE_URL || process.env.NEXT_PUBLIC_GEOCODE_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const COUNTRIES = process.env.NEXT_PUBLIC_GEOCODE_COUNTRIES ?? "in";
const UA = "IntenseCareERP/1.0 (property location lookup)";

async function followShortLink(start: URL): Promise<{ url: URL } | { error: string }> {
  let current = start;
  for (let hop = 0; hop < 5; hop++) {
    if (!isFollowable(current)) return { error: "The short link leads somewhere that isn't a map page." };
    let res: Response;
    try {
      res = await fetch(current.toString(), { redirect: "manual", method: "GET", headers: { "User-Agent": "Mozilla/5.0 (compatible; IntenseCareERP)", "Accept-Language": "en" }, signal: AbortSignal.timeout(7000) });
    } catch {
      return { error: "The short link couldn't be opened (network problem or the link is dead)." };
    }
    // The body is never needed; release the connection.
    void res.body?.cancel().catch(() => {});
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return { error: "The short link returned something unreadable." };
      }
      const inner = next.hostname === "consent.google.com" ? unwrapContinue(next) : null;
      current = inner ?? next;
      // Reached a page that states coordinates / a place — stop following.
      if (extractCoordinates(current) || extractPlaceName(current)) return { url: current };
      continue;
    }
    return { url: current };
  }
  return { error: "The short link redirected too many times." };
}

async function search(query: string): Promise<{ lat: number; lng: number; address: string; found: Found }[] | null> {
  try {
    const u = new URL(`${GEOCODE_URL}/search`);
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("addressdetails", "1");
    u.searchParams.set("limit", "3");
    u.searchParams.set("q", query);
    if (COUNTRIES) u.searchParams.set("countrycodes", COUNTRIES);
    const res = await fetch(u.toString(), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat: string; lon: string; display_name: string; address?: Record<string, string> }[];
    return rows
      .map((r) => {
        const a = r.address ?? {};
        return {
          lat: Number(r.lat),
          lng: Number(r.lon),
          address: r.display_name,
          found: {
            display: r.display_name,
            addressLine: [a.house_number, a.road].filter(Boolean).join(" ") || undefined,
            locality: a.suburb || a.neighbourhood || a.city_district || undefined,
            city: a.city || a.town || a.village || a.state_district || undefined,
            state: a.state,
            postalCode: a.postcode,
            country: a.country,
          },
        };
      })
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180 && !(r.lat === 0 && r.lng === 0));
  } catch {
    return null;
  }
}

function flags(lat: number, lng: number) {
  return { outsideServiceArea: !isInServiceArea({ lat, lng }), maybeSwapped: looksSwapped({ lat, lng }) };
}

export async function extractFromMapLink(raw: string): Promise<ExtractResult> {
  const parsed = parseLink(raw);
  if (!parsed.ok) return { ok: false, code: parsed.code, message: parsed.message };
  let url = parsed.url;
  let kind: LinkKind = parsed.kind;
  let method: "LINK_COORDINATES" | "SHORT_LINK" = "LINK_COORDINATES";

  if (kind === "SHORT") {
    const r = await followShortLink(url);
    if ("error" in r) return { ok: false, code: "SHORT_LINK_FAILED", message: `${r.error} Open it in Google Maps, copy the full address-bar link, or drop the pin on the map yourself.` };
    url = r.url;
    method = "SHORT_LINK";
    const again = parseLink(url.toString());
    if (!again.ok) return { ok: false, code: "SHORT_LINK_FAILED", message: "The short link didn't lead to a map location. Drop the pin on the map yourself." };
    kind = again.kind;
  }

  const c = extractCoordinates(url);
  if (c) {
    return {
      ok: true,
      lat: c.lat,
      lng: c.lng,
      precision: c.precision,
      method,
      resolvedUrl: method === "SHORT_LINK" ? url.toString() : undefined,
      note:
        c.precision === "EXACT"
          ? "Coordinates were read from the link. Check the pin is on the right building."
          : "The link only gives the centre of the map view it opens, which may be close to — not exactly on — the property. Check the pin and drag it onto the building.",
      ...flags(c.lat, c.lng),
    };
  }

  // No coordinates: a place NAME can be looked up, but that is a guess to be confirmed, never saved automatically.
  const name = extractPlaceName(url);
  if (name) {
    const rows = await search(name);
    if (rows === null) return { ok: false, code: "SEARCH_FAILED", message: "The link names a place but has no coordinates, and the address search is unavailable right now. Drop the pin on the map yourself." };
    if (rows.length) {
      const [first, ...rest] = rows;
      return {
        ok: true,
        lat: first.lat,
        lng: first.lng,
        precision: "APPROXIMATE",
        method: "PLACE_SEARCH",
        address: first.address,
        found: first.found,
        resolvedUrl: method === "SHORT_LINK" ? url.toString() : undefined,
        note: `The link has no coordinates, so "${name}" was looked up by name. This is a best guess — check the pin and drag it onto the right building.`,
        alternatives: rest.map((r) => ({ lat: r.lat, lng: r.lng, address: r.address })),
        ...flags(first.lat, first.lng),
      };
    }
  }
  return { ok: false, code: "NO_COORDINATES", message: "No location could be read from that link. Open the place in Google Maps and copy the link from Share, or drop the pin on the map yourself." };
}
