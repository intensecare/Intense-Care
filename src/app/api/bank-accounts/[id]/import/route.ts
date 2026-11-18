import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail, readJson } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { parseBankStatementCsv } from "@/lib/bank-csv";

const BodySchema = z.object({ csv: z.string().min(1).max(2_000_000) });

/**
 * POST /api/bank-accounts/[id]/import — import a bank statement (CSV) as UNMATCHED transactions.
 * There is no live bank-feed integration: this is the only way a statement line reaches the
 * reconciliation screen, and it is never claimed to be an automatic sync. Re-importing the same
 * file is safe — rows are deduplicated by (account, externalId).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("finance.reconcile");
    const acc = await prisma.bankAccount.findUnique({ where: { id: params.id } });
    if (!acc) return fail("Bank account not found.", 404);
    const parsed = BodySchema.safeParse(await readJson(request));
    if (!parsed.success) return fail("No CSV content was received.", 400);
    const { rows, errors } = parseBankStatementCsv(parsed.data.csv);
    if (!rows.length) return fail(errors[0] || "No importable rows were found in this file.", 400);

    let imported = 0;
    let skippedDuplicate = 0;
    for (const r of rows) {
      const res = await prisma.bankTransaction.createMany({
        data: [{ bankAccountId: acc.id, txnDate: r.txnDate, description: r.description, amount: r.amount, reference: r.reference, externalId: r.externalId, importedBy: `${user.id}:${user.name}` }],
        skipDuplicates: true,
      });
      if (res.count === 1) imported++;
      else skippedDuplicate++;
    }
    void recordAudit({
      actor: user,
      action: "BANK_STATEMENT_IMPORTED",
      entityType: "bank_account",
      entityId: acc.id,
      details: `${imported} imported, ${skippedDuplicate} already present, ${errors.length} rows skipped`,
      request,
    });
    return ok({ imported, skippedDuplicate, rowErrors: errors.slice(0, 20) }, 201);
  } catch (err) {
    return errorResponse(err, "bank_accounts.import.route_error");
  }
}
