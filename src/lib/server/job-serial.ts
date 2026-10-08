import type { Prisma, PrismaClient } from "@prisma/client";

/** Next readable Job ID (JOB-10001, JOB-10002 …) from the database sequence. */
export async function nextJobSerial(db: PrismaClient | Prisma.TransactionClient): Promise<string> {
  const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('"job_serial_seq"') AS n`;
  return `JOB-${n}`;
}
