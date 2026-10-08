-- §1 + §2 schema additions (applied to the database via `prisma db push`;
-- this file documents the DDL for environments that apply SQL migrations).
--
-- §1 Google Calendar integration: the id of the calendar event synced for
-- each job (null = integration not connected / event not created).
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "googleEventId" TEXT;

-- §2 AMC — recurring home-maintenance contracts (NRI use case).
CREATE TABLE IF NOT EXISTS "AmcContract" (
  "id"               TEXT    NOT NULL,
  "contractNumber"   TEXT    NOT NULL,
  "customerId"       TEXT    NOT NULL,
  "propertyId"       TEXT    NOT NULL,
  "serviceId"        TEXT,
  "nriContactName"   TEXT,
  "nriContactPhone"  TEXT,
  "nriContactEmail"  TEXT,
  "localContactName" TEXT,
  "localContactPhone" TEXT,
  "startDate"        TEXT    NOT NULL,
  "endDate"          TEXT    NOT NULL,
  "contractValue"    DOUBLE PRECISION NOT NULL,
  "includedServices" TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  "visitCount"       INTEGER NOT NULL,
  "frequency"        TEXT    NOT NULL DEFAULT 'MONTHLY',
  "assignedStaffIds" TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  "emergencyContact" TEXT,
  "paymentStatus"    TEXT    NOT NULL DEFAULT 'PENDING',
  "status"           TEXT    NOT NULL DEFAULT 'ACTIVE',
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AmcContract_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AmcContract_contractNumber_key" ON "AmcContract"("contractNumber");
CREATE INDEX IF NOT EXISTS "AmcContract_customerId_idx" ON "AmcContract"("customerId");
CREATE INDEX IF NOT EXISTS "AmcContract_status_idx" ON "AmcContract"("status");

-- One scheduled maintenance visit per contract; optionally linked to a
-- standard Job so execution reuses the strict pipeline.
CREATE TABLE IF NOT EXISTS "AmcVisit" (
  "id"               TEXT    NOT NULL,
  "contractId"       TEXT    NOT NULL,
  "visitNumber"      INTEGER NOT NULL,
  "scheduledDate"    TEXT    NOT NULL,
  "scheduledSlot"    TEXT,
  "status"           TEXT    NOT NULL DEFAULT 'SCHEDULED',
  "jobId"            TEXT,
  "arrivedAt"        TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "otpVerified"      BOOLEAN NOT NULL DEFAULT false,
  "staffIds"         TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  "checklistSummary" JSONB,
  "photoUrls"        JSONB,
  "qcScore"          INTEGER,
  "issuesFound"      TEXT,
  "recommendations"  TEXT,
  "nriApproved"      BOOLEAN,
  "nriNotes"         TEXT,
  "reminderSentAt"   TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AmcVisit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AmcVisit_jobId_key" ON "AmcVisit"("jobId");
CREATE INDEX IF NOT EXISTS "AmcVisit_contractId_scheduledDate_idx" ON "AmcVisit"("contractId", "scheduledDate");
CREATE INDEX IF NOT EXISTS "AmcVisit_status_idx" ON "AmcVisit"("status");

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmcContract_customerId_fkey') THEN
    ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmcContract_propertyId_fkey') THEN
    ALTER TABLE "AmcContract" ADD CONSTRAINT "AmcContract_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmcVisit_contractId_fkey') THEN
    ALTER TABLE "AmcVisit" ADD CONSTRAINT "AmcVisit_contractId_fkey"
      FOREIGN KEY ("contractId") REFERENCES "AmcContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
