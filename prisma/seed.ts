import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

/**
 * Database seed — creates the FIRST super_admin account only.
 *
 * Credentials come from environment variables (SEED_SUPERADMIN_EMAIL /
 * SEED_SUPERADMIN_PASSWORD) so no secrets are committed to the repository.
 * There are no other hardcoded users, catalogs, or demo data anywhere in the
 * application: services, rubrics, partners, and staff accounts are all
 * created through the app by the company.
 *
 * Run with: npm run db:seed
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SUPERADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL;
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD;

if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
  console.error(
    "Missing SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD in the environment.\n" +
      "Copy .env.example to .env, set both values, then re-run: npm run db:seed"
  );
  process.exit(1);
}

if (SUPERADMIN_PASSWORD.length < 8) {
  console.error("SEED_SUPERADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

async function main() {
  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD!, 12);

  const user = await prisma.user.upsert({
    where: { email: SUPERADMIN_EMAIL!.toLowerCase() },
    create: {
      name: "Super Admin",
      email: SUPERADMIN_EMAIL!.toLowerCase(),
      phone: process.env.SEED_SUPERADMIN_PHONE || "",
      role: "super_admin",
      passwordHash,
      active: true,
    },
    update: {
      role: "super_admin",
      passwordHash,
      active: true,
    },
  });

  console.log(`Seeded superadmin: ${user.email} (${user.id}, role=${user.role})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
