-- §1 Location, §2 QR verification, §3 custom + multiple services,
-- §4/§5 professional quotation/invoice documents, §6 customer visibility.
-- Idempotent (IF NOT EXISTS) so it can be re-applied over a catch-up database.

/* ---------------------------------------------------------------- §1 Job location */
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "serviceAddress" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "serviceLat" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "serviceLng" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "serviceLocationAccuracy" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "locationNotes" TEXT;

/* ---------------------------------------------------------- §2 QR arrival fallback */
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "arrivalQrTokenId" TEXT;

/* ------------------------------------------------------- §6 customer visibility */
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerVisibility" JSONB;

/* --------------------------------------------- §3 custom services on the catalog */
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "taxTreatment" TEXT NOT NULL DEFAULT 'GST';
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT false;

/* --------------------------------------- §3 one or many priced services per job */
CREATE TABLE IF NOT EXISTS "JobServiceLine" (
  "id"            TEXT NOT NULL,
  "jobId"         TEXT NOT NULL,
  "serviceId"     TEXT,
  "name"          TEXT NOT NULL,
  "description"   TEXT NOT NULL DEFAULT '',
  "quantity"      DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unitPrice"     DOUBLE PRECISION NOT NULL,
  "discount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxable"       BOOLEAN NOT NULL DEFAULT true,
  "durationHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "position"      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "JobServiceLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JobServiceLine_jobId_idx" ON "JobServiceLine"("jobId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JobServiceLine_jobId_fkey'
  ) THEN
    ALTER TABLE "JobServiceLine"
      ADD CONSTRAINT "JobServiceLine_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Money sanity: a line can never be negative, and the discount can never
-- exceed the line value (mirrors the Invoice amount check constraints).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'JobServiceLine_amounts_check'
  ) THEN
    ALTER TABLE "JobServiceLine"
      ADD CONSTRAINT "JobServiceLine_amounts_check"
      CHECK (
        "quantity" > 0
        AND "unitPrice" >= 0
        AND "discount" >= 0
        AND "discount" <= "quantity" * "unitPrice" + 0.01
      );
  END IF;
END $$;

-- Backfill: every existing job becomes a single-line job from its service, so
-- documents built from lines show the same figures the job already carried.
INSERT INTO "JobServiceLine" ("id", "jobId", "serviceId", "name", "description", "quantity", "unitPrice", "discount", "taxable", "durationHours", "position")
SELECT
  'jsl_' || j."id",
  j."id",
  s."id",
  s."name",
  COALESCE(s."description", ''),
  1,
  GREATEST(COALESCE(j."amount", 0), 0),
  0,
  true,
  COALESCE(s."estimatedDurationHours", 0),
  0
FROM "Job" j
JOIN "Service" s ON s."id" = j."serviceId"
WHERE NOT EXISTS (SELECT 1 FROM "JobServiceLine" l WHERE l."jobId" = j."id");

/* ------------------------------------------------- §4 professional quotation */
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "invoiceType" TEXT NOT NULL DEFAULT 'GST';
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "igst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "interState" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "serviceAddress" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "serviceTerms" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptedBy" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "jobId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing quotations carried GST implicitly in `tax`; mark the ones that did
-- not as NON_GST so the document never prints an empty GST block.
UPDATE "Quote" SET "invoiceType" = 'NON_GST' WHERE "tax" <= 0 AND "invoiceType" = 'GST';

CREATE INDEX IF NOT EXISTS "Quote_customerId_idx" ON "Quote"("customerId");
CREATE INDEX IF NOT EXISTS "Quote_status_idx" ON "Quote"("status");

/* ------------------- §7 a customer-facing note, kept apart from internal notes */
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerNotes" TEXT;

/* ------------------------------- §4 quotation number series (QTN-2627-00001) */
CREATE SEQUENCE IF NOT EXISTS "quote_seq" START 1;
