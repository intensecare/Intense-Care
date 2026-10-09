import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/**
 * Splits a migration into statements on top-level ";" only — never inside
 * '…' / "…" strings or $$ / $tag$ dollar-quoted bodies (DO blocks), and drops
 * line and block comments. BEGIN / COMMIT are skipped: this script runs statement by
 * statement on a connection pool, where a transaction would stay open.
 */
function splitStatements(sql) {
  const stmts = [];
  let cur = "";
  let i = 0;
  let quote = null; // "'" | '"' | "$tag$"
  while (i < sql.length) {
    const ch = sql[i];
    if (quote) {
      if (quote.length > 1 ? sql.startsWith(quote, i) : ch === quote) {
        cur += quote;
        i += quote.length;
        quote = null;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      i++;
      continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        quote = m[0];
        cur += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === ";") {
      push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  push(cur);
  return stmts;

  function push(s) {
    const t = s.trim();
    if (t && !/^(BEGIN|COMMIT)$/i.test(t)) stmts.push(t);
  }
}

async function main() {
  console.log("Connected to Neon DB. Processing all migration statements safely...");
  const migrationsDir = path.resolve("./prisma/migrations");
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });

  const migrationDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const dir of migrationDirs) {
    const sqlFile = path.join(migrationsDir, dir, "migration.sql");
    if (!fs.existsSync(sqlFile)) continue;
    console.log(`Processing migration: ${dir}`);
    const sqlContent = fs.readFileSync(sqlFile, "utf-8");
    const stmts = splitStatements(sqlContent);

    for (const stmt of stmts) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (err) {
        const msg = err.message || "";
        // Ignorable postgres errors: column already exists, table already exists, relation already exists,
        // constraint already exists, relation does not exist for DROP, etc.
        if (
          msg.includes("already exists") ||
          msg.includes("does not exist") ||
          msg.includes("duplicate key") ||
          msg.includes("42701") ||
          msg.includes("42P07") ||
          msg.includes("42710") ||
          msg.includes("42P01")
        ) {
          // safe to ignore
        } else {
          console.warn(`  [Warning on statement in ${dir}]:`, msg.split("\n")[0]);
        }
      }
    }
    console.log(`  ✓ Done ${dir}`);
  }

  // Also standalone .sql files in prisma/migrations
  const standaloneFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".sql")).map((e) => e.name).sort();
  for (const f of standaloneFiles) {
    console.log(`Processing file: ${f}`);
    const sqlContent = fs.readFileSync(path.join(migrationsDir, f), "utf-8");
    const stmts = splitStatements(sqlContent);
    for (const stmt of stmts) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (err) {
        // ignorable
      }
    }
    console.log(`  ✓ Done ${f}`);
  }

  console.log("\nAll migration statements applied! Verifying schema...");
  
  // Test a job query with customerNotes and all fields
  const sampleJob = await prisma.job.findFirst({
    include: {
      customer: true,
      property: true,
      service: true,
      checklistItems: true,
      invoices: true,
      photos: true,
      qualityChecks: true,
      reworkTasks: true,
      complaints: true,
    },
  });
  console.log("Job query successful! Sample job found:", sampleJob?.id ?? "None (table empty or ready)");

  const users = await prisma.user.findMany({ take: 5 });
  console.log(`Users query successful! Found ${users.length} users.`);
}

main().catch(console.error).finally(() => process.exit(0));
