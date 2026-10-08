-- =============================================================================
-- 20261009 — GST / Non-GST invoices, Tax Officer, readable Job IDs, logout.
-- One transaction: it applies completely or not at all. Every statement is
-- also safe to re-run.
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------- invoices
-- Every invoice is EITHER a GST invoice OR a Non-GST invoice. The type is
-- stored explicitly and the GST breakdown lives in its own columns.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "invoiceType" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "igst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "interState" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "customerGstin" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "supplierGstin" TEXT;

-- Existing invoices: anything that carried tax was a GST invoice (intra-state
-- CGST + SGST split); anything without tax becomes a Non-GST invoice.
UPDATE "Invoice"
SET "invoiceType" = 'GST',
    "cgst" = ROUND(("tax" / 2)::numeric, 2)::double precision,
    "sgst" = "tax" - ROUND(("tax" / 2)::numeric, 2)::double precision,
    "gstRate" = CASE WHEN ("subtotal" - "discount") > 0
                     THEN ROUND(("tax" * 100 / ("subtotal" - "discount"))::numeric, 2)::double precision
                     ELSE 0 END
WHERE "invoiceType" IS NULL AND "tax" > 0;
UPDATE "Invoice" SET "invoiceType" = 'NON_GST', "tax" = 0 WHERE "invoiceType" IS NULL;
ALTER TABLE "Invoice" ALTER COLUMN "invoiceType" SET NOT NULL;

-- Database-level segregation: a Non-GST invoice can never carry GST data,
-- and a GST invoice's tax always equals CGST + SGST + IGST.
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_type_valid";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_type_valid" CHECK ("invoiceType" IN ('GST', 'NON_GST'));
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_non_gst_has_no_gst";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_non_gst_has_no_gst" CHECK (
  "invoiceType" = 'GST'
  OR ("tax" = 0 AND "cgst" = 0 AND "sgst" = 0 AND "igst" = 0 AND "gstRate" = 0 AND "customerGstin" IS NULL)
);
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_gst_breakdown_matches";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_gst_breakdown_matches" CHECK (
  "invoiceType" = 'NON_GST' OR ABS("tax" - ("cgst" + "sgst" + "igst")) < 0.011
);
CREATE INDEX IF NOT EXISTS "Invoice_invoiceType_issuedAt_idx" ON "Invoice"("invoiceType", "issuedAt");

-- Separate, gap-free-ish number series per invoice type.
CREATE SEQUENCE IF NOT EXISTS "gst_invoice_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "non_gst_invoice_seq" START 1;

-- Customer GSTIN (optional, for business customers on GST invoices).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "gstin" TEXT;

-- ------------------------------------------------------------------ Job ID
-- Every job has a readable, unique Job ID (CUSTOMER-NAME-DDMMYYYY-001).
-- Older jobs keep their JOB-10001 style id; any job still without one gets it.
CREATE SEQUENCE IF NOT EXISTS "job_serial_seq" START 10001;
-- Never hand out a JOB-n that already exists.
SELECT setval('"job_serial_seq"', GREATEST(10000, COALESCE((SELECT MAX(substring("jobSerial" FROM '^JOB-([0-9]+)$')::bigint) FROM "Job"), 0)), true);
UPDATE "Job" SET "jobSerial" = 'JOB-' || nextval('"job_serial_seq"')
WHERE "id" IN (SELECT "id" FROM "Job" WHERE "jobSerial" IS NULL ORDER BY "createdAt", "id");
ALTER TABLE "Job" ALTER COLUMN "jobSerial" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Job_jobSerial_key" ON "Job"("jobSerial");

-- ----------------------------------------------------------------- logout
-- Signing out revokes that session server-side: the cookie's session id is
-- recorded here until the cookie would have expired anyway.
CREATE TABLE IF NOT EXISTS "RevokedSession" (
  "jti" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("jti")
);
CREATE INDEX IF NOT EXISTS "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");

-- -------------------------------------------------------------------- QR
-- ONE QR per job → the customer's secure job portal. The separate property
-- QR is retired: its tokens are deleted so printed property QRs stop working.
DROP INDEX IF EXISTS "Property_accessTokenHash_key";
ALTER TABLE "Property" DROP COLUMN IF EXISTS "accessTokenHash";
ALTER TABLE "Property" DROP COLUMN IF EXISTS "accessTokenEnc";

COMMIT;
