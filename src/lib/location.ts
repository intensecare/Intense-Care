/**
 * Location rules shared by the server and the app — ONE place that decides
 * what a valid coordinate is and where a job's team actually has to go.
 *
 *  - A pin is a pair: both latitude and longitude, finite, in range, and not
 *    (0,0) (the default of a broken form, never a real customer address).
 *  - A job's service location is the job's own pin when it has one, else its
 *    property's saved pin. Nothing ever falls back to the viewer's device location.
 */

export interface Coords {
  lat: number;
  lng: number;
}

/** Turns numbers or numeric strings into a valid pair, or null. */
export function normalizeCoords(lat: unknown, lng: unknown): Coords | null {
  const a = toNum(lat);
  const b = toNum(lng);
  if (a === null || b === null) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: round6(a), lng: round6(b) };
}

export const hasCoords = (v: { lat?: number | null; lng?: number | null } | null | undefined): v is Coords =>
  !!v && normalizeCoords(v.lat, v.lng) !== null;

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * India bounding box (the business operates in India). A pair that is outside
 * it but lands inside once swapped was almost certainly saved lng,lat.
 */
const IN_BOX = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };
const inIndia = (c: Coords) => c.lat >= IN_BOX.minLat && c.lat <= IN_BOX.maxLat && c.lng >= IN_BOX.minLng && c.lng <= IN_BOX.maxLng;
export function looksSwapped(c: Coords): boolean {
  return !inIndia(c) && inIndia({ lat: c.lng, lng: c.lat });
}
export const isInServiceArea = inIndia;

export interface AddressParts {
  address?: string | null;
  addressLine?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/**
 * One printable line. `address` is the full address the user typed; the parts
 * are appended only when the full address does not already contain them.
 */
export function formatAddress(p: AddressParts): string {
  const full = (p.address ?? "").trim();
  const lower = full.toLowerCase();
  const extra = [p.locality, p.city, p.state, p.postalCode]
    .map((x) => (x ?? "").trim())
    .filter((x) => x && !lower.includes(x.toLowerCase()));
  const base = full || (p.addressLine ?? "").trim();
  return [base, ...extra].filter(Boolean).join(", ");
}

export type LocationSource = "JOB" | "PROPERTY";

export interface ServiceLocation {
  lat: number | null;
  lng: number | null;
  address: string;
  /** Where the pin came from; null when there is no pin at all. */
  source: LocationSource | null;
}

/**
 * Where the team goes for a job. A job that follows its property
 * (locationSource PROPERTY) uses the property's saved pin; a job with its own
 * pin (JOB) uses that. Either way a missing pin falls back to the other saved
 * pin — never to anything else.
 */
export function resolveServiceLocation(
  job: { locationLat?: number | null; locationLng?: number | null; locationAddress?: string | null; locationSource?: string | null },
  property?: (AddressParts & { lat?: number | null; lng?: number | null }) | null
): ServiceLocation {
  const own = normalizeCoords(job.locationLat, job.locationLng);
  const prop = property ? normalizeCoords(property.lat, property.lng) : null;
  const followsProperty = job.locationSource === "PROPERTY" || (!job.locationSource && !!own && !!prop && Math.abs(own.lat - prop.lat) < 1e-6 && Math.abs(own.lng - prop.lng) < 1e-6);
  const [pin, source]: [Coords | null, LocationSource | null] = followsProperty
    ? prop ? [prop, "PROPERTY"] : own ? [own, "JOB"] : [null, null]
    : own ? [own, "JOB"] : prop ? [prop, "PROPERTY"] : [null, null];
  const address = (job.locationAddress ?? "").trim() || (property ? formatAddress(property) : "");
  return { lat: pin?.lat ?? null, lng: pin?.lng ?? null, address, source };
}

/** Google Maps directions. Uses the saved pin; with no pin, the address text (never the device location). */
export function navigateUrl(v: { lat?: number | null; lng?: number | null; address?: string | null }): string | null {
  const c = normalizeCoords(v.lat, v.lng);
  const dest = c ? `${c.lat},${c.lng}` : (v.address ?? "").trim();
  if (!dest) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

export const LOCATION_SOURCES = ["SEARCH", "MAP_PIN", "DEVICE_GPS", "MANUAL", "IMPORTED"] as const;
export type PropertyLocationSource = (typeof LOCATION_SOURCES)[number];
export const LOCATION_SOURCE_LABEL: Record<PropertyLocationSource, string> = {
  SEARCH: "Address search",
  MAP_PIN: "Pin placed on the map",
  DEVICE_GPS: "Device location at the property",
  MANUAL: "Coordinates typed in",
  IMPORTED: "Existing record",
};

/** Great-circle distance in metres. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
