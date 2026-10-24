// Applies pending database migrations before a deployment is built (Vercel runs
// `npm run vercel-build`). Without this, new code reaches a database that is
// missing its columns and every job query fails.
//
// - Uses a direct (non-pooled) connection when one is configured: DIRECT_URL,
//   DATABASE_URL_UNPOOLED or POSTGRES_URL_NON_POOLING (set by the Neon / Vercel
//   Postgres integrations). Migrations need a session-level lock that poolers drop.
// - Automatically falls back to scripts/ensure-all-columns.mjs if advisory locking
//   times out or fails on connection poolers.
// - Fails the build if both migrate and fallback fail.
// - SKIP_DB_MIGRATIONS=1 skips it (e.g. when migrations are applied by another pipeline).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.SKIP_DB_MIGRATIONS === "1") {
  console.log("[migrate] SKIP_DB_MIGRATIONS=1 — not applying migrations.");
  process.exit(0);
}

let url = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
let source = "DIRECT_URL";

if (!url && process.env.DATABASE_URL) {
  if (process.env.DATABASE_URL.includes("-pooler.")) {
    url = process.env.DATABASE_URL.replace("-pooler.", ".");
    source = "DATABASE_URL (unpooled derived)";
  } else {
    url = process.env.DATABASE_URL;
    source = "DATABASE_URL";
  }
}

if (!url) {
  console.error("[migrate] DATABASE_URL is not set — can't apply migrations. Set it in the hosting environment.");
  process.exit(1);
}

console.log(`[migrate] Applying pending migrations (connection: ${source})…`);
const run = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: url },
});

if (run.status !== 0) {
  console.warn(`[migrate] "prisma migrate deploy" failed or timed out on advisory lock. Falling back to ensure-all-columns schema sync…`);
  const fallback = spawnSync("node", [path.join(__dirname, "ensure-all-columns.mjs")], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || url },
  });
  if (fallback.status !== 0) {
    console.error("[migrate] Both prisma migrate deploy and ensure-all-columns failed. Stopping deployment.");
    process.exit(fallback.status ?? 1);
  }
  console.log("[migrate] Schema sync completed successfully via ensure-all-columns.");
} else {
  console.log("[migrate] Database is up to date.");
}

