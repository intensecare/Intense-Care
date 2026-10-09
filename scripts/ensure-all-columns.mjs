import pg from "pg";
import { Prisma } from "@prisma/client";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new Client({ connectionString });

function mapPrismaTypeToPg(field) {
  if (field.isList) {
    if (field.type === "String") return "TEXT[] DEFAULT ARRAY[]::TEXT[]";
    if (field.type === "Int") return "INTEGER[] DEFAULT ARRAY[]::INTEGER[]";
    return "TEXT[] DEFAULT ARRAY[]::TEXT[]";
  }
  switch (field.type) {
    case "String":
      return "TEXT";
    case "Int":
      return "INTEGER";
    case "Float":
      return "DOUBLE PRECISION";
    case "Boolean":
      return "BOOLEAN DEFAULT false";
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
  await client.connect();
  console.log("Connected to Postgres. Checking all DMMF models against database...");

  const dmmf = Prisma.dmmf.datamodel;
  const models = dmmf.models;

  for (const model of models) {
    const tableName = model.name;
    // 1. Ensure table exists
    const tableCheck = await client.query(
      `SELECT to_regclass('public."${tableName}"') AS exists`
    );
    if (!tableCheck.rows[0].exists) {
      console.log(`Table "${tableName}" does not exist. Creating basic table...`);
      // Find id field
      const idField = model.fields.find((f) => f.isId) || model.fields[0];
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${tableName}" (
          "${idField.name}" TEXT PRIMARY KEY
        )
      `);
    }

    // 2. Query columns in Postgres
    const colRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [tableName]
    );
    const existingCols = new Set(colRes.rows.map((r) => r.column_name));

    // 3. For every scalar field in model, ensure column exists
    for (const field of model.fields) {
      if (field.kind === "scalar" || field.kind === "enum") {
        if (!existingCols.has(field.name)) {
          const pgType = mapPrismaTypeToPg(field);
          const defaultClause = field.hasDefaultValue
            ? `DEFAULT ${typeof field.default === "object" ? "CURRENT_TIMESTAMP" : typeof field.default === "string" ? `'${field.default}'` : field.default}`
            : "";
          const sql = `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${field.name}" ${pgType} ${defaultClause};`;
          console.log(`Adding missing column: ${tableName}.${field.name} (${pgType})`);
          try {
            await client.query(sql);
          } catch (err) {
            console.warn(`  Warning adding column ${tableName}.${field.name}:`, err.message);
          }
        }
      }
    }
  }

  await client.end();
  console.log("Schema verification and auto-migration complete!");
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
