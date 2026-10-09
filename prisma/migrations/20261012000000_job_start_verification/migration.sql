-- Job start verification modes (additive, safe to re-run).
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "startVerificationMode" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Job_startVerificationMode_check') THEN
    ALTER TABLE "Job" ADD CONSTRAINT "Job_startVerificationMode_check"
      CHECK ("startVerificationMode" IS NULL OR "startVerificationMode" IN ('DIRECT','QR','QR_GPS','GPS'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "JobStartVerification" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userName" TEXT NOT NULL,
  "userRole" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "failureReason" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "distanceM" DOUBLE PRECISION,
  "qrResult" TEXT,
  "overrideReason" TEXT,
  "statusBefore" TEXT NOT NULL,
  "statusAfter" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobStartVerification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobStartVerification_mode_check" CHECK ("mode" IN ('DIRECT','QR','QR_GPS','GPS')),
  CONSTRAINT "JobStartVerification_result_check" CHECK ("result" IN ('PASSED','FAILED','OVERRIDE')),
  CONSTRAINT "JobStartVerification_override_reason_check" CHECK ("result" <> 'OVERRIDE' OR ("overrideReason" IS NOT NULL AND length("overrideReason") >= 5))
);

CREATE INDEX IF NOT EXISTS "JobStartVerification_jobId_createdAt_idx" ON "JobStartVerification"("jobId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JobStartVerification_jobId_fkey') THEN
    ALTER TABLE "JobStartVerification" ADD CONSTRAINT "JobStartVerification_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
