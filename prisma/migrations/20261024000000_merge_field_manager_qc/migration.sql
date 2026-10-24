-- Field Manager + QC Inspector  →  Field Operations Manager.
-- Accounts are UPDATED IN PLACE (same id, email, password hash, assignments, history); nothing is deleted or recreated.
-- The previous role of every migrated user is kept in "RoleMigration" so the change is auditable and reversible.
-- Audit-log rows and other history keep the role names they were written with.

CREATE TABLE IF NOT EXISTS "RoleMigration" (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT NOT NULL,
  "previousRole" TEXT NOT NULL,
  "newRole"      TEXT NOT NULL,
  "migratedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "migration"    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "RoleMigration_userId_idx" ON "RoleMigration"("userId");

INSERT INTO "RoleMigration" ("id", "userId", "previousRole", "newRole", "migration")
SELECT 'rm_' || "id", "id", "role", 'field_operations_manager', '20261024000000_merge_field_manager_qc'
FROM "User"
WHERE "role" IN ('field_manager', 'qc_inspector', 'field_staff', 'staff', 'qc')
  AND NOT EXISTS (SELECT 1 FROM "RoleMigration" m WHERE m."userId" = "User"."id" AND m."migration" = '20261024000000_merge_field_manager_qc');

UPDATE "User" SET "role" = 'field_operations_manager'
WHERE "role" IN ('field_manager', 'qc_inspector', 'field_staff', 'staff', 'qc');

-- Quality control: who began an inspection, when, and whether the inspector was on the job's crew.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "qcStartedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "qcStartedBy" TEXT;
ALTER TABLE "QualityCheck" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "QualityCheck" ADD COLUMN IF NOT EXISTS "startedBy" TEXT;
ALTER TABLE "QualityCheck" ADD COLUMN IF NOT EXISTS "inspectorOnCrew" BOOLEAN NOT NULL DEFAULT false;
