-- =============================================================================
-- 20261008 — Simplify to four user types: Admin, Field Manager, QC, Customer.
-- =============================================================================

-- Every desk role becomes Admin; every on-site role becomes Field Manager.
UPDATE "User" SET "role" = 'admin' WHERE "role" IN ('super_admin', 'ops_manager', 'scheduler', 'accounts');
UPDATE "User" SET "role" = 'field_manager' WHERE "role" IN ('staff', 'field_staff');

-- Customers no longer sign in (they use the secure service link) and the
-- referral-partner login is retired. The rows are kept for history but can
-- no longer open a session.
UPDATE "User" SET "active" = false WHERE "role" IN ('customer', 'referral_partner');

-- ONE optional property QR: opens the customer page at the property's
-- current or upcoming service. Only the SHA-256 hash verifies; the
-- encrypted copy lets the admin re-print the same QR.
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "accessTokenHash" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "accessTokenEnc" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Property_accessTokenHash_key" ON "Property"("accessTokenHash");

-- ONE readable Job ID per job (JOB-10001 …) — the existing jobSerial column.
CREATE SEQUENCE IF NOT EXISTS "job_serial_seq" START 10001;
UPDATE "Job" SET "jobSerial" = 'JOB-' || nextval('"job_serial_seq"')
WHERE "id" IN (SELECT "id" FROM "Job" WHERE "jobSerial" IS NULL ORDER BY "createdAt", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "Job_jobSerial_key" ON "Job"("jobSerial");
