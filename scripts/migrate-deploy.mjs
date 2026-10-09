// Applies pending database migrations before a deployment is built (Vercel runs
// `npm run vercel-build`). Without this, new code reaches a database that is
// missing its columns and every job query fails.
//
// - Uses a direct (non-pooled) connection when one is configured: DIRECT_URL,
//   DATABASE_URL_UNPOOLED or POSTGRES_URL_NON_POOLING (set by the Neon / Vercel
//   Postgres integrations). Migrations need a session-level lock that poolers drop.
// - Fails the build if migrating fails, so the previous (working) deployment stays live.
// - SKIP_DB_MIGRATIONS=1 skips it (e.g. when migrations are applied by another pipeline).
import { spawnSync } from "node:child_process";

if (process.env.SKIP_DB_MIGRATIONS === "1") {
  console.log("[migrate] SKIP_DB_MIGRATIONS=1 — not applying migrations.");
  process.exit(0);
}
const url = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set — can't apply migrations. Set it in the hosting environment.");
  process.exit(1);
}
const source = process.env.DIRECT_URL ? "DIRECT_URL" : process.env.DATABASE_URL_UNPOOLED ? "DATABASE_URL_UNPOOLED" : process.env.POSTGRES_URL_NON_POOLING ? "POSTGRES_URL_NON_POOLING" : "DATABASE_URL";
console.log(`[migrate] Applying pending migrations (connection: ${source})…`);
const run = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
if (run.status !== 0) {
  console.error(`
[migrate] Migrations failed, so this deployment was stopped and the previous one stays live.
  • "P3005 database schema is not empty": this database was created without migration history.
    Mark the migrations it already has as applied (npx prisma migrate resolve --applied <name>),
    then redeploy. See README → Deploying.
  • Connection or lock timeouts: set DIRECT_URL to the database's direct (non-pooled) connection string.`);
  process.exit(run.status ?? 1);
}
console.log("[migrate] Database is up to date.");
