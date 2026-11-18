import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { BankAccountInputSchema, serializeBankAccount } from "@/lib/server/bank-accounts";

/** GET /api/bank-accounts — every account, Admin only. Account numbers are included (full access). */
export async function GET() {
  try {
    await requirePermission("finance.bank.manage");
    const rows = await prisma.bankAccount.findMany({ orderBy: [{ status: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }] });
    return ok(rows.map((r) => serializeBankAccount(r, true)));
  } catch (err) {
    return errorResponse(err, "bank_accounts.get.route_error");
  }
}

/**
 * POST /api/bank-accounts — Admin configures a new receiving account. Nothing here is invented: every
 * field is exactly what the Admin typed in from a real bank document (or `kind` marks it as not a real,
 * live account). The first account created becomes the default automatically.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("finance.bank.manage");
    const parsed = BankAccountInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid bank account.", 400);
    const d = parsed.data;
    const count = await prisma.bankAccount.count();
    const isDefault = d.isDefault ?? count === 0;
    const created = await prisma.$transaction(async (tx) => {
      if (isDefault) await tx.bankAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.bankAccount.create({
        data: {
          displayName: d.displayName,
          holderName: d.holderName,
          bankName: d.bankName,
          accountNumber: d.accountNumber,
          accountNumberLast4: d.accountNumber.slice(-4),
          ifsc: d.ifsc,
          branch: d.branch || null,
          accountType: d.accountType,
          upiId: d.upiId || null,
          kind: d.kind,
          openingBalance: d.openingBalance ?? null,
          currency: d.currency,
          notes: d.notes || null,
          isDefault,
          createdBy: `${user.id}:${user.name}`,
        },
      });
    });
    void recordAudit({ actor: user, action: "BANK_ACCOUNT_CREATED", entityType: "bank_account", entityId: created.id, details: `${created.displayName} (${created.kind})`, request });
    return ok(serializeBankAccount(created, true), 201);
  } catch (err) {
    return errorResponse(err, "bank_accounts.post.route_error");
  }
}
