-- =============================================================================
-- 20261005 — Unified QR + Secure Link + Job Workflow System
-- =============================================================================
-- Applied to the Neon Postgres database via `npx prisma db push` (exit 0,
-- "Your database is now in sync with your Prisma schema.").
--
-- §3  qr_tokens  — centralized dynamic QR tokens (hash-only storage)
-- §11 GPS-verified arrival fields + customer confirmation + approval audit
-- =============================================================================

-- §3 Centralized dynamic QR / secure-link tokens.
-- The raw token never touches the database: only its SHA-256 hash. Every
-- permission decision (purpose, expiry, revocation, usage audit) resolves
-- from this single row — QR codes hold nothing but the random token.
CREATE TABLE IF NOT EXISTS "QrToken" (
    "id"              TEXT NOT NULL,
    "tokenHash"       TEXT NOT NULL,
    "tokenLast4"      TEXT NOT NULL,
    "purpose"         TEXT NOT NULL,   -- CUSTOMER_JOB | CUSTOMER_VERIFICATION | CUSTOMER_APPROVAL | MANAGER_JOB | QC_INSPECTION | REWORK | REINSPECTION
    "jobId"           TEXT NOT NULL,
    "expiresAt"       TIMESTAMP(3),
    "revokedAt"       TIMESTAMP(3),
    "revokedBy"       TEXT,
    "revokedReason"   TEXT,
    "usageCount"      INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt"      TIMESTAMP(3),
    "createdBy"       TEXT,
    "createdByName"   TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QrToken_tokenHash_key" ON "QrToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "QrToken_jobId_idx"       ON "QrToken"("jobId");
CREATE INDEX IF NOT EXISTS "QrToken_purpose_idx"     ON "QrToken"("purpose");
CREATE INDEX IF NOT EXISTS "QrToken_jobId_purpose_idx" ON "QrToken"("jobId", "purpose");

-- §11 GPS-verified arrival + customer confirmation + approval audit columns.
ALTER TABLE "Job"
    ADD COLUMN IF NOT EXISTS "arrivalLat"          DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "arrivalLng"          DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "arrivalAccuracy"     DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "arrivalVerification" TEXT,
    ADD COLUMN IF NOT EXISTS "arrivalDistanceM"    DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "arrivalBypassReason" TEXT,
    ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "jobSerial"           TEXT,
    ADD COLUMN IF NOT EXISTS "customerTokenId"     TEXT,
    ADD COLUMN IF NOT EXISTS "approvedAt"          TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "approvedBy"          TEXT,
    ADD COLUMN IF NOT EXISTS "approvalMethod"      TEXT;

-- §11 Property GPS capture (geofence center for arrival verification).
ALTER TABLE "Property"
    ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
