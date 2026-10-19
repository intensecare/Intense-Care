import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { SYNC_LIMITS, type DeviceContact, type RecordFailureCode } from "@/lib/contacts";

/** Cleaning of one contact from the phone — pure (no database), so it is unit-tested directly. */

const ContactShape = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(1000).default(""),
  phones: z.array(z.string().max(60)).max(100).default([]),
  emails: z.array(z.string().max(300)).max(100).optional(),
  updatedAt: z.number().int().min(0).max(8.64e15).optional(),
});

export interface Prepared {
  id: string;
  name: string;
  numbers: { e164: string; key: string }[];
  emails: string[];
  hash: string;
  updatedAt: Date | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cleans one contact into the fields we store, or says why it can't be. */
export function prepareContact(raw: unknown): { ok: true; contact: Prepared } | { ok: false; code: RecordFailureCode | "SKIP"; id?: string } {
  const parsed = ContactShape.safeParse(raw);
  if (!parsed.success) {
    const id = (raw as { id?: unknown } | null)?.id;
    return { ok: false, code: "INVALID_RECORD", id: typeof id === "string" ? id.slice(0, 128) : undefined };
  }
  const c: DeviceContact & { name: string; phones: string[] } = parsed.data as never;
  const seen = new Set<string>();
  const numbers: { e164: string; key: string }[] = [];
  for (const p of c.phones.slice(0, SYNC_LIMITS.maxPhonesPerContact)) {
    const n = normalizePhone(p);
    if (n && !seen.has(n.key)) {
      seen.add(n.key);
      numbers.push(n);
    }
  }
  const emails = Array.from(new Set((c.emails ?? []).map((e) => e.trim().toLowerCase()).filter((e) => e.length <= 200 && EMAIL.test(e)))).slice(0, SYNC_LIMITS.maxEmailsPerContact);
  const name = c.name.replace(/\s+/g, " ").trim().slice(0, SYNC_LIMITS.maxNameLength);
  // The directory exists to match phone numbers: a contact without a usable number isn't kept.
  if (numbers.length === 0) return { ok: false, code: "SKIP", id: c.id };
  const hash = createHash("sha256")
    .update(JSON.stringify([name, numbers.map((n) => n.key).sort(), emails.slice().sort()]))
    .digest("hex");
  return {
    ok: true,
    contact: { id: c.id, name, numbers, emails, hash, updatedAt: c.updatedAt ? new Date(c.updatedAt) : null },
  };
}

