import type { Lead, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { HttpError } from "./authz";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  OPEN_LEAD_STATUSES,
  phoneKey,
  isPlausiblePhone,
  todayIST,
  type LeadActivityRow,
  type LeadRow,
  type LeadSource,
  type LeadStats,
  type LeadStatus,
} from "@/lib/leads";
import { normalizeCoords } from "@/lib/location";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-20");
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Fields an authorized user may set when creating or editing a lead. */
export const LeadFields = z.object({
  customerName: z.string().trim().min(2, "Enter the customer's name").max(120),
  phone: z.string().trim().min(6).max(24).refine(isPlausiblePhone, "Enter a valid phone number (10–15 digits)"),
  email: z.string().trim().email("Enter a valid email").max(160).nullable().optional().or(z.literal("")),
  source: z.enum(LEAD_SOURCES),
  sourceDetails: optText(300),
  serviceInterest: optText(200),
  serviceId: z.string().max(64).nullable().optional(),
  propertyAddress: optText(500),
  locality: optText(120),
  city: optText(120),
  postalCode: optText(16),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  preferredDate: day.nullable().optional().or(z.literal("")),
  estimatedValue: z.number().min(0).max(100_000_000).nullable().optional(),
  assignedUserId: z.string().max(64).nullable().optional(),
  notes: optText(4000),
  nextFollowUpDate: day.nullable().optional().or(z.literal("")),
});
export type LeadInput = z.infer<typeof LeadFields>;

export const actorOf = (u: { id: string; name: string }) => ({ actorId: u.id, actorName: u.name });

export async function nextLeadNumber(tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('lead_seq') AS n`;
  return `LD-${String(Number(rows[0].n)).padStart(5, "0")}`;
}

/** Normalised data for a create/update (blank → null, coordinates validated as a pair). */
export function cleanLeadData(d: Partial<LeadInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined || k === "lat" || k === "lng") continue;
    out[k] = typeof v === "string" ? v.trim() || null : v;
  }
  if (d.phone !== undefined) out.phoneKey = phoneKey(d.phone);
  if (d.email !== undefined) out.email = d.email ? d.email.toLowerCase() : null;
  if (d.lat !== undefined || d.lng !== undefined) {
    const pin = normalizeCoords(d.lat, d.lng);
    if (!pin && (d.lat != null || d.lng != null)) throw new HttpError(400, "The lead's map location needs both latitude and longitude.");
    out.lat = pin?.lat ?? null;
    out.lng = pin?.lng ?? null;
  }
  return out;
}

export async function validateRefs(d: { serviceId?: string | null; assignedUserId?: string | null }) {
  if (d.serviceId && !(await prisma.service.findUnique({ where: { id: d.serviceId }, select: { id: true } }))) throw new HttpError(400, "That service doesn't exist.");
  if (d.assignedUserId) {
    const u = await prisma.user.findUnique({ where: { id: d.assignedUserId }, select: { active: true, role: true } });
    if (!u || !u.active || u.role !== "admin") throw new HttpError(400, "Leads can be assigned only to an active Admin user.");
  }
}

/** Open leads with the same phone number (the duplicate check). */
export async function openDuplicates(key: string, excludeId?: string) {
  if (!key) return [];
  return prisma.lead.findMany({
    where: { phoneKey: key, status: { in: OPEN_LEAD_STATUSES }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, leadNumber: true, status: true, customerName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function addActivity(leadId: string, a: { type: string; message: string; outcome?: string | null; externalId?: string | null; actorId?: string | null; actorName: string }, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.leadActivity.create({ data: { leadId, type: a.type, message: a.message.slice(0, 2000), outcome: a.outcome ?? null, externalId: a.externalId ?? null, actorId: a.actorId ?? null, actorName: a.actorName } });
}

export async function createLead(
  data: Record<string, unknown> & { customerName: string; phone: string; source: LeadSource },
  actor: { actorId?: string | null; actorName: string },
  activity: { type: string; message: string; outcome?: string | null; externalId?: string | null }
): Promise<Lead> {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: { ...(data as Prisma.LeadUncheckedCreateInput), phoneKey: phoneKey(data.phone), leadNumber: await nextLeadNumber(tx), createdBy: actor.actorId ?? null },
    });
    await addActivity(lead.id, { ...activity, ...actor }, tx);
    return lead;
  });
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Rows → wire format, with names of the assignee, service, quotation and job. */
export async function hydrateLeads(rows: Lead[], opts: { duplicates?: boolean } = {}): Promise<LeadRow[]> {
  const ids = (k: keyof Lead) => Array.from(new Set(rows.map((r) => r[k]).filter((x): x is string => typeof x === "string" && !!x)));
  const [users, services, quotes, jobs] = await Promise.all([
    ids("assignedUserId").length ? prisma.user.findMany({ where: { id: { in: ids("assignedUserId") } }, select: { id: true, name: true } }) : [],
    ids("serviceId").length ? prisma.service.findMany({ where: { id: { in: ids("serviceId") } }, select: { id: true, name: true } }) : [],
    ids("quoteId").length ? prisma.quote.findMany({ where: { id: { in: ids("quoteId") } }, select: { id: true, quoteNumber: true } }) : [],
    ids("convertedJobId").length ? prisma.job.findMany({ where: { id: { in: ids("convertedJobId") } }, select: { id: true, jobSerial: true } }) : [],
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const svc = new Map(services.map((s) => [s.id, s.name]));
  const qn = new Map(quotes.map((q) => [q.id, q.quoteNumber]));
  const jn = new Map(jobs.map((j) => [j.id, j.jobSerial]));
  let dupes = new Map<string, { id: string; leadNumber: string; status: LeadStatus }[]>();
  if (opts.duplicates) {
    const keys = Array.from(new Set(rows.map((r) => r.phoneKey).filter(Boolean)));
    const all = keys.length ? await prisma.lead.findMany({ where: { phoneKey: { in: keys } }, select: { id: true, leadNumber: true, status: true, phoneKey: true } }) : [];
    dupes = new Map(rows.map((r) => [r.id, all.filter((x) => x.phoneKey === r.phoneKey && x.id !== r.id).map((x) => ({ id: x.id, leadNumber: x.leadNumber, status: x.status as LeadStatus }))]));
  }
  return rows.map((r) => ({
    id: r.id,
    leadNumber: r.leadNumber,
    customerName: r.customerName,
    phone: r.phone,
    email: r.email,
    source: r.source as LeadSource,
    sourceDetails: r.sourceDetails,
    serviceInterest: r.serviceInterest,
    serviceId: r.serviceId,
    serviceName: r.serviceId ? svc.get(r.serviceId) ?? null : null,
    propertyAddress: r.propertyAddress,
    locality: r.locality,
    city: r.city,
    postalCode: r.postalCode,
    lat: r.lat,
    lng: r.lng,
    preferredDate: r.preferredDate,
    estimatedValue: r.estimatedValue,
    assignedUserId: r.assignedUserId,
    assignedUserName: r.assignedUserId ? name.get(r.assignedUserId) ?? null : null,
    status: r.status as LeadStatus,
    lostReason: r.lostReason,
    notes: r.notes,
    nextFollowUpDate: r.nextFollowUpDate,
    lastContactedAt: iso(r.lastContactedAt),
    quoteId: r.quoteId,
    quoteNumber: r.quoteId ? qn.get(r.quoteId) ?? null : null,
    convertedCustomerId: r.convertedCustomerId,
    convertedPropertyId: r.convertedPropertyId,
    convertedJobId: r.convertedJobId,
    convertedJobNumber: r.convertedJobId ? jn.get(r.convertedJobId) ?? null : null,
    convertedAt: iso(r.convertedAt),
    utmSource: r.utmSource,
    utmMedium: r.utmMedium,
    utmCampaign: r.utmCampaign,
    utmTerm: r.utmTerm,
    utmContent: r.utmContent,
    gclid: r.gclid,
    landingPage: r.landingPage,
    referrerUrl: r.referrerUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(opts.duplicates ? { duplicates: dupes.get(r.id) ?? [] } : {}),
  }));
}

export const serializeActivity = (a: { id: string; type: string; message: string; outcome: string | null; actorName: string; createdAt: Date }): LeadActivityRow => ({
  id: a.id,
  type: a.type,
  message: a.message,
  outcome: a.outcome,
  actorName: a.actorName,
  createdAt: a.createdAt.toISOString(),
});

export interface LeadFilters {
  q?: string | null;
  from?: string | null;
  to?: string | null;
  source?: string | null;
  status?: string | null;
  assignedUserId?: string | null;
  followUp?: "today" | "overdue" | null;
}

export function filtersFromUrl(url: URL): LeadFilters {
  const g = (k: string) => url.searchParams.get(k);
  const f = g("followUp");
  return { q: g("q"), from: g("from"), to: g("to"), source: g("source"), status: g("status"), assignedUserId: g("assignedUserId"), followUp: f === "today" || f === "overdue" ? f : null };
}

const IST_OFFSET_MS = 330 * 60 * 1000;
/** Start of an IST calendar day as a UTC instant. */
const istDayStart = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - IST_OFFSET_MS);

/** The filters as a Prisma where. `except` drops a filter (the dashboard counts every status). */
export function leadWhere(f: LeadFilters, except: (keyof LeadFilters)[] = []): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];
  const use = (k: keyof LeadFilters) => !except.includes(k) && !!f[k];
  if (use("q")) {
    const q = f.q!.trim();
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { customerName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { leadNumber: { contains: q, mode: "insensitive" } },
        { serviceInterest: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { locality: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phoneKey: { contains: digits.slice(-10) } }] : []),
      ],
    });
  }
  if (use("from") && /^\d{4}-\d{2}-\d{2}$/.test(f.from!)) and.push({ createdAt: { gte: istDayStart(f.from!) } });
  if (use("to") && /^\d{4}-\d{2}-\d{2}$/.test(f.to!)) and.push({ createdAt: { lt: new Date(istDayStart(f.to!).getTime() + 86400000) } });
  if (use("source") && (LEAD_SOURCES as readonly string[]).includes(f.source!)) and.push({ source: f.source! });
  if (use("status") && (LEAD_STATUSES as readonly string[]).includes(f.status!)) and.push({ status: f.status! });
  if (use("assignedUserId")) and.push({ assignedUserId: f.assignedUserId === "none" ? null : f.assignedUserId! });
  if (use("followUp")) {
    const today = todayIST();
    and.push({ status: { in: OPEN_LEAD_STATUSES }, nextFollowUpDate: f.followUp === "today" ? today : { lt: today, not: null } });
  }
  return and.length ? { AND: and } : {};
}

export async function leadStats(where: Prisma.LeadWhereInput): Promise<LeadStats> {
  const today = todayIST();
  const [bySourceRows, byStatusRows, followUpsToday, overdue, quoted, pipeline] = await Promise.all([
    prisma.lead.groupBy({ by: ["source"], where, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.lead.count({ where: { AND: [where, { status: { in: OPEN_LEAD_STATUSES }, nextFollowUpDate: today }] } }),
    prisma.lead.count({ where: { AND: [where, { status: { in: OPEN_LEAD_STATUSES }, nextFollowUpDate: { lt: today, not: null } }] } }),
    prisma.lead.count({ where: { AND: [where, { OR: [{ status: "QUOTATION_SENT" }, { quoteId: { not: null } }] }] } }),
    prisma.lead.aggregate({ where: { AND: [where, { status: { in: OPEN_LEAD_STATUSES } }] }, _sum: { estimatedValue: true } }),
  ]);
  const bySource = Object.fromEntries(LEAD_SOURCES.map((s) => [s, 0])) as Record<LeadSource, number>;
  for (const r of bySourceRows) if (r.source in bySource) bySource[r.source as LeadSource] = r._count._all;
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const r of byStatusRows) if (r.status in byStatus) byStatus[r.status as LeadStatus] = r._count._all;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const closed = byStatus.WON + byStatus.LOST;
  return {
    total,
    new: byStatus.NEW,
    bySource,
    byStatus,
    followUpsToday,
    overdueFollowUps: overdue,
    quotationsSent: quoted,
    won: byStatus.WON,
    lost: byStatus.LOST,
    conversionRate: closed ? Math.round((byStatus.WON / closed) * 1000) / 10 : null,
    pipelineValue: Math.round((pipeline._sum.estimatedValue ?? 0) * 100) / 100,
  };
}

/* -------------------------------------------------------------------------- */
/* Customer / property / job from a lead                                      */
/* -------------------------------------------------------------------------- */

export const PropertyFromLead = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(3, "Enter the property address").max(500),
  locality: optText(120),
  city: optText(120),
  postalCode: optText(16),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

export const LinkCustomerSchema = z.object({
  /** Use this existing customer (else: the lead's linked one, else one with the same phone, else a new one). */
  customerId: z.string().max(64).optional(),
  /** Use this existing property of the customer. */
  propertyId: z.string().max(64).optional(),
  /** Or create this property. Defaults to the lead's address. */
  property: PropertyFromLead.optional(),
  /** Make a new customer even if one with the same phone exists. */
  forceNewCustomer: z.boolean().optional(),
});

/** Existing customers whose phone matches (digits only, last 10). */
export async function customersWithPhone(key: string) {
  if (key.length < 6) return [];
  return prisma.$queryRaw<{ id: string; name: string; phone: string }[]>`
    SELECT id, name, phone FROM "Customer"
    WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = ${key} AND status <> 'inactive'
    ORDER BY "createdAt" ASC LIMIT 5`;
}

const customerSourceFor = (s: string) => (s === "REFERRAL" ? "referral" : s.startsWith("GOOGLE") ? "google" : "direct");

/**
 * The customer and property a lead becomes. Reuses what already exists (the
 * lead's linked records, a chosen customer/property, or a customer with the
 * same phone) before creating anything, and records the links on the lead so
 * a retry never makes a second customer.
 */
export async function ensureCustomerAndProperty(lead: Lead, input: z.infer<typeof LinkCustomerSchema>, actor: { id: string; name: string }) {
  let customerId = input.customerId ?? lead.convertedCustomerId ?? null;
  let reused = !!customerId;
  if (customerId) {
    const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!c) throw new HttpError(404, "That customer doesn't exist.");
  } else if (!input.forceNewCustomer) {
    const match = (await customersWithPhone(lead.phoneKey))[0];
    if (match) {
      customerId = match.id;
      reused = true;
    }
  }
  if (!customerId) {
    const c = await prisma.customer.create({
      data: {
        name: lead.customerName,
        phone: lead.phone,
        email: lead.email ?? "",
        address: [lead.propertyAddress, lead.locality, lead.city, lead.postalCode].filter(Boolean).join(", "),
        source: customerSourceFor(lead.source),
        notes: `From lead ${lead.leadNumber}`,
      },
    });
    customerId = c.id;
  }

  let propertyId = input.propertyId ?? (lead.convertedCustomerId === customerId ? lead.convertedPropertyId : null) ?? null;
  let propertyReused = !!propertyId;
  if (propertyId) {
    const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { customerId: true } });
    if (!p || p.customerId !== customerId) throw new HttpError(400, "That property doesn't belong to this customer.");
  } else {
    const src = input.property ?? (lead.propertyAddress ? { address: lead.propertyAddress, locality: lead.locality, city: lead.city, postalCode: lead.postalCode, lat: lead.lat, lng: lead.lng } : null);
    if (!src) {
      // An existing customer with exactly one property: that's the one.
      const props = await prisma.property.findMany({ where: { customerId }, select: { id: true } });
      if (props.length === 1) {
        propertyId = props[0].id;
        propertyReused = true;
      } else throw new HttpError(400, props.length ? "Choose which of the customer's properties this job is for." : "Enter the property address for this customer.");
    } else {
      const pin = normalizeCoords(src.lat, src.lng);
      const p = await prisma.property.create({
        data: {
          customerId,
          title: ("title" in src && src.title) || `${lead.customerName.split(" ")[0]}'s ${src.locality || src.city || "Property"}`.slice(0, 200),
          address: src.address,
          locality: src.locality ?? null,
          city: src.city ?? "",
          postalCode: src.postalCode ?? null,
          lat: pin?.lat ?? null,
          lng: pin?.lng ?? null,
          locationSource: pin ? "MAP_PIN" : null,
          locationUpdatedAt: pin ? new Date() : null,
        },
      });
      propertyId = p.id;
    }
  }

  await prisma.lead.update({ where: { id: lead.id }, data: { convertedCustomerId: customerId, convertedPropertyId: propertyId } });
  if (lead.convertedCustomerId !== customerId || lead.convertedPropertyId !== propertyId) {
    await addActivity(lead.id, { type: "CUSTOMER_LINKED", message: `${reused ? "Linked to existing customer" : "New customer created"}; ${propertyReused ? "existing property" : "new property"} used.`, ...actorOf(actor) });
  }
  return { customerId: customerId!, propertyId: propertyId!, customerReused: reused, propertyReused };
}
