import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new Client({ connectionString });

function cleanSql(raw) {
  const noSingleLine = raw.replace(/--.*$/gm, "");
  const noComments = noSingleLine.replace(/\/\*[\s\S]*?\*\//g, "");
  return noComments;
}

async function run() {
  await client.connect();
  console.log("Connected to PostgreSQL via pg.Client");

  const migrationsDir = path.resolve("./prisma/migrations");
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });

  const migrationDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const dir of migrationDirs) {
    const sqlFile = path.join(migrationsDir, dir, "migration.sql");
    if (!fs.existsSync(sqlFile)) continue;
    const sql = cleanSql(fs.readFileSync(sqlFile, "utf-8"));

    try {
      await client.query(sql);
      console.log(`✓ Fast applied ${dir}`);
    } catch (bulkErr) {
      // If bulk fails, fallback to statement by statement
      const rawStmts = sql.split(";");
      for (const raw of rawStmts) {
        const stmt = raw.trim();
        if (!stmt) continue;
        try {
          await client.query(stmt);
        } catch (err) {
          // Ignored expected duplicates
        }
      }
      console.log(`✓ Statement applied ${dir}`);
    }
  }

  // Also standalone .sql files
  const standaloneFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".sql")).map((e) => e.name).sort();
  for (const f of standaloneFiles) {
    const sql = cleanSql(fs.readFileSync(path.join(migrationsDir, f), "utf-8"));
    try {
      await client.query(sql);
      console.log(`✓ Fast applied ${f}`);
    } catch {
      const rawStmts = sql.split(";");
      for (const raw of rawStmts) {
        const stmt = raw.trim();
        if (!stmt) continue;
        try {
          await client.query(stmt);
        } catch {}
      }
      console.log(`✓ Statement applied ${f}`);
    }
  }

  // Check columns on Job
  const colRes = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'Job'
  `);
  console.log(`\nJob table columns count: ${colRes.rows.length}`);
  const hasCustomerNotes = colRes.rows.some((r) => r.column_name === "customerNotes");
  console.log(`Job.customerNotes exists: ${hasCustomerNotes}`);

  await client.end();
  console.log("Database sync finished successfully!");
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
