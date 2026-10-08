import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

/**
 * Seeds the FIRST admin account from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Set SEED_STARTER_SERVICES=1 to also add a starter price list (only when the
 * catalog is empty) — every price can be edited on Admin → Services.
 * Run: npm run db:seed
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const email = (process.env.SEED_ADMIN_EMAIL || process.env.SEED_SUPERADMIN_EMAIL || "").toLowerCase().trim();
const password = process.env.SEED_ADMIN_PASSWORD || process.env.SEED_SUPERADMIN_PASSWORD || "";

async function main() {
  if (!email || password.length < 8) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 8 characters) in .env, then run npm run db:seed.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    create: { name: "Admin", email, phone: process.env.SEED_ADMIN_PHONE || "", role: "ADMIN", passwordHash },
    update: { role: "ADMIN", passwordHash, active: true },
  });
  console.log(`Admin ready: ${admin.email}`);

  if (process.env.SEED_STARTER_SERVICES === "1" && (await prisma.service.count()) === 0) {
    await prisma.service.createMany({
      data: [
        { name: "Wash & Fold", unit: "KG", price: 9900, turnaroundHours: 48, sortOrder: 1 },
        { name: "Wash & Iron", unit: "PIECE", price: 2500, turnaroundHours: 48, sortOrder: 2 },
        { name: "Dry Clean", unit: "PIECE", price: 12000, turnaroundHours: 72, sortOrder: 3 },
        { name: "Steam Iron", unit: "PIECE", price: 1500, turnaroundHours: 24, sortOrder: 4 },
        { name: "Shoe Cleaning", unit: "PAIR", price: 29900, turnaroundHours: 72, sortOrder: 5 },
      ],
    });
    console.log("Starter services added.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
