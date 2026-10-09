import { prisma } from "./prisma";
import { formatAddress, normalizeCoords } from "@/lib/location";

/** Jobs whose team has not set out yet — their location may still follow the property. */
export const LOCATION_OPEN_STATUSES = ["DRAFT", "SCHEDULED", "ASSIGNED"];

/**
 * After a property's pin or address changes, every not-yet-started job that
 * follows the property (locationSource PROPERTY) gets the new location. Jobs
 * with their own pin, and jobs already under way or finished, keep theirs —
 * history is never rewritten. Returns the number of jobs updated.
 */
export async function syncOpenJobsToProperty(propertyId: string): Promise<number> {
  const p = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!p) return 0;
  const pin = normalizeCoords(p.lat, p.lng);
  const r = await prisma.job.updateMany({
    where: { propertyId, status: { in: LOCATION_OPEN_STATUSES }, OR: [{ locationSource: "PROPERTY" }, { locationSource: null }] },
    data: { locationLat: pin?.lat ?? null, locationLng: pin?.lng ?? null, locationAddress: formatAddress(p) || null, locationSource: "PROPERTY" },
  });
  return r.count;
}
