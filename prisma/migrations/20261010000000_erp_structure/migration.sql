-- =============================================================================
-- 20261010 — ERP structure: job location + customer visibility, quotations as
-- a module, invoice line items, standard/custom services, feedback comments.
-- One transaction; every statement is safe to re-run.
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------- jobs
-- The service location chosen on the map is stored on the job itself
-- (defaults to the property's location; can be adjusted per job).
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "locationLat" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "locationLng" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "locationAddress" TEXT;
-- What the customer may see on their QR page (null = company defaults).
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerVisibility" JSONB;
-- Notes written FOR the customer (internal notes stay in "notes").
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerNotes" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customerFeedbackComment" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "quoteId" TEXT;
-- Existing jobs: take the property's coordinates and address.
UPDATE "Job" j SET "locationLat" = p."lat", "locationLng" = p."lng",
  "locationAddress" = NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ', p."address", NULLIF(p."city", ''))), '')
FROM "Property" p WHERE p."id" = j."propertyId" AND j."locationAddress" IS NULL;

-- ------------------------------------------------------------- quotations
ALTER TABLE "Quote" ALTER COLUMN "serviceId" DROP NOT NULL;
ALTER TABLE "Quote" ALTER COLUMN "propertyId" DROP NOT NULL;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "quoteType" TEXT NOT NULL DEFAULT 'GST';
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "igst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "interState" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "customerGstin" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "terms" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "acceptedBy" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "shareTokenHash" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "shareTokenEnc" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "jobId" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "Quote_shareTokenHash_key" ON "Quote"("shareTokenHash");
CREATE INDEX IF NOT EXISTS "Quote_customerId_idx" ON "Quote"("customerId");
-- Older quotes: a quote with tax was a GST quote, split CGST/SGST.
UPDATE "Quote" SET "quoteType" = CASE WHEN "tax" > 0 THEN 'GST' ELSE 'NON_GST' END,
  "cgst" = CASE WHEN "tax" > 0 THEN ROUND(("tax" / 2)::numeric, 2)::double precision ELSE 0 END,
  "sgst" = CASE WHEN "tax" > 0 THEN "tax" - ROUND(("tax" / 2)::numeric, 2)::double precision ELSE 0 END
WHERE "cgst" = 0 AND "sgst" = 0 AND "igst" = 0;
ALTER TABLE "Quote" DROP CONSTRAINT IF EXISTS "Quote_type_valid";
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_type_valid" CHECK ("quoteType" IN ('GST', 'NON_GST'));
CREATE SEQUENCE IF NOT EXISTS "quote_seq" START 1;

-- ---------------------------------------------------------------- invoices
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "items" JSONB;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "serviceAddress" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "quoteId" TEXT;

-- ---------------------------------------------------------------- services
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT false;
-- DEFAULT = follow the company setting; GST / NON_GST = always this type.
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "gstTreatment" TEXT NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_gst_treatment_valid";
ALTER TABLE "Service" ADD CONSTRAINT "Service_gst_treatment_valid" CHECK ("gstTreatment" IN ('DEFAULT', 'GST', 'NON_GST'));

COMMIT;
