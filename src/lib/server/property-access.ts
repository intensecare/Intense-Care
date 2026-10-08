import { prisma } from "./prisma";
import { generateToken, hashToken, sealToken, openToken } from "./qr-service";
import { resolveBaseUrl } from "./policy";

/**
 * The ONE optional property QR.
 *
 * A printed QR at the property (door, utility room …) that opens the
 * customer page for the property's current or next service. The token is a
 * 256-bit random value: only its SHA-256 hash verifies; an encrypted copy
 * lets the admin re-print the same QR. Regenerating revokes the old QR.
 * The QR never carries any customer data — it only points at the job's own
 * secure service link, which the server then authorizes as usual.
 */

export function propertyLinkPath(token: string): string {
  return `/customer/property/${token}`;
}

/** Current QR link for the property, or null when none was created. */
export async function getPropertyAccessLink(propertyId: string): Promise<string | null> {
  const row = await prisma.property.findUnique({ where: { id: propertyId }, select: { accessTokenEnc: true } });
  const raw = row?.accessTokenEnc ? openToken(row.accessTokenEnc) : null;
  return raw ? `${resolveBaseUrl(null)}${propertyLinkPath(raw)}` : null;
}

/** Create (or replace, which revokes the old one) the property's QR link. */
export async function createPropertyAccessLink(propertyId: string): Promise<string> {
  const raw = generateToken();
  await prisma.property.update({
    where: { id: propertyId },
    data: { accessTokenHash: hashToken(raw), accessTokenEnc: sealToken(raw) },
  });
  return `${resolveBaseUrl(null)}${propertyLinkPath(raw)}`;
}

export async function revokePropertyAccessLink(propertyId: string): Promise<void> {
  await prisma.property.update({ where: { id: propertyId }, data: { accessTokenHash: null, accessTokenEnc: null } });
}

const OPEN = ["DRAFT", "SCHEDULED", "ASSIGNED", "ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS", "WORK_COMPLETED", "QUALITY_CHECK", "PASS", "REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_COMPLETED", "REINSPECTION", "CUSTOMER_APPROVAL"];

/**
 * Resolves a scanned property QR to the job whose page should open:
 * the active job today, else the next upcoming one, else the most recent
 * completed one (so the customer can still rate it).
 */
export async function resolvePropertyAccess(token: string): Promise<{ propertyTitle: string; jobId: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const property = await prisma.property.findUnique({ where: { accessTokenHash: hashToken(token) }, select: { id: true, title: true } });
  if (!property) return null;

  const open = await prisma.job.findMany({
    where: { propertyId: property.id, status: { in: OPEN } },
    select: { id: true, status: true, scheduledDate: true, scheduledTimeSlot: true },
    orderBy: [{ scheduledDate: "asc" }, { scheduledTimeSlot: "asc" }],
  });
  const onSite = open.find((j) => !["DRAFT", "SCHEDULED", "ASSIGNED"].includes(j.status));
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = open.find((j) => j.scheduledDate >= today) ?? open[0];
  let jobId: string | null = onSite?.id ?? upcoming?.id ?? null;
  if (!jobId) {
    const last = await prisma.job.findFirst({
      where: { propertyId: property.id, status: { in: ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    jobId = last?.id ?? null;
  }
  return { propertyTitle: property.title, jobId };
}
