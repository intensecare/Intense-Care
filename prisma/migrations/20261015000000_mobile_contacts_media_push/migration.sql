-- =============================================================================
-- 20261015 — Android app: devices, contact sync, push ledger, media deletions.
-- Additive and idempotent.
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------- photo upload idempotency
ALTER TABLE "JobPhoto" ADD COLUMN IF NOT EXISTS "clientUploadId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "JobPhoto_jobId_clientUploadId_key" ON "JobPhoto"("jobId", "clientUploadId");

-- ---------------------------------------------------------------- devices
CREATE TABLE IF NOT EXISTS "MobileDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "label" TEXT,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "appVersion" TEXT,
  "syncTokenHash" TEXT,
  "syncTokenIssuedAt" TIMESTAMP(3),
  "syncPaused" BOOLEAN NOT NULL DEFAULT false,
  "pushToken" TEXT,
  "pushTokenUpdatedAt" TIMESTAMP(3),
  "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MobileDevice_syncTokenHash_key" ON "MobileDevice"("syncTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "MobileDevice_userId_deviceId_key" ON "MobileDevice"("userId", "deviceId");
CREATE INDEX IF NOT EXISTS "MobileDevice_userId_idx" ON "MobileDevice"("userId");
CREATE INDEX IF NOT EXISTS "MobileDevice_pushToken_idx" ON "MobileDevice"("pushToken");

-- ---------------------------------------------------------------- contacts
CREATE TABLE IF NOT EXISTS "PhoneContact" (
  "id" TEXT NOT NULL,
  "deviceRowId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "deviceContactId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "contentHash" TEXT NOT NULL,
  "deviceUpdatedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "removedAt" TIMESTAMP(3),
  "customerId" TEXT,
  "leadId" TEXT,
  "importState" TEXT NOT NULL DEFAULT 'NONE',
  "dupDismissedAt" TIMESTAMP(3),
  "firstSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhoneContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PhoneContact_status_check" CHECK ("status" IN ('ACTIVE', 'REMOVED')),
  CONSTRAINT "PhoneContact_import_check" CHECK ("importState" IN ('NONE', 'LEAD', 'IGNORED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "PhoneContact_deviceRowId_deviceContactId_key" ON "PhoneContact"("deviceRowId", "deviceContactId");
CREATE INDEX IF NOT EXISTS "PhoneContact_ownerUserId_idx" ON "PhoneContact"("ownerUserId");
CREATE INDEX IF NOT EXISTS "PhoneContact_status_idx" ON "PhoneContact"("status");
CREATE INDEX IF NOT EXISTS "PhoneContact_customerId_idx" ON "PhoneContact"("customerId");
CREATE INDEX IF NOT EXISTS "PhoneContact_leadId_idx" ON "PhoneContact"("leadId");

CREATE TABLE IF NOT EXISTS "PhoneContactNumber" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "e164" TEXT NOT NULL,
  "phoneKey" TEXT NOT NULL,
  CONSTRAINT "PhoneContactNumber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PhoneContactNumber_contactId_phoneKey_key" ON "PhoneContactNumber"("contactId", "phoneKey");
CREATE INDEX IF NOT EXISTS "PhoneContactNumber_phoneKey_idx" ON "PhoneContactNumber"("phoneKey");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhoneContactNumber_contactId_fkey') THEN
    ALTER TABLE "PhoneContactNumber" ADD CONSTRAINT "PhoneContactNumber_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "PhoneContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ContactSyncRun" (
  "id" TEXT NOT NULL,
  "deviceRowId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "clientRunId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "scanned" INTEGER NOT NULL DEFAULT 0,
  "added" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0,
  "unchanged" INTEGER NOT NULL DEFAULT 0,
  "removed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "duplicates" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "ContactSyncRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContactSyncRun_status_check" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContactSyncRun_deviceRowId_clientRunId_key" ON "ContactSyncRun"("deviceRowId", "clientRunId");
CREATE INDEX IF NOT EXISTS "ContactSyncRun_deviceRowId_startedAt_idx" ON "ContactSyncRun"("deviceRowId", "startedAt");

CREATE TABLE IF NOT EXISTS "ContactSyncBatch" (
  "id" TEXT NOT NULL,
  "deviceRowId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactSyncBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContactSyncBatch_deviceRowId_idempotencyKey_key" ON "ContactSyncBatch"("deviceRowId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ContactSyncBatch_createdAt_idx" ON "ContactSyncBatch"("createdAt");

-- Customer lookup by phone: the last 10 digits, as the sync and the lead module match.
CREATE INDEX IF NOT EXISTS "Customer_phone10_idx" ON "Customer" ((right(regexp_replace("phone", '\D', '', 'g'), 10)));

-- ---------------------------------------------------------------- lead source: PHONE_CONTACT
ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_source_check";
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_source_check" CHECK ("source" IN ('PHONE_CALL','GOOGLE_SEARCH','GOOGLE_MAPS','GOOGLE_ADS','WEBSITE','WHATSAPP','REFERRAL','WALK_IN','PHONE_CONTACT','OTHER'));

-- ---------------------------------------------------------------- push ledger
CREATE TABLE IF NOT EXISTS "PushNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "route" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushNotification_userId_dedupeKey_key" ON "PushNotification"("userId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "PushNotification_createdAt_idx" ON "PushNotification"("createdAt");

-- ---------------------------------------------------------------- media deletions (audit snapshot)
CREATE TABLE IF NOT EXISTS "MediaDeletion" (
  "id" TEXT NOT NULL,
  "assetKind" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "bytes" INTEGER,
  "jobId" TEXT,
  "jobSerial" TEXT,
  "uploadedBy" TEXT,
  "uploadedAt" TIMESTAMP(3),
  "protectedOverride" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "remoteDeleted" BOOLEAN NOT NULL DEFAULT false,
  "deletedBy" TEXT NOT NULL,
  "deletedByName" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaDeletion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MediaDeletion_deletedAt_idx" ON "MediaDeletion"("deletedAt");
CREATE INDEX IF NOT EXISTS "MediaDeletion_jobId_idx" ON "MediaDeletion"("jobId");

COMMIT;
