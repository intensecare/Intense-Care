-- Property: the Google Maps / location link pasted to set the pin.
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "mapLink" TEXT;

-- UPI payment attempts (customer "Pay now") and their audit trail.
CREATE TABLE IF NOT EXISTS "UpiPaymentAttempt" (
  "id"             TEXT PRIMARY KEY,
  "invoiceId"      TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "customerId"     TEXT NOT NULL,
  "reference"      TEXT NOT NULL,
  "amount"         DOUBLE PRECISION NOT NULL,
  "payeeVpa"       TEXT NOT NULL,
  "payeeName"      TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'INITIATED',
  "utr"            TEXT,
  "payerNote"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt"    TIMESTAMP(3),
  "reviewedAt"     TIMESTAMP(3),
  "reviewedBy"     TEXT,
  "reviewedByName" TEXT,
  "reviewNote"     TEXT,
  "paymentId"      TEXT,
  CONSTRAINT "UpiPaymentAttempt_status_check" CHECK ("status" IN ('INITIATED','SUBMITTED','VERIFIED','REJECTED','CANCELLED')),
  CONSTRAINT "UpiPaymentAttempt_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "UpiPaymentAttempt_reference_key" ON "UpiPaymentAttempt"("reference");
CREATE INDEX IF NOT EXISTS "UpiPaymentAttempt_invoiceId_status_idx" ON "UpiPaymentAttempt"("invoiceId", "status");
CREATE INDEX IF NOT EXISTS "UpiPaymentAttempt_status_submittedAt_idx" ON "UpiPaymentAttempt"("status", "submittedAt");
-- One UTR can pay one thing: no two live (not rejected / cancelled) attempts may carry the same UTR.
CREATE UNIQUE INDEX IF NOT EXISTS "UpiPaymentAttempt_utr_live_key" ON "UpiPaymentAttempt"("utr") WHERE "utr" IS NOT NULL AND "status" IN ('SUBMITTED','VERIFIED');

CREATE TABLE IF NOT EXISTS "UpiPaymentEvent" (
  "id"         TEXT PRIMARY KEY,
  "attemptId"  TEXT NOT NULL REFERENCES "UpiPaymentAttempt"("id") ON DELETE CASCADE,
  "at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fromStatus" TEXT,
  "toStatus"   TEXT NOT NULL,
  "actorType"  TEXT NOT NULL,
  "actorName"  TEXT,
  "note"       TEXT
);
CREATE INDEX IF NOT EXISTS "UpiPaymentEvent_attemptId_at_idx" ON "UpiPaymentEvent"("attemptId", "at");
