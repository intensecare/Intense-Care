-- QualityIssue.qualityCheckId is now optional: customer attention requests
-- are created without a formal QC record.
ALTER TABLE "QualityIssue" ALTER COLUMN "qualityCheckId" DROP NOT NULL;

-- Composite indexes matching schema.prisma
CREATE INDEX "Job_scheduledDate_status_idx" ON "Job"("scheduledDate", "status");
CREATE INDEX "CommissionEntry_partnerId_status_idx" ON "CommissionEntry"("partnerId", "status");
