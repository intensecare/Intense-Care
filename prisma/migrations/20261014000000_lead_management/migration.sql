-- =============================================================================
-- 20261014 — Lead Management. Additive only; safe to re-run.
-- =============================================================================
BEGIN;

CREATE SEQUENCE IF NOT EXISTS "lead_seq" START 1;

CREATE TABLE IF NOT EXISTS "Lead" (
  "id"                  TEXT NOT NULL,
  "leadNumber"          TEXT NOT NULL,
  "customerName"        TEXT NOT NULL,
  "phone"               TEXT NOT NULL,
  -- Last 10 digits of the phone, for duplicate detection.
  "phoneKey"            TEXT NOT NULL,
  "email"               TEXT,
  "source"              TEXT NOT NULL,
  "sourceDetails"       TEXT,
  "serviceInterest"     TEXT,
  "serviceId"           TEXT,
  "propertyAddress"     TEXT,
  "locality"            TEXT,
  "city"                TEXT,
  "postalCode"          TEXT,
  "lat"                 DOUBLE PRECISION,
  "lng"                 DOUBLE PRECISION,
  "preferredDate"       TEXT,
  "estimatedValue"      DOUBLE PRECISION,
  "assignedUserId"      TEXT,
  "status"              TEXT NOT NULL DEFAULT 'NEW',
  "lostReason"          TEXT,
  "notes"               TEXT,
  "nextFollowUpDate"    TEXT,
  "lastContactedAt"     TIMESTAMP(3),
  "quoteId"             TEXT,
  "convertedCustomerId" TEXT,
  "convertedPropertyId" TEXT,
  "convertedJobId"      TEXT,
  "convertedAt"         TIMESTAMP(3),
  "convertedBy"         TEXT,
  "utmSource"           TEXT,
  "utmMedium"           TEXT,
  "utmCampaign"         TEXT,
  "utmTerm"             TEXT,
  "utmContent"          TEXT,
  "gclid"               TEXT,
  "landingPage"         TEXT,
  "referrerUrl"         TEXT,
  "createdBy"           TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Lead_source_check" CHECK ("source" IN ('PHONE_CALL','GOOGLE_SEARCH','GOOGLE_MAPS','GOOGLE_ADS','WEBSITE','WHATSAPP','REFERRAL','WALK_IN','OTHER')),
  CONSTRAINT "Lead_status_check" CHECK ("status" IN ('NEW','CONTACTED','QUALIFIED','QUOTATION_SENT','FOLLOW_UP','WON','LOST')),
  CONSTRAINT "Lead_lost_reason_check" CHECK ("status" <> 'LOST' OR ("lostReason" IS NOT NULL AND length(btrim("lostReason")) >= 3)),
  CONSTRAINT "Lead_value_check" CHECK ("estimatedValue" IS NULL OR "estimatedValue" >= 0),
  CONSTRAINT "Lead_coords_check" CHECK (("lat" IS NULL AND "lng" IS NULL) OR ("lat" IS NOT NULL AND "lng" IS NOT NULL AND abs("lat") <= 90 AND abs("lng") <= 180))
);
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_leadNumber_key" ON "Lead"("leadNumber");
-- One lead can become one job — a second conversion can never succeed.
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_convertedJobId_key" ON "Lead"("convertedJobId");
CREATE INDEX IF NOT EXISTS "Lead_phoneKey_idx" ON "Lead"("phoneKey");
CREATE INDEX IF NOT EXISTS "Lead_status_idx" ON "Lead"("status");
CREATE INDEX IF NOT EXISTS "Lead_source_idx" ON "Lead"("source");
CREATE INDEX IF NOT EXISTS "Lead_nextFollowUpDate_idx" ON "Lead"("nextFollowUpDate");
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead"("createdAt");
CREATE INDEX IF NOT EXISTS "Lead_quoteId_idx" ON "Lead"("quoteId");

CREATE TABLE IF NOT EXISTS "LeadActivity" (
  "id"         TEXT NOT NULL,
  "leadId"     TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "message"    TEXT NOT NULL,
  "outcome"    TEXT,
  -- Provider message id (e.g. WhatsApp) so a webhook retry is stored once.
  "externalId" TEXT,
  "actorId"    TEXT,
  "actorName"  TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadActivity_externalId_key" ON "LeadActivity"("externalId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadActivity_leadId_fkey') THEN
    ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
