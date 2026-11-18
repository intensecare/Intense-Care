import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./authz";
import type { BankAccount, BankAccountSnapshot } from "@/lib/types";

/**
 * Bank Accounts — the company's own configured accounts for receiving customer payments.
 *
 * This module never invents anything: every account is typed in by an Admin from a real bank
 * document (or explicitly marked VIRTUAL_ACCOUNT / LEDGER_ACCOUNT, which are not real, live
 * accounts — see the `kind` field). There is no live bank-feed or payment-gateway integration;
 * "VIRTUAL_ACCOUNT" only reserves the shape for one, and must never be presented as already live.
 */

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian bank account numbers vary by bank (9–18 digits in practice); this just rejects obvious junk. */
const ACCOUNT_NUMBER_PATTERN = /^[0-9]{6,20}$/;

export const BankAccountInputSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  holderName: z.string().trim().min(2).max(160),
  bankName: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().regex(ACCOUNT_NUMBER_PATTERN, "Account number must be 6–20 digits."),
  ifsc: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => IFSC_PATTERN.test(v), "IFSC must look like HDFC0001234 (4 letters, 0, 6 alphanumeric)."),
  branch: z.string().trim().max(160).optional(),
  accountType: z.enum(["SAVINGS", "CURRENT"]).default("CURRENT"),
  upiId: z
    .string()
    .trim()
    .max(80)
    .optional()
    .refine((v) => !v || /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9]{2,31}$/.test(v), "That UPI ID doesn't look valid."),
  kind: z.enum(["COMPANY_ACCOUNT", "VIRTUAL_ACCOUNT", "LEDGER_ACCOUNT"]).default("COMPANY_ACCOUNT"),
  openingBalance: z.number().min(0).max(1_000_000_000).nullable().optional(),
  currency: z.string().trim().length(3).default("INR"),
  notes: z.string().trim().max(1000).optional(),
  isDefault: z.boolean().optional(),
});
export type BankAccountInput = z.infer<typeof BankAccountInputSchema>;

export function maskAccountNumber(last4: string): string {
  return `••••••${last4}`;
}

type Row = Prisma.BankAccountGetPayload<object>;

/** `full = true` reveals the real account number — callers must already hold finance.bank.manage. */
export function serializeBankAccount(a: Row, full: boolean): BankAccount {
  return {
    id: a.id,
    displayName: a.displayName,
    holderName: a.holderName,
    bankName: a.bankName,
    accountNumber: full ? a.accountNumber : undefined,
    accountNumberMasked: maskAccountNumber(a.accountNumberLast4),
    ifsc: a.ifsc,
    branch: a.branch ?? undefined,
    accountType: a.accountType === "SAVINGS" ? "SAVINGS" : "CURRENT",
    upiId: a.upiId ?? undefined,
    kind: (a.kind as BankAccount["kind"]) ?? "COMPANY_ACCOUNT",
    openingBalance: a.openingBalance ?? undefined,
    currency: a.currency,
    status: a.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    isDefault: a.isDefault,
    notes: a.notes ?? undefined,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function snapshotOf(a: Pick<Row, "displayName" | "holderName" | "bankName" | "accountNumber" | "ifsc" | "branch" | "upiId">): BankAccountSnapshot {
  return {
    displayName: a.displayName,
    holderName: a.holderName,
    bankName: a.bankName,
    accountNumber: a.accountNumber,
    ifsc: a.ifsc,
    branch: a.branch ?? undefined,
    upiId: a.upiId ?? undefined,
  };
}

/** The account to pre-select when none is chosen explicitly: the active account flagged default. */
export async function defaultBankAccount(db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.bankAccount.findFirst({ where: { status: "ACTIVE", isDefault: true } });
}

/**
 * Resolves the account id to attach to a NEW invoice/quotation: an explicitly chosen active account,
 * else the company default, else null (printed documents simply omit the bank-details section — never
 * fabricated). Throws if a chosen id is unknown or inactive.
 */
export async function resolveBankAccountForNew(bankAccountId: string | null | undefined): Promise<Row | null> {
  if (bankAccountId) {
    const acc = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!acc) throw new HttpError(400, "That receiving bank account no longer exists.");
    if (acc.status !== "ACTIVE") throw new HttpError(400, "That receiving bank account is inactive.");
    return acc;
  }
  return defaultBankAccount();
}
