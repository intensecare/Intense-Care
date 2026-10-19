// Last-resort schema-sync fallback, used by scripts/migrate-deploy.mjs only when `prisma migrate deploy`
// itself fails (e.g. an advisory-lock timeout on a pooled connection). It adds missing TABLES and COLUMNS
// so queries stop throwing "column does not exist" — but it can NEVER fully replace a real migration:
// it adds no indexes, no unique/foreign-key/check constraints, and no NOT NULL on rows that already exist.
// Treat any deploy that reaches this path as needing a manual `npx prisma migrate deploy` (with a reachable
// direct connection) as soon as possible to add what this script cannot.
//
// Field metadata comes from prisma/schema.prisma itself, NOT from `Prisma.dmmf`: on this project's Prisma
// version, `Prisma.dmmf.datamodel.models[].fields[]` only carries {name, kind, type} — isList, isRequired,
// hasDefaultValue and default are all gone. An earlier version of this script relied on those missing
// fields, which silently produced wrong SQL (e.g. a duplicated `DEFAULT` clause that fails outright for
// every Boolean column with a default, or a plain TEXT column for what should be a TEXT[] array) and
// swallowed the failure per-column with just a console.warn, so the deploy "succeeded" with gaps.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const SCALAR_TYPES = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "Bytes", "BigInt", "Decimal"]);

/** Minimal prisma/schema.prisma reader — just enough field metadata to generate safe ALTER/CREATE SQL. */
function parseSchema(schemaPath) {
  const text = fs.readFileSync(schemaPath, "utf8");
  const modelNames = new Set([...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));
  const models = [];
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gms)) {
    const [, modelName, body] = m;
    const fields = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!fm) continue;
      const [, name, baseType, listMark, optMark, rest] = fm;
      if (!SCALAR_TYPES.has(baseType)) continue; // relation to another model — not a column on this side
      if (/@relation\b/.test(rest)) continue; // belt and suspenders
      const isList = !!listMark;
      const isRequired = !optMark && !isList;
      const isId = /@id\b/.test(rest);
      let defaultLiteral = null;
      // Allows one level of nested parens, e.g. now(), cuid(), dbgenerated("x") — enough for this schema.
      const dm = /@default\(\s*((?:[^()]|\([^()]*\))*)\s*\)/.exec(rest);
      if (dm) {
        const raw = dm[1];
        if (/^now\(\)$/.test(raw)) defaultLiteral = "CURRENT_TIMESTAMP";
        else if (/^(cuid|uuid|autoincrement|dbgenerated)\(/.test(raw)) defaultLiteral = null; // can't reproduce here
        else if (/^true$/.test(raw)) defaultLiteral = "true";
        else if (/^false$/.test(raw)) defaultLiteral = "false";
        else if (/^-?\d+(\.\d+)?$/.test(raw)) defaultLiteral = raw;
        else if (/^"(.*)"$/.test(raw)) defaultLiteral = `'${raw.slice(1, -1).replace(/'/g, "''")}'`;
        else if (/^\[\s*\]$/.test(raw)) defaultLiteral = isList ? (baseType === "Int" ? "ARRAY[]::INTEGER[]" : "ARRAY[]::TEXT[]") : null;
        // else: bare identifier (e.g. an enum constant) — this schema has no native enums; leave unset rather than guess.
      }
      fields.push({ name, baseType, isList, isRequired, isId, defaultLiteral });
    }
    models.push({ name: modelName, fields });
  }
  return { models, modelNames };
}

function mapPrismaTypeToPg(field) {
  if (field.isList) return field.baseType === "Int" ? "INTEGER[]" : "TEXT[]";
  switch (field.baseType) {
    case "String":
      return "TEXT";
    case "Int":
      return "INTEGER";
    case "BigInt":
      return "BIGINT";
    case "Float":
    case "Decimal":
      return "DOUBLE PRECISION";
    case "Boolean":
      return "BOOLEAN";
    case "DateTime":
      return "TIMESTAMP(3)";
    case "Json":
      return "JSONB";
    case "Bytes":
      return "BYTEA";
    default:
      return "TEXT";
  }
}

async function run() {
  const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");
  const { models } = parseSchema(schemaPath);
  if (!models.length) throw new Error(`No models parsed from ${schemaPath} — refusing to run against an empty field list.`);

  const client = new Client({ connectionString });
  await client.connect();
  console.log(`Connected to Postgres. Checking ${models.length} model(s) from prisma/schema.prisma against the database...`);

  const failures = [];
  for (const model of models) {
    const tableName = model.name;
    const tableCheck = await client.query(`SELECT to_regclass('public."${tableName}"') AS exists`);
    if (!tableCheck.rows[0].exists) {
      const idField = model.fields.find((f) => f.isId) ?? model.fields[0];
      if (!idField) { failures.push(`${tableName}: no fields parsed — skipped table creation`); continue; }
      console.log(`Table "${tableName}" does not exist. Creating with just its id column...`);
      await client.query(`CREATE TABLE IF NOT EXISTS "${tableName}" ("${idField.name}" TEXT PRIMARY KEY)`);
    }

    const colRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [tableName]);
    const existingCols = new Set(colRes.rows.map((r) => r.column_name));

    for (const field of model.fields) {
      if (existingCols.has(field.name)) continue;
      const pgType = mapPrismaTypeToPg(field);
      const defaultClause = field.defaultLiteral ? `DEFAULT ${field.defaultLiteral}` : "";
      // NOT NULL is only safe to add alongside a default (existing rows need a value); without one, leave nullable.
      const notNull = field.isRequired && field.defaultLiteral ? "NOT NULL" : "";
      const sql = `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${field.name}" ${pgType} ${defaultClause} ${notNull};`;
      console.log(`Adding missing column: ${tableName}.${field.name} (${pgType}${defaultClause ? ", " + defaultClause : ""}${notNull ? ", " + notNull : ""})`);
      try {
        await client.query(sql);
      } catch (err) {
        console.warn(`  FAILED adding column ${tableName}.${field.name}:`, err.message);
        failures.push(`${tableName}.${field.name}: ${err.message}`);
      }
    }
  }

  await client.end();
  if (failures.length) {
    console.error(`Schema auto-migration finished with ${failures.length} column(s) NOT added:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error("Run `npx prisma migrate deploy` with a reachable direct connection as soon as possible — " +
      "this fallback never adds indexes or constraints either, even for the columns it did add.");
    process.exitCode = 1;
    return;
  }
  console.log("Schema auto-migration complete (columns only — indexes/constraints/NOT NULL backfill still need `prisma migrate deploy`).");
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
