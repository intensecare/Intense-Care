import type { PhoneContact, PhoneContactNumber, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export interface ContactRow {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
  status: "ACTIVE" | "REMOVED";
  removedAt: string | null;
  deviceId: string;
  deviceLabel: string | null;
  firstSyncedAt: string;
  lastSyncedAt: string;
  importState: string;
  customer: { id: string; name: string } | null;
  lead: { id: string; leadNumber: string; status: string } | null;
  /** Shares a number with another contact on the same phone. */
  duplicate: boolean;
  /** Matches more than one ERP customer — needs a person to choose. */
  ambiguousCustomers: { id: string; name: string }[];
}

type Full = PhoneContact & { numbers: PhoneContactNumber[] };

/** Contact ids (of this list) that share a number with another active contact on the same phone, and not dismissed. */
async function duplicateIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT n."contactId" AS id
    FROM "PhoneContactNumber" n
    JOIN "PhoneContact" c ON c.id = n."contactId" AND c.status = 'ACTIVE' AND c."dupDismissedAt" IS NULL
    WHERE n."contactId" = ANY(${ids}::text[])
      AND EXISTS (
        SELECT 1 FROM "PhoneContactNumber" n2 JOIN "PhoneContact" c2 ON c2.id = n2."contactId" AND c2.status = 'ACTIVE'
        WHERE n2."phoneKey" = n."phoneKey" AND n2."contactId" <> n."contactId" AND c2."deviceRowId" = c."deviceRowId")`;
  return new Set(rows.map((r) => r.id));
}

/** ERP customers matched per contact id (for contacts that match more than one). */
async function customerMatches(ids: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>();
  if (!ids.length) return out;
  const rows = await prisma.$queryRaw<{ cid: string; id: string; name: string }[]>`
    SELECT DISTINCT n."contactId" AS cid, c.id, c.name
    FROM "PhoneContactNumber" n
    JOIN "Customer" c ON right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = n."phoneKey" AND c.status <> 'inactive'
    WHERE n."contactId" = ANY(${ids}::text[])`;
  for (const r of rows) out.set(r.cid, [...(out.get(r.cid) ?? []), { id: r.id, name: r.name }]);
  return out;
}

export async function serializeContacts(rows: Full[]): Promise<ContactRow[]> {
  const ids = rows.map((r) => r.id);
  const [dups, matches, devices, customers, leads] = await Promise.all([
    duplicateIds(ids),
    customerMatches(ids),
    prisma.mobileDevice.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.deviceRowId))) } }, select: { id: true, deviceId: true, label: true } }),
    prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    prisma.lead.findMany({ where: { id: { in: rows.map((r) => r.leadId).filter((x): x is string => !!x) } }, select: { id: true, leadNumber: true, status: true } }),
  ]);
  const dev = new Map(devices.map((d) => [d.id, d]));
  const cust = new Map(customers.map((c) => [c.id, c]));
  const lead = new Map(leads.map((l) => [l.id, l]));
  return rows.map((r) => {
    const m = matches.get(r.id) ?? [];
    return {
      id: r.id,
      name: r.displayName,
      phones: r.numbers.map((n) => n.e164),
      emails: r.emails,
      status: r.status as "ACTIVE" | "REMOVED",
      removedAt: r.removedAt?.toISOString() ?? null,
      deviceId: r.deviceRowId,
      deviceLabel: dev.get(r.deviceRowId)?.label ?? null,
      firstSyncedAt: r.firstSyncedAt.toISOString(),
      lastSyncedAt: r.lastSyncedAt.toISOString(),
      importState: r.importState,
      customer: r.customerId && cust.get(r.customerId) ? cust.get(r.customerId)! : null,
      lead: r.leadId && lead.get(r.leadId) ? lead.get(r.leadId)! : null,
      duplicate: dups.has(r.id),
      ambiguousCustomers: m.length > 1 ? m : [],
    };
  });
}

export interface ContactFilters {
  q?: string | null;
  status?: string | null;
  link?: string | null;
  deviceRowId?: string | null;
  dup?: boolean;
}

export async function contactWhere(f: ContactFilters): Promise<Prisma.PhoneContactWhereInput> {
  const and: Prisma.PhoneContactWhereInput[] = [];
  const status = f.status === "REMOVED" ? "REMOVED" : f.status === "ALL" ? null : "ACTIVE";
  if (status) and.push({ status });
  if (f.deviceRowId) and.push({ deviceRowId: f.deviceRowId });
  if (f.q?.trim()) {
    const q = f.q.trim();
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { emails: { has: q.toLowerCase() } },
        ...(digits.length >= 4 ? [{ numbers: { some: { phoneKey: { contains: digits.slice(-10) } } } }] : []),
      ],
    });
  }
  if (f.link === "customer") and.push({ customerId: { not: null } });
  else if (f.link === "lead") and.push({ leadId: { not: null } });
  else if (f.link === "none") and.push({ customerId: null, leadId: null });
  if (f.dup) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT n."contactId" AS id FROM "PhoneContactNumber" n
      JOIN "PhoneContact" c ON c.id = n."contactId" AND c.status = 'ACTIVE' AND c."dupDismissedAt" IS NULL
      WHERE EXISTS (SELECT 1 FROM "PhoneContactNumber" n2 JOIN "PhoneContact" c2 ON c2.id = n2."contactId" AND c2.status = 'ACTIVE'
        WHERE n2."phoneKey" = n."phoneKey" AND n2."contactId" <> n."contactId" AND c2."deviceRowId" = c."deviceRowId")`;
    and.push({ id: { in: rows.map((r) => r.id) } });
  }
  return and.length ? { AND: and } : {};
}
