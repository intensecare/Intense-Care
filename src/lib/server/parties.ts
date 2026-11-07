import type { Customer, Prisma, Property } from "@prisma/client";
import { prisma } from "./prisma";
import { normalizePhone } from "@/lib/phone";

/**
 * Find-or-create for customers and properties, shared by quotations, quick job creation and quotation → job
 * conversion, so the same person or address typed twice never becomes two records.
 *
 *  - Customer: matched on the phone number's last 10 digits (any format). A match is REUSED as it is — typing a
 *    different name for a known number never edits the customer. No phone → nothing to match on → a new customer.
 *  - Property: matched, within one customer, on the normalised address text. Nothing is invented: no coordinates,
 *    no placeholder details — a property made from an address alone has no map pin.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function findCustomerByPhone(phone: string, db: Db = prisma): Promise<Customer | null> {
  const n = normalizePhone(phone);
  if (!n) return null;
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Customer" WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${n.key} ORDER BY "createdAt" ASC LIMIT 1`;
  return rows[0] ? db.customer.findUnique({ where: { id: rows[0].id } }) : null;
}

export interface NewCustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
}

export async function findOrCreateCustomer(input: NewCustomerInput, db: Db = prisma): Promise<{ customer: Customer; created: boolean }> {
  const phone = (input.phone ?? "").trim();
  if (phone) {
    const existing = await findCustomerByPhone(phone, db);
    if (existing) return { customer: existing, created: false };
  }
  const customer = await db.customer.create({
    data: { name: input.name.trim(), phone, email: (input.email ?? "").trim().toLowerCase(), address: (input.address ?? "").trim(), gstin: input.gstin || null, source: "direct" },
  });
  return { customer, created: true };
}

/** Lower-case, punctuation and spacing removed — "12, MG Road,  Bengaluru" and "12 mg road bengaluru" are the same address. */
export const addressKey = (a: string) => a.toLowerCase().replace(/[^a-z0-9ऀ-෿]+/g, " ").trim();

export async function findOrCreateProperty(customerId: string, input: { address: string; title?: string | null }, db: Db = prisma): Promise<{ property: Property; created: boolean }> {
  const address = input.address.trim();
  const key = addressKey(address);
  const mine = await db.property.findMany({ where: { customerId } });
  const hit = mine.find((p) => addressKey(p.address) === key || addressKey([p.address, p.city].filter(Boolean).join(" ")) === key);
  if (hit) return { property: hit, created: false };
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { name: true } });
  const property = await db.property.create({
    data: { customerId, address, title: input.title?.trim() || `${(customer?.name ?? "Customer").split(" ")[0]}'s property` },
  });
  return { property, created: true };
}
