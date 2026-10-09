-- =============================================================================
-- 20261011 — Expenses, referral bonuses, HR (employees, attendance, leave,
-- payroll), job staff assignment with history, freelance payments, stored files.
-- ADDITIVE ONLY and safe to re-run. One transaction. It deliberately does not
-- drop anything — tables / columns created by the earlier
-- 20261010000000_location_qr_custom_services_visibility migration stay in place.
-- =============================================================================
BEGIN;

CREATE SEQUENCE IF NOT EXISTS "expense_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "referral_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "employee_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "freelancer_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "freelance_payment_seq" START 1;

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "specialInstructions" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "expectedDurationHours" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "assignmentConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "assignmentConfirmedBy" TEXT;

ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "approvedBy" TEXT,
ADD COLUMN IF NOT EXISTS "employeeId" TEXT,
ADD COLUMN IF NOT EXISTS "expenseNumber" TEXT,
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "jobId" TEXT,
ADD COLUMN IF NOT EXISTS "notes" TEXT,
ADD COLUMN IF NOT EXISTS "paidBy" TEXT,
ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'PAID',
ADD COLUMN IF NOT EXISTS "receiptFileId" TEXT,
ADD COLUMN IF NOT EXISTS "sourceId" TEXT,
ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "vendor" TEXT,
ADD COLUMN IF NOT EXISTS "voidReason" TEXT,
ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "voidedBy" TEXT;

CREATE TABLE IF NOT EXISTS "StoredFile" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "category" TEXT,
    "label" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "expiresOn" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "referralNumber" TEXT NOT NULL,
    "referrerName" TEXT NOT NULL,
    "referrerContact" TEXT NOT NULL DEFAULT '',
    "referrerCustomerId" TEXT,
    "referredCustomerId" TEXT,
    "referredName" TEXT NOT NULL,
    "referredContact" TEXT NOT NULL DEFAULT '',
    "referredPhoneKey" TEXT,
    "referralDate" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'customer',
    "qualifyingJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "bonusType" TEXT,
    "bonusValue" DOUBLE PRECISION,
    "bonusAmount" DOUBLE PRECISION,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "expenseId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Employee" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'PERMANENT',
    "department" TEXT,
    "designation" TEXT,
    "joiningDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "managerUserId" TEXT,
    "userId" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serviceCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availabilityNotes" TEXT,
    "preferredLocations" TEXT,
    "payType" TEXT,
    "payRate" DOUBLE PRECISION,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "agreementOnFile" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "jobId" TEXT,
    "verificationMethod" TEXT NOT NULL DEFAULT 'NONE',
    "verificationRef" TEXT,
    "notes" TEXT,
    "recordedBy" TEXT NOT NULL,
    "correctedBy" TEXT,
    "correctedAt" TIMESTAMP(3),
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "approverId" TEXT,
    "approverName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "basic" DOUBLE PRECISION NOT NULL,
    "allowances" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advances" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonuses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netPayable" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "expenseId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobAssignment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "rateType" TEXT,
    "rate" DOUBLE PRECISION,
    "expectedHours" DOUBLE PRECISION,
    "actualHours" DOUBLE PRECISION,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedReason" TEXT,

    CONSTRAINT "JobAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JobAssignmentEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "employeeId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAssignmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FreelancePayment" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "hours" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "expenseId" TEXT,
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreelancePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StoredFile_ownerType_ownerId_idx" ON "StoredFile"("ownerType", "ownerId");

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_referralNumber_key" ON "Referral"("referralNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_referredCustomerId_key" ON "Referral"("referredCustomerId");

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_referredPhoneKey_key" ON "Referral"("referredPhoneKey");

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_qualifyingJobId_key" ON "Referral"("qualifyingJobId");

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_expenseId_key" ON "Referral"("expenseId");

CREATE INDEX IF NOT EXISTS "Referral_status_idx" ON "Referral"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "Employee_employeeCode_key" ON "Employee"("employeeCode");

CREATE UNIQUE INDEX IF NOT EXISTS "Employee_userId_key" ON "Employee"("userId");

CREATE INDEX IF NOT EXISTS "Employee_employmentType_status_idx" ON "Employee"("employmentType", "status");

CREATE INDEX IF NOT EXISTS "Employee_managerUserId_idx" ON "Employee"("managerUserId");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");

CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRecord_employeeId_date_key" ON "AttendanceRecord"("employeeId", "date");

CREATE INDEX IF NOT EXISTS "LeaveRequest_employeeId_status_idx" ON "LeaveRequest"("employeeId", "status");

CREATE INDEX IF NOT EXISTS "LeaveRequest_startDate_idx" ON "LeaveRequest"("startDate");

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRecord_expenseId_key" ON "PayrollRecord"("expenseId");

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRecord_employeeId_period_key" ON "PayrollRecord"("employeeId", "period");

CREATE INDEX IF NOT EXISTS "JobAssignment_employeeId_status_idx" ON "JobAssignment"("employeeId", "status");

CREATE INDEX IF NOT EXISTS "JobAssignment_jobId_idx" ON "JobAssignment"("jobId");

CREATE UNIQUE INDEX IF NOT EXISTS "JobAssignment_jobId_employeeId_key" ON "JobAssignment"("jobId", "employeeId");

CREATE INDEX IF NOT EXISTS "JobAssignmentEvent_jobId_createdAt_idx" ON "JobAssignmentEvent"("jobId", "createdAt");

CREATE INDEX IF NOT EXISTS "JobAssignmentEvent_employeeId_idx" ON "JobAssignmentEvent"("employeeId");

CREATE UNIQUE INDEX IF NOT EXISTS "FreelancePayment_paymentNumber_key" ON "FreelancePayment"("paymentNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "FreelancePayment_assignmentId_key" ON "FreelancePayment"("assignmentId");

CREATE UNIQUE INDEX IF NOT EXISTS "FreelancePayment_expenseId_key" ON "FreelancePayment"("expenseId");

CREATE INDEX IF NOT EXISTS "FreelancePayment_status_idx" ON "FreelancePayment"("status");

CREATE INDEX IF NOT EXISTS "FreelancePayment_employeeId_idx" ON "FreelancePayment"("employeeId");

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_expenseNumber_key" ON "Expense"("expenseNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_idempotencyKey_key" ON "Expense"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "Expense_date_idx" ON "Expense"("date");

CREATE INDEX IF NOT EXISTS "Expense_category_idx" ON "Expense"("category");

CREATE INDEX IF NOT EXISTS "Expense_jobId_idx" ON "Expense"("jobId");

CREATE INDEX IF NOT EXISTS "Expense_employeeId_idx" ON "Expense"("employeeId");

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_sourceType_sourceId_key" ON "Expense"("sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS "JobActivityEvent_jobId_createdAt_idx" ON "JobActivityEvent"("jobId", "createdAt");

CREATE INDEX IF NOT EXISTS "JobActivityEvent_createdAt_idx" ON "JobActivityEvent"("createdAt");


-- ------------------------------------------------ backfill legacy expenses
-- Old rows had free-text categories and no number. Map them onto the fixed
-- category list (anything unrecognised becomes OTHER_EXPENSES, original text kept in notes).
UPDATE "Expense" SET
  "notes" = CASE WHEN "notes" IS NULL AND "expenseNumber" IS NULL THEN 'Earlier category: ' || "category" ELSE "notes" END,
  "category" = CASE
    WHEN "category" IN ('CLEANING_SUPPLIES','EQUIPMENT','TRANSPORTATION','FUEL','STAFF_WAGES','FREELANCE_PAYMENTS','MARKETING','OFFICE_EXPENSES','REPAIRS_MAINTENANCE','REFERRAL_BONUSES','OTHER_EXPENSES') THEN "category"
    WHEN "category" ILIKE '%suppl%' OR "category" ILIKE '%chemical%' OR "category" ILIKE '%consumable%' THEN 'CLEANING_SUPPLIES'
    WHEN "category" ILIKE '%equip%' OR "category" ILIKE '%machine%' OR "category" ILIKE '%tool%' THEN 'EQUIPMENT'
    WHEN "category" ILIKE '%fuel%' OR "category" ILIKE '%petrol%' OR "category" ILIKE '%diesel%' THEN 'FUEL'
    WHEN "category" ILIKE '%transport%' OR "category" ILIKE '%travel%' OR "category" ILIKE '%vehicle%' THEN 'TRANSPORTATION'
    WHEN "category" ILIKE '%wage%' OR "category" ILIKE '%salary%' OR "category" ILIKE '%payroll%' THEN 'STAFF_WAGES'
    WHEN "category" ILIKE '%freelanc%' THEN 'FREELANCE_PAYMENTS'
    WHEN "category" ILIKE '%market%' OR "category" ILIKE '%advert%' THEN 'MARKETING'
    WHEN "category" ILIKE '%office%' OR "category" ILIKE '%rent%' OR "category" ILIKE '%utilit%' THEN 'OFFICE_EXPENSES'
    WHEN "category" ILIKE '%repair%' OR "category" ILIKE '%mainten%' THEN 'REPAIRS_MAINTENANCE'
    WHEN "category" ILIKE '%referral%' OR "category" ILIKE '%bonus%' THEN 'REFERRAL_BONUSES'
    ELSE 'OTHER_EXPENSES' END
WHERE "expenseNumber" IS NULL;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "id", "createdAt" FROM "Expense" WHERE "expenseNumber" IS NULL ORDER BY "createdAt", "id" LOOP
    UPDATE "Expense" SET "expenseNumber" = 'EXP-' ||
      CASE WHEN EXTRACT(MONTH FROM r."createdAt") >= 4 THEN to_char(r."createdAt", 'YY') || to_char(r."createdAt" + interval '1 year', 'YY')
           ELSE to_char(r."createdAt" - interval '1 year', 'YY') || to_char(r."createdAt", 'YY') END
      || '-' || lpad(nextval('"expense_seq"')::text, 5, '0')
    WHERE "id" = r."id";
  END LOOP;
END $$;

-- ------------------------------------------------ constraints (guarded)
CREATE OR REPLACE FUNCTION pg_temp.add_constraint(tbl text, name text, def text) RETURNS void AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = name) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', tbl, name, def);
  END IF;
END
$f$ LANGUAGE plpgsql;

-- Foreign keys
SELECT pg_temp.add_constraint('Expense', 'Expense_jobId_fkey', 'FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('Expense', 'Expense_employeeId_fkey', 'FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('Expense', 'Expense_receiptFileId_fkey', 'FOREIGN KEY ("receiptFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('Referral', 'Referral_referrerCustomerId_fkey', 'FOREIGN KEY ("referrerCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('Referral', 'Referral_referredCustomerId_fkey', 'FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('Referral', 'Referral_qualifyingJobId_fkey', 'FOREIGN KEY ("qualifyingJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('Referral', 'Referral_expenseId_fkey', 'FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('Employee', 'Employee_managerUserId_fkey', 'FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('Employee', 'Employee_userId_fkey', 'FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('AttendanceRecord', 'AttendanceRecord_employeeId_fkey', 'FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('AttendanceRecord', 'AttendanceRecord_jobId_fkey', 'FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('LeaveRequest', 'LeaveRequest_employeeId_fkey', 'FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('PayrollRecord', 'PayrollRecord_employeeId_fkey', 'FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('PayrollRecord', 'PayrollRecord_expenseId_fkey', 'FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('JobAssignment', 'JobAssignment_jobId_fkey', 'FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('JobAssignment', 'JobAssignment_employeeId_fkey', 'FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('JobAssignmentEvent', 'JobAssignmentEvent_jobId_fkey', 'FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('FreelancePayment', 'FreelancePayment_assignmentId_fkey', 'FOREIGN KEY ("assignmentId") REFERENCES "JobAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('FreelancePayment', 'FreelancePayment_employeeId_fkey', 'FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('FreelancePayment', 'FreelancePayment_jobId_fkey', 'FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
SELECT pg_temp.add_constraint('FreelancePayment', 'FreelancePayment_expenseId_fkey', 'FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE');

-- Value checks: bad data is refused by the database itself, not only by the API
SELECT pg_temp.add_constraint('Expense', 'Expense_amounts_check', 'CHECK ("amount" >= 0 AND "taxAmount" >= 0 AND "taxAmount" <= "amount")');
SELECT pg_temp.add_constraint('Expense', 'Expense_category_check', 'CHECK ("category" IN (''CLEANING_SUPPLIES'',''EQUIPMENT'',''TRANSPORTATION'',''FUEL'',''STAFF_WAGES'',''FREELANCE_PAYMENTS'',''MARKETING'',''OFFICE_EXPENSES'',''REPAIRS_MAINTENANCE'',''REFERRAL_BONUSES'',''OTHER_EXPENSES''))');
SELECT pg_temp.add_constraint('Expense', 'Expense_status_check', 'CHECK ("paymentStatus" IN (''PAID'',''PENDING'') AND "approvalStatus" IN (''APPROVED'',''PENDING_APPROVAL'',''REJECTED''))');
SELECT pg_temp.add_constraint('Expense', 'Expense_source_check', 'CHECK (("sourceType" IS NULL) = ("sourceId" IS NULL))');
SELECT pg_temp.add_constraint('Referral', 'Referral_status_check', 'CHECK ("status" IN (''CREATED'',''CUSTOMER_REGISTERED'',''QUALIFYING_JOB_COMPLETED'',''BONUS_REVIEW'',''APPROVED'',''PAID'',''REJECTED'',''EXPIRED'') AND "approvalStatus" IN (''PENDING'',''APPROVED'',''REJECTED'') AND "paymentStatus" IN (''UNPAID'',''PAID''))');
SELECT pg_temp.add_constraint('Referral', 'Referral_paid_needs_approval_check', 'CHECK ("paymentStatus" <> ''PAID'' OR ("approvalStatus" = ''APPROVED'' AND "expenseId" IS NOT NULL AND "approvedBy" IS NOT NULL))');
SELECT pg_temp.add_constraint('Referral', 'Referral_bonus_check', 'CHECK ("bonusAmount" IS NULL OR "bonusAmount" >= 0)');
SELECT pg_temp.add_constraint('Employee', 'Employee_type_check', 'CHECK ("employmentType" IN (''PERMANENT'',''CONTRACT'',''FREELANCE'') AND "status" IN (''ACTIVE'',''INACTIVE'',''ON_LEAVE'',''EXITED'') AND "verificationStatus" IN (''PENDING'',''VERIFIED'',''REJECTED''))');
SELECT pg_temp.add_constraint('Employee', 'Employee_pay_check', 'CHECK (("payRate" IS NULL OR "payRate" >= 0) AND ("payType" IS NULL OR "payType" IN (''MONTHLY'',''DAILY'',''HOURLY'',''PER_JOB'')))');
SELECT pg_temp.add_constraint('AttendanceRecord', 'AttendanceRecord_check', 'CHECK ("status" IN (''PRESENT'',''ABSENT'',''HALF_DAY'',''LEAVE'',''HOLIDAY'',''WEEKLY_OFF'') AND "verificationMethod" IN (''NONE'',''GPS'',''QR'',''MANUAL'') AND ("checkIn" IS NULL OR "checkOut" IS NULL OR "checkOut" >= "checkIn"))');
SELECT pg_temp.add_constraint('LeaveRequest', 'LeaveRequest_check', 'CHECK ("status" IN (''PENDING'',''APPROVED'',''REJECTED'',''CANCELLED'') AND "leaveType" IN (''CASUAL'',''SICK'',''PAID'',''UNPAID'',''OTHER'') AND "endDate" >= "startDate" AND "days" > 0)');
SELECT pg_temp.add_constraint('PayrollRecord', 'PayrollRecord_check', 'CHECK ("status" IN (''DRAFT'',''APPROVED'',''PAID'') AND "basic" >= 0 AND "allowances" >= 0 AND "deductions" >= 0 AND "advances" >= 0 AND "bonuses" >= 0 AND "netPayable" >= 0)');
SELECT pg_temp.add_constraint('PayrollRecord', 'PayrollRecord_paid_needs_expense_check', 'CHECK ("status" <> ''PAID'' OR ("expenseId" IS NOT NULL AND "paidAt" IS NOT NULL))');
SELECT pg_temp.add_constraint('JobAssignment', 'JobAssignment_check', 'CHECK ("role" IN (''LEAD'',''MEMBER'') AND "status" IN (''ASSIGNED'',''ACCEPTED'',''DECLINED'',''COMPLETED'',''REMOVED'') AND ("rate" IS NULL OR "rate" >= 0) AND ("rateType" IS NULL OR "rateType" IN (''FIXED'',''HOURLY'')))');
SELECT pg_temp.add_constraint('FreelancePayment', 'FreelancePayment_check', 'CHECK ("status" IN (''PENDING_VERIFICATION'',''VERIFIED'',''APPROVED'',''PAID'',''REJECTED'') AND "amount" >= 0 AND "rate" >= 0 AND "rateType" IN (''FIXED'',''HOURLY''))');
SELECT pg_temp.add_constraint('FreelancePayment', 'FreelancePayment_paid_needs_expense_check', 'CHECK ("status" <> ''PAID'' OR ("expenseId" IS NOT NULL AND "paidAt" IS NOT NULL AND "approvedBy" IS NOT NULL))');

-- One LEAD per job among active assignments
CREATE UNIQUE INDEX IF NOT EXISTS "JobAssignment_one_lead_per_job" ON "JobAssignment"("jobId") WHERE "role" = 'LEAD' AND "status" IN ('ASSIGNED','ACCEPTED','COMPLETED');

COMMIT;
