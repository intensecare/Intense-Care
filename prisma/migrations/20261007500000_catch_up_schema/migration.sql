-- =============================================================================
-- 20261007500000 — Catch-up: objects the schema already uses but which only
-- ever reached the database through `prisma db push` (see the two loose
-- 20261004 / 20261005 .sql notes). Every statement is idempotent, so this is
-- a no-op on databases that were pushed, and makes a fresh
-- `prisma migrate deploy` produce the full schema. Nothing is dropped.
-- =============================================================================

-- Job: GPS arrival, customer confirmation/approval, feedback, calendar, referral.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "approvalMethod" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "arrivalAccuracy" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "arrivalBypassReason" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "arrivalDistanceM" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "arrivalLat" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "arrivalLng" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "arrivalVerification" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerFeedbackAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerFeedbackRating" INTEGER;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerTokenId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "googleEventId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "googleReviewClicked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "jobSerial" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "referralPartnerId" TEXT;

-- Property GPS (arrival geofence).
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;

-- The customer's secure service link (one per job).
CREATE TABLE IF NOT EXISTS "QrToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEnc" TEXT,
    "tokenLast4" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QrToken_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "QrToken" ADD COLUMN IF NOT EXISTS "tokenEnc" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "QrToken_tokenHash_key" ON "QrToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "QrToken_jobId_idx" ON "QrToken"("jobId");
CREATE INDEX IF NOT EXISTS "QrToken_purpose_idx" ON "QrToken"("purpose");
CREATE INDEX IF NOT EXISTS "QrToken_jobId_purpose_idx" ON "QrToken"("jobId", "purpose");

-- AMC contracts / visits (existing backend data; kept, not expanded).
CREATE TABLE IF NOT EXISTS "AmcContract" (
    "id" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "serviceId" TEXT,
    "nriContactName" TEXT,
    "nriContactPhone" TEXT,
    "nriContactEmail" TEXT,
    "localContactName" TEXT,
    "localContactPhone" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "contractValue" DOUBLE PRECISION NOT NULL,
    "includedServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visitCount" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "assignedStaffIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emergencyContact" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmcContract_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AmcContract_contractNumber_key" ON "AmcContract"("contractNumber");
CREATE INDEX IF NOT EXISTS "AmcContract_customerId_idx" ON "AmcContract"("customerId");
CREATE INDEX IF NOT EXISTS "AmcContract_status_idx" ON "AmcContract"("status");

CREATE TABLE IF NOT EXISTS "AmcVisit" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "visitNumber" INTEGER NOT NULL,
    "scheduledDate" TEXT NOT NULL,
    "scheduledSlot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "jobId" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "staffIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checklistSummary" JSONB,
    "photoUrls" JSONB,
    "qcScore" INTEGER,
    "issuesFound" TEXT,
    "recommendations" TEXT,
    "nriApproved" BOOLEAN,
    "nriNotes" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmcVisit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AmcVisit_jobId_key" ON "AmcVisit"("jobId");
CREATE INDEX IF NOT EXISTS "AmcVisit_contractId_scheduledDate_idx" ON "AmcVisit"("contractId", "scheduledDate");
CREATE INDEX IF NOT EXISTS "AmcVisit_status_idx" ON "AmcVisit"("status");

CREATE INDEX IF NOT EXISTS "JobActivityEvent_jobId_createdAt_idx" ON "JobActivityEvent"("jobId", "createdAt");
CREATE INDEX IF NOT EXISTS "JobActivityEvent_createdAt_idx" ON "JobActivityEvent"("createdAt");

-- Foreign keys (skipped when they already exist).
DO $$ BEGIN
  ALTER TABLE "Job" ADD CONSTRAINT "Job_referralPartnerId_fkey" FOREIGN KEY ("referralPartnerId") REFERENCES "ReferralPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "QrToken" ADD CONSTRAINT "QrToken_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AmcVisit" ADD CONSTRAINT "AmcVisit_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "AmcContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
