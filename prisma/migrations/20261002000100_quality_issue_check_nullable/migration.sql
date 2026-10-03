-- QualityIssue.qualityCheckId is now optional: customer attention requests
-- are created without a formal QC record.
ALTER TABLE "QualityIssue" ALTER COLUMN "qualityCheckId" DROP NOT NULL;

-- Composite indexes matching schema.prisma (IF NOT EXISTS keeps this
-- idempotent against schemas previously synced with db push).
CREATE INDEX IF NOT EXISTS "Job_scheduledDate_status_idx" ON "Job"("scheduledDate", "status");
CREATE INDEX IF NOT EXISTS "CommissionEntry_partnerId_status_idx" ON "CommissionEntry"("partnerId", "status");
