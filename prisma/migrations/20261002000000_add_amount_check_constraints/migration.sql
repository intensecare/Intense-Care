-- Add check constraints to prevent negative amounts in financial fields
-- This migration adds database-level validation for negative amounts

-- Job amount check constraint
ALTER TABLE "Job" ADD CONSTRAINT "Job_amount_positive" CHECK (amount >= 0);

-- Invoice amount constraints
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subtotal_positive" CHECK (subtotal >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_total_positive" CHECK (total >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amountPaid_positive" CHECK (amountPaid >= 0);

-- Payment amount constraint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK (amount >= 0);

-- Expense amount constraint
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive" CHECK (amount >= 0);

-- Commission amounts
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_bookingAmount_positive" CHECK (bookingAmount >= 0);
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_commissionAmount_positive" CHECK (commissionAmount >= 0);

-- Payout amount constraint
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_positive" CHECK (amount >= 0);

-- Customer lifetime revenue
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_lifetimeRevenue_positive" CHECK (lifetimeRevenue >= 0);

-- Partner financial fields
ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_totalRevenueGenerated_positive" CHECK (totalRevenueGenerated >= 0);
ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_totalCommissionEarned_positive" CHECK (totalCommissionEarned >= 0);
ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_totalCommissionPaid_positive" CHECK (totalCommissionPaid >= 0);
ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_totalCommissionPending_positive" CHECK (totalCommissionPending >= 0);
