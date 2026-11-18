-- Bank Accounts, payment reconciliation, and bank-mapping for invoices/quotations.

CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountNumberLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "branch" TEXT,
    "accountType" TEXT NOT NULL DEFAULT 'CURRENT',
    "upiId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'COMPANY_ACCOUNT',
    "openingBalance" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankAccount_status_idx" ON "BankAccount"("status");

CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "txnDate" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "importedBy" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'CSV_IMPORT',

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankTransaction_bankAccountId_externalId_key" ON "BankTransaction"("bankAccountId", "externalId");
CREATE INDEX "BankTransaction_bankAccountId_status_idx" ON "BankTransaction"("bankAccountId", "status");

CREATE TABLE "ReconciliationRecord" (
    "id" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "matchedAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MATCHED',
    "matchedBy" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "ReconciliationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReconciliationRecord_bankTransactionId_key" ON "ReconciliationRecord"("bankTransactionId");
CREATE UNIQUE INDEX "ReconciliationRecord_paymentId_key" ON "ReconciliationRecord"("paymentId");
CREATE INDEX "ReconciliationRecord_paymentId_idx" ON "ReconciliationRecord"("paymentId");

ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationRecord" ADD CONSTRAINT "ReconciliationRecord_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationRecord" ADD CONSTRAINT "ReconciliationRecord_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invoice: receiving account + frozen snapshot
ALTER TABLE "Invoice" ADD COLUMN "bankAccountId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "bankAccountSnapshot" JSONB;
CREATE INDEX "Invoice_bankAccountId_idx" ON "Invoice"("bankAccountId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quote: receiving account (carried forward on conversion)
ALTER TABLE "Quote" ADD COLUMN "bankAccountId" TEXT;
CREATE INDEX "Quote_bankAccountId_idx" ON "Quote"("bankAccountId");
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payment: actual receiving account for this specific payment (may differ from the invoice's default)
ALTER TABLE "Payment" ADD COLUMN "receivingBankAccountId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "recordedBy" TEXT;
CREATE INDEX "Payment_receivingBankAccountId_idx" ON "Payment"("receivingBankAccountId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivingBankAccountId_fkey" FOREIGN KEY ("receivingBankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
