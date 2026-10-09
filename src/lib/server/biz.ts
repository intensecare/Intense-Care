import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { financialYear } from "./invoices";

type Db = PrismaClient | Prisma.TransactionClient;

const SEQUENCES = {
  expense: "expense_seq",
  referral: "referral_seq",
  employee: "employee_seq",
  freelancer: "freelancer_seq",
  freelance_payment: "freelance_payment_seq",
} as const;
export type SeqName = keyof typeof SEQUENCES;

/** Next number from a database sequence (gap-free enough, never duplicated). */
export async function nextSeq(name: SeqName, db: Db = prisma): Promise<number> {
  const seq = SEQUENCES[name]; // fixed whitelist — never user input
  const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('"${seq}"') AS n`);
  return Number(n);
}

export async function nextExpenseNumber(db: Db = prisma) {
  return `EXP-${financialYear()}-${String(await nextSeq("expense", db)).padStart(5, "0")}`;
}
export async function nextReferralNumber(db: Db = prisma) {
  return `REF-${String(await nextSeq("referral", db)).padStart(5, "0")}`;
}
export async function nextEmployeeCode(type: string, db: Db = prisma) {
  return type === "FREELANCE" ? `FRL-${String(await nextSeq("freelancer", db)).padStart(4, "0")}` : `EMP-${String(await nextSeq("employee", db)).padStart(4, "0")}`;
}
export async function nextFreelancePaymentNumber(db: Db = prisma) {
  return `FPY-${financialYear()}-${String(await nextSeq("freelance_payment", db)).padStart(5, "0")}`;
}

/** ?page=1&pageSize=25 — bounded so a request can't ask for the whole table. */
export function parsePaging(url: URL, defaultSize = 25, maxSize = 100) {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Math.floor(Number(url.searchParams.get("pageSize"))) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isMonth = (s: string | null | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Today in India as YYYY-MM-DD (the business runs on IST). */
export function istToday(d: Date = new Date()): string {
  return new Date(d.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** First and last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/** Days between two YYYY-MM-DD dates, inclusive. */
export function inclusiveDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

/**
 * CSV for spreadsheets. A cell that starts with = + - @ is prefixed so Excel
 * can't run it as a formula ("CSV injection"), and quotes/newlines are escaped.
 */
export function toCsv(rows: Record<string, string | number | boolean | null | undefined>[]): string {
  if (!rows.length) return "";
  const head = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let t = v === null || v === undefined ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "﻿" + [head.join(","), ...rows.map((r) => head.map((h) => cell(r[h])).join(","))].join("\r\n");
}

export function csvResponse(name: string, rows: Record<string, string | number | boolean | null | undefined>[]): Response {
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** id → display name for a list of user ids. */
export async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!unique.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** `performedBy` strings in audit/approval fields are "id:name" — show the name. */
export const nameOf = (s: string | null | undefined) => (s ? s.slice(s.indexOf(":") + 1) : null);
