import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Readable Job ID: CUSTOMER-NAME-DDMMYYYY-NNN, e.g. RAHUL-SHARMA-08102026-001.
 *   - customer name upper-cased, spaces → "-", other symbols removed
 *   - the service date as DDMMYYYY
 *   - a 3-digit sequence per customer name + date (001, 002, 003 …)
 * Uniqueness is guaranteed by the database (unique index on Job.jobSerial);
 * the per-prefix advisory lock makes concurrent bookings for the same
 * customer and date take turns instead of colliding.
 */
export function jobIdPrefix(customerName: string, scheduledDate: string): string {
  const slug =
    customerName
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/&/g, " AND ")
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "CUSTOMER";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(scheduledDate);
  const date = m ? `${m[3]}${m[2]}${m[1]}` : "00000000";
  return `${slug}-${date}`;
}

/** Next Job ID for this customer and date. Call inside a transaction. */
export async function nextJobSerial(
  db: PrismaClient | Prisma.TransactionClient,
  customerName: string,
  scheduledDate: string
): Promise<string> {
  const prefix = jobIdPrefix(customerName, scheduledDate);
  // Held until the surrounding transaction commits.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;
  const rows = await db.$queryRaw<{ jobSerial: string }[]>`
    SELECT "jobSerial" FROM "Job" WHERE "jobSerial" LIKE ${prefix + "-%"}`;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const max = rows.reduce((acc, r) => {
    const hit = pattern.exec(r.jobSerial);
    return hit ? Math.max(acc, Number(hit[1])) : acc;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
