// READ-ONLY schema diff: prisma/schema.prisma vs the physical database named by DATABASE_URL.
// Makes NO changes whatsoever — only SELECTs against information_schema / pg_catalog.
//
//   DATABASE_URL="postgresql://..." node scripts/schema-diff-readonly.mjs
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL is not set"); process.exit(1); }

const SCALAR_TYPES = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "Bytes", "BigInt", "Decimal"]);

function parseSchema(schemaPath) {
  const raw = fs.readFileSync(schemaPath, "utf8");
  // Strip `///` / `//` doc-comment text (but keep the lines) BEFORE brace-matching a model's body —
  // a comment like "/// [{ a, b }]" documenting a JSON shape contains a bare `}` that otherwise fools
  // a naive "first closing brace" match into truncating the model well before its real end. This is
  // the exact bug in scripts/ensure-all-columns.mjs that has silently hidden every field declared
  // after such a comment (on Invoice and Quote) from every production schema-sync run.
  const text = raw.replace(/^(\s*)\/\/\/?.*$/gm, "$1// (comment removed for parsing)");
  const models = [];
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gms)) {
    const [, modelName, body] = m;
    const fields = [];
    const relations = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!fm) continue;
      const [, name, baseType, listMark, optMark, rest] = fm;
      const isList = !!listMark;
      const isRequired = !optMark && !isList;
      if (!SCALAR_TYPES.has(baseType)) {
        if (!/@relation\b/.test(rest) && listMark) continue; // a plain list of another model (back-relation) — no column here
        relations.push({ name, target: baseType, isList });
        continue;
      }
      if (/@relation\b/.test(rest)) continue;
      const isId = /@id\b/.test(rest);
      const isUnique = /@unique\b/.test(rest);
      fields.push({ name, baseType, isList, isRequired, isId, isUnique });
    }
    models.push({ name: modelName, fields, relations });
  }
  return models;
}

async function main() {
  const models = parseSchema(path.join(__dirname, "..", "prisma", "schema.prisma"));
  const client = new Client({ connectionString });
  await client.connect();

  const tablesRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  const physicalTables = new Set(tablesRes.rows.map((r) => r.table_name));

  const report = { missingTables: [], extraTables: [], missingColumns: [], extraColumns: [], missingForeignKeys: [], tableSummary: [] };

  const expectedTableNames = new Set(models.map((m) => m.name));
  for (const t of physicalTables) {
    if (t === "_prisma_migrations") continue;
    if (!expectedTableNames.has(t)) report.extraTables.push(t);
  }

  for (const model of models) {
    if (!physicalTables.has(model.name)) {
      report.missingTables.push(model.name);
      continue;
    }
    const colRes = await client.query(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [model.name]
    );
    const existing = new Map(colRes.rows.map((r) => [r.column_name, r.is_nullable]));
    const expectedNames = new Set(model.fields.map((f) => f.name));
    let missingOnThisTable = 0;
    for (const f of model.fields) {
      if (!existing.has(f.name)) {
        report.missingColumns.push({ table: model.name, column: f.name, required: f.isRequired, type: f.baseType, isList: f.isList });
        missingOnThisTable++;
      }
    }
    for (const colName of existing.keys()) {
      if (!expectedNames.has(colName)) report.extraColumns.push({ table: model.name, column: colName });
    }

    // Foreign keys expected from scalar relation fields ending in Id with a matching @relation target.
    const fkRes = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type='FOREIGN KEY'`,
      [model.name]
    );
    const existingFkCols = new Set(fkRes.rows.map((r) => r.column_name));
    // Heuristic: a field named e.g. "customerId" that is NOT a primary id and has a lowercase-first relation counterpart.
    for (const f of model.fields) {
      if (f.isId) continue;
      if (!/Id$/.test(f.name)) continue;
      const relName = f.name.replace(/Id$/, "");
      const hasRelation = model.relations.some((r) => r.name.toLowerCase() === relName.toLowerCase());
      if (hasRelation && !existingFkCols.has(f.name)) {
        report.missingForeignKeys.push({ table: model.name, column: f.name });
      }
    }

    report.tableSummary.push({ table: model.name, expectedColumns: model.fields.length, missingColumns: missingOnThisTable });
  }

  await client.end();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
