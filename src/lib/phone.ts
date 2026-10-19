/**
 * Phone-number normalisation — ONE rule used by the contact sync (server side)
 * and mirrored exactly by the Android app (PhoneNormalizer.java); both run the
 * same vectors in tests/fixtures/phone-vectors.json.
 *
 *   e164  international form, "+" and digits (what we display and store)
 *   key   the LAST 10 digits — what customers, leads and contacts are matched on
 *
 * Numbers that can't be a real phone number (too short, too long, all one
 * digit, no digits) return null and are never stored or matched.
 */

export const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE?.replace(/\D/g, "") || "91";

export interface NormalizedPhone {
  e164: string;
  key: string;
}

export function normalizePhone(raw: string, countryCode: string = DEFAULT_COUNTRY_CODE): NormalizedPhone | null {
  if (typeof raw !== "string") return null;
  let t = raw.trim();
  if (t.length === 0 || t.length > 40) return null;
  // "tel:" prefix and a trailing extension ("ext 12", "x12") are dropped.
  t = t.replace(/^tel:/i, "").replace(/\s*(ext\.?|extension|x)\s*\d+\s*$/i, "");
  // Service codes ("*123#") and anything still carrying letters aren't phone numbers.
  if (/[*#A-Za-z]/.test(t)) return null;
  const plus = t.startsWith("+");
  let d = t.replace(/\D/g, "");
  if (d.length < 7) return null;
  if (!plus) {
    if (d.startsWith("00")) d = d.slice(2); // 00 = international call prefix
    else if (d.length === 11 && d.startsWith("0")) d = countryCode + d.slice(1); // national trunk 0
    else if (d.length === 10) d = countryCode + d; // national number
  }
  if (d.length < 8 || d.length > 15) return null;
  const key = d.slice(-10);
  if (/^(\d)\1+$/.test(key)) return null; // 0000000000, 1111111111 …
  return { e164: `+${d}`, key };
}
