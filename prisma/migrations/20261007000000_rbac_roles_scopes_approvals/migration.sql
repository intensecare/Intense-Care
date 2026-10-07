-- =============================================================================
-- 20261007 — RBAC: nine roles, scope attributes, approval authority, audit §27
-- =============================================================================

-- Users: scope attributes + external-role links (customer / referral partner).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "teamId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralPartnerId" TEXT;

CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_customerId_idx" ON "User"("customerId");
CREATE INDEX IF NOT EXISTS "User_referralPartnerId_idx" ON "User"("referralPartnerId");
CREATE INDEX IF NOT EXISTS "User_teamId_idx" ON "User"("teamId");

-- Legacy "staff" accounts ran the whole on-site flow as lead workers — they
-- become Field Managers / Team Leaders. New cleaners are created as field_staff.
UPDATE "User" SET "role" = 'field_manager' WHERE "role" = 'staff';

-- Invoices: finalization freeze + refund running total.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "finalizedBy" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Refunds with approval authority.
CREATE TABLE IF NOT EXISTS "Refund" (
    "id"          TEXT NOT NULL,
    "invoiceId"   TEXT NOT NULL,
    "jobId"       TEXT NOT NULL,
    "customerId"  TEXT NOT NULL,
    "amount"      DOUBLE PRECISION NOT NULL,
    "reason"      TEXT NOT NULL,
    "method"      TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedBy" TEXT NOT NULL,
    "approvedBy"  TEXT,
    "approvedAt"  TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Refund_invoiceId_idx" ON "Refund"("invoiceId");
CREATE INDEX IF NOT EXISTS "Refund_status_idx" ON "Refund"("status");

-- Audit log §27: role, job, reason and device metadata.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "performedByRole" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "jobId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
CREATE INDEX IF NOT EXISTS "AuditLog_jobId_idx" ON "AuditLog"("jobId");
