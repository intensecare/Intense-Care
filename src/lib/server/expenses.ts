import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { userNames, isDay, istToday } from "./biz";
import { EXPENSE_CATEGORY_KEYS, PAYMENT_METHOD_KEYS, SYSTEM_CATEGORIES, round2, type ExpenseRow } from "@/lib/business";

/**
 * What counts as a business cost, everywhere (Expenses page, Reports, profit):
 * an expense that is APPROVED and not voided. Pending approvals, rejected and
 * voided rows are never counted. `paymentStatus` (PAID / PENDING) says whether
 * the money has left yet — an unpaid bill is still a cost, shown as "payable".
 */
export const COUNTED: Prisma.ExpenseWhereInput = { approvalStatus: "APPROVED", voidedAt: null };

export const ExpenseInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the expense date."),
  category: z.enum(EXPENSE_CATEGORY_KEYS),
  description: z.string().trim().min(2, "Describe the expense.").max(300),
  amount: z.number().positive("Enter the amount.").max(10_000_000),
  taxAmount: z.number().min(0).max(10_000_000).default(0),
  paymentMethod: z.enum(PAYMENT_METHOD_KEYS),
  paidBy: z.string().trim().max(120).optional().nullable(),
  vendor: z.string().trim().max(160).optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  jobId: z.string().max(64).optional().nullable(),
  employeeId: z.string().max(64).optional().nullable(),
  receiptFileId: z.string().max(64).optional().nullable(),
  paymentStatus: z.enum(["PAID", "PENDING"]).default("PAID"),
  notes: z.string().trim().max(1000).optional().nullable(),
  idempotencyKey: z.string().min(8).max(64).optional(),
  confirmDuplicate: z.boolean().optional(),
});
export type ExpenseInputT = z.infer<typeof ExpenseInput>;

/** Rules a typed-in expense must satisfy (the DB checks them again). */
export function checkExpenseRules(d: Pick<ExpenseInputT, "date" | "amount" | "taxAmount" | "category">): string | null {
  if (d.taxAmount > d.amount) return "The tax amount can't be more than the total amount.";
  if (d.date > istToday(new Date(Date.now() + 86400000))) return "The expense date can't be in the future.";
  if (d.category === "FREELANCE_PAYMENTS") return "Freelance payments are recorded under HR → Freelance payments, which adds the expense for you.";
  if (d.category === "REFERRAL_BONUSES") return "Referral bonuses are recorded under Referrals, which adds the expense for you.";
  return null;
}

export interface ExpenseFilters {
  from?: string | null;
  to?: string | null;
  category?: string | null;
  jobId?: string | null;
  paymentStatus?: string | null;
  approvalStatus?: string | null;
  q?: string | null;
  includeVoided?: boolean;
}

export function expenseWhere(f: ExpenseFilters, base: Prisma.ExpenseWhereInput = {}): Prisma.ExpenseWhereInput {
  const and: Prisma.ExpenseWhereInput[] = [base];
  if (isDay(f.from)) and.push({ date: { gte: f.from } });
  if (isDay(f.to)) and.push({ date: { lte: f.to } });
  if (f.category && (EXPENSE_CATEGORY_KEYS as string[]).includes(f.category)) and.push({ category: f.category });
  if (f.jobId) and.push({ jobId: f.jobId });
  if (f.paymentStatus === "PAID" || f.paymentStatus === "PENDING") and.push({ paymentStatus: f.paymentStatus });
  if (f.approvalStatus === "APPROVED" || f.approvalStatus === "PENDING_APPROVAL" || f.approvalStatus === "REJECTED") and.push({ approvalStatus: f.approvalStatus });
  if (!f.includeVoided) and.push({ voidedAt: null });
  const q = f.q?.trim();
  if (q) and.push({ OR: [{ description: { contains: q, mode: "insensitive" } }, { vendor: { contains: q, mode: "insensitive" } }, { expenseNumber: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }] });
  return { AND: and };
}

export function filtersFromUrl(url: URL): ExpenseFilters {
  const g = (k: string) => url.searchParams.get(k);
  return { from: g("from"), to: g("to"), category: g("category"), jobId: g("jobId"), paymentStatus: g("paymentStatus"), approvalStatus: g("approvalStatus"), q: g("q"), includeVoided: g("includeVoided") === "1" };
}

type ExpenseRecord = Prisma.ExpenseGetPayload<object>;

/** Adds job number, employee, receipt and creator names to a page of expenses. */
export async function hydrateExpenses(rows: ExpenseRecord[]): Promise<ExpenseRow[]> {
  const jobIds = Array.from(new Set(rows.map((r) => r.jobId).filter((x): x is string => !!x)));
  const empIds = Array.from(new Set(rows.map((r) => r.employeeId).filter((x): x is string => !!x)));
  const fileIds = Array.from(new Set(rows.map((r) => r.receiptFileId).filter((x): x is string => !!x)));
  const [jobs, emps, files, names] = await Promise.all([
    jobIds.length ? prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobSerial: true } }) : [],
    empIds.length ? prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, fullName: true } }) : [],
    fileIds.length ? prisma.storedFile.findMany({ where: { id: { in: fileIds } }, select: { id: true, fileName: true, mimeType: true } }) : [],
    userNames(rows.map((r) => r.createdBy)),
  ]);
  const jm = new Map(jobs.map((j) => [j.id, j.jobSerial]));
  const em = new Map(emps.map((e) => [e.id, e.fullName]));
  const fm = new Map(files.map((f) => [f.id, f]));
  return rows.map((r) => ({
    id: r.id,
    expenseNumber: r.expenseNumber ?? r.id.slice(-8),
    date: r.date,
    category: r.category,
    description: r.description,
    amount: r.amount,
    taxAmount: r.taxAmount,
    paymentMethod: r.paymentMethod,
    paidBy: r.paidBy,
    vendor: r.vendor,
    reference: r.reference,
    jobId: r.jobId,
    jobNumber: r.jobId ? jm.get(r.jobId) ?? null : null,
    employeeId: r.employeeId,
    employeeName: r.employeeId ? em.get(r.employeeId) ?? null : null,
    receipt: r.receiptFileId && fm.get(r.receiptFileId) ? { id: r.receiptFileId, fileName: fm.get(r.receiptFileId)!.fileName, mimeType: fm.get(r.receiptFileId)!.mimeType } : null,
    paymentStatus: r.paymentStatus as ExpenseRow["paymentStatus"],
    approvalStatus: r.approvalStatus as ExpenseRow["approvalStatus"],
    notes: r.notes,
    source: r.sourceType && r.sourceId ? { type: r.sourceType, id: r.sourceId } : null,
    voided: !!r.voidedAt,
    voidReason: r.voidReason,
    createdBy: r.createdBy,
    createdByName: names.get(r.createdBy) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Totals for the counted expenses that match the filters (Admin summary cards + monthly view). */
export async function expenseSummary(where: Prisma.ExpenseWhereInput) {
  const counted: Prisma.ExpenseWhereInput = { AND: [where, COUNTED] };
  const [agg, unpaid, byCat, monthRows] = await Promise.all([
    prisma.expense.aggregate({ where: counted, _sum: { amount: true, taxAmount: true }, _count: true }),
    prisma.expense.aggregate({ where: { AND: [counted, { paymentStatus: "PENDING" }] }, _sum: { amount: true }, _count: true }),
    prisma.expense.groupBy({ by: ["category"], where: counted, _sum: { amount: true }, _count: true }),
    prisma.expense.findMany({ where: counted, select: { date: true, amount: true } }),
  ]);
  const months = new Map<string, number>();
  for (const r of monthRows) months.set(r.date.slice(0, 7), round2((months.get(r.date.slice(0, 7)) ?? 0) + r.amount));
  return {
    count: agg._count,
    total: round2(agg._sum.amount ?? 0),
    tax: round2(agg._sum.taxAmount ?? 0),
    payable: round2(unpaid._sum.amount ?? 0),
    payableCount: unpaid._count,
    byCategory: byCat.map((c) => ({ category: c.category, total: round2(c._sum.amount ?? 0), count: c._count })).sort((a, b) => b.total - a.total),
    byMonth: Array.from(months.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({ month, total })),
  };
}

export const isSystemCategory = (c: string) => (SYSTEM_CATEGORIES as string[]).includes(c);

/**
 * The expense that a PAID payroll / freelance payment / referral bonus leaves
 * behind. One per source (unique on sourceType + sourceId), always approved
 * and paid, so a cost is counted exactly once.
 */
export async function createSourceExpense(
  tx: Prisma.TransactionClient,
  i: {
    sourceType: "PAYROLL" | "FREELANCE" | "REFERRAL";
    sourceId: string;
    category: "STAFF_WAGES" | "FREELANCE_PAYMENTS" | "REFERRAL_BONUSES";
    amount: number;
    date: string;
    description: string;
    paymentMethod: string;
    reference?: string | null;
    employeeId?: string | null;
    jobId?: string | null;
    paidBy: string;
    createdBy: string;
  }
) {
  const { nextExpenseNumber } = await import("./biz");
  return tx.expense.create({
    data: {
      expenseNumber: await nextExpenseNumber(tx),
      date: i.date,
      category: i.category,
      description: i.description.slice(0, 300),
      amount: round2(i.amount),
      taxAmount: 0,
      paymentMethod: i.paymentMethod,
      paidBy: i.paidBy,
      reference: i.reference ?? null,
      employeeId: i.employeeId ?? null,
      jobId: i.jobId ?? null,
      paymentStatus: "PAID",
      approvalStatus: "APPROVED",
      approvedBy: `${i.createdBy}:${i.paidBy}`,
      approvedAt: new Date(),
      sourceType: i.sourceType,
      sourceId: i.sourceId,
      createdBy: i.createdBy,
    },
  });
}
